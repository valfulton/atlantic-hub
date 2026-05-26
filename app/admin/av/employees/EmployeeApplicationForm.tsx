'use client';

/**
 * EmployeeApplicationForm — fresh in-hub onboarding form. Used both by the
 * employee (self-fill) and the operator (prefill/edit on their behalf). One
 * store (employee_profiles), no external site, no honeypot. Non-sensitive
 * fields only; W-9 / IDs / banking go in document uploads, not here.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface AppValue {
  title: string | null;
  phone: string | null;
  location: string | null;
  startDate: string | null;
  compBasis: string | null;
  emergencyContact: string | null;
  payload: Record<string, unknown>;
}

const PAYLOAD_FIELDS: { key: string; label: string; hint: string; area?: boolean }[] = [
  { key: 'preferred_name', label: 'Preferred name', hint: 'What we should call you' },
  { key: 'linkedin', label: 'LinkedIn', hint: 'Profile URL (optional)' },
  { key: 'experience', label: 'Relevant experience', hint: 'Sales / industry background', area: true },
  { key: 'availability', label: 'Availability', hint: 'Hours / days you can work' },
  { key: 'about_you', label: 'Anything else we should know?', hint: 'Optional', area: true }
];

export default function EmployeeApplicationForm({
  userId,
  initial,
  selfMode = false
}: {
  userId: number;
  initial: AppValue | null;
  /** true when the employee is filling their own (copy adjusts). */
  selfMode?: boolean;
}) {
  const router = useRouter();
  const seed = initial ?? { title: null, phone: null, location: null, startDate: null, compBasis: null, emergencyContact: null, payload: {} };
  const [title, setTitle] = useState(seed.title ?? '');
  const [phone, setPhone] = useState(seed.phone ?? '');
  const [location, setLocation] = useState(seed.location ?? '');
  const [startDate, setStartDate] = useState(seed.startDate ?? '');
  const [compBasis, setCompBasis] = useState(seed.compBasis ?? '');
  const [emergencyContact, setEmergencyContact] = useState(seed.emergencyContact ?? '');
  const initialPayload = useMemo(() => {
    const o: Record<string, string> = {};
    for (const f of PAYLOAD_FIELDS) o[f.key] = typeof seed.payload?.[f.key] === 'string' ? (seed.payload[f.key] as string) : '';
    return o;
  }, [seed.payload]);
  const [payload, setPayload] = useState<Record<string, string>>(initialPayload);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function setP(k: string, v: string) { setPayload((p) => ({ ...p, [k]: v })); }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/av/employees/${userId}/application`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, phone, location, startDate, compBasis, emergencyContact, payload })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || 'Could not save.');
      setMsg({ ok: true, text: selfMode ? 'Saved — thank you! Your details are in.' : 'Saved.' });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const input = 'w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm text-ink focus:outline-none focus:border-brand';
  const lab = 'block text-sm text-ink font-medium';
  const hint = 'block text-[11px] text-muted mb-1';

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-1">Application / onboarding</div>
      <p className="text-xs text-muted mb-3 leading-relaxed">
        {selfMode
          ? 'Fill in your details so we can get you set up. Sensitive paperwork (W-9, ID, signed agreement) is handled separately — don’t put SSN or banking here.'
          : 'Their onboarding details. You can prefill or edit; sensitive docs live in Documents, not here.'}
      </p>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block"><span className={lab}>Title / role</span><span className={hint}>e.g. Sales rep</span>
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="block"><span className={lab}>Phone</span><span className={hint}>Best number</span>
          <input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <label className="block"><span className={lab}>Location</span><span className={hint}>City / state</span>
          <input className={input} value={location} onChange={(e) => setLocation(e.target.value)} /></label>
        <label className="block"><span className={lab}>Start date</span><span className={hint}>When you began / will begin</span>
          <input type="date" className={input} value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
        <label className="block"><span className={lab}>Compensation basis</span><span className={hint}>e.g. commission + residual</span>
          <input className={input} value={compBasis} onChange={(e) => setCompBasis(e.target.value)} /></label>
        <label className="block"><span className={lab}>Emergency contact</span><span className={hint}>Name + phone</span>
          <input className={input} value={emergencyContact} onChange={(e) => setEmergencyContact(e.target.value)} /></label>
        {PAYLOAD_FIELDS.map((f) => (
          <label key={f.key} className={f.area ? 'block sm:col-span-2' : 'block'}>
            <span className={lab}>{f.label}</span><span className={hint}>{f.hint}</span>
            {f.area
              ? <textarea className={input} rows={2} value={payload[f.key]} onChange={(e) => setP(f.key, e.target.value)} />
              : <input className={input} value={payload[f.key]} onChange={(e) => setP(f.key, e.target.value)} />}
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-3">
        <button onClick={save} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-medium"
          style={{ background: 'linear-gradient(120deg,#FF9C5B,#FFC73D)', color: '#1a1207', border: 'none' }}>
          {busy ? 'Saving…' : 'Save application'}
        </button>
        {msg && <span className="text-xs" style={{ color: msg.ok ? '#6ee7b7' : '#fca5a5' }}>{msg.text}</span>}
      </div>
    </div>
  );
}
