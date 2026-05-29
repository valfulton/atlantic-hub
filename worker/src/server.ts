/**
 * worker/src/server.ts  (#225)
 *
 * Long-running Node process that owns the heavy AI work for Atlantic Hub.
 * Runs OUTSIDE Netlify so the 60s function ceiling does not constrain bulk
 * refresh or sweep batches. Hub UI POSTs here when NEXT_PUBLIC_WORKER_URL
 * is configured; otherwise falls back to the Netlify endpoints.
 *
 * Endpoints (all POST, JSON):
 *   /refresh-intel   -- same body shape as /api/admin/av/leads/refresh-intel
 *                       in the hub: { auditIds, audits, callScripts, outreach }
 *   /health          -- liveness check, no auth required (cheap, returns 200)
 *
 * Auth: every endpoint except /health requires header X-Worker-Secret to
 * match env WORKER_SECRET. Shared secret pattern — keeps it simple.
 *
 * Imports the same AI helpers from ../lib/* as the hub. The tsconfig wires
 * the @/lib/* path alias to the hub source. Drift is impossible: when val
 * pushes a fix to lib/ai/score_and_audit.ts on Netlify, the next worker
 * rebuild picks it up identically.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import { scoreAndAuditLead } from '@/lib/ai/score_and_audit';
import { extractPainProfileForLead } from '@/lib/ai/pain_extractor';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

const PORT = Number.parseInt(process.env.PORT || '4001', 10);
const WORKER_SECRET = process.env.WORKER_SECRET || '';

// Per-batch deadline — no platform ceiling here, but we still cap so a
// runaway batch doesn't hold the connection forever. Generous because we
// own the process: 5 minutes per request is fine.
const SOFT_DEADLINE_MS = 5 * 60 * 1000;
const MAX_LEADS_PER_REQUEST = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const app = express();
app.use(express.json({ limit: '256kb' }));

// CORS — only allow the hub origin to call us. Adjust HUB_ORIGIN env to your
// Netlify URL (or your wrapped atlanticandvine.com if you migrate).
app.use((req: Request, res: Response, next: NextFunction) => {
  const hubOrigin = process.env.HUB_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', hubOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Worker-Secret');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// Auth middleware -- applies to everything except /health.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/health') return next();
  if (!WORKER_SECRET) {
    res.status(503).json({ error: 'worker_misconfigured', detail: 'WORKER_SECRET not set' });
    return;
  }
  const header = req.headers['x-worker-secret'];
  if (header !== WORKER_SECRET) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

interface RefreshResult {
  requestedLeads: number;
  matchedLeads: number;
  audits: { reset: number; regenerated: number; failed: number };
  callScripts: { reset: number; regenerated: number; failed: number };
  outreach: { deleted: number };
  stoppedEarly: boolean;
  elapsedMs: number;
}

app.post('/refresh-intel', async (req: Request, res: Response) => {
  const body = req.body as { auditIds?: unknown; audits?: unknown; callScripts?: unknown; outreach?: unknown };
  const auditIds = Array.isArray(body.auditIds)
    ? body.auditIds.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)).slice(0, MAX_LEADS_PER_REQUEST)
    : [];
  if (auditIds.length === 0) {
    res.status(400).json({ error: 'no valid auditIds' });
    return;
  }
  const doAudits = body.audits === true;
  const doCallScripts = body.callScripts === true;
  const doOutreach = body.outreach === true;
  if (!doAudits && !doCallScripts && !doOutreach) {
    res.status(400).json({ error: 'nothing_selected' });
    return;
  }

  const start = Date.now();
  const result: RefreshResult = {
    requestedLeads: auditIds.length,
    matchedLeads: 0,
    audits: { reset: 0, regenerated: 0, failed: 0 },
    callScripts: { reset: 0, regenerated: 0, failed: 0 },
    outreach: { deleted: 0 },
    stoppedEarly: false,
    elapsedMs: 0
  };

  try {
    const db = getAvDb();
    const placeholders = auditIds.map(() => '?').join(',');
    const [leadRows] = await db.execute<(RowDataPacket & { id: number })[]>(
      `SELECT id FROM leads WHERE audit_id IN (${placeholders}) AND archived_at IS NULL`,
      auditIds
    );
    const leadIds = leadRows.map((r) => r.id);
    result.matchedLeads = leadIds.length;
    if (leadIds.length === 0) {
      result.elapsedMs = Date.now() - start;
      res.json({ ok: true, ...result });
      return;
    }

    const idPh = leadIds.map(() => '?').join(',');

    // ---- AUDITS ----
    if (doAudits) {
      const [upd] = await db.execute<ResultSetHeader>(
        `UPDATE leads
            SET ai_last_scored_at = NULL,
                audit_content     = NULL,
                ai_score_reason   = NULL
          WHERE id IN (${idPh})`,
        leadIds
      );
      result.audits.reset = upd.affectedRows;
      for (const id of leadIds) {
        if (Date.now() - start > SOFT_DEADLINE_MS) {
          result.stoppedEarly = true;
          break;
        }
        try {
          const r = await scoreAndAuditLead(id);
          if (r && !r.skipped) result.audits.regenerated += 1;
        } catch (err) {
          result.audits.failed += 1;
          console.error('[worker:refresh-intel:audit]', id, (err as Error).message);
        }
      }
    }

    // ---- CALL SCRIPTS ----
    if (doCallScripts && !result.stoppedEarly) {
      const [upd] = await db.execute<ResultSetHeader>(
        `UPDATE leads
            SET pain_extracted_at = NULL,
                pain_point_profile = NULL
          WHERE id IN (${idPh})`,
        leadIds
      );
      result.callScripts.reset = upd.affectedRows;
      for (const id of leadIds) {
        if (Date.now() - start > SOFT_DEADLINE_MS) {
          result.stoppedEarly = true;
          break;
        }
        try {
          const r = await extractPainProfileForLead(id);
          if (r !== null) result.callScripts.regenerated += 1;
        } catch (err) {
          result.callScripts.failed += 1;
          console.error('[worker:refresh-intel:pain]', id, (err as Error).message);
        }
      }
    }

    // ---- OUTREACH DRAFTS ----
    if (doOutreach) {
      const [del] = await db.execute<ResultSetHeader>(
        `DELETE FROM outreach_messages
          WHERE lead_id IN (${idPh})
            AND status IN ('draft', 'pending_approval')`,
        leadIds
      );
      result.outreach.deleted = del.affectedRows;
    }

    // (#177 fix mirrored) Bust dashboard guidance cache for affected clients.
    try {
      await db.execute<ResultSetHeader>(
        `DELETE FROM intelligence_objects
          WHERE object_type IN ('next_best_moves', 'momentum_signals')
            AND tenant_id IN (
              SELECT CONCAT('client:', cu.client_user_id)
                FROM client_users cu
                JOIN leads l ON l.client_id = cu.client_id
               WHERE l.id IN (${idPh})
            )`,
        leadIds
      );
    } catch (err) {
      console.error('[worker:refresh-intel:guidance-clear]', (err as Error).message);
    }

    result.elapsedMs = Date.now() - start;
    await logEvent({
      eventType: 'leads.refresh_intel',
      source: 'worker',
      executionTimeMs: result.elapsedMs,
      payload: {
        worker: true,
        do_audits: doAudits,
        do_call_scripts: doCallScripts,
        do_outreach: doOutreach,
        ...result
      }
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[worker:refresh-intel]', (err as Error).message);
    res.status(500).json({ error: 'refresh_failed', message: (err as Error).message.slice(0, 300) });
  }
});

// Startup
if (process.argv.includes('--smoke')) {
  console.log('[worker] smoke test mode — exiting after import resolution');
  process.exit(0);
}

const server = app.listen(PORT, () => {
  console.log(`[worker] listening on :${PORT} (secret=${WORKER_SECRET ? 'set' : 'UNSET — endpoints will 503'})`);
});

// Graceful shutdown
function shutdown(sig: string) {
  console.log(`[worker] received ${sig} — closing server`);
  server.close(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
