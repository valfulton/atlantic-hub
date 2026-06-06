/**
 * LeadsView — the pipeline rendered in the canonical .app-* vocabulary.
 *
 * Each lead becomes a SignalCard (same shape as dashboard watchlist + fresh-
 * leads cards). Section heads (.app-sh) carve the page into:
 *   - "Hot fits" — band === 'hot'
 *   - "In your pipeline" — everything else
 *
 * Discover form is a single ghost-gold CTA in the section head so the page
 * stays a feed of cards, not a form-heavy operator surface.
 */
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ClientLead } from '@/lib/client/leads';
import DiscoverPanel from './DiscoverPanel';

interface Props {
  leads: ClientLead[];
}

function chipLabel(l: ClientLead): { kind: 'distress' | 'fit'; label: string } {
  if (l.band === 'hot') {
    const score = l.icpFitScore ?? l.score ?? 0;
    return { kind: 'fit', label: `${score} fit · hot` };
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

/** Contact facts — phone (tap-to-call) + full address + website. Always shown
 *  when present; these are client-critical and must not be hidden (val 2026-06-05). */
function LeadMeta({ lead: l }: { lead: ClientLead }) {
  const address = [l.addressStreet, l.addressCity, l.addressState, l.addressPostal].filter(Boolean).join(', ');
  if (!l.phone && !address && !l.email && !l.website) return null;
  const tel = l.phone ? l.phone.replace(/[^\d+]/g, '') : '';
  return (
    <div className="meta">
      {l.phone && (
        <div className="row"><span className="k">Phone</span><a className="v" href={`tel:${tel}`}>{l.phone}</a></div>
      )}
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
  const chip = chipLabel(lead);
  const href = lead.auditId ? `/client/leads/${lead.auditId}` : '#';
  function open() {
    if (href !== '#') startTransition(() => router.push(href));
  }
  const initial = (lead.company || '·').trim().charAt(0).toUpperCase();
  return (
    <article className="app-card">
      <div className="hd">
        <div className="logo">
          <span className="sc" />
          <b>{initial}</b>
        </div>
        <div className="nm">
          {lead.auditId ? (
            <Link href={href} title={lead.company} className="nm-link"><b>{lead.company}</b></Link>
          ) : (
            <b title={lead.company}>{lead.company}</b>
          )}
          <span className={`chip${chip.kind === 'fit' ? ' fit' : ''}`}>{chip.label}</span>
        </div>
      </div>
      <div className="painline">
        <span className="painline__eb">Why they need you</span>
        <p className="ln">{oneLinerOf(lead)}</p>
      </div>
      <LeadMeta lead={lead} />
      <div className="foot">
        {telOf(lead) ? (
          <a className="pcta" href={telOf(lead)!}>📞 Call</a>
        ) : mailtoOf(lead) ? (
          <a className="pcta" href={mailtoOf(lead)!}>✉️ Email</a>
        ) : (
          <button type="button" className="pcta" onClick={open} disabled={pending}>
            {pending ? 'Opening…' : '✚ Add to pipeline'}
          </button>
        )}
      </div>
    </article>
  );
}

export default function LeadsView({ leads }: Props) {
  const [showDiscover, setShowDiscover] = useState(false);

  if (leads.length === 0) {
    return (
      <>
        <div className="app-sh">
          <h3>Your <em>pipeline</em></h3>
          <button
            type="button"
            className="app-cta"
            onClick={() => setShowDiscover((s) => !s)}
            style={{ marginLeft: 'auto' }}
          >
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

  const hot = leads.filter((l) => l.band === 'hot');
  const rest = leads.filter((l) => l.band !== 'hot');

  return (
    <>
      <div className="app-sh">
        <h3>Hot <em>fits</em></h3>
        <span className="ct">{hot.length} on the board</span>
        <button
          type="button"
          className="app-cta"
          onClick={() => setShowDiscover((s) => !s)}
          style={{ marginLeft: 'auto' }}
        >
          {showDiscover ? 'Hide find-new-leads' : 'Find new leads'}
        </button>
      </div>

      {showDiscover && (
        <div style={{ marginBottom: '1.4rem' }}>
          <DiscoverPanel />
        </div>
      )}

      {hot.length > 0 ? (
        <div className="app-cards">
          {hot.map((l) => <LeadCard key={l.id} lead={l} />)}
        </div>
      ) : (
        <div className="app-empty">
          <p>No hot leads yet. New prospects will land here.</p>
        </div>
      )}

      {rest.length > 0 && (
        <>
          <div className="app-sh">
            <h3>In your <em>pipeline</em></h3>
            <span className="ct">{rest.length}</span>
          </div>
          <div className="app-cards">
            {rest.map((l) => <LeadCard key={l.id} lead={l} />)}
          </div>
        </>
      )}
    </>
  );
}
