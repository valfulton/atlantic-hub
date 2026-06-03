/**
 * /client/intake-form/[token] — PUBLIC, no-login prefilled intake.
 *
 * Opened from the operator's share link. Verifies the signed token
 * (lib/auth/intake-share), loads the client's prefilled brief, and renders the
 * intake form. No session, no password, no gate — they just fill it and submit
 * (via /api/client/intake-form, authorized by the same token). Not in the
 * middleware matcher, so it's reachable without logging in.
 *
 * (val 2026-06-02) REVERTED: this page used to render brand-tabs +
 * IntakeSocialChannelsBlock around the form for owner-scoped tokens. val hated
 * the resulting page (dark social block off-brand, tabs noisy). Stripped back
 * to the original single-form layout. We still RESOLVE owner-scoped tokens so
 * existing all-brands intake links don't 404 -- they just open the first allowed
 * brand silently, no UI change. Multi-brand UX will get re-designed separately.
 */
import { resolveIntakeShareToken } from '@/lib/auth/intake-share';
import { listBrandsForUser } from '@/lib/client/membership';
import { findClientUserById } from '@/lib/auth/client-user';
import { getBriefPayload } from '@/lib/client/brief_store';
import { getAvDb } from '@/lib/db/av';
import ClientIntakeForm from '@/app/client/intake/ClientIntakeForm';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function PublicIntakeFormPage({ params }: { params: { token: string } }) {
  const scope = await resolveIntakeShareToken(params.token);

  if (scope.kind === 'invalid') {
    return (
      <main className="max-w-lg mx-auto px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-ink">This link isn&apos;t valid</h1>
        <p className="text-sm text-muted mt-2">It may have expired. Ask Atlantic &amp; Vine for a fresh link.</p>
      </main>
    );
  }

  let clientId: number;
  if (scope.kind === 'owner') {
    const memberships = await listBrandsForUser(scope.clientUserId);
    if (memberships.length > 0) {
      clientId = memberships[0].clientId; // pick first allowed brand silently
    } else {
      const u = await findClientUserById(scope.clientUserId);
      clientId = u?.client_id ?? 0;
    }
    if (!clientId) {
      return (
        <main className="max-w-lg mx-auto px-4 py-16 text-center">
          <h1 className="text-xl font-semibold text-ink">No brands found</h1>
          <p className="text-sm text-muted mt-2">Ask Atlantic &amp; Vine to set up your account.</p>
        </main>
      );
    }
  } else {
    clientId = scope.clientId;
  }

  let initial: Record<string, unknown> = {};
  try {
    initial = ((await getBriefPayload('av', clientId)) as Record<string, unknown>) ?? {};
  } catch {
    initial = {};
  }

  // (#299) Resolve the brand name with a smarter fallback chain. The original
  // SELECT client_name read the operator-entered display label, which is often
  // a person's name (e.g. 'Timothy Helfrey') rather than the brand (e.g.
  // 'OPHORA Water Technologies') — so the form opened with "Let's make Timothy
  // Helfrey shine" when it should have said "Let's make OPHORA Water shine."
  //
  // Priority:
  //   1. brief_payload.companyName / company_name / business_name (intake-canonical)
  //   2. brief_payload.brandName / brand_name (intake-canonical, alt key)
  //   3. clients.client_name (operator label — last resort; may be a person)
  //   4. 'your business' (fallback)
  //
  // Multi-brand accounts (Adriana = CBB + CLDA under one login) keep working
  // because each brand has its own client_id row and own brief_payload, so
  // the chain resolves to the active brand correctly.
  function pickFromInitial(...keys: string[]): string | null {
    for (const k of keys) {
      const v = (initial as Record<string, unknown>)[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
  }
  let brandName =
    pickFromInitial('companyName', 'company_name', 'business_name', 'brandName', 'brand_name')
    || 'your business';
  if (brandName === 'your business') {
    try {
      const db = getAvDb();
      const [rows] = await db.execute<(RowDataPacket & { client_name: string | null })[]>(
        `SELECT client_name FROM clients WHERE client_id = ? LIMIT 1`,
        [clientId]
      );
      if (rows[0]?.client_name) brandName = rows[0].client_name;
    } catch { /* keep default */ }
  }

  return (
    <main className="w-full max-w-4xl mx-auto px-3 sm:px-4 py-6 sm:py-10" data-tenant="av">
      <ClientIntakeForm initial={initial} brandName={brandName} shareToken={params.token} />
    </main>
  );
}
