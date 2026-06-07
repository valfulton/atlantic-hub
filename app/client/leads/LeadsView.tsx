/**
 * LeadsView — the pipeline as a sortable, collapsible feed (val 2026-06-07).
 *
 *   - Sort by: best fit · hottest · location · type · name.
 *   - Each lead COLLAPSES: compact by default (name · fit · Hot tag · phone ·
 *     Call), expand the chevron for the "why they need you" line + full
 *     contact + open-lead. Phone + Call are NEVER hidden — call in one tap.
 *   - Pop: hot leads carry a gold left edge + a gold "Hot" tag; gold Call button.
 *
 * Styles come from app/client/_styles/app.css (.app-card vocabulary).
 */
'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ClientLead } from '@/lib/client/leads';
import DiscoverPanel from './DiscoverPanel';

interface Props {
  leads: ClientLead[];
}

type SortKey = 'fit' | 'hot' | 'location' | 'type' | 'name';
const SORT_LABELS: Record<SortKey, string> = {
  fit: 'Best fit',
  hot: 'Hottest',
  location: 'Location',
  type: 'Type',
  name: 'Name'
};

function bandRank(l: ClientLead): number {
  return l.band === 'hot' ? 3 : l.band === 'warm' ? 2 : l.band === 'cool' ? 1 : 0;
}
function fitOf(l: ClientLead): number {
  return l.icpFitScore ?? l.score ?? 0;
}
function locOf(l: ClientLead): string {
  return [l.addressCity, l.addressState].filter(Boolean).join(', ');
}
const COMPARATORS: Record<SortKey, (a: ClientLead, b: ClientLead) => number> = {
  fit: (a, b) => fitOf(b) - fitOf(a),
  hot: (a, b) => bandRank(b) - bandRank(a) || fitOf(b) - fitOf(a),
  location: (a, b) => locOf(a).localeCompare(locOf(b)) || (a.company || '').localeCompare(b.company || ''),
  type: (a, b) => (a.industry || 'zzz').localeCompare(b.industry || 'zzz') || (a.company || '').localeCompare(b.company || ''),
  name: (a, b) => (a.company || '').localeCompare(b.company || '')
};

function chipLabel(l: ClientLead): { kind: 'distress' | 'fit'; label: string } {
  if (l.band === 'hot') {
    const score = l.icpFitScore ?? l.score ?? 0;
    return { kind: 'fit', label: `${score} fit` };
  }
  if (l.icpFitScore != null) {
    const band = l.band ? ` · ${l.band}` : '';
    return { kind: 'fit', label: `${l.icpFitScore} fit${band}` };
  }
  return { kind: 'fit', label: l.leadStatus || 'New lead' };
}

function oneLinerOf(l: ClientLead): string {
  return l.painSummary ||
         l.icpFitReasoning ||
         (l.contactName ? `${l.contactName} reachable. Ready to send.` : 'Enriched and ready.');
}

/** Real tap-to-call href (digits + leading +), or null if no usable number. */
function telOf(l: ClientLead): string | null {
  if (!l.phone) return null;
  const cleaned = l.phone.replace(/[^\d+]/g, '');
  return cleaned.replace(/\D/g, '').length >= 7 ? `tel:${cleaned}` : null;
}

/** Prefilled mailto: a ready first email, so "Email" sends in one tap. */
function mailtoOf(l: ClientLead): string | null {
  if (!l.email) return null;
  const first = (l.contactName || '').trim().split(/\s+/)[0] || 'there';
  const subject = `Quick idea for ${l.company || 'your team'}`;
  const pain = (l.painSummary || l.callScript?.primaryPain || '').trim();
  const body = [
    `Hi ${first},`,
    '',
    `I came across ${l.company || 'your business'} and wanted to reach out.`,
    ...(pain ? ['', pain] : []),
    '',
    'Would you be open to a short call this week?',
    '',
    'Best,'
  ].join('\n');
  return `mailto:${l.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Full contact facts (address + email + website) — shown when the card is
 *  expanded. Phone lives in the always-visible compact row, never hidden. */
function LeadMeta({ lead: l }: { lead: ClientLead }) {
  const address = [l.addressStreet, l.addressCity, l.addressState, l.addressPostal].filter(Boolean).join(', ');
  if (!address && !l.email && !l.website) return null;
  return (
    <div className="meta">
      {address && (
        <div className="row"><span className="k">Address</span><span className="v">{address}</span></div>
      )}
      {l.email && (
        <div className="row"><span className="k">Email</span><a className="v" href={`mailto:${l.email}`}>{l.email}</a></div>
      )}
      {l.website && (
        <div className="row"><span className="k">Web</span><a className="v" href={l.website} target="_blank" rel="noopener">{l.website.replace(/^https?:\/\//, '')}</a></div>
      )}
    </div>
  );
}

function LeadCard({ lead }: { lead: ClientLead }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const chip = chipLabel(lead);
  const href = lead.auditId ? `/client/leads/${lead.auditId}` : '#';
  const initial = (lead.company || '·').trim().charAt(0).toUpperCase();
  const isHot = lead.band === 'hot';
  const tel = telOf(lead);

  function openLead() {
    if (href !== '#') startTransition(() => router.push(href));
  }

  return (
    <article className="app-card" style={isHot ? { borderLeft: '3px solid var(--gold)' } : undefined}>
      <div className="hd">
        <div className="logo"><span className="sc" /><b>{initial}</b></div>
        <div className="nm">
          {lead.auditId ? (
            <Link href={href} title={lead.company} className="nm-link"><b>{lead.company}</b></Link>
          ) : (
            <b title={lead.company}>{lead.company}</b>
          )}
          <span style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '3px' }}>
            {isHot && (
              <span style={{ fontSize: '.6rem', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', background: 'var(--gold)', color: 'var(--black)', padding: '.16rem .45rem', borderRadius: '5px' }}>Hot</span>
            )}
            <span className={`chip${chip.kind === 'fit' ? ' fit' : ''}`}>{chip.label}</span>
            {lead.industry && !['other', 'unknown', 'n/a', 'none'].includes(lead.industry.trim().toLowerCase()) && (
              <span style={{ fontSize: '.66rem', color: 'var(--muted)' }}>{lead.industry}</span>
            )}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? 'Collapse lead' : 'Expand lead'}
          style={{ marginLeft: 'auto', alignSelf: 'flex-start', width: '34px', height: '34px', borderRadius: '8px', border: '1px solid var(--rule)', background: 'transparent', color: 'var(--emerald-deep)', fontSize: '18px', lineHeight: 1, cursor: 'pointer', flexShrink: 0 }}
        >
          {open ? '−' : '+'}
        </button>
      </div>

      {/* Always-visible: phone + the one-tap Call. Never hidden by collapse. */}
      {lead.phone && (
        <div style={{ padding: '0 1.1rem', fontSize: '.8rem' }}>
          <span style={{ color: 'var(--muted)' }}>Phone </span>
          {tel ? (
            <a href={tel} style={{ color: 'var(--ink)', textDecoration: 'none', borderBottom: '1px solid var(--rule)' }}>{lead.phone}</a>
          ) : lead.phone}
        </div>
      )}
      <div className="foot">
        {tel ? (
          <a className="pcta" href={tel}>📞 Call</a>
        ) : mailtoOf(lead) ? (
          <a className="pcta" href={mailtoOf(lead)!}>✉️ Email</a>
        ) : (
          <button type="button" className="pcta" onClick={openLead} disabled={pending}>
            {pending ? 'Opening…' : '✚ Add to pipeline'}
          </button>
        )}
      </div>

      {/* Collapsed detail: the "why", full contact, open lead. */}
      {open && (
        <div style={{ borderTop: '1px solid var(--rule)', marginTop: '2px' }}>
          <div className="painline">
            <span className="painline__eb">Why they need you</span>
            <p className="ln">{oneLinerOf(lead)}</p>
          </div>
          <LeadMeta lead={lead} />
          {lead.auditId && (
            <div style={{ padding: '0 1.1rem 1rem' }}>
              <Link href={href} className="nm-link" style={{ color: 'var(--emerald-deep)', fontWeight: 600, fontSize: '.85rem' }}>Open lead →</Link>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export default function LeadsView({ leads }: Props) {
  const [showDiscover, setShowDiscover] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('fit');

  const sorted = useMemo(() => [...leads].sort(COMPARATORS[sortBy]), [leads, sortBy]);
  const hotCount = useMemo(() => leads.filter((l) => l.band === 'hot').length, [leads]);

  if (leads.length === 0) {
    return (
      <>
        <div className="app-sh">
          <h3>Your <em>pipeline</em></h3>
          <button type="button" className="app-cta" onClick={() => setShowDiscover((s) => !s)} style={{ marginLeft: 'auto' }}>
            {showDiscover ? 'Hide find-new-leads' : 'Find new leads'}
          </button>
        </div>
        {showDiscover && (
          <div style={{ marginBottom: '1.4rem' }}>
            <DiscoverPanel />
          </div>
        )}
        <div className="app-empty">
          <p>Pipeline is empty. Prospects appear here as they&apos;re identified — ranked by fit, highest first.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="app-sh">
        <h3>Your <em>pipeline</em></h3>
        <span className="ct">{leads.length}{hotCount > 0 ? ` · ${hotCount} hot` : ''}</span>
        <button type="button" className="app-cta" onClick={() => setShowDiscover((s) => !s)} style={{ marginLeft: 'auto' }}>
          {showDiscover ? 'Hide find-new-leads' : 'Find new leads'}
        </button>
      </div>

      {/* Sort control */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', margin: '0 0 1rem' }}>
        <label htmlFor="lead-sort" style={{ fontSize: '.7rem', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>Sort by</label>
        <select
          id="lead-sort"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          style={{ fontFamily: 'inherit', fontSize: '.85rem', color: 'var(--ink)', background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: '8px', padding: '.42rem .6rem' }}
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
            <option key={k} value={k}>{SORT_LABELS[k]}</option>
          ))}
        </select>
      </div>

      {showDiscover && (
        <div style={{ marginBottom: '1.4rem' }}>
          <DiscoverPanel />
        </div>
      )}

      <div className="app-cards">
        {sorted.map((l) => <LeadCard key={l.id} lead={l} />)}
      </div>
    </>
  );
}
