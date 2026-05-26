/**
 * /client/intake-form/[token] — PUBLIC, no-login prefilled intake.
 *
 * Opened from the operator's share link. Verifies the signed token
 * (lib/auth/intake-share), loads the client's prefilled brief, and renders the
 * intake form. No session, no password, no gate — they just fill it and submit
 * (via /api/client/intake-form, authorized by the same token). Not in the
 * middleware matcher, so it's reachable without logging in.
 */
import { verifyIntakeShareToken } from '@/lib/auth/intake-share';
import { getBriefPayload } from '@/lib/client/brief_store';
import { getAvDb } from '@/lib/db/av';
import ClientIntakeForm from '@/app/client/intake/ClientIntakeForm';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function PublicIntakeFormPage({ params }: { params: { token: string } }) {
  const clientId = await verifyIntakeShareToken(params.token);

  if (!clientId) {
    return (
      <main className="max-w-lg mx-auto px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-ink">This link isn&apos;t valid</h1>
        <p className="text-sm text-muted mt-2">It may have expired. Ask Atlantic &amp; Vine for a fresh link.</p>
      </main>
    );
  }

  let initial: Record<string, unknown> = {};
  try {
    initial = ((await getBriefPayload('av', clientId)) as Record<string, unknown>) ?? {};
  } catch {
    initial = {};
  }

  let brandName = 'your business';
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { client_name: string | null })[]>(
      `SELECT client_name FROM clients WHERE client_id = ? LIMIT 1`,
      [clientId]
    );
    if (rows[0]?.client_name) brandName = rows[0].client_name;
  } catch { /* keep default */ }

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 sm:py-10" data-tenant="av">
      <ClientIntakeForm initial={initial} brandName={brandName} shareToken={params.token} />
    </main>
  );
}
