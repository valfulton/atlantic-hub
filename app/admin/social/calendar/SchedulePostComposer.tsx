'use client';

/**
 * SchedulePostComposer — compose a social post and drop it onto the Campaign
 * Timeline. Pick a channel, write the post, set a date/time (+ optional media),
 * and it lands on the calendar (scheduled). Posts to /api/admin/social/outbox.
 * This is the operator's hands-on "populate the calendar" control.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { celebrate } from '@/lib/ui/celebrate';

interface Channel {
  id: number;
  provider: string;
  displayName: string | null;
  tenantId: string;
}

const PROVIDER_LABEL: Record<string, string> = {
  linkedin: 'LinkedIn', x: 'X', instagram: 'Instagram', facebook: 'Facebook',
  threads: 'Threads', tiktok: 'TikTok', youtube: 'YouTube'
};

export function SchedulePostComposer({ channels }: { channels: Channel[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [connectionId, setConnectionId] = useState<string>(channels[0] ? String(channels[0].id) : '');
  const [body, setBody] = useState('');
  const [when, setWhen] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    if (!connectionId) { setMsg({ ok: false, text: 'Pick a channel.' }); return; }
    if (!body.trim()) { setMsg({ ok: false, text: 'Write something to post.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/admin/social/outbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          connectionId: Number(connectionId),
          body: body.trim(),
          scheduledFor: when || undefined,
          mediaUrl: mediaUrl.trim() || undefined,
          mediaType
        })
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j?.error || 'Could not schedule.');
      setMsg({ ok: true, text: when ? 'Scheduled — it’s on your calendar.' : 'Saved as a draft on the calendar.' });
      celebrate(when ? 'Scheduled to your calendar' : 'Draft saved');
      setBody(''); setMediaUrl('');
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const fld = 'rounded-lg border border-border bg-black/30 px-3 py-2 text-sm text-ink placeholder-muted/60 focus:outline-none focus:border-brand';

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mb-4 rounded-lg bg-brand hover:opacity-90 text-brand-fg font-medium text-sm px-4 py-2">
        + Schedule a post
      </button>
    );
  }

  return (
    <div className="mb-5 rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-base font-semibold text-ink">Schedule a post</div>
        <button onClick={() => setOpen(false)} className="text-muted text-sm hover:text-ink">Close</button>
      </div>

      {channels.length === 0 ? (
        <p className="text-sm text-muted">
          No connected channels yet. Connect an account under <span className="text-ink">Social integrations</span> first, then you can schedule posts here.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.1em] text-muted">Channel</span>
              <select className={fld + ' w-full mt-1'} value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {(PROVIDER_LABEL[c.provider] ?? c.provider)}{c.displayName ? ` · ${c.displayName}` : ''} ({c.tenantId})
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.1em] text-muted">When (blank = save as draft)</span>
              <input type="datetime-local" className={fld + ' w-full mt-1'} value={when} onChange={(e) => setWhen(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.1em] text-muted">Post</span>
            <textarea className={fld + ' w-full mt-1'} rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What's going out…" />
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.1em] text-muted">Media URL (optional)</span>
              <input className={fld + ' w-full mt-1'} value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="image or video URL (e.g. a commercial)" />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-[0.1em] text-muted">Media type</span>
              <select className={fld + ' w-full mt-1'} value={mediaType} onChange={(e) => setMediaType(e.target.value as 'image' | 'video')}>
                <option value="image">Image</option>
                <option value="video">Video</option>
              </select>
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={submit} disabled={busy} className="rounded-lg bg-brand hover:opacity-90 disabled:opacity-50 text-brand-fg font-medium text-sm px-5 py-2">
              {busy ? 'Scheduling…' : 'Add to calendar'}
            </button>
            {msg && <span className={'text-xs ' + (msg.ok ? 'text-emerald-300' : 'text-rose-300')}>{msg.text}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
