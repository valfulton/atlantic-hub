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
import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import type { IcpProvenance, IcpItemSource } from '@/lib/client/icp';

interface IcpValue {
  industries: string[];
  geographies: string[];
  excludeGeographies: string[];
  excludedIndustries: string[];
  /** (#252) Per-client preferred / excluded contact titles. Inc 1 persists;
   *  Inc 2 will apply the filter at "pick top person" discovery steps. */
  preferredContactTitles: string[];
  excludedContactTitles: string[];
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

// Inline styles (not palette classes) so the colors always render regardless of
// Tailwind purge.
//   amber  = operator (val)
//   teal   = client
//   blue   = ai_intake (#239 — sharpener from brief)
//   muted  = new/unsaved
const CHIP_STYLE: Record<'operator' | 'client' | 'ai_intake' | 'new', CSSProperties> = {
  operator: { borderColor: 'rgba(255,199,61,0.45)', color: '#FFC73D', background: 'rgba(255,199,61,0.10)' },
  client: { borderColor: 'rgba(94,234,212,0.45)', color: '#5eead4', background: 'rgba(94,234,212,0.10)' },
  ai_intake: { borderColor: 'rgba(147,197,253,0.45)', color: '#93c5fd', background: 'rgba(147,197,253,0.10)' },
  new: { borderColor: 'var(--border, rgba(255,255,255,0.15))', color: 'var(--muted, #9aa)', background: 'transparent' }
};

const CHIP_TITLE: Record<'operator' | 'client' | 'ai_intake' | 'new', string> = {
  operator: 'You added this',
  client: 'Client added this',
  ai_intake: 'Sharpened from intake (review + edit any time)',
  new: 'New — save to keep'
};

/** Live chips beneath a list field, colored by who authored each item. New items
 *  the operator just typed (not yet on file) show muted until saved. */
function ProvenanceChips({ value, sources }: { value: string; sources: Record<string, IcpItemSource> }) {
  const items = toList(value);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {items.map((it, i) => {
        const src = sources[it.toLowerCase()];
        const key: 'operator' | 'client' | 'ai_intake' | 'new' =
          src === 'client' ? 'client'
          : src === 'operator' ? 'operator'
          : src === 'ai_intake' ? 'ai_intake'
          : 'new';
        return (
          <span
            key={`${it}-${i}`}
            className="text-[11px] px-2 py-0.5 rounded-full border"
            style={CHIP_STYLE[key]}
            title={CHIP_TITLE[key]}
          >
            {it}
          </span>
        );
      })}
    </div>
  );
}

export default function IcpEditor({
  clientId,
  initial,
  provenance
}: {
  clientId: number;
  initial: IcpValue;
  provenance?: IcpProvenance;
}) {
  const router = useRouter();
  const prov = provenance ?? {
    industries: {},
    geographies: {},
    excludeGeographies: {},
    excludedIndustries: {},
    preferredContactTitles: {},
    excludedContactTitles: {},
    description: null
  };
  const [industries, setIndustries] = useState(toLine(initial.industries));
  const [excludedIndustries, setExcludedIndustries] = useState(toLine(initial.excludedIndustries));
  const [geographies, setGeographies] = useState(toLine(initial.geographies));
  const [excludeGeographies, setExcludeGeographies] = useState(toLine(initial.excludeGeographies));
  // (#252 Inc 1) Operator preferences for the "pick top person" steps in
  // discovery. Skip's "no HR people" rule is exactly excludedContactTitles.
  const [preferredContactTitles, setPreferredContactTitles] = useState(toLine(initial.preferredContactTitles ?? []));
  const [excludedContactTitles, setExcludedContactTitles] = useState(toLine(initial.excludedContactTitles ?? []));
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
          preferredContactTitles: toList(preferredContactTitles),
          excludedContactTitles: toList(excludedContactTitles),
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
      <p className="text-xs text-muted mb-2 leading-relaxed">
        These drive &ldquo;Find leads for this client.&rdquo; Target their <span className="text-ink">customers&rsquo;</span> industries
        (not the client&rsquo;s own), and exclude the noise. Comma-separated.
      </p>
      <div className="flex flex-wrap items-center gap-3 mb-3 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full border" style={CHIP_STYLE.operator} /> You added
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full border" style={CHIP_STYLE.client} /> Client added
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full border" style={CHIP_STYLE.new} /> New — save to keep
        </span>
        <span className="text-muted">· edit freely; chips are just a cue for what they changed</span>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block sm:col-span-2">
          <span className={label}>Target industries / keywords</span>
          <span className={hint}>The kinds of companies they sell to — e.g. construction, restaurants, manufacturers</span>
          <input className={input} value={industries} onChange={(e) => setIndustries(e.target.value)} />
          <ProvenanceChips value={industries} sources={prov.industries} />
        </label>
        <label className="block sm:col-span-2">
          <span className={label}>Exclude industries</span>
          <span className={hint}>Drop these from results — e.g. hospital, health system, insurance carrier</span>
          <input className={input} value={excludedIndustries} onChange={(e) => setExcludedIndustries(e.target.value)} />
          <ProvenanceChips value={excludedIndustries} sources={prov.excludedIndustries} />
        </label>
        <label className="block">
          <span className={label}>Locations</span>
          <span className={hint}>City / state / country</span>
          <input className={input} value={geographies} onChange={(e) => setGeographies(e.target.value)} />
          <ProvenanceChips value={geographies} sources={prov.geographies} />
        </label>
        <label className="block">
          <span className={label}>Exclude locations</span>
          <span className={hint}>Optional</span>
          <input className={input} value={excludeGeographies} onChange={(e) => setExcludeGeographies(e.target.value)} />
          <ProvenanceChips value={excludeGeographies} sources={prov.excludeGeographies} />
        </label>
        {/* (#252 Inc 1) Contact-title preferences. Inc 2 applies them at
            "pick top person" discovery steps; Inc 1 only persists. */}
        <label className="block sm:col-span-2">
          <span className={label}>Preferred contact titles</span>
          <span className={hint}>
            Titles to rank FIRST when picking the top person at a matched company — e.g. CEO, Founder, Owner, COO
          </span>
          <input
            className={input}
            value={preferredContactTitles}
            onChange={(e) => setPreferredContactTitles(e.target.value)}
            placeholder="CEO, Founder, Owner, COO, President"
          />
          <ProvenanceChips value={preferredContactTitles} sources={prov.preferredContactTitles} />
        </label>
        <label className="block sm:col-span-2">
          <span className={label}>Excluded contact titles</span>
          <span className={hint}>
            Drop these from results — e.g. HR, Recruiter (gate-keepers). Skip&apos;s rule.
          </span>
          <input
            className={input}
            value={excludedContactTitles}
            onChange={(e) => setExcludedContactTitles(e.target.value)}
            placeholder="HR, Recruiter, Talent Acquisition"
          />
          <ProvenanceChips value={excludedContactTitles} sources={prov.excludedContactTitles} />
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
