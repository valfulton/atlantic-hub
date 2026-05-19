'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Mailbox {
  id: number;
  displayName: string;
  fromAddress: string;
  driver: string;
  status: string;
}

export function NewCampaignForm() {
  const router = useRouter();
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [mailboxId, setMailboxId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [aiOfferSummary, setAiOfferSummary] = useState(
    'Our platform finds high-fit leads, runs the AI audits, generates the on-brand commercials, and drafts the outreach -- so the founder can focus on conversations instead of tooling.'
  );
  const [aiCta, setAiCta] = useState('Open to a quick 15-minute call this week to see if it fits?');
  const [aiSignature, setAiSignature] = useState('— the Atlantic and Vine team');
  const [dailyLimit, setDailyLimit] = useState(5);
  const [requireApproval, setRequireApproval] = useState(true);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [status, setStatus] = useState<'draft' | 'active'>('active');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/admin/av/outreach/mailboxes');
      if (res.ok) {
        const data = await res.json();
        const active = (data.mailboxes as Mailbox[]).filter((m) => m.status === 'active');
        setMailboxes(active);
        if (active.length > 0) setMailboxId(active[0].id);
      }
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!mailboxId) {
      setError('Connect a mailbox first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/av/outreach/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          mailboxId,
          aiOfferSummary,
          aiCta,
          aiSignature,
          dailySendLimit: dailyLimit,
          requireApproval,
          autoAdvanceStage: autoAdvance,
          status
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      router.push(`/admin/av/outreach/${data.campaignId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (mailboxes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center">
        <p className="text-sm text-muted mb-3">
          No active mailboxes yet. Connect one to send from.
        </p>
        <a
          href="/admin/av/outreach/mailboxes"
          className="inline-block px-3 py-1.5 text-sm rounded-md bg-brand text-ink font-medium"
        >
          Connect a mailbox
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 max-w-2xl">
      <label className="block">
        <span className="text-[11px] uppercase tracking-wider text-muted">Campaign name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Hot AV leads -- May 2026"
          required
          className="mt-1 w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink"
        />
      </label>
      <label className="block">
        <span className="text-[11px] uppercase tracking-wider text-muted">
          Description (just for you)
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="mt-1 w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink"
        />
      </label>
      <label className="block">
        <span className="text-[11px] uppercase tracking-wider text-muted">Send from mailbox</span>
        <select
          value={mailboxId ?? ''}
          onChange={(e) => setMailboxId(parseInt(e.target.value, 10) || null)}
          className="mt-1 w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink"
        >
          {mailboxes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName} — {m.fromAddress}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="rounded-lg border border-border p-4">
        <legend className="text-[11px] uppercase tracking-wider text-muted px-1">
          AI prompt grounding (drives every draft)
        </legend>
        <div className="space-y-3 mt-2">
          <label className="block">
            <span className="text-xs text-ink">Offer summary</span>
            <textarea
              value={aiOfferSummary}
              onChange={(e) => setAiOfferSummary(e.target.value)}
              rows={3}
              className="mt-1 w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink"
            />
          </label>
          <label className="block">
            <span className="text-xs text-ink">Call-to-action</span>
            <input
              value={aiCta}
              onChange={(e) => setAiCta(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink"
            />
          </label>
          <label className="block">
            <span className="text-xs text-ink">Signature (plural voice — no founder name)</span>
            <input
              value={aiSignature}
              onChange={(e) => setAiSignature(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink"
            />
          </label>
        </div>
      </fieldset>

      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider text-muted">
            Daily send cap (per campaign)
          </span>
          <input
            type="number"
            min={1}
            max={500}
            value={dailyLimit}
            onChange={(e) => setDailyLimit(parseInt(e.target.value, 10) || 1)}
            className="mt-1 w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink"
          />
          <p className="text-[11px] text-muted mt-1">
            Per-mailbox + per-tier caps still apply alongside this.
          </p>
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider text-muted">Initial status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as 'draft' | 'active')}
            className="mt-1 w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink"
          >
            <option value="active">Active — start accepting drafts immediately</option>
            <option value="draft">Draft — finish setup before going live</option>
          </select>
        </label>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={requireApproval}
            onChange={(e) => setRequireApproval(e.target.checked)}
          />
          Require operator approval before send (recommended)
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={autoAdvance}
            onChange={(e) => setAutoAdvance(e.target.checked)}
          />
          Auto-advance lead_status on send + reply (recommended)
        </label>
      </div>

      {error && <div className="text-sm text-red-300">{error}</div>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-1.5 text-sm rounded-md bg-brand text-ink font-medium disabled:opacity-50"
        >
          {busy ? 'Creating...' : 'Create campaign'}
        </button>
        <a
          href="/admin/av/outreach"
          className="px-3 py-1.5 text-sm rounded-md bg-surface border border-border text-muted hover:text-ink"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
