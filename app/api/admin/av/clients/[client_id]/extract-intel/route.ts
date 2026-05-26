/**
 * POST /api/admin/av/clients/[client_id]/extract-intel
 *
 * Operator-triggered: read this client's intake and distill it into canonical
 * intelligence_objects (System Constitution section 5, "Intake Extraction").
 * Button-driven so val controls when it spends; the prompt is visible/editable on
 * the AI Prompts page. Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { extractIntakeIntelligence } from '@/lib/client/intake_extract';
import { proposeLinesFromIntake } from '@/lib/campaigns/propose_lines';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/clients/extract-intel:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) return NextResponse.json({ error: 'invalid client id' }, { status: 400 });

  try {
    const result = await extractIntakeIntelligence({ clientId, actorUserId: null });

    // Auto-propose narrative-line candidates from the same intake (skips if the
    // client already has lines, so re-running never spams duplicates).
    let linesProposed = 0;
    if (result.reason !== 'no_intake') {
      try {
        const p = await proposeLinesFromIntake({ clientId });
        linesProposed = p.proposed;
      } catch {
        /* non-fatal: extraction still succeeded */
      }
    }

    return NextResponse.json({ ...result, linesProposed });
  } catch (err) {
    return NextResponse.json({ error: 'extraction failed', errorClass: (err as Error).name }, { status: 500 });
  }
}
