/**
 * POST /api/admin/av/leads/[audit_id]/find-another-poc   (#252 Inc 3)
 *
 * Operator-side trigger for the "find another POC" workflow. One Apollo
 * call, filter via the ICP title prefs (Inc 1) + drop the current contact's
 * title, insert the first survivor as a NEW lead at the same company. The
 * implementation lives in lib/apollo/find_another_poc.ts; this route is the
 * thin authz + validation + JSON-shape wrapper.
 *
 * Body: empty — the lead's audit_id is in the path, everything else is
 * derived from the lead's row + the owning client's ICP.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import { findAnotherPocForLead } from '@/lib/apollo/find_another_poc';

export const runtime = 'nodejs';
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: { audit_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/leads/[audit_id]/find-another-poc:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }
  if (!UUID_RE.test(params.audit_id)) {
    return NextResponse.json({ error: 'invalid audit_id' }, { status: 400 });
  }

  try {
    const result = await findAnotherPocForLead({ auditId: params.audit_id });
    // 200 on both success AND soft-failure — the UI distinguishes by the `ok`
    // boolean and renders `reason` when ok=false. We reserve 4xx/5xx for
    // genuine wire-level failures (auth, AV-tab-disabled, malformed audit_id).
    return NextResponse.json(result);
  } catch (err) {
    console.error('[find-another-poc]', (err as Error).message);
    return NextResponse.json(
      { ok: false, reason: 'server error', errorClass: (err as Error).name },
      { status: 500 }
    );
  }
}
