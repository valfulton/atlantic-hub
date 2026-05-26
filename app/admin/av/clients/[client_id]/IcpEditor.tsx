'use client';

/**
 * IcpEditor — operator tunes WHO a client's discovery looks for. This is the fix
 * for off-target leads (e.g. a benefits broker pulling hospitals): set the target
 * industries/keywords to their real customers, and exclude the noise.
 *
 * Lists are comma-separated in the UI, sent as arrays. Saves to
 * /api/admin/av/clients/[id]/icp; the next "Find leads for this client" run uses
 * the new ICP immediately (excluded industries are filtered out of results).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface IcpValue {
  industries: string[];
  geographies: string[];
  excludeGeographies: string[];
  excludedIndustries: string[];
  companySizeMin: number | null;
  companySizeMax: number | null;
  description: string;
}

const toLine = (a: string[]) => (a || []).join(', ');
const toList = (s: string) =>
  s.split(',').map((x) => x.trim()).filter(Boolean);
const toNum = (s: string): number | null => {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export default function IcpEditor({ clientId, initial }: { clientId: number; initial: IcpValue }) {
  const router = useRouter();
  const [industries, setIndustries] = useState(toLine(initial.industries));
  const [excludedIndustries, setExcludedIndustries] = useState(toLine(initial.excludedIndustries));
  const [geographies, setGeographies] = useState(toLine(initial.geographies));
  const [excludeGeographies, setExcludeGeographies] = useState(toLine(initial.excludeGeographies));
  const [sizeMin, setSizeMin] = useState(initial.companySizeMin != null ? String(initial.companySizeMin) : '');
  const [sizeMax, setSizeMax] = useState(initial.companySizeMax != null ? String(initial.companySizeMax) : '');
  const [description, setDescription] = useState(initial.description || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/icp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          industries: toList(industries),
          excludedIndustries: toList(excludedIndustries),
          geographies: toList(geographies),
          excludeGeographies: toList(excludeGeographies),
          companySizeMin: toNum(sizeMin),
          companySizeMax: toNum(sizeMax),
          description
        })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || 'Could not save.');
      setMsg({ ok: true, text: 'Saved. The next discovery run uses this.' });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  const input = 'w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm text-ink focus:outline-none focus:border-brand';
  const label = 'block text-sm text-ink font-medium';
  const hint = 'block text-[11px] text-muted mb-1';

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 mb-5">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-1">Their ICP — who discovery targets</div>
      <p className="text-xs text-muted mb-3 leading-relaxed">
        These drive &ldquo;Find leads for this client.&rdquo; Target their <span className="text-ink">customers&rsquo;</span> industries
        (not the client&rsquo;s own), and exclude the noise. Comma-separated.
      </p>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block sm:col-span-2">
          <span className={label}>Target industries / keywords</span>
          <span className={hint}>The kinds of companies they sell to — e.g. construction, restaurants, manufacturers</span>
          <input className={input} value={industries} onChange={(e) => setIndustries(e.target.value)} />
        </label>
        <label className="block sm:col-span-2">
          <span className={label}>Exclude industries</span>
          <span className={hint}>Drop these from results — e.g. hospital, health system, insurance carrier</span>
          <input className={input} value={excludedIndustries} onChange={(e) => setExcludedIndustries(e.target.value)} />
        </label>
        <label className="block">
          <span className={label}>Locations</span>
          <span className={hint}>City / state / country</span>
          <input className={input} value={geographies} onChange={(e) => setGeographies(e.target.value)} />
        </label>
        <label className="block">
          <span className={label}>Exclude locations</span>
          <span className={hint}>Optional</span>
          <input className={input} value={excludeGeographies} onChange={(e) => setExcludeGeographies(e.target.value)} />
        </label>
        <label className="block">
          <span className={label}>Company size — min employees</span>
          <span className={hint}>Optional</span>
          <input className={input} inputMode="numeric" value={sizeMin} onChange={(e) => setSizeMin(e.target.value)} />
        </label>
        <label className="block">
          <span className={label}>Company size — max employees</span>
          <span className={hint}>Optional</span>
          <input className={input} inputMode="numeric" value={sizeMax} onChange={(e) => setSizeMax(e.target.value)} />
        </label>
        <label className="block sm:col-span-2">
          <span className={label}>Notes / description</span>
          <span className={hint}>Freeform — who their ideal client really is</span>
          <textarea className={input} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>

      <div className="flex items-center gap-3 mt-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg px-4 py-2 text-sm font-medium"
          style={{ background: 'linear-gradient(120deg,#FF9C5B,#FFC73D)', color: '#1a1207', border: 'none' }}
        >
          {saving ? 'Saving…' : 'Save ICP'}
        </button>
        {msg && (
          <span className="text-xs" style={{ color: msg.ok ? '#6ee7b7' : '#fca5a5' }}>{msg.text}</span>
        )}
      </div>
    </div>
  );
}
