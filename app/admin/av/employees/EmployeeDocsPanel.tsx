'use client';

/**
 * EmployeeDocsPanel — documents (upload / list / download / delete) + contract
 * signing for an employee. Used on the operator employee page and the employee's
 * own /employees/me page. Sensitive paperwork (W-9, IDs, signed agreement) lives
 * here as files.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Doc { doc_id: number; label: string; content_type: string | null; created_at: string | Date }

export default function EmployeeDocsPanel({
  userId,
  documents,
  contractSignedName,
  contractSignedAt
}: {
  userId: number;
  documents: Doc[];
  contractSignedName: string | null;
  contractSignedAt: string | null;
}) {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sigName, setSigName] = useState('');
  const [signing, setSigning] = useState(false);
  const [sigMsg, setSigMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const base = `/api/admin/av/employees/${userId}/documents`;

  async function upload() {
    if (!file) { setMsg({ ok: false, text: 'Choose a file first.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (label.trim()) fd.append('label', label.trim());
      const res = await fetch(base, { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || 'Upload failed.');
      setLabel(''); setFile(null);
      setMsg({ ok: true, text: 'Uploaded.' });
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  async function del(docId: number) {
    if (!confirm('Delete this document?')) return;
    try {
      const res = await fetch(`${base}?docId=${docId}`, { method: 'DELETE' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || 'Delete failed.');
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }

  async function sign() {
    if (sigName.trim().length < 2) { setSigMsg({ ok: false, text: 'Type your full name to sign.' }); return; }
    setSigning(true); setSigMsg(null);
    try {
      const res = await fetch(`/api/admin/av/employees/${userId}/contract`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signedName: sigName.trim() })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || 'Could not record signature.');
      setSigMsg({ ok: true, text: 'Signed — thank you.' });
      router.refresh();
    } catch (e) { setSigMsg({ ok: false, text: (e as Error).message }); }
    finally { setSigning(false); }
  }

  const input = 'rounded-lg border border-border bg-black/20 px-3 py-2 text-sm text-ink focus:outline-none focus:border-brand';
  const btn = { background: 'linear-gradient(120deg,#FF9C5B,#FFC73D)', color: '#1a1207', border: 'none' } as const;

  return (
    <div className="space-y-5">
      {/* Contract */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-2">Contract</div>
        {contractSignedName ? (
          <p className="text-sm text-ink">
            Signed by <span className="font-medium">{contractSignedName}</span>
            {contractSignedAt ? ` on ${new Date(contractSignedAt).toISOString().slice(0, 10)}` : ''}.
          </p>
        ) : (
          <div>
            <p className="text-xs text-muted mb-2 leading-relaxed">
              Review the agreement (uploaded in documents), then type your full legal name to sign. Your name + the date are recorded.
            </p>
            <div className="flex flex-wrap gap-2 items-center">
              <input className={`${input} w-64`} placeholder="Type your full name" value={sigName} onChange={(e) => setSigName(e.target.value)} />
              <button onClick={sign} disabled={signing} className="rounded-lg px-4 py-2 text-sm font-medium" style={btn}>
                {signing ? 'Signing…' : 'Sign'}
              </button>
              {sigMsg && <span className="text-xs" style={{ color: sigMsg.ok ? '#6ee7b7' : '#fca5a5' }}>{sigMsg.text}</span>}
            </div>
          </div>
        )}
      </div>

      {/* Documents */}
      <div className="rounded-2xl border border-border bg-surface p-4">
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-2">Documents</div>
        <p className="text-xs text-muted mb-3 leading-relaxed">Application, signed contract, W-9, ID — anything that should live on file. Max 15 MB each.</p>

        <div className="flex flex-wrap gap-2 items-center mb-3">
          <input className={`${input} w-56`} placeholder="Label (e.g. Signed contract)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input type="file" className="text-sm text-muted" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button onClick={upload} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-medium" style={btn}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
          {msg && <span className="text-xs" style={{ color: msg.ok ? '#6ee7b7' : '#fca5a5' }}>{msg.text}</span>}
        </div>

        {documents.length === 0 ? (
          <p className="text-sm text-muted">No documents yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {documents.map((d) => (
              <li key={d.doc_id} className="py-2 flex items-center justify-between gap-3">
                <a href={`${base}/${d.doc_id}`} target="_blank" rel="noopener" className="text-sm text-ink hover:text-brand hover:underline truncate">
                  {d.label}
                </a>
                <button onClick={() => del(d.doc_id)} className="text-[11px] text-muted/70 hover:text-rose-300 shrink-0">Delete</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
