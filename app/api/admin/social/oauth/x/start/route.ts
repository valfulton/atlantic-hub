import { NextRequest } from 'next/server';
import { handleOAuthStart } from '@/lib/social/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handleOAuthStart(req, 'x');
}
