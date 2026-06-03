'use client';

/**
 * EnrichmentSourcesPanel  (#180 / #368, val 2026-06-02)
 *
 * The buried-fields surface. Renders an at-a-glance view of what each vendor
 * (Apollo / Hunter / Google Places / Clay / smart-scrape) actually populated
 * on this lead. Each vendor block hides itself when null, so the panel is
 * tight on leads with only one source.
 *
 * Read-only — editing happens via the regular Enrich actions. This is the
 * "what do I already know?" view, not a re-write surface.
 */
import { useState } from 'react';
import type { EnrichmentSourcesBundle } from '@/lib/leads/enrichment_sources';

function SectionHeader({ name, color }: { name: string; color: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: color }} aria-hidden />
      <h4 className="text-[11px] uppercase tracking-[0.14em] text-ink/85 font-medium">{name}</h4>
    </div>
  );
}

function Row({ label, value, link }: { label: string; value: string | number | null | undefined; link?: string | null }) {
  if (value === null || value === undefined || value === '') return null;
  const v = typeof value === 'number' ? String(value) : value;
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px] py-0.5">
      <span className="text-muted shrink-0">{label}</span>
      <span className="text-ink truncate text-right">
        {link ? (
          <a href={link} target="_blank" rel="noreferrer" className="text-brand hover:underline break-all">
            {v}
          </a>
        ) : (
          v
        )}
      </span>
    </div>
  );
}

export default function EnrichmentSourcesPanel({ sources }: { sources: EnrichmentSourcesBundle | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!sources) return null;
  const { apollo, hunter, places, clay, scrape } = sources;
  const anyPresent = !!(apollo || hunter || places || clay || scrape);
  if (!anyPresent) return null;

  const counts: string[] = [];
  if (apollo) counts.push('Apollo');
  if (hunter) counts.push('Hunter');
  if (places) counts.push('Places');
  if (clay) counts.push('Clay');
  if (scrape) counts.push('Scrape');

  return (
    <div className="col-span-full">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 text-left rounded-lg border border-border bg-surface px-3 py-2 hover:border-brand/40 transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10.5px] uppercase tracking-[0.14em] text-brand">Data sources</span>
          <span className="text-[11px] text-muted">{counts.join(' · ')}</span>
        </div>
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-muted">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="mt-3 grid gap-4 md:grid-cols-2 rounded-2xl border border-border bg-bg/40 p-4">
          {apollo && (
            <section>
              <SectionHeader name="Apollo" color="#60a5fa" />
              <div className="grid gap-0.5">
                <Row label="Industry" value={apollo.industry} />
                <Row label="Employees (est.)" value={apollo.estimatedNumEmployees?.toLocaleString()} />
                <Row label="Founded" value={apollo.foundedYear} />
                <Row label="Location" value={apollo.location} />
                <Row label="Org LinkedIn" value={apollo.linkedinUrl ? 'view →' : null} link={apollo.linkedinUrl} />
                <Row label="POC LinkedIn" value={apollo.personLinkedin ? 'view →' : null} link={apollo.personLinkedin} />
                <Row label="Org ID" value={apollo.organizationId} />
                {apollo.shortDescription && (
                  <div className="mt-2 text-[12px] text-ink/85 leading-snug italic border-l-2 border-blue-400/40 pl-2">
                    “{apollo.shortDescription.slice(0, 280)}{apollo.shortDescription.length > 280 ? '…' : ''}”
                  </div>
                )}
              </div>
            </section>
          )}
          {hunter && (
            <section>
              <SectionHeader name="Hunter" color="#fcd34d" />
              <div className="grid gap-0.5">
                <Row label="Email confidence" value={hunter.emailConfidence !== null ? `${hunter.emailConfidence}/100` : null} />
                <Row label="Verification" value={hunter.verification} />
                <Row label="Position" value={hunter.position} />
                <Row label="Department" value={hunter.department} />
                <Row label="Seniority" value={hunter.seniority} />
                {hunter.sources.length > 0 && (
                  <div className="mt-1.5 text-[11px]">
                    <div className="text-muted mb-0.5">Sources found at:</div>
                    <ul className="grid gap-0.5">
                      {hunter.sources.map((s, i) => (
                        <li key={i} className="truncate">
                          <a href={s} target="_blank" rel="noreferrer" className="text-brand hover:underline">{s}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )}
          {places && (
            <section>
              <SectionHeader name="Google Places" color="#6ee7b7" />
              <div className="grid gap-0.5">
                <Row label="Rating" value={places.rating !== null ? `★ ${places.rating} (${places.userRatingsTotal ?? 0} reviews)` : null} />
                <Row label="Status" value={places.businessStatus} />
                <Row label="Price level" value={places.priceLevel !== null ? '$'.repeat(Math.max(1, Math.min(4, places.priceLevel))) : null} />
                <Row label="Open now" value={places.openNow === true ? 'yes' : places.openNow === false ? 'no' : null} />
                {places.types.length > 0 && (
                  <div className="text-[11px] text-muted mt-1 flex flex-wrap gap-1">
                    {places.types.map((t) => (
                      <span key={t} className="rounded bg-emerald-400/10 border border-emerald-400/25 px-1.5 py-0.5 text-emerald-200">{t}</span>
                    ))}
                  </div>
                )}
                <Row label="Maps" value={places.mapsUrl ? 'view →' : null} link={places.mapsUrl} />
                {places.photoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={places.photoUrl} alt="" className="mt-2 max-w-full h-32 object-cover rounded-md border border-border" />
                )}
              </div>
            </section>
          )}
          {clay && (
            <section>
              <SectionHeader name="Clay" color="#f0abfc" />
              <div className="grid gap-0.5">
                <Row label="Row id" value={clay.rowId} />
                <Row label="Table id" value={clay.tableId} />
                {clay.extraFields.map((f) => (
                  <Row key={f.key} label={f.key} value={f.value} />
                ))}
              </div>
            </section>
          )}
          {scrape && (
            <section className="md:col-span-2">
              <SectionHeader name="Smart scrape" color="#a5b4fc" />
              <div className="grid gap-0.5">
                {scrape.ogTitle && (
                  <div className="text-[12px] text-ink/95 font-medium">{scrape.ogTitle}</div>
                )}
                {scrape.ogDescription && (
                  <div className="text-[11.5px] text-muted leading-snug">{scrape.ogDescription}</div>
                )}
                <div className="flex flex-wrap gap-2 mt-1 text-[11px]">
                  {scrape.linkedin && <a href={scrape.linkedin} target="_blank" rel="noreferrer" className="text-brand hover:underline">LinkedIn</a>}
                  {scrape.instagram && <a href={scrape.instagram} target="_blank" rel="noreferrer" className="text-brand hover:underline">Instagram</a>}
                  {scrape.facebook && <a href={scrape.facebook} target="_blank" rel="noreferrer" className="text-brand hover:underline">Facebook</a>}
                  {scrape.twitter && <a href={scrape.twitter} target="_blank" rel="noreferrer" className="text-brand hover:underline">X / Twitter</a>}
                  {scrape.youtube && <a href={scrape.youtube} target="_blank" rel="noreferrer" className="text-brand hover:underline">YouTube</a>}
                  {scrape.tiktok && <a href={scrape.tiktok} target="_blank" rel="noreferrer" className="text-brand hover:underline">TikTok</a>}
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
