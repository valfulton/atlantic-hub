/**
 * POST /api/admin/av/clients/[client_id]/fill-intake-from-web  (#235)
 *
 * Two modes, both via this one endpoint:
 *   - mode='preview'  -> fetch URL + run LLM, return the suggested payload.
 *                        DOES NOT write to the DB. Operator reviews first.
 *   - mode='apply'    -> caller passes the suggestions BACK with applyKeys[]
 *                        (the keys the operator chose to keep). We
 *                        JSON_MERGE_PATCH those keys onto creative_briefs +
 *                        client_users.intake_payload. Respects the same
 *                        "merge-only" safety as our SQL part-2 scripts.
 *
 * The preview step is the cost step (one OpenAI call). Apply is cheap — pure
 * DB writes — and never re-runs the LLM. So an operator who keeps clicking
 * "Apply" with edited suggestions doesn't burn tokens repeatedly.
 *
 * Owner/staff only. client_user role explicitly rejected.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { getBriefPayload, saveBriefPayload } from '@/lib/client/brief_store';
import { INTAKE_KEYS } from '@/lib/client/intake_fields';
import { suggestIntakeFromUrl, suggestIntakeFromSite, IntakeWebFetchError } from '@/lib/client/intake_web_filler';
import { stampWebsiteOnBrief } from '@/lib/client/website_resolver';
import { logEvent } from '@/lib/events/log';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';
// Web fetch + LLM call can take 15-25s for slow sites. Cap at 60s.
export const maxDuration = 60;

interface PreviewBody {
  mode: 'preview';
  url: string;
  /** (val 2026-06-07) When true, auto-discover same-origin subpages (about,
   *  services, contact, etc.) from the homepage and blend their text into
   *  ONE LLM call. One click captures the whole site instead of forcing val
   *  to paste each URL separately. Defaults to true for new previews. */
  multiPage?: boolean;
}
interface ApplyBody {
  mode: 'apply';
  /** The suggestions object returned by a previous preview call, optionally
   *  edited by the operator before re-submitting. */
  suggestions: Record<string, string>;
  /** Which keys to actually write. Subset of Object.keys(suggestions). */
  applyKeys: string[];
  /** When true (default), only write keys that are currently blank in the
   *  stored payload. When false, overwrite any matching keys. */
  blanksOnly?: boolean;
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/[client_id]/fill-intake-from-web:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client_id' }, { status: 400 });
  }

  let body: PreviewBody | ApplyBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  // -------- PREVIEW --------
  if (body.mode === 'preview') {
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 });

    // Pull the client's name as a hint so the LLM knows whose page it's reading.
    let brandHint: string | null = null;
    try {
      const db = getAvDb();
      const [rows] = await db.execute<(RowDataPacket & { client_name: string | null })[]>(
        `SELECT client_name FROM clients WHERE client_id = ? LIMIT 1`,
        [clientId]
      );
      brandHint = rows[0]?.client_name?.trim() || null;
    } catch { /* non-fatal */ }

    try {
      // (val 2026-06-07) Default to multi-page auto-discover. Caller can pass
      // multiPage:false to force single-page (e.g. when val wants to re-read
      // ONE specific URL like /blog/specific-post that's not in the nav).
      const useMultiPage = body.multiPage !== false;
      const result = useMultiPage
        ? await suggestIntakeFromSite({ url, brandHint, clientId })
        : await suggestIntakeFromUrl({ url, brandHint, clientId });

      // (#517, val 2026-06-08) The fetch succeeded — that URL IS the client's
      // website. Persist it to brief_payload.website_url if currently blank so
      // pre-flight, brand-kit, audit, social-scrape all see the same website
      // (no more "ran the scrape but pre-flight still says no website on brief").
      // Blanks-only: never overwrites a hand-curated value. Uses result.fetchedUrl
      // (post-redirect canonical) when available; falls back to the pasted URL.
      void stampWebsiteOnBrief('av', clientId, result.fetchedUrl || url, {
        changedBy: guard.actor.userId ? `user:${guard.actor.userId}` : 'operator',
        source: 'intake_web_filler:preview'
      });

      // Also tell the caller which of the suggested keys are currently blank in
      // the stored payload, so the UI can default-check just those keys.
      const current = (await getBriefPayload('av', clientId)) ?? {};
      const blankKeys: string[] = [];
      const overwriteKeys: string[] = [];
      // For overwrite keys, also return the EXISTING stored value so the UI
      // can show val what's about to be replaced ("Current: …" line above the
      // suggested value). Truncated to keep the payload sane.
      const existing: Record<string, string> = {};
      for (const k of Object.keys(result.suggestions)) {
        const stored = (current as Record<string, unknown>)[k];
        const isBlank = typeof stored !== 'string' || stored.trim().length === 0;
        if (isBlank) {
          blankKeys.push(k);
        } else {
          overwriteKeys.push(k);
          existing[k] = (stored as string).slice(0, 800);
        }
      }
      return NextResponse.json({
        ok: true,
        ...result,
        blankKeys,
        overwriteKeys,
        existing
      });
    } catch (err) {
      if (err instanceof IntakeWebFetchError) {
        return NextResponse.json({ error: err.message }, { status: err.statusCode });
      }
      console.error('[fill-intake-from-web:preview]', (err as Error).message);
      return NextResponse.json(
        { error: 'preview failed', detail: (err as Error).message },
        { status: 500 }
      );
    }
  }

  // -------- APPLY --------
  if (body.mode === 'apply') {
    if (!body.suggestions || typeof body.suggestions !== 'object') {
      return NextResponse.json({ error: 'suggestions object is required' }, { status: 400 });
    }
    if (!Array.isArray(body.applyKeys) || body.applyKeys.length === 0) {
      return NextResponse.json({ error: 'applyKeys must be a non-empty array' }, { status: 400 });
    }
    const blanksOnly = body.blanksOnly !== false; // default true
    const allowed = new Set(INTAKE_KEYS);

    try {
      // Build the patch from applyKeys, scoped to canonical intake keys + the
      // suggestions object. If blanksOnly is set, drop keys that already have
      // a non-empty value in the stored payload.
      const current = (await getBriefPayload('av', clientId)) ?? {};
      const patch: Record<string, string> = {};
      const writtenKeys: string[] = [];
      const skippedNonBlank: string[] = [];

      for (const k of body.applyKeys) {
        if (!allowed.has(k)) continue;
        const v = body.suggestions[k];
        if (typeof v !== 'string' || !v.trim()) continue;
        const existing = (current as Record<string, unknown>)[k];
        const isBlank = typeof existing !== 'string' || existing.trim().length === 0;
        if (blanksOnly && !isBlank) {
          skippedNonBlank.push(k);
          continue;
        }
        patch[k] = v.trim().slice(0, 4000);
        writtenKeys.push(k);
      }

      if (writtenKeys.length === 0) {
        return NextResponse.json({
          ok: true,
          writtenKeys: [],
          skippedNonBlank,
          note: 'Nothing to write (every chosen key was already filled and blanksOnly was true).'
        });
      }

      // Merge into the brief payload (creative_briefs) -- the same writer used
      // by every other intake mutation, so snapshotBriefVersion runs and val
      // can roll back from the brief versions tab if she doesn't like the
      // result.
      const merged = { ...current, ...patch };
      const ok = await saveBriefPayload('av', clientId, merged, {
        changedBy: guard.actor.userId ? `user:${guard.actor.userId}` : 'operator',
        source: 'web_filler'
      });
      if (!ok) {
        return NextResponse.json({ error: 'save failed' }, { status: 500 });
      }

      // Mirror to client_users.intake_payload so the preview at /preview/intake
      // renders fully (same pattern as the SQL part-2 loaders).
      try {
        const db = getAvDb();
        await db.execute<ResultSetHeader>(
          `UPDATE client_users
              SET intake_payload = JSON_MERGE_PATCH(COALESCE(intake_payload, JSON_OBJECT()), CAST(? AS JSON))
            WHERE client_id = ?`,
          [JSON.stringify(patch), clientId]
        );
      } catch (err) {
        // Non-fatal: the brief is the source of truth; mirror is convenience.
        console.error('[fill-intake-from-web:mirror]', (err as Error).message);
      }

      await logEvent({
        eventType: 'intake.web_fill.applied',
        userId: guard.actor.userId,
        source: 'operator',
        status: 'success',
        payload: { client_id: clientId, written_keys: writtenKeys, skipped_non_blank: skippedNonBlank }
      });

      return NextResponse.json({ ok: true, writtenKeys, skippedNonBlank });
    } catch (err) {
      console.error('[fill-intake-from-web:apply]', (err as Error).message);
      return NextResponse.json(
        { error: 'apply failed', detail: (err as Error).message },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: 'invalid mode' }, { status: 400 });
}
