/**
 * /client/intake-form/[token] — PUBLIC, no-login prefilled intake.
 *
 * Opened from the operator's share link. Two token shapes:
 *   - single-brand intake share (legacy): grants one client_id.
 *   - owner-scoped intake share (#45 Phase B): grants the OWNER access to
 *     every brand they belong to. ?brand=<id> selects which brand's intake
 *     is currently shown; BrandTabsHeader gives them the tab switcher.
 *
 * No session, no password, no gate — they just fill it and submit. Not in
 * the middleware matcher, so it's reachable without logging in. The token
 * itself is the auth.
 */
import { resolveIntakeShareToken } from '@/lib/auth/intake-share';
import { listBrandsForUser } from '@/lib/client/membership';
import { findClientUserById } from '@/lib/auth/client-user';
import { getBriefPayload } from '@/lib/client/brief_store';
import { getAvDb } from '@/lib/db/av';
import ClientIntakeForm from '@/app/client/intake/ClientIntakeForm';
import BrandTabsHeader from './_components/BrandTabsHeader';
import IntakeSocialChannelsBlock from './_components/IntakeSocialChannelsBlock';
import type { RowDataPacket } from 'mysql2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PageProps {
  params: { token: string };
  searchParams: { brand?: string };
}

export default async function PublicIntakeFormPage({ params, searchParams }: PageProps) {
  const scope = await resolveIntakeShareToken(params.token);

  if (scope.kind === 'invalid') {
    return (
      <main className="max-w-lg mx-auto px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-ink">This link isn&apos;t valid</h1>
        <p className="text-sm text-muted mt-2">It may have expired. Ask Atlantic &amp; Vine for a fresh link.</p>
      </main>
    );
  }

  // Resolve which brand we're rendering + the tabs (if any).
  let clientId: number;
  let brands: { clientId: number; clientName: string | null }[] = [];
  if (scope.kind === 'owner') {
    const memberships = await listBrandsForUser(scope.clientUserId);
    // Owner role can fill any of their brand intakes; reps + viewers see only
    // their own brand if listed (rare for this flow but cheap to allow).
    brands = memberships.map((m) => ({ clientId: m.clientId, clientName: m.clientName }));
    if (brands.length === 0) {
      // Owner has no brand memberships -- fall back to their primary client_id.
      const user = await findClientUserById(scope.clientUserId);
      if (user?.client_id) {
        brands = [{ clientId: user.client_id, clientName: null }];
      } else {
        return (
          <main className="max-w-lg mx-auto px-4 py-16 text-center">
            <h1 className="text-xl font-semibold text-ink">No brands found</h1>
            <p className="text-sm text-muted mt-2">Ask Atlantic &amp; Vine to set up your account.</p>
          </main>
        );
      }
    }
    const requested = Number.parseInt(searchParams.brand ?? '', 10);
    const allowed = brands.some((b) => b.clientId === requested);
    clientId = allowed ? requested : brands[0].clientId;
  } else {
    clientId = scope.clientId;
  }

  let initial: Record<string, unknown> = {};
  try {
    initial = ((await getBriefPayload('av', clientId)) as Record<string, unknown>) ?? {};
  } catch {
    initial = {};
  }

  // (#299) Resolve brand name with smarter fallback chain (see earlier comment).
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

  // For the brand tabs: take the brand label from the brief payload first
  // (so Adriana sees "CBB" / "CLDA" instead of operator-entered display labels)
  // -- requires looking up each brand's brief, but that's already cached.
  if (scope.kind === 'owner' && brands.length > 1) {
    const labeled = await Promise.all(
      brands.map(async (b) => {
        try {
          const bp = (await getBriefPayload('av', b.clientId)) as Record<string, unknown> | null;
          const fromBrief =
            (bp?.companyName as string | undefined) ||
            (bp?.company_name as string | undefined) ||
            (bp?.brandName as string | undefined) ||
            null;
          return { clientId: b.clientId, clientName: (fromBrief && fromBrief.trim()) || b.clientName };
        } catch {
          return b;
        }
      })
    );
    brands = labeled;
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 sm:py-10" data-tenant="av">
      {scope.kind === 'owner' && (
        <BrandTabsHeader brands={brands} activeClientId={clientId} token={params.token} />
      )}
      <ClientIntakeForm initial={initial} brandName={brandName} shareToken={params.token} />
      <IntakeSocialChannelsBlock token={params.token} clientId={clientId} brandName={brandName} />
    </main>
  );
}
