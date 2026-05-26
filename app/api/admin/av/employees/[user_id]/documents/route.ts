/**
 * Employee documents.
 *   POST   (multipart: file, label?) — upload a document to this employee.
 *   DELETE (?docId=)                 — remove a document record.
 *
 * Owner + staff (an employee can upload their own; operator manages anyone's).
 * Bytes live in hot storage (Netlify Blobs, store 'employee-docs'); the row
 * holds the blob key + label. This is where sensitive paperwork lives (W-9,
 * IDs, signed agreements) — as files, never as profile columns.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getHotStorage } from '@/lib/storage/provider';
import { addEmployeeDocument, deleteEmployeeDocument, getEmployeeDocument } from '@/lib/employees/store';

export const runtime = 'nodejs';
export const maxDuration = 30;

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

export async function POST(req: NextRequest, { params }: { params: { user_id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/employees/documents:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const userId = Number.parseInt(params.user_id, 10);
  if (!Number.isFinite(userId) || userId <= 0) return NextResponse.json({ error: 'invalid user id' }, { status: 400 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'expected multipart form data' }, { status: 400 }); }
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'missing "file" field' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file too large (max 15 MB)' }, { status: 413 });

  const label = (typeof form.get('label') === 'string' && (form.get('label') as string).trim())
    ? (form.get('label') as string).trim()
    : (file.name || 'Document');
  const safeName = (file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const blobKey = `emp/${userId}/${Date.now()}-${safeName}`;

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    await getHotStorage('employee-docs').put(blobKey, buf, file.type || 'application/octet-stream');
    const docId = await addEmployeeDocument({
      userId, label, blobKey, contentType: file.type || null, uploadedBy: guard.actor.userId ?? null
    });
    return NextResponse.json({ ok: true, docId, label });
  } catch (err) {
    return NextResponse.json({ error: 'upload failed', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { user_id: string } }) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/employees/documents:DELETE', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const userId = Number.parseInt(params.user_id, 10);
  const docId = Number.parseInt(req.nextUrl.searchParams.get('docId') ?? '', 10);
  if (!Number.isFinite(docId) || docId <= 0) return NextResponse.json({ error: 'docId required' }, { status: 400 });

  const doc = await getEmployeeDocument(docId);
  if (!doc || doc.user_id !== userId) return NextResponse.json({ error: 'not found' }, { status: 404 });

  try {
    await deleteEmployeeDocument(docId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'delete failed', errorClass: (err as Error).name }, { status: 500 });
  }
}
