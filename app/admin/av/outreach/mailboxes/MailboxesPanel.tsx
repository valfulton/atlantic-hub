'use client';

/**
 * Mailboxes manager UI. Connect HostGator SMTP / Outlook / Gmail
 * mailboxes, test the connection, archive, and (for OAuth drivers)
 * complete the OAuth dance via redirect.
 */

import { useCallback, useEffect, useState } from 'react';

interface Mailbox {
  id: number;
  displayName: string;
  fromAddress: string;
  fromName: string | null;
  replyToAddress: string | null;
  driver: 'hostgator_smtp' | 'microsoft_graph' | 'gmail_api';
  status: 'active' | 'pending_oauth' | 'disconnected' | 'error';
  dailySendCount: number;
  dailySendResetAt: string | null;
  lastTestAt: string | null;
  lastTestOutcome: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

const DRIVER_LABEL: Record<Mailbox['driver'], string> = {
  hostgator_smtp: 'HostGator SMTP',
  microsoft_graph: 'Outlook / Microsoft 365',
  gmail_api: 'Gmail / Google Workspace'
};

export function MailboxesPanel() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState<Mailbox['driver'] | null>(null);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/admin/av/outreach/mailboxes');
    if (res.ok) {
      const data = await res.json();
      setMailboxes(data.mailboxes ?? []);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
    const url = new URL(window.location.href);
    const connected = url.searchParams.get('connected');
    const err = url.searchParams.get('oauth_error');
    if (connected) {
      setFlash(`Mailbox #${connected} connected.`);
      url.searchParams.delete('connected');
      window.history.replaceState({}, '', url.toString());
    } else if (err) {
      setFlash(`OAuth error: ${err}`);
      url.searchParams.delete('oauth_error');
      window.history.replaceState({}, '', url.toString());
    }
  }, [refresh]);

  async function testConnection(id: number) {
    setBusyIds(prev => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/admin/av/outreach/mailboxes/${id}/test`, {
        method: 'POST'
      });
      const data = await res.json();
      setFlash(
        data.ok
          ? `Test OK (${data.latencyMs}ms): ${data.message}`
          : `Test failed: ${data.message}`
      );
      await refresh();
    } finally {
      setBusyIds(prev => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  }

  async function archive(id: number) {
    if (!window.confirm('Archive this mailbox? Outreach campaigns using it will pause until rewired.')) return;
    setBusyIds(prev => new Set(prev).add(id));
    try {
      await fetch(`/api/admin/av/outreach/mailboxes/${id}`, { method: 'DELETE' });
      await refresh();
    } finally {
      setBusyIds(prev => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    }
  }

  return (
    <div className="space-y-6">
      {flash && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 px-4 py-2 text-sm"
        >
          {flash}
        </div>
      )}

      <section className="grid sm:grid-cols-3 gap-3">
        <ConnectCard
          driver="hostgator_smtp"
          title="HostGator SMTP"
          description="Send from any mailbox you've created in cPanel. The simplest setup -- enter host, port, user, and password."
          onClick={() => setAdding('hostgator_smtp')}
        />
        <ConnectCard
          driver="microsoft_graph"
          title="Outlook / Microsoft 365"
          description="OAuth handoff to Microsoft. Sends from your Outlook account; replies land in your normal Outlook inbox."
          onClick={() => setAdding('microsoft_graph')}
        />
        <ConnectCard
          driver="gmail_api"
          title="Gmail / Google Workspace"
          description="OAuth handoff to Google. Sends from your Gmail account; replies land in your normal Gmail inbox."
          onClick={() => setAdding('gmail_api')}
        />
      </section>

      {adding && (
        <AddMailboxForm
          driver={adding}
          onClose={() => setAdding(null)}
          onCreated={async (oauthStartUrl) => {
            setAdding(null);
            if (oauthStartUrl) {
              window.location.href = oauthStartUrl;
            } else {
              await refresh();
            }
          }}
        />
      )}

      <section>
        <h2 className="text-sm font-semibold text-ink uppercase tracking-wider mb-2">
          Connected mailboxes
        </h2>
        {!loaded ? (
          <p className="text-xs text-muted">Loading...</p>
        ) : mailboxes.length === 0 ? (
          <p className="text-sm text-muted">
            None connected yet. Pick a driver above to add your first mailbox.
          </p>
        ) : (
          <ul className="space-y-2">
            {mailboxes.map((m) => (
              <li key={m.id} className="rounded-lg border border-border bg-[var(--surface)] p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-ink truncate">{m.displayName}</span>
                      <MailboxStatusPill status={m.status} />
                    </div>
                    <div className="text-xs text-muted">
                      {DRIVER_LABEL[m.driver]} · {m.fromAddress}
                    </div>
                    <div className="text-xs text-muted mt-1">
                      Sent today: {m.dailySendCount}
                      {m.lastTestAt && (
                        <> · Last test: {new Date(m.lastTestAt).toLocaleString()}
                          {m.lastTestOutcome === 'success' ? ' ✓' : ` (${m.lastTestOutcome})`}
                        </>
                      )}
                    </div>
                    {m.lastError && (
                      <div className="text-xs text-red-300 mt-1 max-w-xl truncate" title={m.lastError}>
                        {m.lastError}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {m.status === 'pending_oauth' && (
                      <a
                        href={
                          m.driver === 'microsoft_graph'
                            ? `/api/admin/av/outreach/mailboxes/oauth/microsoft/start?mailbox_id=${m.id}`
                            : `/api/admin/av/outreach/mailboxes/oauth/google/start?mailbox_id=${m.id}`
                        }
                        className="px-3 py-1.5 text-sm rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-200 hover:bg-amber-500/30 transition-colors"
                      >
                        Complete OAuth
                      </a>
                    )}
                    <button
                      onClick={() => testConnection(m.id)}
                      disabled={busyIds.has(m.id) || m.status === 'pending_oauth'}
                      className="px-3 py-1.5 text-sm rounded-md bg-surface border border-border hover:border-brand text-ink disabled:opacity-50 transition-colors"
                    >
                      Test
                    </button>
                    <button
                      onClick={() => archive(m.id)}
                      disabled={busyIds.has(m.id)}
                      className="px-3 py-1.5 text-sm rounded-md bg-surface border border-border hover:border-red-500 text-muted hover:text-red-300 disabled:opacity-50 transition-colors"
                    >
                      Archive
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ConnectCard({
  driver,
  title,
  description,
  onClick
}: {
  driver: Mailbox['driver'];
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-lg border border-border bg-[var(--surface)] p-4 hover:border-brand transition-colors block"
    >
      <div className="text-sm font-semibold text-ink mb-1">{title}</div>
      <p className="text-xs text-muted leading-relaxed">{description}</p>
      <div className="mt-3 text-xs text-brand">+ Connect</div>
    </button>
  );
}

function MailboxStatusPill({ status }: { status: Mailbox['status'] }) {
  const styles: Record<Mailbox['status'], string> = {
    active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    pending_oauth: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    disconnected: 'bg-gray-500/15 text-gray-300 border-gray-500/40',
    error: 'bg-red-500/15 text-red-300 border-red-500/40'
  };
  return (
    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${styles[status]}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function AddMailboxForm({
  driver,
  onClose,
  onCreated
}: {
  driver: Mailbox['driver'];
  onClose: () => void;
  onCreated: (oauthStartUrl?: string) => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [fromName, setFromName] = useState('');
  const [host, setHost] = useState('mail.atlanticandvine.com');
  const [port, setPort] = useState(465);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        driver,
        displayName,
        fromAddress,
        fromName: fromName || null
      };
      if (driver === 'hostgator_smtp') {
        body.host = host;
        body.port = port;
        body.secure = port === 465;
        body.user = user || fromAddress;
        body.pass = pass;
      }
      const res = await fetch('/api/admin/av/outreach/mailboxes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      onCreated(data.oauthStartUrl);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-brand/40 bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink">
          Connect {DRIVER_LABEL[driver]}
        </h3>
        <button
          onClick={onClose}
          className="text-xs text-muted hover:text-ink"
          aria-label="Close add-mailbox form"
        >
          ✕
        </button>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Display name (just for you)">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Atlantic outreach"
            required
            className="w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink"
          />
        </Field>
        <Field label="From email address">
          <input
            type="email"
            value={fromAddress}
            onChange={(e) => setFromAddress(e.target.value)}
            placeholder="outreach@atlanticandvine.com"
            required
            className="w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink"
          />
        </Field>
        <Field label="From display name (shown in recipient inbox)">
          <input
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            placeholder="Atlantic and Vine"
            className="w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink"
          />
        </Field>

        {driver === 'hostgator_smtp' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="SMTP host">
                <input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  required
                  className="w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink"
                />
              </Field>
              <Field label="Port">
                <select
                  value={port}
                  onChange={(e) => setPort(parseInt(e.target.value, 10))}
                  className="w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink"
                >
                  <option value={465}>465 (SSL)</option>
                  <option value={587}>587 (STARTTLS)</option>
                </select>
              </Field>
            </div>
            <Field label="SMTP username (usually the full email address)">
              <input
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder={fromAddress}
                className="w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink"
              />
            </Field>
            <Field label="SMTP password (set in cPanel > Email Accounts)">
              <input
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                required
                className="w-full px-2 py-1.5 text-sm rounded-md border border-border bg-surface text-ink"
              />
            </Field>
            <p className="text-xs text-muted">
              Stored encrypted at rest using your EMAIL_ENCRYPTION_KEY. Never logged, never shown
              back to the UI.
            </p>
          </>
        )}

        {driver !== 'hostgator_smtp' && (
          <p className="text-xs text-muted">
            After you save, you'll be redirected to{' '}
            {driver === 'microsoft_graph' ? 'Microsoft' : 'Google'} to grant the platform send +
            read access. We store only OAuth tokens (encrypted) -- no password ever passes through
            our system.
          </p>
        )}

        {error && <div className="text-xs text-red-300">{error}</div>}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={busy}
            className="px-3 py-1.5 text-sm rounded-md bg-brand text-ink font-medium disabled:opacity-50"
          >
            {busy ? 'Saving...' : driver === 'hostgator_smtp' ? 'Save mailbox' : 'Save + connect'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md bg-surface border border-border text-muted hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

function Field({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-muted">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
