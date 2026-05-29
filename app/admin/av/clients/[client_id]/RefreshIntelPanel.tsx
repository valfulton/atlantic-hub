'use client';

/**
 * RefreshIntelPanel (#203)
 *
 * One-click "force-regenerate the AI intel" for a client's leads. Replaces
 * the phpMyAdmin SQL pattern documented in the playbook. Three checkboxes
 * (audits / call scripts / outreach drafts), confirm, watch the counts come back.
 *
 * Lives on the operator-side client page.
 */
import { useState } from 'react';

interface RefreshResult {
  totalLeads: number;
  audits: { reset: number; regenerated: number; failed: number };
  callScripts: { reset: number; regenerated: number; failed: number };
  outreach: { deleted: number };
  stoppedEarly: boolean;
  elapsedMs: number;
}

export default function RefreshIntelPanel({
  clientId,
  clientName
}: {
  clientId: number;
  clientName: string;
}) {
  const [audits, setAudits] = useState(true);
  const [callScripts, setCallScripts] = useState(true);
  const [outreach, setOutreach] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RefreshResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // (#223) Separate state for the lighter "flush guidance only" action.
  const [flushBusy, setFlushBusy] = useState(false);
  const [flushMsg, setFlushMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const nothingSelected = !audits && !callScripts && !outreach;

  async function run() {
    const parts: string[] = [];
    if (audits) parts.push('all lead audits');
    if (callScripts) parts.push('all call scripts');
    if (outreach) parts.push('all draft outreach emails');
    const sentence =
      parts.length === 1
        ? parts[0]
        : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
    const confirmed = window.confirm(
      `Regenerate ${sentence} for ${clientName}'s leads?\n\nThis runs OpenAI for every audit and call script and can take up to a minute. It will also DELETE any unsent outreach drafts (already-sent emails are safe).`
    );
    if (!confirmed) return;

    setBusy(true);
    setResult(null);
    setError(null);

    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/refresh-intel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audits, callScripts, outreach })
      });
      // (#221) Read text first so a Netlify 60s timeout surfaces as an
      // actionable status code instead of res.json() throwing the cryptic
      // "did not match the expected pattern".
      const rawText = await res.text();
      let data: (RefreshResult & { error?: string; message?: string }) | null = null;
      try {
        data = JSON.parse(rawText) as RefreshResult & { error?: string; message?: string };
      } catch {
        throw new Error(
          `Server returned HTTP ${res.status} (non-JSON). ` +
          `Likely a Netlify 60s timeout while regenerating intel. ` +
          `Try un-checking one of the boxes (audits OR call scripts, not both) and run again, ` +
          `or use the per-row Refresh on /admin/av/intel-freshness.`
        );
      }
      if (!res.ok) {
        throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
      }
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // (#223) Lightweight "just clear the dashboard cache" -- no AI, instant,
  // safe to click whenever cards look stale. The cards recompose on next
  // dashboard load using the latest code + latest data.
  async function flushGuidance() {
    setFlushBusy(true);
    setFlushMsg(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/clear-guidance`, {
        method: 'POST'
      });
      const rawText = await res.text();
      let data: { ok?: boolean; rowsDeleted?: number; error?: string } | null = null;
      try { data = JSON.parse(rawText); } catch {
        throw new Error(`Server returned HTTP ${res.status} (non-JSON).`);
      }
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setFlushMsg({
        ok: true,
        text: `Cleared ${data?.rowsDeleted ?? 0} cached guidance row(s). Reload ${clientName}'s dashboard to see fresh cards.`
      });
    } catch (err) {
      setFlushMsg({ ok: false, text: (err as Error).message });
    } finally {
      setFlushBusy(false);
    }
  }

  const cb = (checked: boolean) =>
    'inline-flex items-center gap-2 cursor-pointer select-none ' +
    (busy ? 'opacity-50 cursor-not-allowed' : '');

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-1">
        Refresh AI intel (force regeneration)
      </div>
      <div className="text-[13px] text-white/70 mb-3">
        After a prompt change or a fresh intake submission, use this to nuke and rebuild
        AI-generated content for {clientName}&apos;s leads. Already-sent emails are never touched.
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 mb-3 text-[13px] text-white/80">
        <label className={cb(audits)}>
          <input
            type="checkbox"
            checked={audits}
            disabled={busy}
            onChange={(e) => setAudits(e.target.checked)}
          />
          <span>Audits (re-score every lead)</span>
        </label>
        <label className={cb(callScripts)}>
          <input
            type="checkbox"
            checked={callScripts}
            disabled={busy}
            onChange={(e) => setCallScripts(e.target.checked)}
          />
          <span>Call scripts (pain profiles)</span>
        </label>
        <label className={cb(outreach)}>
          <input
            type="checkbox"
            checked={outreach}
            disabled={busy}
            onChange={(e) => setOutreach(e.target.checked)}
          />
          <span>Outreach drafts (delete unsent)</span>
        </label>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={run}
          disabled={busy || nothingSelected || flushBusy}
          className={
            'rounded-lg px-4 py-2 text-[13px] font-medium transition ' +
            (busy || nothingSelected || flushBusy
              ? 'bg-white/10 text-white/40 cursor-not-allowed'
              : 'bg-amber-400/90 text-black hover:bg-amber-300')
          }
        >
          {busy ? 'Regenerating…' : 'Refresh AI intel'}
        </button>

        {/* (#223) Lighter alternative when dashboard cards look stale but you
            don't want to spend OpenAI tokens. Just clears the cached
            next_best_moves + momentum_signals; next dashboard load
            recomposes from latest code + data. */}
        <button
          onClick={flushGuidance}
          disabled={busy || flushBusy}
          title="Clears cached dashboard guidance ONLY. No AI calls. Use after a code change to lib/client/guidance.ts."
          className={
            'rounded-lg px-3 py-2 text-[12px] font-medium transition border ' +
            (busy || flushBusy
              ? 'border-white/10 text-white/30 cursor-not-allowed'
              : 'border-white/20 text-white/70 hover:border-white/40 hover:text-white')
          }
        >
          {flushBusy ? 'Flushing…' : 'Flush dashboard cache only (no AI)'}
        </button>

        {nothingSelected && !busy && !flushBusy && (
          <span className="text-[11px] text-white/40">Pick at least one to refresh, or just flush.</span>
        )}
      </div>

      {flushMsg && (
        <div
          className={
            'mt-3 rounded-md border px-3 py-2 text-[12px] ' +
            (flushMsg.ok
              ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-100'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-200')
          }
        >
          {flushMsg.text}
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[12px] text-emerald-100 space-y-1">
          <div>
            Touched <strong>{result.totalLeads}</strong> lead{result.totalLeads === 1 ? '' : 's'} in {Math.round(result.elapsedMs / 100) / 10}s.
          </div>
          {audits && (
            <div>
              · Audits: reset {result.audits.reset}, regenerated {result.audits.regenerated}
              {result.audits.failed > 0 && `, failed ${result.audits.failed}`}
            </div>
          )}
          {callScripts && (
            <div>
              · Call scripts: reset {result.callScripts.reset}, regenerated {result.callScripts.regenerated}
              {result.callScripts.failed > 0 && `, failed ${result.callScripts.failed}`}
            </div>
          )}
          {outreach && <div>· Outreach drafts deleted: {result.outreach.deleted}</div>}
          {result.stoppedEarly && (
            <div className="text-amber-200">
              Hit the 55s soft deadline mid-batch. Click again to drain the rest — the columns are already nulled so the next run picks up where this left off.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
