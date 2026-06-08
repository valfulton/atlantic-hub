/**
 * POST /api/admin/av/clients/[client_id]/dossier/address-screen  (#529, val 2026-06-08)
 *
 * Run a financial-stress screen against every address in the dossier's
 * address_history. For each address:
 *   - Geocode via Census Bureau (free)
 *   - Pull HMDA county-level mortgage market signal
 *   - Stub per-property record (gated on Puppeteer worker #422)
 *
 * Persists results to public_intel_records keyed by address slug so the
 * Intelligence Feed shows per-address rows, not state aggregates. Also
 * adds a red flag summarizing each address's market-stress signal.
 *
 * Operator-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getDossier, saveDossier, newRedFlagId } from '@/lib/av/client_dossier';
import { screenAddressesAndPersist } from '@/lib/av/address_stress_screen';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/[client_id]/dossier/address-screen:POST',
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

  // Read address history off the dossier. We screen every distinct address.
  const dossier = await getDossier(clientId);
  const addressSet = new Set<string>();
  for (const a of dossier.addressHistory) {
    if (a.address && a.address.trim().length > 5) addressSet.add(a.address.trim());
  }
  // Also include the personal_address field if it's not already in history
  if (dossier.personalAddress && dossier.personalAddress.trim().length > 5) {
    addressSet.add(dossier.personalAddress.trim());
  }
  const addresses = Array.from(addressSet);

  if (addresses.length === 0) {
    return NextResponse.json({
      ok: false,
      error: 'No addresses on the dossier. Add at least one address (Personal address or Address history) before running the screen.'
    }, { status: 400 });
  }

  const results = await screenAddressesAndPersist(clientId, addresses);

  // Add a red flag per geocoded address summarizing the market stress.
  // We drop the existing address_screen flags first so re-runs don't pile up.
  const preserved = dossier.redFlags.filter((f) => f.source !== 'address_screen');
  const fetchedAt = new Date().toISOString();
  const newFlags = results
    .filter((r) => r.ok)
    .map((r) => {
      // Severity ladder based on denial rate (a market stress proxy):
      // <8% = low, 8-15% = medium, >15% = high. Tweak as we learn.
      const denialRate = r.hmda?.denial_rate ?? 0;
      const severity: 'low' | 'medium' | 'high' =
        denialRate > 0.15 ? 'high' : denialRate > 0.08 ? 'medium' : 'low';
      return {
        id: newRedFlagId(),
        label: r.signalLabel,
        source: 'address_screen',
        severity,
        surfaced_at: fetchedAt
      };
    });

  await saveDossier(
    clientId,
    {
      redFlags: [...newFlags, ...preserved],
      lastScreenedAtNow: true
    },
    { updatedBy: `user:${guard.actor.userId ?? 'operator'}` }
  );

  return NextResponse.json({
    ok: true,
    addresses_screened: results.length,
    geocoded: results.filter((r) => r.ok).length,
    results
  });
}
