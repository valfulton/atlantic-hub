'use client';

/**
 * LeadQuickActions  (#222)
 *
 * Slim inline action row at the bottom of every lead card. Two flows:
 *   - "Log call" / "Log email" / "Log note"  -> expands a one-textarea form,
 *                                               posts to call_log endpoint,
 *                                               stamps the time automatically,
 *                                               collapses on save.
 *   - "Draft email"  -> calls the no-campaign quick-draft endpoint, shows
 *                       subject + body in an inline expandable block,
 *                       Copy-to-clipboard + Mark-as-sent buttons.
 *
 * Goal: val (or a rep) never leaves the lead card. One click logs effort;
 * one click drafts an email. The activity gets recorded against the lead so
 * the engagement scorer + intel-freshness view both reflect it.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type ActivityKind = 'call' | 'email' | 'note';

// Map the activity kind to the call_log outcome the existing endpoint expects.
// For email / note we use 'other' and prefix the notes; the call_log schema
// stays untouched. A future task can add a real `kind` column if we want
// nicer filtering later.
function outcomeFor(kind: ActivityKind): string {
  return kind === 'call' ? 'connected' : 'other';
}
function prefixFor(kind: ActivityKind): string {
  return kind === 'email' ? '[EMAIL] ' : kind === 'note' ? '[NOTE] ' : '';
}

interface QuickDraft {
  subject: string;
  body: string;
  groundedOnAudit: boolean;
}

export default function LeadQuickActions({
  auditId,
  company,
  contactEmail
}: {
  auditId: string;
  company: string;
  contactEmail: string | null;
}) {
  const router = useRouter();
  const [logKind, setLogKind] = useState<ActivityKind | null>(null);
  const [logText, setLogText] = useState('');
  const [logging, setLogging] = useState(false);
  const [logMsg, setLogMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<QuickDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function saveLog() {
    if (!logKind) return;
    if (!logText.trim()) {
      setLogMsg({ ok: false, text: 'Add a quick note before saving.' });
      return;
    }
    setLogging(true);
    setLogMsg(null);
    try {
      const res = await fetch(`/api/admin/av/leads/${auditId}/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome: outcomeFor(logKind),
          notes: `${prefixFor(logKind)}${logText.trim()}`
        })
      });
      const rawText = await res.text();
      let data: { error?: string; message?: string } | null = null;
      try { data = JSON.parse(rawText); } catch {
        throw new Error(`Server returned HTTP ${res.status} (non-JSON).`);
      }
      if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
      setLogMsg({ ok: true, text: `Logged ${logKind}.` });
      setLogText('');
      // Auto-collapse after a moment, then refresh the page so any
      // last_activity_at / engagement updates show.
      setTimeout(() => {
        setLogKind(null);
        setLogMsg(null);
        router.refresh();
      }, 1200);
    } catch (err) {
      setLogMsg({ ok: false, text: (err as Error).message });
    } finally {
      setLogging(false);
    }
  }

  async function doDraft() {
    setDrafting(true);
    setDraftError(null);
    setDraft(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/admin/av/leads/${auditId}/draft-email-quick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const rawText = await res.text();
      let data: { subject?: string; body?: string; groundedOnAudit?: boolean; error?: string; message?: string } | null = null;
      try { data = JSON.parse(rawText); } catch {
        throw new Error(`Server returned HTTP ${res.status} (non-JSON).`);
      }
      if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
      setDraft({
        subject: data?.subject || '',
        body: data?.body || '',
        groundedOnAudit: !!data?.groundedOnAudit
      });
    } catch (err) {
      setDraftError((err as Error).message);
    } finally {
      setDrafting(false);
    }
  }

  function copyDraft() {
    if (!draft) return;
    const text = `Subject: ${draft.subject}\n\n${draft.body}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  async function markEmailSent() {
    if (!draft) return;
    try {
      await fetch(`/api/admin/av/leads/${auditId}/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome: 'other',
          notes: `[EMAIL SENT] Subject: ${draft.subject.slice(0, 120)}`
        })
      });
      setDraft(null);
      router.refresh();
    } catch {
      // Soft-fail; the rep can manually log the send.
    }
  }

  const inputCls =
    'w-full rounded-md bg-black/30 border border-white/10 px-2.5 py-1.5 text-[12px] text-white/90 ' +
    'placeholder-white/30 focus:outline-none focus:border-[#EBCB6B]/50';

  return (
    <div className="mt-3 pt-3 border-t border-border space-y-2">
      {/* Action row */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(['call', 'email', 'note'] as ActivityKind[]).map((k) => (
          <button
            key={k}
            onClick={() => {
              setLogKind(logKind === k ? null : k);
              setLogText('');
              setLogMsg(null);
            }}
            className={
              'text-[10.5px] uppercase tracking-wider px-2 py-1 rounded-md border transition ' +
              (logKind === k
                ? 'border-[#EBCB6B]/55 bg-[#EBCB6B]/10 text-[#EBCB6B]'
                : 'border-white/10 text-white/55 hover:text-white/85 hover:border-white/25')
            }
          >
            Log {k}
          </button>
        ))}
        <button
          onClick={doDraft}
          disabled={drafting}
          className={
            'text-[10.5px] uppercase tracking-wider px-2 py-1 rounded-md border transition ml-auto ' +
            (drafting
              ? 'border-white/10 text-white/30 cursor-not-allowed'
              : 'border-[#EBCB6B]/40 text-[#EBCB6B] hover:bg-[#EBCB6B]/10')
          }
        >
          {drafting ? 'Drafting…' : 'Draft email'}
        </button>
        {contactEmail && (
          <a
            href={`mailto:${contactEmail}`}
            className="text-[10.5px] uppercase tracking-wider px-2 py-1 rounded-md border border-white/10 text-white/55 hover:text-white/85 hover:border-white/25"
          >
            Mailto
          </a>
        )}
      </div>

      {/* Log form (expands when a kind is selected) */}
      {logKind && (
        <div className="rounded-md border border-[#EBCB6B]/20 bg-[#EBCB6B]/[0.03] p-2 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-[#EBCB6B]/75">
            Logging {logKind} for {company} · {new Date().toLocaleString()}
          </div>
          <textarea
            className={inputCls}
            rows={2}
            placeholder={
              logKind === 'call'
                ? 'What did you discuss? Any objections? Next step?'
                : logKind === 'email'
                ? 'Subject + a sentence about what you sent or replied with'
                : 'A quick observation, follow-up reminder, or context'
            }
            value={logText}
            onChange={(e) => setLogText(e.target.value)}
            disabled={logging}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={saveLog}
              disabled={logging || !logText.trim()}
              className={
                'rounded-md px-3 py-1 text-[11px] font-medium transition ' +
                (logging || !logText.trim()
                  ? 'bg-white/10 text-white/40 cursor-not-allowed'
                  : 'border border-[#EBCB6B]/40 text-[#EBCB6B] hover:bg-[#EBCB6B]/10')
              }
            >
              {logging ? 'Saving…' : 'Save log'}
            </button>
            <button
              onClick={() => { setLogKind(null); setLogText(''); setLogMsg(null); }}
              className="text-[11px] text-white/40 hover:text-white/70"
            >
              cancel
            </button>
            {logMsg && (
              <span className={'text-[10.5px] ' + (logMsg.ok ? 'text-emerald-300' : 'text-rose-300')}>
                {logMsg.text}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Draft block (expands when drafted) */}
      {(draft || draftError) && (
        <div className="rounded-md border border-[#EBCB6B]/20 bg-[#EBCB6B]/[0.03] p-2.5 space-y-1.5">
          {draftError ? (
            <div className="text-[11.5px] text-rose-300">{draftError}</div>
          ) : draft ? (
            <>
              <div className="text-[10px] uppercase tracking-wider text-[#EBCB6B]/75 flex items-center justify-between gap-2">
                <span>Draft email · {draft.groundedOnAudit ? 'grounded in audit' : 'industry-grounded'}</span>
                <button
                  onClick={() => setDraft(null)}
                  className="text-[10px] text-white/40 hover:text-white/70 uppercase tracking-wider"
                >
                  close
                </button>
              </div>
              <div className="text-[12px] text-white/90 font-medium">{draft.subject}</div>
              <div className="text-[11.5px] text-white/75 whitespace-pre-wrap leading-relaxed">{draft.body}</div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={copyDraft}
                  className="rounded-md px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-wider border border-[#EBCB6B]/40 text-[#EBCB6B] hover:bg-[#EBCB6B]/10 transition"
                >
                  {copied ? 'Copied ✓' : 'Copy subject + body'}
                </button>
                {contactEmail && (
                  <a
                    href={`mailto:${contactEmail}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`}
                    className="rounded-md px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-wider border border-[#EBCB6B]/40 text-[#EBCB6B] hover:bg-[#EBCB6B]/10 transition"
                  >
                    Open in mail client
                  </a>
                )}
                <button
                  onClick={markEmailSent}
                  className="rounded-md px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-wider border border-emerald-400/40 text-emerald-300 hover:bg-emerald-400/10 transition"
                >
                  Mark as sent (logs it)
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
