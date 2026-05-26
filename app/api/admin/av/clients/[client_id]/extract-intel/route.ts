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
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: 'extraction failed', errorClass: (err as Error).name }, { status: 500 });
  }
}
