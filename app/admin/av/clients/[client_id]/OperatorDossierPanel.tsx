'use client';

/**
 * OperatorDossierPanel  (#521 + #521b, val 2026-06-08)
 *
 * Operator-only Due Diligence file per client. Holds the PII + screening
 * notes val needs BEFORE deciding to take on a new client:
 *   - Personal address (home/mailing — never on the brief)
 *   - Birth year (for record matching)
 *   - Prior entity names (LLCs / DBAs to screen against)
 *   - Spouse / co-signer (often the actual decision-maker)
 *   - Free-form notes
 *   - Red-flag log (manual + auto from screens)
 *
 * Live screen buttons:
 *   - Look up USPTO patents (calls PatentsView API, files results as red flag)
 *   - Search USPTO trademarks (opens USPTO trademark search in new tab)
 *
 * NEVER renders when mode !== 'operator'. The parent passes mode; client
 * previews send 'client_preview' and the panel returns null.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClientDossier, RedFlag, DossierAddress } from '@/lib/av/client_dossier';

interface Props {
  clientId: number;
  /** Pre-loaded server-side via getDossier(). */
  initialDossier: ClientDossier;
  /** Pre-loaded from the brief so the screen buttons have something to query. */
  briefCompany: string | null;
  briefContactName: string | null;
  /** Operator vs client_preview — panel returns null when not operator. */
  mode: 'operator' | 'client_preview';
}

const SEV_STYLES: Record<RedFlag['severity'], string> = {
  low: 'border-amber-400/40 bg-amber-400/[0.08] text-amber-200',
  medium: 'border-orange-400/40 bg-orange-400/[0.08] text-orange-200',
  high: 'border-rose-400/50 bg-rose-400/[0.10] text-rose-200'
};

const SEV_LABEL: Record<RedFlag['severity'], string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High'
};

function newRedFlagId(): string {
  return 'rf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * (#525) Minimal markdown → HTML converter for the print-friendly DD report
 * tab. We don't want to ship a real markdown lib client-side just for this
 * one feature — the report uses a known subset of markdown (headers, lists,
 * tables, bold, code, blockquotes, hr) and this handles all of it.
 *
 * If we end up using this in more places, swap for `marked` (5kb gzip) or
 * `micromark`. For now: zero-dep.
 */
function markdownToBasicHtml(md: string): string {
  // Escape HTML first (we'll add tags after).
  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  let inTable = false;
  let tableHeaderDone = false;

  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  const closeTable = () => { if (inTable) { out.push('</tbody></table>'); inTable = false; tableHeaderDone = false; } };

  const inline = (s: string) => {
    let r = escapeHtml(s);
    // bold
    r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // inline code
    r = r.replace(/`([^`]+)`/g, '<code>$1</code>');
    // italic (single underscore around word)
    r = r.replace(/\b_([^_]+)_\b/g, '<em>$1</em>');
    return r;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList(); closeTable();
      continue;
    }
    if (line.startsWith('# ')) { closeList(); closeTable(); out.push(`<h1>${inline(line.slice(2))}</h1>`); continue; }
    if (line.startsWith('## ')) { closeList(); closeTable(); out.push(`<h2>${inline(line.slice(3))}</h2>`); continue; }
    if (line.startsWith('### ')) { closeList(); closeTable(); out.push(`<h3>${inline(line.slice(4))}</h3>`); continue; }
    if (line === '---') { closeList(); closeTable(); out.push('<hr>'); continue; }
    if (line.startsWith('> ')) { closeList(); closeTable(); out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`); continue; }
    if (line.startsWith('- ') || line.startsWith('  - ')) {
      closeTable();
      if (!inList) { out.push('<ul>'); inList = true; }
      const depth = line.startsWith('  - ') ? 4 : 2;
      out.push(`<li>${inline(line.slice(depth))}</li>`);
      continue;
    }
    if (line.startsWith('|')) {
      closeList();
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      // Separator row like |---|---|
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
      if (!inTable) { out.push('<table><thead>'); inTable = true; tableHeaderDone = false; }
      if (!tableHeaderDone) {
        out.push('<tr>' + cells.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>');
        tableHeaderDone = true;
      } else {
        out.push('<tr>' + cells.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>');
      }
      continue;
    }
    closeList(); closeTable();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList(); closeTable();
  return out.join('\n');
}

function fmtTs(s: string | null | undefined): string {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface PatentHit {
  patentId: string;
  patentTitle: string;
  patentDate: string | null;
  assigneeOrg: string | null;
  inventorNames: string[];
  publicUrl: string;
}

interface PatentLookupResult {
  ok: boolean;
  query: string;
  byAssignee: PatentHit[];
  byInventor: PatentHit[];
  totalAssigneeHits: number;
  totalInventorHits: number;
  fetchedAt: string;
  error?: string;
}

export default function OperatorDossierPanel({
  clientId,
  initialDossier,
  briefCompany,
  briefContactName,
  mode
}: Props) {
  // PII-safety: this panel never renders on client-preview surfaces.
  if (mode !== 'operator') return null;

  const router = useRouter();
  const [d, setD] = useState<ClientDossier>(initialDossier);
  const [busy, setBusy] = useState<'idle' | 'saving' | 'patents' | 'kyc' | 'report' | 'address'>('idle');
  const [kycReport, setKycReport] = useState<{
    sweptAt: string;
    steps: Array<{ source: string; ran: boolean; hits: number; skipReason?: string; flagLabel?: string }>;
    flagsAdded: number;
  } | null>(null);
  // (#525) DD Report state
  const [ddReport, setDdReport] = useState<{
    markdown: string;
    meta: { generatedAt: string; subject: string; flagCount: number; recordCount: number; auditScore: number | null };
  } | null>(null);
  const [copyOk, setCopyOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [patentResult, setPatentResult] = useState<PatentLookupResult | null>(null);
  // (#529) Address-stress screen result state
  const [addressScreenResult, setAddressScreenResult] = useState<{
    addresses_screened: number;
    geocoded: number;
    results: Array<{
      address: string;
      matchedAddress: string | null;
      county: string | null;
      state: string | null;
      ok: boolean;
      signalLabel: string;
      hmda: {
        total_applications?: number;
        total_originated?: number;
        total_denied?: number;
        median_loan_amount?: number | null;
        denial_rate?: number | null;
      } | null;
      propertyRecord: { status: string; note: string };
    }>;
  } | null>(null);

  // Inline add-red-flag form state
  const [newFlagLabel, setNewFlagLabel] = useState('');
  const [newFlagSeverity, setNewFlagSeverity] = useState<RedFlag['severity']>('medium');

  // (#524) Inline add-address form state
  const [newAddrText, setNewAddrText] = useState('');
  const [newAddrSource, setNewAddrSource] = useState('manual');
  const [newAddrLabel, setNewAddrLabel] = useState('');

  function newAddressId(): string {
    return 'addr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function addAddress() {
    const text = newAddrText.trim();
    if (!text) return;
    // Dedup: same address + source?
    const exists = d.addressHistory.find(
      (a) => a.address.trim().toLowerCase() === text.toLowerCase() && a.source === newAddrSource
    );
    if (exists) {
      setErr('That address is already on file from that source.');
      return;
    }
    const next: DossierAddress = {
      id: newAddressId(),
      address: text,
      source: newAddrSource,
      captured_at: new Date().toISOString(),
      label: newAddrLabel.trim() || null,
      notes: null
    };
    setD((cur) => ({
      ...cur,
      addressHistory: [next, ...cur.addressHistory],
      // Mirror to personal_address so legacy readers see the latest.
      personalAddress: text
    }));
    setNewAddrText('');
    setNewAddrLabel('');
    setErr(null);
  }
  function removeAddress(id: string) {
    setD((cur) => {
      const filtered = cur.addressHistory.filter((a) => a.id !== id);
      // If we removed the one mirrored to personalAddress, update the mirror.
      const newPrimary = filtered[0]?.address ?? null;
      return { ...cur, addressHistory: filtered, personalAddress: newPrimary };
    });
  }

  async function save() {
    setBusy('saving');
    setErr(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/dossier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalAddress: d.personalAddress,
          addressHistory: d.addressHistory,
          dobYear: d.dobYear,
          priorEntities: d.priorEntities,
          spouseOrCosignerName: d.spouseOrCosignerName,
          notesMd: d.notesMd,
          redFlags: d.redFlags
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setD(data.dossier);
      setOkMsg('Applied.');
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('idle');
    }
  }

  function addRedFlag() {
    const label = newFlagLabel.trim();
    if (!label) return;
    const next: RedFlag = {
      id: newRedFlagId(),
      label,
      source: 'manual',
      severity: newFlagSeverity,
      surfaced_at: new Date().toISOString()
    };
    setD((cur) => ({ ...cur, redFlags: [next, ...cur.redFlags] }));
    setNewFlagLabel('');
  }

  function removeRedFlag(id: string) {
    setD((cur) => ({ ...cur, redFlags: cur.redFlags.filter((f) => f.id !== id) }));
  }

  async function generateDdReport() {
    setBusy('report');
    setErr(null);
    setOkMsg(null);
    setDdReport(null);
    setCopyOk(false);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/dossier/dd-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDdReport({ markdown: data.markdown, meta: data.meta });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('idle');
    }
  }

  async function copyReport() {
    if (!ddReport) return;
    try {
      await navigator.clipboard.writeText(ddReport.markdown);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 2000);
    } catch {
      setErr('Could not copy to clipboard. Select the text manually instead.');
    }
  }

  function printReport() {
    if (!ddReport) return;
    // Open a new tab with a styled HTML version, trigger print.
    const html = `<!DOCTYPE html>
<html><head><title>DD Report — ${ddReport.meta.subject}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; max-width: 7in; margin: 0.5in auto; padding: 0 0.5in; color: #1a1a1a; line-height: 1.55; }
  h1 { font-size: 24pt; border-bottom: 2px solid #CDA434; padding-bottom: 8px; margin-bottom: 4px; }
  h2 { font-size: 14pt; margin-top: 1.5em; color: #5a4a1a; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  h3 { font-size: 12pt; margin-top: 1em; }
  table { border-collapse: collapse; width: 100%; margin: 0.5em 0; font-size: 10pt; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
  th { background: #f5f0e0; }
  code { background: #f0f0f0; padding: 1px 5px; border-radius: 3px; font-size: 9pt; }
  blockquote { border-left: 3px solid #CDA434; margin-left: 0; padding-left: 1em; color: #555; font-style: italic; }
  hr { border: 0; border-top: 1px dashed #ccc; margin: 2em 0; }
  ul li { margin-bottom: 0.3em; }
  @media print { body { margin: 0; padding: 0.5in; } }
</style></head><body>
${markdownToBasicHtml(ddReport.markdown)}
<script>setTimeout(() => window.print(), 300);</script>
</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function runKycSweep() {
    setBusy('kyc');
    setErr(null);
    setOkMsg(null);
    setKycReport(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/dossier/run-kyc-sweep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setKycReport({
        sweptAt: data.sweptAt,
        steps: data.steps,
        flagsAdded: data.flagsAdded
      });
      setOkMsg(`KYC sweep ran · ${data.flagsAdded} flag${data.flagsAdded === 1 ? '' : 's'} added`);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('idle');
    }
  }

  async function runAddressScreen() {
    setBusy('address');
    setErr(null);
    setOkMsg(null);
    setAddressScreenResult(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/dossier/address-screen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setAddressScreenResult(data);
      setOkMsg(
        `Address screen ran · ${data.geocoded}/${data.addresses_screened} geocoded · market-stress signal saved per address`
      );
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('idle');
    }
  }

  async function lookupPatents() {
    setBusy('patents');
    setErr(null);
    setOkMsg(null);
    setPatentResult(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/dossier/lookup-patents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPatentResult(data.result as PatentLookupResult);
      router.refresh(); // pulls the new red-flag entry from server
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('idle');
    }
  }

  const trademarkQuery = (briefCompany || '').trim();
  // USPTO's newer trademark search is at tmsearch.uspto.gov. The basic search
  // accepts a query parameter — opens prefilled in a new tab.
  const trademarkSearchUrl = trademarkQuery
    ? `https://tmsearch.uspto.gov/search/search-information?searchType=basic&query=${encodeURIComponent(trademarkQuery)}`
    : 'https://tmsearch.uspto.gov/';

  const inputCls = 'w-full rounded-md bg-black/30 border border-white/10 px-2.5 py-1.5 text-[12.5px] text-white/90 placeholder-white/30 focus:outline-none focus:border-[color-mix(in_srgb,var(--gold-bright)_50%,transparent)]';
  const labelCls = 'block text-[10.5px] uppercase tracking-[0.14em] text-muted mb-1';

  return (
    <div id="dossier" className="rounded-2xl border border-rose-400/25 bg-rose-400/[0.025] p-4 mb-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.14em] text-rose-300/90 flex items-center gap-2">
            🔒 Due Diligence · operator only
          </div>
          <div className="text-[12px] text-white/65 mt-0.5">
            Notes + PII the client never sees. Lives separately from the creative brief.
          </div>
        </div>
        {d.lastScreenedAt && (
          <div className="text-[10.5px] text-muted">
            Last screened {fmtTs(d.lastScreenedAt.toString())}
          </div>
        )}
      </div>

      {/* Red-flag log — top of panel so the warning is the first thing seen. */}
      <div className="mb-4">
        <div className={labelCls}>Red flags ({d.redFlags.length})</div>
        {d.redFlags.length === 0 ? (
          <div className="text-[11.5px] text-muted italic rounded-md border border-dashed border-white/10 px-2.5 py-2">
            No flags yet. Add manually below or run a screen.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {d.redFlags.map((f) => (
              <li
                key={f.id}
                className={`rounded-md border px-2.5 py-1.5 flex items-start justify-between gap-2 text-[12px] ${SEV_STYLES[f.severity]}`}
              >
                <div className="min-w-0">
                  <div>{f.label}</div>
                  <div className="text-[10.5px] opacity-70 mt-0.5">
                    {SEV_LABEL[f.severity]} · {f.source} · {fmtTs(f.surfaced_at)}
                    {f.dossier_url && (
                      <> · <a href={f.dossier_url} target="_blank" rel="noopener" className="underline hover:text-[var(--gold-bright)]">open intel →</a></>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeRedFlag(f.id)}
                  className="shrink-0 text-[10.5px] uppercase tracking-wider opacity-60 hover:opacity-100"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* Add-flag inline form */}
        <div className="mt-2 rounded-md border border-white/10 bg-black/15 p-2 flex flex-wrap gap-2 items-center">
          <input
            value={newFlagLabel}
            onChange={(e) => setNewFlagLabel(e.target.value)}
            placeholder="Add a flag (e.g. &ldquo;previously sued by prior agency&rdquo;)"
            className={inputCls + ' flex-1 min-w-[200px]'}
          />
          <select
            value={newFlagSeverity}
            onChange={(e) => setNewFlagSeverity(e.target.value as RedFlag['severity'])}
            className="rounded-md bg-black/30 border border-white/10 px-2 py-1.5 text-[11.5px] text-white/85"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <button
            type="button"
            onClick={addRedFlag}
            disabled={!newFlagLabel.trim()}
            className="rounded-md border border-rose-400/40 bg-rose-400/10 hover:bg-rose-400/20 text-rose-200 text-[11.5px] px-3 py-1.5 disabled:opacity-40"
          >
            + Add flag
          </button>
        </div>
      </div>

      {/* PII fields */}
      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        {/* (#524, val 2026-06-08) Address history. Every adapter (GA SOS, CA
            SOS, Apollo, manual) appends a new entry. Old addresses stay so
            val can verify identity across time and spot parallel entities. */}
        <div className="sm:col-span-2">
          <label className={labelCls}>Addresses ({d.addressHistory.length})</label>
          {d.addressHistory.length === 0 ? (
            <div className="text-[11.5px] text-muted italic rounded-md border border-dashed border-white/10 px-2.5 py-2">
              No addresses on file. Add one below — every adapter that learns an address from now on (GA SOS, CA SOS, Apollo, etc.) will append here automatically.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {d.addressHistory.map((a) => (
                <li
                  key={a.id}
                  className="rounded-md border border-white/10 bg-black/15 px-2.5 py-1.5 flex items-start justify-between gap-2 text-[12px]"
                >
                  <div className="min-w-0">
                    <div className="text-white/90">{a.address}</div>
                    <div className="text-[10.5px] opacity-65 mt-0.5 flex flex-wrap gap-1.5 items-center">
                      <code className="bg-white/5 px-1 py-0.5 rounded text-white/70">{a.source}</code>
                      {a.label && <span className="text-white/55">· {a.label}</span>}
                      <span className="text-white/45">· {fmtTs(a.captured_at)}</span>
                      {a.notes && <span className="text-white/55 italic">· {a.notes}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAddress(a.id)}
                    className="shrink-0 text-[10.5px] uppercase tracking-wider opacity-60 hover:opacity-100"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* Inline add-address form */}
          <div className="mt-2 rounded-md border border-white/10 bg-black/15 p-2 space-y-2">
            <textarea
              value={newAddrText}
              onChange={(e) => setNewAddrText(e.target.value)}
              rows={2}
              className={inputCls}
              placeholder="Add an address (paste from GA SOS, LinkedIn, business card, etc.)"
            />
            <div className="flex flex-wrap gap-2 items-center">
              <select
                value={newAddrSource}
                onChange={(e) => setNewAddrSource(e.target.value)}
                className="rounded-md bg-black/30 border border-white/10 px-2 py-1.5 text-[11.5px] text-white/85"
                title="Where this address came from"
              >
                <option value="manual">manual</option>
                <option value="ga_sos">ga_sos</option>
                <option value="ca_sos">ca_sos</option>
                <option value="apollo">apollo</option>
                <option value="linkedin">linkedin</option>
                <option value="google_places">google_places</option>
                <option value="business_card">business_card</option>
                <option value="referral">referral</option>
              </select>
              <input
                type="text"
                value={newAddrLabel}
                onChange={(e) => setNewAddrLabel(e.target.value)}
                placeholder="Label (e.g. Principal office, Home)"
                className={inputCls + ' flex-1 min-w-[160px]'}
              />
              <button
                type="button"
                onClick={addAddress}
                disabled={!newAddrText.trim()}
                className="rounded-md border border-rose-400/40 bg-rose-400/10 hover:bg-rose-400/20 text-rose-200 text-[11.5px] px-3 py-1.5 disabled:opacity-40"
              >
                + Add address
              </button>
            </div>
          </div>
        </div>
        <div>
          <label className={labelCls}>Birth year</label>
          <input
            type="number"
            min={1900}
            max={2030}
            value={d.dobYear ?? ''}
            onChange={(e) => setD({ ...d, dobYear: e.target.value ? Number.parseInt(e.target.value, 10) : null })}
            className={inputCls}
            placeholder="e.g. 1972"
          />
        </div>
        <div>
          <label className={labelCls}>Spouse / co-signer</label>
          <input
            type="text"
            value={d.spouseOrCosignerName ?? ''}
            onChange={(e) => setD({ ...d, spouseOrCosignerName: e.target.value })}
            className={inputCls}
            placeholder="Often the actual decision-maker"
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Prior entities / DBAs (comma list)</label>
          <textarea
            value={d.priorEntities ?? ''}
            onChange={(e) => setD({ ...d, priorEntities: e.target.value })}
            rows={2}
            className={inputCls}
            placeholder="Other LLC/DBA names the operator should screen against"
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Free-form notes (markdown)</label>
          <textarea
            value={d.notesMd ?? ''}
            onChange={(e) => setD({ ...d, notesMd: e.target.value })}
            rows={4}
            className={inputCls + ' font-mono text-[11.5px]'}
            placeholder="Anything else — meeting impressions, references, gut checks, payment terms agreed verbally, etc."
          />
        </div>
      </div>

      {/* Apply button */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <button
          type="button"
          onClick={save}
          disabled={busy !== 'idle'}
          className="rounded-md bg-[var(--gold-bright)] hover:bg-[color-mix(in_srgb,var(--gold-bright)_85%,white_15%)] text-black text-[13px] font-medium px-4 py-2 disabled:opacity-50"
        >
          {busy === 'saving' ? 'Applying…' : '✓ Apply'}
        </button>
        <div className="text-[11px] flex items-center gap-2">
          {err && <span className="text-rose-300">{err}</span>}
          {okMsg && <span className="text-emerald-300">{okMsg}</span>}
        </div>
      </div>

      {/* Screen buttons — KYC sweep (one-click) + individual sources */}
      <div className="border-t border-white/10 pt-3">
        <div className={labelCls}>Run a quick screen</div>
        <div className="text-[11.5px] text-white/65 mb-2">
          Looks at <code className="bg-black/30 px-1 rounded">{briefCompany || '(no company on brief)'}</code>
          {briefContactName && <> + <code className="bg-black/30 px-1 rounded">{briefContactName}</code></>}.
        </div>
        {/* (#525) DD Report — generates polished markdown report combining
            dossier + audit + records into an investor-ready deliverable. */}
        <div className="flex flex-wrap gap-2 mb-2">
          <button
            type="button"
            onClick={runKycSweep}
            disabled={busy !== 'idle' || (!briefCompany && !briefContactName)}
            className="flex-1 sm:flex-none rounded-md border border-rose-400/50 bg-rose-400/15 hover:bg-rose-400/25 text-rose-100 text-[12.5px] font-medium px-4 py-2 disabled:opacity-40"
            title="One click: runs USPTO + CourtListener (name-targeted) + CFPB (company-targeted)"
          >
            {busy === 'kyc' ? '⚡ Running KYC sweep…' : '⚡ Run Full KYC Sweep'}
          </button>
          {/* (#529) Address-stress screen — geocodes every dossier address +
              pulls HMDA county-level mortgage stress signal. Per-property
              record lookups (assessor, deeds, mortgage balance) are queued
              behind the Puppeteer worker (#422) and stub-labeled honestly. */}
          <button
            type="button"
            onClick={runAddressScreen}
            disabled={busy !== 'idle'}
            className="flex-1 sm:flex-none rounded-md border border-sky-400/50 bg-sky-400/15 hover:bg-sky-400/25 text-sky-100 text-[12.5px] font-medium px-4 py-2 disabled:opacity-40"
            title="For every address on the dossier: geocode + HMDA market stress + queued per-property records"
          >
            {busy === 'address' ? '🏠 Screening addresses…' : '🏠 Screen each address'}
          </button>
          <button
            type="button"
            onClick={generateDdReport}
            disabled={busy !== 'idle'}
            className="flex-1 sm:flex-none rounded-md border border-[color-mix(in_srgb,var(--gold-bright)_55%,transparent)] bg-[color-mix(in_srgb,var(--gold-bright)_15%,transparent)] hover:bg-[color-mix(in_srgb,var(--gold-bright)_25%,transparent)] text-[var(--gold-bright)] text-[12.5px] font-medium px-4 py-2 disabled:opacity-40"
            title="Generate a polished Pre-Engagement Intelligence Report — markdown ready to copy into an email or print to PDF"
          >
            {busy === 'report' ? '📄 Building report…' : '📄 Generate DD Report'}
          </button>
        </div>
        {kycReport && (
          <div className="mb-2 rounded-md border border-rose-400/25 bg-rose-400/[0.05] p-2.5 text-[11.5px]">
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-rose-300/90 mb-1">
              Sweep ran · {kycReport.flagsAdded} flag{kycReport.flagsAdded === 1 ? '' : 's'} added
            </div>
            <ul className="space-y-0.5 text-white/75">
              {kycReport.steps.map((s, i) => (
                <li key={i}>
                  <span className={s.ran ? 'text-emerald-300' : 'text-amber-300/85'}>{s.ran ? '✓' : '○'}</span>
                  <code className="text-white/55 mx-1">{s.source}</code>
                  {s.ran
                    ? <span>· {s.hits} hit{s.hits === 1 ? '' : 's'}</span>
                    : <span>· {s.skipReason}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* (#529) Address-stress screen results */}
        {addressScreenResult && (
          <div className="mt-3 rounded-md border border-sky-400/30 bg-sky-400/[0.05] p-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-sky-300 mb-1.5">
              Address screen · {addressScreenResult.geocoded}/{addressScreenResult.addresses_screened} geocoded
            </div>
            <div className="space-y-2.5">
              {addressScreenResult.results.map((r, idx) => (
                <div key={idx} className="border-l-2 border-sky-400/40 pl-2.5">
                  <div className="text-[12px] text-white/90 font-medium">
                    {r.matchedAddress ?? r.address}
                  </div>
                  {r.ok ? (
                    <>
                      <div className="text-[11.5px] text-white/70 mt-0.5">{r.signalLabel}</div>
                      {r.hmda && (
                        <div className="text-[10.5px] text-white/55 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                          <span>Apps: {r.hmda.total_applications?.toLocaleString() ?? '?'}</span>
                          <span>Originated: {r.hmda.total_originated?.toLocaleString() ?? '?'}</span>
                          <span>Denied: {r.hmda.total_denied?.toLocaleString() ?? '?'}</span>
                          {r.hmda.median_loan_amount != null && (
                            <span>Median: ${Math.round(r.hmda.median_loan_amount).toLocaleString()}</span>
                          )}
                        </div>
                      )}
                      <div className="text-[10.5px] text-amber-200/70 mt-1 italic">
                        📋 {r.propertyRecord.note}
                      </div>
                    </>
                  ) : (
                    <div className="text-[11.5px] text-rose-300 mt-0.5">{r.signalLabel}</div>
                  )}
                </div>
              ))}
            </div>
            <div className="text-[10.5px] text-white/45 mt-2.5 italic">
              HMDA is county-level mortgage market data — it shows the lending environment around each address,
              not the property's own balance. Per-property records (owner, assessed value, last sale, mortgage)
              come online when the records worker (#422) is provisioned.
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={lookupPatents}
            disabled={busy !== 'idle' || (!briefCompany && !briefContactName)}
            className="rounded-md border border-sky-400/40 bg-sky-400/10 hover:bg-sky-400/20 text-sky-200 text-[12px] px-3 py-1.5 disabled:opacity-40"
            title="Searches USPTO PatentsView for patents filed by this company or naming this person as inventor"
          >
            {busy === 'patents' ? 'Searching USPTO…' : '🔬 Look up USPTO patents'}
          </button>
          <a
            href={trademarkSearchUrl}
            target="_blank"
            rel="noopener"
            className="rounded-md border border-violet-400/40 bg-violet-400/10 hover:bg-violet-400/20 text-violet-200 text-[12px] px-3 py-1.5"
            title="USPTO doesn't expose a clean free name-search API for trademarks — this opens the official search prefilled with the company name"
          >
            ™ Search USPTO trademarks ↗
          </a>
        </div>

        {/* Patent results */}
        {patentResult && (
          <div className="mt-3 rounded-md border border-sky-400/30 bg-sky-400/[0.05] p-3">
            <div className="text-[11px] uppercase tracking-[0.14em] text-sky-300 mb-1.5">
              Patents found · {patentResult.totalAssigneeHits + patentResult.totalInventorHits}
            </div>
            {patentResult.error && (
              <div className="text-[12px] text-rose-300">{patentResult.error}</div>
            )}
            {patentResult.byAssignee.length === 0 && patentResult.byInventor.length === 0 ? (
              <div className="text-[12px] text-white/65 italic">
                No patents found for {patentResult.query}. (Could be a clean signal OR they file under a different name — try editing the company on the brief.)
              </div>
            ) : (
              <>
                {patentResult.byAssignee.length > 0 && (
                  <div className="mb-2">
                    <div className="text-[10.5px] text-white/55 mb-1">By company ({patentResult.byAssignee.length})</div>
                    <ul className="space-y-1 text-[12px]">
                      {patentResult.byAssignee.slice(0, 10).map((p) => (
                        <li key={p.patentId}>
                          <a href={p.publicUrl} target="_blank" rel="noopener" className="text-sky-200 hover:underline">
                            {p.patentTitle || `Patent ${p.patentId}`}
                          </a>
                          {p.patentDate && <span className="text-white/55"> · {p.patentDate}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {patentResult.byInventor.length > 0 && (
                  <div>
                    <div className="text-[10.5px] text-white/55 mb-1">By inventor ({patentResult.byInventor.length})</div>
                    <ul className="space-y-1 text-[12px]">
                      {patentResult.byInventor.slice(0, 10).map((p) => (
                        <li key={p.patentId}>
                          <a href={p.publicUrl} target="_blank" rel="noopener" className="text-sky-200 hover:underline">
                            {p.patentTitle || `Patent ${p.patentId}`}
                          </a>
                          {p.assigneeOrg && <span className="text-white/55"> · {p.assigneeOrg}</span>}
                          {p.patentDate && <span className="text-white/55"> · {p.patentDate}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* (#525) DD Report modal — mobile-first, copy + print actions. */}
      {ddReport && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto"
          onClick={() => setDdReport(null)}
        >
          <div
            className="w-full max-w-3xl my-4 rounded-2xl border border-[color-mix(in_srgb,var(--gold-bright)_40%,transparent)] bg-surface shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border bg-[color-mix(in_srgb,var(--gold-bright)_8%,transparent)]">
              <div className="min-w-0">
                <div className="text-[10.5px] uppercase tracking-[0.14em] text-[var(--gold-bright)]">
                  Pre-Engagement Intelligence Report
                </div>
                <div className="text-sm text-ink/95 truncate font-medium">
                  {ddReport.meta.subject}
                </div>
                <div className="text-[10.5px] text-white/55 mt-0.5">
                  {ddReport.meta.flagCount} flag{ddReport.meta.flagCount === 1 ? '' : 's'} ·
                  {' '}{ddReport.meta.recordCount} record{ddReport.meta.recordCount === 1 ? '' : 's'}
                  {ddReport.meta.auditScore !== null && <> · website {ddReport.meta.auditScore.toFixed(1)}/10</>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDdReport(null)}
                className="text-muted hover:text-ink text-lg leading-none shrink-0"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="flex flex-wrap gap-2 px-4 py-2 border-b border-border/60 bg-black/15">
              <button
                type="button"
                onClick={copyReport}
                className="rounded-md border border-[color-mix(in_srgb,var(--gold-bright)_45%,transparent)] bg-[color-mix(in_srgb,var(--gold-bright)_12%,transparent)] hover:bg-[color-mix(in_srgb,var(--gold-bright)_22%,transparent)] text-[var(--gold-bright)] text-[11.5px] px-3 py-1.5"
              >
                {copyOk ? '✓ Copied' : '📋 Copy markdown'}
              </button>
              <button
                type="button"
                onClick={printReport}
                className="rounded-md border border-white/20 bg-white/5 hover:bg-white/10 text-ink/85 text-[11.5px] px-3 py-1.5"
              >
                🖨 Open as PDF
              </button>
              <button
                type="button"
                onClick={() => setDdReport(null)}
                className="ml-auto rounded-md border border-white/15 hover:border-white/30 text-muted hover:text-ink text-[11.5px] px-3 py-1.5"
              >
                Close
              </button>
            </div>
            <div className="px-4 py-4 overflow-y-auto">
              <pre className="text-[11.5px] text-ink/90 font-mono whitespace-pre-wrap leading-relaxed">
                {ddReport.markdown}
              </pre>
            </div>
            <div className="px-4 py-2 border-t border-border/60 text-[10.5px] text-white/55 italic">
              Tip: paste into Gmail / Outlook directly — markdown bold + tables render cleanly in most email clients. For a formal attachment, click <strong className="text-white/80">Open as PDF</strong> and use your browser&apos;s print dialog.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
