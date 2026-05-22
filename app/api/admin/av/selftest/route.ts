/**
 * GET /api/admin/av/selftest
 *
 * One-call health probe for the commercial / brand-kit / social-content
 * stack, so the operator can confirm everything is wired without clicking
 * through every lead. Reports, for the AV product database:
 *   - which env keys are present (booleans only -- never the values)
 *   - which tables exist and how many rows they hold
 *   - a few rolled-up signal counts (logos on file, library logos, drafts,
 *     commercials by status)
 *   - the most recent recorded failures, so a broken button explains itself
 *
 * Every probe is wrapped individually: a missing table or column degrades
 * that one line to { ok: false } instead of failing the whole report.
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface CountRow extends RowDataPacket {
  n: number;
}

async function safeCount(sql: string, args: unknown[] = []): Promise<{ ok: boolean; n: number | null; error?: string }> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<CountRow[]>(sql, args);
    const n = rows[0] ? Number(rows[0].n) : 0;
    return { ok: true, n };
  } catch (err) {
    return { ok: false, n: null, error: (err as Error).message.slice(0, 200) };
  }
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/selftest',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Env presence -- booleans only. A key counts as "present" only if it is
  // non-empty AND (for the AI keys) carries the expected prefix, which is the
  // exact mistake that produced the silent 502 last time.
  const xai = process.env.XAI_API_KEY ?? '';
  const openai = process.env.OPENAI_API_KEY ?? '';
  const env = {
    XAI_API_KEY: { present: xai.length > 0, looksValid: xai.startsWith('xai-') },
    OPENAI_API_KEY: { present: openai.length > 0, looksValid: openai.startsWith('sk-') },
    DB_HOST: { present: !!process.env.DB_HOST },
    DB_USER_AV: { present: !!process.env.DB_USER_AV },
    DB_PASS_AV: { present: !!process.env.DB_PASS_AV }
  };

  // Table existence + row counts. COUNT(*) throws if the table is absent,
  // which is exactly the "schema not applied in production" signal we want.
  const [
    grokAssets,
    brandKits,
    logoLibrary,
    socialDrafts,
    visualBriefs,
    systemEvents
  ] = await Promise.all([
    safeCount('SELECT COUNT(*) AS n FROM grok_imagine_assets'),
    safeCount('SELECT COUNT(*) AS n FROM lead_brand_kits'),
    safeCount('SELECT COUNT(*) AS n FROM operator_logo_library'),
    safeCount('SELECT COUNT(*) AS n FROM lead_social_drafts'),
    safeCount('SELECT COUNT(*) AS n FROM lead_visual_briefs'),
    safeCount('SELECT COUNT(*) AS n FROM system_events')
  ]);

  const tables = {
    grok_imagine_assets: grokAssets,
    lead_brand_kits: brandKits,
    operator_logo_library: logoLibrary,
    lead_social_drafts: socialDrafts,
    lead_visual_briefs: visualBriefs,
    system_events: systemEvents
  };

  // Rolled-up signals -- the numbers that actually answer "is my data here".
  const [
    leadsWithLogo,
    activeLibraryLogos,
    activeDrafts,
    commercialsSucceeded,
    commercialsRunning,
    commercialsFailed
  ] = await Promise.all([
    safeCount('SELECT COUNT(*) AS n FROM lead_brand_kits WHERE logo_data IS NOT NULL'),
    safeCount('SELECT COUNT(*) AS n FROM operator_logo_library WHERE archived_at IS NULL'),
    safeCount("SELECT COUNT(*) AS n FROM lead_social_drafts WHERE status = 'active'"),
    safeCount("SELECT COUNT(*) AS n FROM grok_imagine_assets WHERE generation_status = 'succeeded'"),
    safeCount("SELECT COUNT(*) AS n FROM grok_imagine_assets WHERE generation_status IN ('queued','running')"),
    safeCount("SELECT COUNT(*) AS n FROM grok_imagine_assets WHERE generation_status = 'failed'")
  ]);

  const signals = {
    leads_with_logo_on_file: leadsWithLogo,
    reusable_library_logos: activeLibraryLogos,
    active_social_drafts: activeDrafts,
    commercials_succeeded: commercialsSucceeded,
    commercials_in_flight: commercialsRunning,
    commercials_failed: commercialsFailed
  };

  // Most recent failures, so a button that "does nothing" explains itself.
  let recentFailures: Array<{ eventType: string; source: string | null; error: string | null; at: string }> = [];
  let failuresOk = true;
  try {
    const db = getAvDb();
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT event_type, source, error_message, created_at
       FROM system_events
       WHERE status = 'failure'
       ORDER BY created_at DESC
       LIMIT 8`
    );
    recentFailures = rows.map((r) => ({
      eventType: String(r.event_type),
      source: r.source == null ? null : String(r.source),
      error: r.error_message == null ? null : String(r.error_message).slice(0, 240),
      at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
    }));
  } catch (err) {
    failuresOk = false;
    recentFailures = [{ eventType: 'selftest', source: null, error: (err as Error).message.slice(0, 240), at: '' }];
  }

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    env,
    tables,
    signals,
    recentFailures,
    failuresOk
  });
}
