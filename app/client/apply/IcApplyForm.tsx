/**
 * IcApplyForm (val 2026-06-16, #701)
 *
 * The application form on /client/apply. Tier picker (radio chips) + phone +
 * short pitch. Posts to /api/client/ic-application. On success, replaces the
 * form with the "thank you, Val will review" state by re-rendering with the
 * router.refresh() — the server page reads getOpenApplicationForUser and
 * paints the approved/pending state instead.
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  firstName: string;
  email: string;
  displayName: string;
}

type Tier = 'caller' | 'manager' | 'referrer' | 'any';

const TIER_OPTIONS: { id: Tier; label: string; hint: string }[] = [
  { id: 'caller',   label: 'Call leads',          hint: 'Work A&V lead inventory; earn commission per close' },
  { id: 'manager',  label: 'Manage callers',      hint: 'Hire + run a team of callers; manager override on team' },
  { id: 'referrer', label: 'Refer new clients',   hint: 'Share your link; earn residual on every paying referral' },
  { id: 'any',      label: 'Open to any role',    hint: 'Talk to Val about where you fit best' }
];

export default function IcApplyForm({ firstName, email, displayName }: Props) {
  const router = useRouter();
  const [tier, setTier] = useState<Tier>('any');
  const [phone, setPhone] = useState('');
  const [pitch, setPitch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/client/ic-application', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tierPref: tier, phone: phone.trim() || null, pitch: pitch.trim() || null })
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || 'submit failed');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      background: 'var(--paper, #FFFFFF)',
      border: '1px solid rgba(10,77,60,0.18)',
      borderRadius: 14,
      padding: '22px 22px 24px'
    }}>
      {/* Identity readout — these snapshot at submit so val knows who's who */}
      <div style={{ marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid rgba(10,77,60,0.10)' }}>
        <p style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted, #5C6862)', fontWeight: 700, margin: 0 }}>You are applying as</p>
        <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink, #14201B)', margin: '4px 0 2px' }}>{displayName || firstName}</p>
        <p style={{ fontSize: 13, color: 'var(--muted, #5C6862)', margin: 0 }}>{email}</p>
      </div>

      {/* Tier picker */}
      <p style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink, #14201B)', fontWeight: 700, margin: '0 0 10px' }}>
        How would you like to work with us?
      </p>
      <div style={{ display: 'grid', gap: 8, marginBottom: 18 }}>
        {TIER_OPTIONS.map((opt) => (
          <label
            key={opt.id}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '12px 14px',
              border: '1px solid ' + (tier === opt.id ? 'var(--emerald-deep, #0A4D3C)' : 'rgba(10,77,60,0.18)'),
              background: tier === opt.id ? 'rgba(10,77,60,0.04)' : 'transparent',
              borderRadius: 10, cursor: 'pointer',
              transition: 'background 0.15s ease, border-color 0.15s ease'
            }}
          >
            <input
              type="radio"
              name="ic_tier"
              value={opt.id}
              checked={tier === opt.id}
              onChange={() => setTier(opt.id)}
              style={{ marginTop: 2 }}
            />
            <span>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--ink, #14201B)' }}>{opt.label}</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--muted, #5C6862)', marginTop: 2 }}>{opt.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {/* Phone */}
      <label style={{ display: 'block', marginBottom: 14 }}>
        <span style={{ display: 'block', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink, #14201B)', fontWeight: 700, marginBottom: 6 }}>
          Best phone number
        </span>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(555) 555-5555"
          style={{
            width: '100%', padding: '10px 12px',
            border: '1px solid rgba(10,77,60,0.25)', borderRadius: 8,
            fontSize: 14, color: 'var(--ink, #14201B)', background: '#fff'
          }}
        />
      </label>

      {/* Pitch */}
      <label style={{ display: 'block', marginBottom: 18 }}>
        <span style={{ display: 'block', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink, #14201B)', fontWeight: 700, marginBottom: 6 }}>
          Tell Val about yourself <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--muted, #5C6862)' }}>(optional)</span>
        </span>
        <textarea
          value={pitch}
          onChange={(e) => setPitch(e.target.value)}
          rows={5}
          placeholder="What you're great at, who you know, why you'd love to work with A&V."
          style={{
            width: '100%', padding: '10px 12px',
            border: '1px solid rgba(10,77,60,0.25)', borderRadius: 8,
            fontSize: 14, lineHeight: 1.5, color: 'var(--ink, #14201B)', background: '#fff',
            resize: 'vertical', fontFamily: 'inherit'
          }}
        />
      </label>

      {error && (
        <div style={{ fontSize: 13, color: 'var(--garnet, #A23B2E)', margin: '0 0 14px' }}>
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={saving}
        style={{
          background: 'var(--emerald-deep, #0A4D3C)',
          color: '#fff', border: 'none', borderRadius: 8,
          padding: '12px 22px', fontSize: 14, fontWeight: 600,
          cursor: saving ? 'wait' : 'pointer',
          opacity: saving ? 0.6 : 1, width: '100%'
        }}
      >
        {saving ? 'Submitting…' : 'Submit my application'}
      </button>
    </div>
  );
}
