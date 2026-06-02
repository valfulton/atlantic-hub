/**
 * lib/leads/normalize.ts
 *
 * Single home for lead-identity normalization.
 *
 * Consolidated 2026-06-02 (Lean Pass) from three drifted copies of realEmail()
 * in lib/sales/rep_dashboard.ts, lib/client/leads.ts, and lib/client/lead_detail.ts.
 * The copies had diverged: two anchored the synthetic-address filter to
 * @eventsbywater.com, lead_detail.ts did not — so the same lead could show an
 * email in one view and a blank in another.
 *
 * Canonical rule (val ruling): UNANCHORED. `prospect+`, `apollo+`, and `noemail+`
 * are Apollo synthetic catch-all addresses and are never deliverable mailboxes,
 * regardless of the domain that follows. Filter them on ANY domain.
 *
 * Pure functions only — no imports — so this is safe to use from both operator
 * and client-portal data layers without dragging in any module graph.
 */

/**
 * Returns the email if it is a real, deliverable mailbox; otherwise null.
 * Filters Apollo synthetic catch-alls (prospect+ / apollo+ / noemail+, any domain)
 * and the eventsbywater.com info@ catch-all.
 */
export function realEmail(e: string | null): string | null {
  if (!e || !e.trim()) return null;
  const v = e.trim();
  if (/^(prospect|apollo|noemail)\+/i.test(v)) return null;
  if (/^info@eventsbywater\.com$/i.test(v)) return null;
  return v;
}
