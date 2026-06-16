/**
 * /client/apply  (val 2026-06-16, #701)
 *
 * Universal "Earn with A&V" application surface. Any logged-in client_user
 * lands here from the dashboard CTA card. They pick a tier (caller / manager /
 * referrer / any), type a short pitch + phone, submit. Lands in
 * ic_applications. val reviews on /admin/av/ic-applications.
 *
 * If they already have a pending or approved application, this page shows the
 * status instead of the form (no duplicate submissions, no anxiety).
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { getOpenApplicationForUser } from '@/lib/ic/applications';
import IcApplyForm from './IcApplyForm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ClientApplyPage() {
  const actor = readClientActorFromHeaders(headers() as unknown as Headers);
  if (!actor) redirect('/client/login');
  const user = await findClientUserById(actor.clientUserId);
  if (!user) redirect('/client/login');

  const existing = await getOpenApplicationForUser(actor.clientUserId);
  const firstName = (user.display_name || user.email || '').split(/\s+/)[0] || 'there';

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '24px 16px 80px' }}>
      <p style={{
        fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'var(--gold-deep, #7A5A18)', fontWeight: 700, margin: '0 0 6px'
      }}>
        Earn with Atlantic & Vine
      </p>
      <h1 style={{
        fontFamily: 'var(--font-display, Fraunces, serif)',
        fontSize: 32, fontWeight: 600, color: 'var(--ink, #14201B)',
        margin: '0 0 8px', lineHeight: 1.2
      }}>
        Apply for an Independent Contractor position
      </h1>
      <p style={{ fontSize: 15, color: 'var(--muted, #5C6862)', margin: '0 0 24px', lineHeight: 1.55 }}>
        Atlantic & Vine works with a small bench of Independent Contractors who
        call leads, manage callers, or refer new clients. Tell us how you'd like
        to work with us — Val reviews each application personally.
      </p>

      {existing ? (
        <div style={{
          background: 'var(--paper, #FFFFFF)',
          border: '1px solid rgba(10,77,60,0.18)',
          borderLeft: '3px solid var(--emerald-deep, #0A4D3C)',
          borderRadius: 12, padding: '18px 20px'
        }}>
          <p style={{
            fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: 'var(--emerald-deep, #0A4D3C)', fontWeight: 700, margin: '0 0 6px'
          }}>
            {existing.status === 'approved' ? 'You are approved' : 'Your application is in'}
          </p>
          <h2 style={{
            fontFamily: 'var(--font-display, Fraunces, serif)',
            fontSize: 22, fontWeight: 600, color: 'var(--ink, #14201B)',
            margin: '0 0 10px'
          }}>
            Thank you, {firstName}.
          </h2>
          <p style={{ fontSize: 14, color: 'var(--ink, #14201B)', lineHeight: 1.55, margin: '0 0 8px' }}>
            {existing.status === 'approved'
              ? 'You are an approved A&V Independent Contractor. Your work inventory will appear on your dashboard.'
              : 'Val will review and get back to you within 48 hours. You will see your work inventory on your dashboard once approved.'}
          </p>
          <p style={{ fontSize: 12, color: 'var(--muted, #5C6862)', margin: '6px 0 0' }}>
            Submitted as {existing.tierPref === 'any' ? 'open to any role' : existing.tierPref}.
          </p>
        </div>
      ) : (
        <IcApplyForm
          firstName={firstName}
          email={user.email ?? ''}
          displayName={user.display_name ?? ''}
        />
      )}
    </div>
  );
}
