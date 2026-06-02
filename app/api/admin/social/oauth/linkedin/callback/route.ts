// EXTERNAL-ENTRY — entered by an external provider/email, not by in-app code
// (OAuth provider redirect via env URLs / PR intake email). Zero in-code references is BY DESIGN.
// Do NOT delete in a dead-code sweep. See Atlantic_Hub_Playbook/Hidden_Pages_Audit.md (PR A).

import { NextRequest } from 'next/server';
import { handleOAuthCallback } from '@/lib/social/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handleOAuthCallback(req, 'linkedin');
}
