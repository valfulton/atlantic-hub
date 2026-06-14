/**
 * /admin/av/clients/[client_id]/preview/cases  (val 2026-06-12)
 *
 * Operator preview mirror of /client/cases — the case list val sees when
 * she's looking through Adriana's eyes (or whoever the brand's primary
 * client_user is). Reuses listCasesForClient — primary-client view only,
 * since collaborator access is per-user and the preview renders as the
 * brand owner.
 *
 * Cream skin matches the actual /client/cases page so val sees the SAME
 * thing the client sees (mirror discipline).
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';
import { listCasesForClient, type CaseRecord } from '@/lib/case/case_store';
import OperatorPreviewChrome from '@/app/admin/av/clients/[client_id]/preview/_components/OperatorPreviewChrome';

/* See [caseId]/page.tsx for the rationale — inline client-nav mockup
   instead of mounting ClientV3TopNav (which renders unstyled on /admin/*
   routes because the client app.css isn't loaded there). */
function PreviewClientNav() {
  const NAV = ['Home', 'Matters', 'Leads', 'Watchlist', 'Campaigns', 'Calendar', 'Content', 'Press', 'Newsroom'];
  return (
    <div style={{
      background: '#FAF8F4',
      borderBottom: '1px solid rgba(10,77,60,0.10)',
      padding: '12px 22px',
      display: 'flex',
      alignItems: 'center',
      gap: 18,
      flexWrap: 'wrap',
      fontFamily: 'Inter, system-ui, sans-serif'
    }}>
      <span style={{
        fontFamily: 'Fraunces, Georgia, serif',
        fontSize: 16,
        fontWeight: 600,
        letterSpacing: '-0.01em',
        color: '#14201B'
      }}>
        Atlantic &amp; Vine
      </span>
      <nav style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }} aria-label="What the client sees in their top nav">
        {NAV.map((label) => (
          <span
            key={label}
            style={{
              fontSize: 12,
              fontWeight: label === 'Matters' ? 600 : 500,
              color: label === 'Matters' ? '#0A4D3C' : '#5C6862',
              padding: '4px 2px',
              borderBottom: label === 'Matters' ? '2px solid #0A4D3C' : '2px solid transparent'
            }}
          >
            {label}
          </span>
        ))}
      </nav>
    </div>
  );
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CREAM_SKIN = {
  '--ink': '#14201B',
  '--muted': '#5C6862',
  '--paper': '#FFFFFF',
  '--cream': '#FAF8F4',
  '--gold-deep': '#7A5A18',
  '--emerald-deep': '#0A4D3C'
} as CSSProperties;

interface PageProps {
  params: { client_id: string };
}

function caseKindLabel(k: string): string {
  switch (k) {
    case 'trust_dispute': return 'Trust matter';
    case 'elder_advocacy': return 'Family care';
    case 'estate_litigation': return 'Estate matter';
    case 'malpractice_defense': return 'Defense matter';
    case 'campaign_legal': return 'Campaign legal';
    case 'guardianship': return 'Guardianship';
    case 'family_law': return 'Family law';
    case 'business_litigation': return 'Business matter';
    default: return 'Matter';
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso.slice(0, 10); }
}

export default async function PreviewCasesListPage({ params }: PageProps) {
  const clientId = parseInt(params.client_id, 10);
  if (!Number.isInteger(clientId)) notFound();

  let cases: CaseRecord[] = [];
  let err: string | null = null;
  try {
    cases = await listCasesForClient(clientId);
  } catch (e) {
    err = (e as Error).message || 'failed to load';
  }

  return (
    <>
      {/* (val 2026-06-13) Shared operator chrome + cream client nav, same as
          the case detail preview, so val sees what Rebecca/Adriana actually see
          when they hit /client/cases. Without this the preview was an orphan
          page with no nav — val (rightly) thought collaborators had no way
          to navigate off the page. */}
      <div style={{ padding: '0 18px' }}>
        <OperatorPreviewChrome
          clientId={clientId}
          clientName="this client"
          active="cases"
        />
      </div>
      <PreviewClientNav />
    <main className="min-h-screen" style={{ ...CREAM_SKIN, background: 'var(--cream)', color: 'var(--ink)' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1.25rem 4rem' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--gold-deep, #7A5A18)', marginBottom: 12 }}>
          Your matters
        </div>
        <h1 style={{ fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif', fontWeight: 500, fontSize: 32, lineHeight: 1.1, marginBottom: 24 }}>
          Cases on your account
        </h1>

        {err && (
          <div style={{ background: '#FBE9E7', border: '1px solid #E57373', color: '#A23B2E', padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontSize: 13 }}>
            Could not load cases: {err}
          </div>
        )}

        {cases.length === 0 && !err ? (
          <div style={{ background: 'var(--paper, #FFFFFF)', border: '0.5px solid rgba(10,10,10,0.1)', borderRadius: 14, padding: '22px 24px' }}>
            <div style={{ fontSize: 14, color: 'var(--muted, #3B4944)' }}>
              No open matters on this account yet.
            </div>
          </div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
            {cases.map((c) => (
              <li key={c.caseId}>
                <Link
                  href={`/admin/av/clients/${clientId}/preview/cases/${c.caseId}`}
                  style={{
                    display: 'block',
                    background: 'var(--paper, #FFFFFF)',
                    border: '0.5px solid rgba(10,10,10,0.1)',
                    borderRadius: 14,
                    padding: '18px 22px',
                    textDecoration: 'none',
                    color: 'var(--ink)'
                  }}
                >
                  <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--gold-deep, #7A5A18)', marginBottom: 6 }}>
                    {caseKindLabel(c.caseKind)}
                  </div>
                  <div style={{ fontFamily: 'Fraunces, Cormorant Garamond, Georgia, serif', fontWeight: 500, fontSize: 22, lineHeight: 1.2 }}>
                    {c.caseName}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted, #3B4944)', marginTop: 8 }}>
                    Opened {formatDate(c.openedAt)} · status: {c.status.replace(/_/g, ' ')}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
    </>
  );
}
