'use client';

/**
 * WeeklyDigestPanel  (#216 v1)
 *
 * Operator-side: preview + send the client's weekly digest email. Lives on
 * the client page near AutopilotActivity since they're both "what the
 * system did for this client" surfaces.
 *
 * Two clicks max: Preview (LLM-free — just builds from ThisWeek data + brand
 * kit), Send. Send is disabled when the week is empty unless val checks
 * "send anyway." A small inline HTML preview shows what Tim will receive.
 */
import { useState } from 'react';

interface PreviewResponse {
  ok: true;
  mode: 'preview';
  to: string | null;
  subject: string;
  items: Array<{ at: string; text: string; tone: 'good' | 'info' | 'urgent' }>;
  isEmpty: boolean;
  html: string;
  text: string;
  brandName: string;
}

interface SendResponse {
  ok: boolean;
  mode: 'send';
  to: string | null;
  subject: string;
  itemsCount: number;
  isEmpty: boolean;
  sent: boolean;
  reason?: string;
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default function WeeklyDigestPanel({
  clientId,
  clientName,
  lastSentAt
}: {
  clientId: number;
  clientName: string;
  /** ISO string of the most-recent client.digest.sent event for this client.
   *  Renders a "Last sent X ago" line so val knows whether the Friday cron
   *  already covered them. */
  lastSentAt?: string | null;
}) {
  const [busy, setBusy] = useState<'idle' | 'previewing' | 'sending'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [sendResult, setSendResult] = useState<SendResponse | null>(null);
  const [forceEmpty, setForceEmpty] = useState(false);

  async function runPreview() {
    setBusy('previewing');
    setErr(null);
    setSendResult(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/send-digest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'preview' })
      });
      const raw = await res.text();
      let data: PreviewResponse | { error?: string; detail?: string } | null = null;
      try { data = JSON.parse(raw); } catch { throw new Error(`HTTP ${res.status} (non-JSON)`); }
      if (!res.ok || !data || !('ok' in data)) {
        const detail = data && 'detail' in data ? data.detail : null;
        throw new Error((data && 'error' in data && data.error) || detail || `HTTP ${res.status}`);
      }
      setPreview(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('idle');
    }
  }

  async function runSend() {
    if (!preview) return;
    if (!preview.to) { setErr('No recipient email on file for this client.'); return; }
    setBusy('sending');
    setErr(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/send-digest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'send', force: forceEmpty })
      });
      const raw = await res.text();
      let data: SendResponse | { error?: string; detail?: string } | null = null;
      try { data = JSON.parse(raw); } catch { throw new Error(`HTTP ${res.status} (non-JSON)`); }
      if (!res.ok || !data || !('ok' in data)) {
        const detail = data && 'detail' in data ? data.detail : null;
        throw new Error((data && 'error' in data && data.error) || detail || `HTTP ${res.status}`);
      }
      setSendResult(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('idle');
    }
  }

  function discard() {
    setPreview(null);
    setSendResult(null);
    setErr(null);
    setForceEmpty(false);
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted">
          Weekly digest email for {clientName}
        </div>
        {lastSentAt && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden="true" />
            Last sent {relativeTime(lastSentAt)}
          </span>
        )}
      </div>
      <div className="text-[12.5px] text-white/70 mb-3 leading-relaxed">
        Send {clientName} a branded summary of what Atlantic &amp; Vine moved this week — same data
        as the &ldquo;This week for you&rdquo; widget on their dashboard. The Friday cron runs this
        automatically across all active clients; this panel lets you preview or trigger ad-hoc.
      </div>

      {!preview && !sendResult && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={runPreview}
            disabled={busy !== 'idle'}
            className={
              'rounded-md px-3 py-1.5 text-[11.5px] font-medium transition ' +
              (busy !== 'idle'
                ? 'bg-white/10 text-white/40 cursor-not-allowed'
                : 'bg-amber-400/90 text-black hover:bg-amber-300')
            }
          >
            {busy === 'previewing' ? 'Building…' : 'Preview digest'}
          </button>
          <span className="text-[10.5px] text-white/40">Free preview — no LLM call.</span>
          {err && <span className="text-[10.5px] text-rose-300 ml-1">{err}</span>}
        </div>
      )}

      {preview && !sendResult && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-start">
            <div className="text-[12px] text-white/80 space-y-0.5">
              <div>
                <span className="text-white/55">To:</span>{' '}
                <span className="font-mono text-white/90">{preview.to || <span className="text-rose-300">no recipient</span>}</span>
              </div>
              <div>
                <span className="text-white/55">Subject:</span>{' '}
                <span className="text-white/90">{preview.subject}</span>
              </div>
              <div>
                <span className="text-white/55">Items:</span>{' '}
                <span className="text-white/90">{preview.items.length}</span>
                {preview.isEmpty && (
                  <span className="ml-2 text-[10.5px] uppercase tracking-wider text-amber-300/85">empty week</span>
                )}
              </div>
            </div>
            <button
              onClick={discard}
              disabled={busy !== 'idle'}
              className="text-[10.5px] uppercase tracking-wider text-white/50 hover:text-white/85 px-2"
            >
              Discard
            </button>
          </div>

          {/* Embedded HTML preview — rendered in a sandbox iframe via srcDoc
              so the email's full CSS shows what Tim will actually see. */}
          <div className="rounded-md border border-white/10 bg-black/20 overflow-hidden">
            <div className="text-[10px] uppercase tracking-wider text-white/45 px-3 py-1.5 bg-black/30 border-b border-white/10">
              What {clientName} will see in their inbox
            </div>
            <iframe
              srcDoc={preview.html}
              title="digest preview"
              style={{ width: '100%', height: 520, border: 0, background: '#f8fafc' }}
            />
          </div>

          <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-white/5">
            {preview.isEmpty && (
              <label className="flex items-center gap-1.5 text-[11px] text-white/75 cursor-pointer">
                <input
                  type="checkbox"
                  checked={forceEmpty}
                  onChange={(e) => setForceEmpty(e.target.checked)}
                  className="h-3 w-3"
                />
                Send anyway (week is empty)
              </label>
            )}
            <button
              onClick={runSend}
              disabled={busy !== 'idle' || !preview.to || (preview.isEmpty && !forceEmpty)}
              className={
                'rounded-md px-3 py-1.5 text-[11.5px] font-medium transition ' +
                (busy !== 'idle' || !preview.to || (preview.isEmpty && !forceEmpty)
                  ? 'bg-white/10 text-white/40 cursor-not-allowed'
                  : 'bg-amber-400/90 text-black hover:bg-amber-300')
              }
            >
              {busy === 'sending' ? 'Sending…' : `Send to ${preview.to || '—'}`}
            </button>
            <button
              onClick={runPreview}
              disabled={busy !== 'idle'}
              className="text-[10.5px] uppercase tracking-wider text-white/50 hover:text-white/85"
            >
              Rebuild
            </button>
          </div>

          {err && <div className="text-[10.5px] text-rose-300">{err}</div>}
        </div>
      )}

      {sendResult && (
        <div className={
          'rounded-md p-3 space-y-2 ' +
          (sendResult.sent
            ? 'border border-emerald-500/30 bg-emerald-500/5'
            : 'border border-rose-500/30 bg-rose-500/5')
        }>
          {sendResult.sent ? (
            <>
              <div className="text-[12px] text-emerald-200 font-medium">
                ✓ Sent to {sendResult.to}
              </div>
              <div className="text-[11px] text-white/65">
                Subject: {sendResult.subject} · {sendResult.itemsCount} items
              </div>
            </>
          ) : (
            <>
              <div className="text-[12px] text-rose-200 font-medium">
                Didn&apos;t send: <span className="font-mono">{sendResult.reason || 'unknown'}</span>
              </div>
              {sendResult.reason === 'smtp_not_configured' && (
                <div className="text-[11px] text-white/65">
                  SMTP env vars aren&apos;t set in Netlify. Check SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS.
                </div>
              )}
            </>
          )}
          <button
            onClick={discard}
            className="text-[10.5px] uppercase tracking-wider text-white/50 hover:text-white/85"
          >
            Run again
          </button>
        </div>
      )}
    </div>
  );
}
