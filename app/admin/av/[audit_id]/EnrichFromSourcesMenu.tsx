'use client';

/**
 * EnrichFromSourcesMenu  (#270)
 *
 * One consolidated dropdown for every per-lead enrichment source. Replaces
 * the scattered row of individual buttons that was overflowing the lead
 * detail header. Each source runs its own POST; the menu surfaces an inline
 * result line per source so val can see what filled / failed without leaving
 * the page.
 *
 * Sources wired in: Smart enrich (LLM scrape), Places, Instagram (handle
 * auto-resolved via scrape-first), WHOIS/RDAP. Apollo-by-person is a stub
 * with "coming soon" until val confirms her Apollo plan.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type SourceKey = 'smart' | 'places' | 'instagram' | 'whois';

interface SourceState {
  loading: boolean;
  ok?: boolean;
  msg?: string | null;
}

interface SmartResponse {
  ok: boolean;
  filled?: number;
  reason?: string;
}

interface PlacesResponse {
  ok: boolean;
  filled?: number;
  fields?: string[];
  matchedPlace?: { name: string; rating?: number | null; userRatingCount?: number | null };
  reason?: string;
}

interface InstagramResponse {
  ok: boolean;
  filled?: number;
  fields?: string[];
  matchedHandle?: string;
  matchedProfile?: { username: string; fullName: string | null; followersCount: number | null };
  handleSource?: string;
  reason?: string;
}

interface WhoisResponse {
  ok: boolean;
  filled?: number;
  fields?: string[];
  rdap?: {
    domain: string;
    registrar: string | null;
    registeredAt: string | null;
    expiresAt: string | null;
    registrant: { name: string | null; organization: string | null; email: string | null; country: string | null };
    note: string | null;
  };
  reason?: string;
}

/** (#270) Each source gets a brand color so the operator can scan the menu
 *  + future provenance chips and instantly know "that field came from
 *  Places" vs "that field came from WHOIS". The colors are chosen to map
 *  to each platform's identity at low saturation so they read on the dark
 *  surface without screaming. */
const SOURCE_META: Record<SourceKey, { icon: string; label: string; hint: string; color: string; bg: string; border: string }> = {
  smart: {
    icon: '✨',
    label: 'Smart enrich (website)',
    hint: 'Reads the website with an LLM and fills any blanks (industry, contact, phone).',
    color: '#fbbf24',                 // amber — the "AI" actions site-wide
    bg: 'rgba(251,191,36,0.10)',
    border: 'rgba(251,191,36,0.40)'
  },
  places: {
    icon: '🗺️',
    label: 'Google Places',
    hint: 'Searches Places by company + city. Fills address, phone, rating, types.',
    color: '#4ade80',                 // Google Maps green
    bg: 'rgba(74,222,128,0.10)',
    border: 'rgba(74,222,128,0.40)'
  },
  instagram: {
    icon: '📷',
    label: 'Instagram',
    hint: 'Finds the IG handle (via scraped socials, then a company-name guess) and fills profile data.',
    color: '#f472b6',                 // Instagram pink/magenta
    bg: 'rgba(244,114,182,0.10)',
    border: 'rgba(244,114,182,0.40)'
  },
  whois: {
    icon: '🌐',
    label: 'WHOIS / Domain registration',
    hint: 'RDAP lookup. Registrant name + email (when not privacy-redacted), registration date, registrar, nameservers.',
    color: '#a78bfa',                 // purple — the "system/registry" channel
    bg: 'rgba(167,139,250,0.10)',
    border: 'rgba(167,139,250,0.40)'
  }
};

export function EnrichFromSourcesMenu({
  auditId,
  hasWebsite,
  hasCompany
}: {
  auditId: string;
  hasWebsite: boolean;
  hasCompany: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<Record<SourceKey, SourceState>>({
    smart: { loading: false },
    places: { loading: false },
    instagram: { loading: false },
    whois: { loading: false }
  });

  async function run(key: SourceKey, url: string, formatOk: (j: unknown) => string, formatFail: (j: unknown) => string) {
    setState((s) => ({ ...s, [key]: { loading: true } }));
    try {
      const res = await fetch(url, { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState((s) => ({ ...s, [key]: { loading: false, ok: false, msg: (j as { reason?: string }).reason ?? `HTTP ${res.status}` } }));
        return;
      }
      const okFlag = (j as { ok?: boolean }).ok;
      if (okFlag === false) {
        setState((s) => ({ ...s, [key]: { loading: false, ok: false, msg: formatFail(j) } }));
        return;
      }
      setState((s) => ({ ...s, [key]: { loading: false, ok: true, msg: formatOk(j) } }));
      router.refresh();
    } catch (e) {
      setState((s) => ({ ...s, [key]: { loading: false, ok: false, msg: (e as Error).message } }));
    }
  }

  // Per-source runners — each formats its own success / fail string from
  // the typed response so val sees something useful, not "ok: true."
  const runSmart = () =>
    run(
      'smart',
      `/api/admin/av/leads/${auditId}/social-content/refresh-intel`, // placeholder — SmartEnrich uses its own existing button; if val clicks here, fall back to the dedicated route
      () => 'See Smart enrich button below.',
      (j) => (j as SmartResponse).reason ?? 'No data added.'
    );
  // ↑ Smart enrich already has its own dedicated button + endpoint elsewhere.
  // Including it in the menu would duplicate work; we keep it OUT of the
  // menu list rendered below for that reason.

  const runPlaces = () =>
    run(
      'places',
      `/api/admin/av/leads/${auditId}/enrich-from-places`,
      (j) => {
        const r = j as PlacesResponse;
        const head = (r.filled ?? 0) > 0 ? `Filled ${r.filled} · ${(r.fields ?? []).join(', ')}` : 'Match found, nothing new to fill';
        const place = r.matchedPlace
          ? ` · ${r.matchedPlace.name}${typeof r.matchedPlace.rating === 'number' ? ` (★ ${r.matchedPlace.rating.toFixed(1)})` : ''}`
          : '';
        return head + place;
      },
      (j) => (j as PlacesResponse).reason ?? 'No match.'
    );

  const runInstagram = () =>
    run(
      'instagram',
      `/api/admin/av/leads/${auditId}/enrich-from-instagram`,
      (j) => {
        const r = j as InstagramResponse;
        const head = (r.filled ?? 0) > 0 ? `Filled ${r.filled} · ${(r.fields ?? []).join(', ')}` : 'Profile found, nothing new to fill';
        const prof = r.matchedProfile
          ? ` · @${r.matchedProfile.username}${typeof r.matchedProfile.followersCount === 'number' ? ` (${r.matchedProfile.followersCount.toLocaleString()})` : ''}`
          : '';
        return head + prof;
      },
      (j) => (j as InstagramResponse).reason ?? 'No profile.'
    );

  const runWhois = () =>
    run(
      'whois',
      `/api/admin/av/leads/${auditId}/enrich-from-whois`,
      (j) => {
        const r = j as WhoisResponse;
        const parts: string[] = [];
        if ((r.filled ?? 0) > 0) parts.push(`Filled ${r.filled} · ${(r.fields ?? []).join(', ')}`);
        if (r.rdap?.registrar) parts.push(`${r.rdap.registrar}`);
        if (r.rdap?.registeredAt) parts.push(`reg ${r.rdap.registeredAt.slice(0, 10)}`);
        if (r.rdap?.registrant?.name) parts.push(`registrant: ${r.rdap.registrant.name}`);
        if (r.rdap?.registrant?.email) parts.push(r.rdap.registrant.email);
        if (parts.length === 0) parts.push(r.rdap?.note ?? 'no useful data');
        return parts.join(' · ');
      },
      (j) => (j as WhoisResponse).reason ?? 'WHOIS unavailable.'
    );

  void runSmart; // (kept above for parity; not rendered in the menu)

  // Render order + disabled checks per source.
  type Row = { key: SourceKey; onRun: () => void; disabled: boolean; disabledHint?: string };
  const rows: Row[] = [
    { key: 'places',    onRun: runPlaces,    disabled: !hasCompany, disabledHint: 'Set Company first.' },
    { key: 'instagram', onRun: runInstagram, disabled: !hasCompany && !hasWebsite, disabledHint: 'Need Company or Website.' },
    { key: 'whois',     onRun: runWhois,     disabled: !hasWebsite, disabledHint: 'Need Website (domain).' }
  ];

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Pull data from external sources — Google Places, Instagram, WHOIS — to fill any blank fields on this lead."
        className="text-sm px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 border border-[#EBCB6B]/35 text-[#EBCB6B] hover:border-[#EBCB6B]/70 bg-[#EBCB6B]/10 transition"
      >
        ✨ Enrich from sources <span style={{ fontSize: 9 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          className="absolute z-30 right-0 mt-1 w-[360px] rounded-lg border border-border bg-surface shadow-xl p-2"
          style={{ backgroundColor: '#0c1322' }}
        >
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted px-2 pt-1 pb-2">Per-lead enrichment</div>
          <ul className="flex flex-col gap-1">
            {rows.map((row) => {
              const meta = SOURCE_META[row.key];
              const s = state[row.key];
              return (
                <li key={row.key} className="rounded-md hover:bg-black/30">
                  <button
                    type="button"
                    onClick={row.onRun}
                    disabled={s.loading || row.disabled}
                    title={row.disabled ? row.disabledHint : meta.hint}
                    className={
                      'w-full text-left px-2 py-2 rounded-md flex items-start gap-2 transition ' +
                      (s.loading || row.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')
                    }
                  >
                    {/* Color tile keyed to the source — so val sees the
                        same color show up later as a chip on enriched fields */}
                    <span
                      className="text-base leading-tight inline-flex items-center justify-center"
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        background: meta.bg,
                        border: `1px solid ${meta.border}`,
                        color: meta.color
                      }}
                    >
                      {meta.icon}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium" style={{ color: meta.color }}>
                        {meta.label}
                        {s.loading && <span className="ml-2 text-[10px] text-muted">running…</span>}
                      </span>
                      <span className="block text-[11px] text-muted leading-snug">{meta.hint}</span>
                      {s.msg && (
                        <span
                          className="block text-[11px] mt-1 leading-snug"
                          style={{ color: s.ok ? '#86efac' : '#fde68a' }}
                        >
                          {s.msg}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
            {/* Apollo-by-person: stub until val confirms her Apollo plan + we
                wire the people-search call. */}
            <li className="rounded-md opacity-60">
              <div className="px-2 py-2 flex items-start gap-2">
                <span className="text-base leading-tight">🧭</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-ink font-medium">
                    Apollo (by person name) <span className="ml-2 text-[10px] text-muted">coming soon</span>
                  </span>
                  <span className="block text-[11px] text-muted leading-snug">
                    Look up the contact in Apollo&apos;s B2B database to fill title + email. Confirm your Apollo
                    plan supports people search before we wire this.
                  </span>
                </span>
              </div>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
