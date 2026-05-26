/**
 * GET /api/admin/av/employees/[user_id]/documents/[doc_id]
 *
 * Streams an employee document's bytes from hot storage. Owner + staff only
 * (behind the /api/admin guard), so sensitive files are never public.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getHotStorage } from '@/lib/storage/provider';
import { getEmployeeDocument } from '@/lib/employees/store';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { user_id: string; doc_id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/employees/documents:GET', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const userId = Number.parseInt(params.user_id, 10);
  const docId = Number.parseInt(params.doc_id, 10);
  if (!Number.isFinite(docId) || docId <= 0) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const doc = await getEmployeeDocument(docId);
  if (!doc || doc.user_id !== userId) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const bytes = await getHotStorage('employee-docs').getBytes(doc.file_url);
  if (!bytes) return NextResponse.json({ error: 'file not found in storage' }, { status: 404 });

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      'content-type': doc.content_type || 'application/octet-stream',
      'content-disposition': `inline; filename="${doc.label.replace(/[^a-zA-Z0-9._ -]/g, '_')}"`,
      'cache-control': 'private, no-store'
    }
  });
}
