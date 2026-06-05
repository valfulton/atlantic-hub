'use client';

/**
 * NewClientForm — operator creates a client in one shot. Collapsed by default so
 * the roster stays clean; expand to fill a few fields. On success it shows the
 * magic link to copy/send and a link straight into the new client's detail.
 * Posts to /api/admin/av/clients/create.
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

type Tier = 'audit_only' | 'sprint' | 'momentum' | 'scale';

interface PackOption {
  id: string;
  displayName: string;
  shortPositioning: string;
}

const inputCls = 'w-full rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink';
const labelCls = 'block text-[11px] uppercase tracking-[0.1em] text-muted mb-1';

export default function NewClientForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ clientId: number | null; magicLink: string; emailSent: boolean; lineSeeded: boolean } | null>(null);

  const [f, setF] = useState({
    email: '', name: '', company: '', industry: '', website_url: '',
    tier: 'scale' as Tier, trialDays: '30',
    // (#428) Vertical pack applied right after creation — no second step
    // required. Blank = no pack (legacy marketing-only clients).
    verticalPack: '',
    // Creative-brief prefill (you fill as much as you can; the client approves/adds).
    key_message: '', target_audience: '', why_advertise: '', goals: '', audience_insights: '',
    message_support: '', differentiators: '', competitors: '', brand_voice: '', brand_colors: '',
    preferred_channels: '', timeline: ''
  });
  const set = (k: keyof typeof f, v: unknown) => setF((s) => ({ ...s, [k]: v }));

  // (#428) Load the vertical pack catalog once. Falls back to no-pack option on error.
  const [packs, setPacks] = useState<PackOption[]>([]);
  useEffect(() => {
    let alive = true;
    fetch('/api/admin/av/vertical-packs')
      .then((r) => (r.ok ? r.json() : { packs: [] }))
      .then((j: { packs?: PackOption[] }) => { if (alive) setPacks(j.packs ?? []); })
      .catch(() => { if (alive) setPacks([]); });
    return () => { alive = false; };
  }, []);

  async function submit(send: boolean) {
    if (!f.email.trim()) { setErr('Email is required.'); return; }
    setBusy(true); setErr(null); setDone(null);
    try {
      const res = await fetch('/api/admin/av/clients/create', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: f.email.trim(), name: f.name.trim() || null, company: f.company.trim() || null,
          industry: f.industry.trim() || null, tier: f.tier,
          trialDays: Number(f.trialDays) || null, sendInvite: send,
          // (#416) Website MUST be in the body. Canonical intake key is
          // `website_url` (per lib/client/intake_fields). Without this the API
          // had no website field in INTAKE_KEYS to pick up, intake.website_url
          // stayed blank on creation, the autofill in createClientFromOperator
          // (#415) never fired, and the intake form showed up empty. This is
          // the field that "I already entered this" referred to.
          website_url: f.website_url.trim() || undefined,
          key_message: f.key_message.trim() || undefined, target_audience: f.target_audience.trim() || undefined,
          why_advertise: f.why_advertise.trim() || undefined, goals: f.goals.trim() || undefined,
          audience_insights: f.audience_insights.trim() || undefined, message_support: f.message_support.trim() || undefined,
          differentiators: f.differentiators.trim() || undefined, competitors: f.competitors.trim() || undefined,
          brand_voice: f.brand_voice.trim() || undefined, brand_colors: f.brand_colors.trim() || undefined,
          preferred_channels: f.preferred_channels.trim() || undefined, timeline: f.timeline.trim() || undefined
        })
      });
      const j = await res.json();
      if (res.ok && j.ok) {
        // (#428) If a vertical pack was selected, fire the apply call right
        // after creation so the new client lands with the pack already on —
        // signal weights, cascade recipes, ICP seed all in place. Best-effort:
        // if this fails the client still exists; operator can apply the pack
        // manually from the VerticalPackPanel on the client detail page.
        if (j.clientId && f.verticalPack) {
          try {
            await fetch(`/api/admin/av/clients/${j.clientId}/vertical-pack`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ packId: f.verticalPack })
            });
          } catch { /* non-fatal — client exists, pack can be applied later */ }
        }
        setDone({ clientId: j.clientId ?? null, magicLink: j.magicLink, emailSent: j.emailSent, lineSeeded: j.lineSeeded });
        router.refresh();
      } else {
        setErr(j.error || 'Could not create the client.');
      }
    } catch {
      setErr('Could not create the client.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setDone(null); setErr(null);
    setF({
      email: '', name: '', company: '', industry: '', website_url: '', tier: 'scale', trialDays: '30',
      verticalPack: '',
      key_message: '', target_audience: '', why_advertise: '', goals: '', audience_insights: '',
      message_support: '', differentiators: '', competitors: '', brand_voice: '', brand_colors: '',
      preferred_channels: '', timeline: ''
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mb-5 rounded-lg bg-brand hover:opacity-90 text-black font-medium text-sm px-4 py-2">
        + New client
      </button>
    );
  }

  return (
    <div className="mb-6 rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-base font-semibold text-ink">New client</div>
        <button onClick={() => { setOpen(false); reset(); }} className="text-muted text-sm hover:text-ink">Close</button>
      </div>

      {done ? (
        <div>
          <p className="text-sm text-ink mb-2">
            Client created{done.lineSeeded ? ' with a seeded narrative line' : ''}.
            {' '}{done.emailSent ? 'Magic-link invite emailed.' : 'No email sent — copy the link below to send when ready.'}
          </p>
          <label className={labelCls}>Magic link (valid 24h)</label>
          <div className="flex gap-2">
            <input className={inputCls} readOnly value={done.magicLink} onFocusCapture={(e) => e.currentTarget.select()} />
            <button onClick={() => navigator.clipboard?.writeText(done.magicLink)} className="shrink-0 rounded-lg border border-border bg-black/30 px-3 text-sm text-ink">Copy</button>
          </div>
          <div className="mt-4 flex gap-2">
            {done.clientId && <a href={`/admin/av/clients/${done.clientId}`} className="rounded-lg bg-brand hover:opacity-90 text-black font-medium text-sm px-4 py-2">Open client</a>}
            <button onClick={reset} className="rounded-lg border border-border bg-black/30 px-4 py-2 text-sm text-ink">Create another</button>
          </div>
        </div>
      ) : (
        <div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className={labelCls}>Email *</label><input className={inputCls} type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
            <div><label className={labelCls}>Contact name</label><input className={inputCls} value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
            <div><label className={labelCls}>Company</label><input className={inputCls} value={f.company} onChange={(e) => set('company', e.target.value)} /></div>
            <div>
              <label className={labelCls}>Website</label>
              <input
                className={inputCls}
                type="url"
                placeholder="https://example.com"
                value={f.website_url}
                onChange={(e) => set('website_url', e.target.value)}
              />
              <div className="text-[10px] text-muted mt-1">
                Paste it once — we pull the rest of their brief from the page on save.
              </div>
            </div>
            <div><label className={labelCls}>Industry</label><input className={inputCls} value={f.industry} onChange={(e) => set('industry', e.target.value)} /></div>
            <div>
              <label className={labelCls}>Tier</label>
              <select className={inputCls} value={f.tier} onChange={(e) => set('tier', e.target.value as Tier)}>
                {(['audit_only', 'sprint', 'momentum', 'scale'] as Tier[]).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label className={labelCls}>Trial days (blank = permanent)</label><input className={inputCls} inputMode="numeric" value={f.trialDays} onChange={(e) => set('trialDays', e.target.value)} /></div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Vertical pack (applies signal weights + cascade recipes)</label>
              <select className={inputCls} value={f.verticalPack} onChange={(e) => set('verticalPack', e.target.value)}>
                <option value="">— No pack (marketing-only client) —</option>
                {packs.map((p) => (
                  <option key={p.id} value={p.id}>{p.displayName} — {p.shortPositioning}</option>
                ))}
              </select>
              <div className="text-[10px] text-muted mt-1">
                Picks the engine's signal weights + cascade recipes for this client&apos;s vertical. Auto-applies after creation.
              </div>
            </div>
          </div>
          <div className="mt-4 text-[11px] uppercase tracking-[0.1em] text-muted">Creative brief — prefill as much as you can (they approve / add the rest)</div>
          <div className="mt-2 grid sm:grid-cols-2 gap-3">
            <div><label className={labelCls}>Key message (seeds their thesis)</label><input className={inputCls} value={f.key_message} onChange={(e) => set('key_message', e.target.value)} placeholder="If they remember one thing…" /></div>
            <div><label className={labelCls}>Target audience</label><input className={inputCls} value={f.target_audience} onChange={(e) => set('target_audience', e.target.value)} placeholder="Who they want to reach" /></div>
            <div><label className={labelCls}>Why advertise</label><input className={inputCls} value={f.why_advertise} onChange={(e) => set('why_advertise', e.target.value)} /></div>
            <div><label className={labelCls}>Goals</label><input className={inputCls} value={f.goals} onChange={(e) => set('goals', e.target.value)} /></div>
            <div><label className={labelCls}>Audience insights</label><input className={inputCls} value={f.audience_insights} onChange={(e) => set('audience_insights', e.target.value)} /></div>
            <div><label className={labelCls}>Proof / support</label><input className={inputCls} value={f.message_support} onChange={(e) => set('message_support', e.target.value)} /></div>
            <div><label className={labelCls}>Differentiators</label><input className={inputCls} value={f.differentiators} onChange={(e) => set('differentiators', e.target.value)} /></div>
            <div><label className={labelCls}>Competitors</label><input className={inputCls} value={f.competitors} onChange={(e) => set('competitors', e.target.value)} /></div>
            <div><label className={labelCls}>Brand voice</label><input className={inputCls} value={f.brand_voice} onChange={(e) => set('brand_voice', e.target.value)} /></div>
            <div><label className={labelCls}>Brand colors</label><input className={inputCls} value={f.brand_colors} onChange={(e) => set('brand_colors', e.target.value)} /></div>
            <div><label className={labelCls}>Preferred channels</label><input className={inputCls} value={f.preferred_channels} onChange={(e) => set('preferred_channels', e.target.value)} /></div>
            <div><label className={labelCls}>Seasonality / key dates</label><input className={inputCls} value={f.timeline} onChange={(e) => set('timeline', e.target.value)} /></div>
          </div>
          {err && <div className="mt-3 text-sm" style={{ color: '#fca5a5' }}>{err}</div>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={() => submit(false)} disabled={busy || !f.email.trim()} className="rounded-lg bg-brand hover:opacity-90 disabled:opacity-50 text-brand-fg font-medium text-sm px-5 py-2">
              {busy ? 'Saving…' : 'Save only'}
            </button>
            <button onClick={() => submit(true)} disabled={busy || !f.email.trim()} className="rounded-lg border border-border bg-black/30 hover:border-brand disabled:opacity-50 text-ink font-medium text-sm px-5 py-2">
              {busy ? 'Saving…' : 'Save & send invite'}
            </button>
            <span className="text-[11px] text-muted">Save only = no email (copy the link after). Either way: creates the account + hub, sets tier/trial, seeds a candidate line.</span>
          </div>
        </div>
      )}
    </div>
  );
}
