/**
 * POST /api/admin/av/clients/[client_id]/dossier/lookup-patents  (#521b)
 *
 * Run USPTO patent lookup for this client. Pulls company + contact_name
 * from the brief, fires PatentsView, returns hits. Operator-only.
 *
 * Body: { } (no body needed — pulls from brief)
 *   OR  { companyOverride?: string, contactOverride?: string } to test
 *       a different query without touching the brief.
 *
 * Side effect: if hits are found, appends a red flag entry to the dossier
 * red-flag log (severity: 'low' if assignee hits, 'medium' if 10+ hits, since
 * a flurry of patents can also signal litigious behaviour).
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { lookupPatentsForClient } from '@/lib/av/uspto_patents';
import { getDossier, saveDossier, newRedFlagId } from '@/lib/av/client_dossier';
import { getBriefPayload } from '@/lib/client/brief_store';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface Body {
  companyOverride?: string;
  contactOverride?: string;
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/[client_id]/dossier/lookup-patents:POST',
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

  let body: Body = {};
  try { body = (await req.json()) as Body; } catch { /* empty body ok */ }

  // Pull defaults from the brief.
  const brief = (await getBriefPayload('av', clientId)) as Record<string, unknown> | null;
  const companyFromBrief = typeof brief?.company === 'string' ? brief.company : null;
  const contactFromBrief = typeof brief?.contact_name === 'string' ? brief.contact_name : null;

  const company = body.companyOverride?.trim() || companyFromBrief;
  const contact = body.contactOverride?.trim() || contactFromBrief;

  if (!company && !contact) {
    return NextResponse.json({
      ok: false,
      error: 'No company name or contact name on the brief. Fill those in first or pass companyOverride/contactOverride.'
    }, { status: 400 });
  }

  const result = await lookupPatentsForClient({ companyName: company, contactName: contact });

  // If hits exist, surface as red flags so the operator sees them in the
  // dossier log + the client page ribbon.
  const totalHits = result.byAssignee.length + result.byInventor.length;
  if (totalHits > 0) {
    const current = await getDossier(clientId);
    const newFlag = {
      id: newRedFlagId(),
      label: `${totalHits} patent${totalHits === 1 ? '' : 's'} on USPTO · ${result.byAssignee.length} by company, ${result.byInventor.length} by inventor`,
      source: 'uspto_patents' as const,
      severity: (totalHits >= 10 ? 'medium' : 'low') as 'low' | 'medium',
      surfaced_at: result.fetchedAt
    };
    // Dedupe: if the most recent uspto_patents flag has the same totals, replace it; else prepend.
    const existing = current.redFlags.filter((f) => f.source !== 'uspto_patents');
    await saveDossier(clientId, { redFlags: [newFlag, ...existing] }, {
      updatedBy: guard.actor.userId ? `user:${guard.actor.userId}` : 'operator'
    });
  }

  return NextResponse.json({ ok: true, result });
}
