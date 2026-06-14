'use client';

/**
 * ViewAsPicker — operator-side "Preview as [someone]" dropdown.
 * (val 2026-06-13, #636)
 *
 * Lets val see exactly what each collaborator sees on a case page WITHOUT
 * impersonating their session. The page server-renders with that user's
 * visibility filter applied, and links to operator pages stay intact so
 * val can switch back and forth.
 *
 * The picker is intentionally INERT for inputs / actions — selecting a
 * user only changes the read filter, not the actor identity.
 */
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

interface Candidate {
  clientUserId: number;
  email: string;
  displayName: string | null;
  role: string;
}

const ROLE_LABEL: Record<string, string> = {
  parent: 'Parent / brand owner',
  account_rep: 'A&V account rep (sees everything)',
  professional: 'Attorney / advisor',
  family: 'Family — read only',
  operator: 'Operator (val)',
  unknown: 'No relationship to this case'
};

export default function ViewAsPicker({
  candidates,
  current
}: {
  candidates: Candidate[];
  /** The currently-active ?as=<id>, or null when in default operator view. */
  current: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function switchTo(value: string) {
    const next = new URLSearchParams(params?.toString() ?? '');
    if (value === '') {
      next.delete('as');
    } else {
      next.set('as', value);
    }
    const qs = next.toString();
    const url = qs ? `${pathname}?${qs}` : (pathname || '/');
    startTransition(() => router.push(url));
  }

  const currentCandidate = current !== null
    ? candidates.find((c) => c.clientUserId === current)
    : null;

  return (
    <div
      data-chrome="hide-in-canvas"
      style={{
        background: '#F5EFE3',
        border: '1px solid rgba(201,169,97,0.45)',
        borderRadius: 10,
        padding: '10px 14px',
        marginBottom: 14,
        fontSize: 13,
        color: '#1B2329',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap'
      }}
    >
      <span style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#0A4D3C', fontWeight: 600 }}>
        View as
      </span>

      <select
        value={current === null ? '' : String(current)}
        onChange={(e) => switchTo(e.target.value)}
        disabled={isPending}
        style={{
          fontSize: 13,
          padding: '6px 10px',
          borderRadius: 6,
          border: '1px solid rgba(10,77,60,0.30)',
          background: '#FFFFFF',
          color: '#14201B',
          minWidth: 240
        }}
      >
        <option value="">— Operator (val · sees everything)</option>
        {candidates.length === 0 && (
          <option value="" disabled>No collaborators yet</option>
        )}
        {candidates.map((c) => (
          <option key={c.clientUserId} value={String(c.clientUserId)}>
            {c.displayName || c.email}
            {' '}
            ({ROLE_LABEL[c.role] ?? c.role})
          </option>
        ))}
      </select>

      {currentCandidate && (
        <span style={{ fontSize: 12, color: '#5C6862' }}>
          Showing this page as <strong style={{ color: '#0A4D3C' }}>{currentCandidate.displayName || currentCandidate.email}</strong>
          {' — '}
          their visibility filter is applied. Switch back to Operator to see everything.
        </span>
      )}
    </div>
  );
}
