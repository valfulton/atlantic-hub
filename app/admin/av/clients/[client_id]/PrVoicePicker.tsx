'use client';

/**
 * PrVoicePicker  (#88)
 *
 * Per-client PR voice + posture picker for the operator client page. Lets val
 * flip THIS brand's drafter voice (client_voice / advisory / congratulatory)
 * and its intel posture (self_promotion / work_leads / both) without opening
 * the full brief editor.
 *
 * The drafter reads default_voice / intel_posture out of the brief on every
 * draftPitch() call, so any change here takes effect on the next draft.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type IntelVoice = 'client_voice' | 'advisory' | 'congratulatory';
type IntelPosture = 'self_promotion' | 'work_leads' | 'both';

const VOICE_LABEL: Record<IntelVoice, { label: string; hint: string }> = {
  client_voice: {
    label: 'Client voice',
    hint: 'Speak AS this brand — for clients we represent (self-promotion).'
  },
  advisory: {
    label: 'Advisory',
    hint: 'Speak AS Atlantic & Vine TO this prospect — for working leads.'
  },
  congratulatory: {
    label: 'Congratulatory',
    hint: 'A warm note from A&V acknowledging something noteworthy. Opener, not a pitch.'
  }
};

const POSTURE_LABEL: Record<IntelPosture, { label: string; hint: string }> = {
  self_promotion: { label: 'Win press for them', hint: 'Use intel to land coverage FOR this brand.' },
  work_leads: { label: 'Approach their leads', hint: 'Use intel to reach OUT to their prospects.' },
  both: { label: 'Both', hint: 'Either, depending on the opportunity.' }
};

export default function PrVoicePicker({
  clientId,
  clientName,
  initialVoice,
  initialPosture
}: {
  clientId: number;
  clientName: string;
  initialVoice: IntelVoice | null;
  initialPosture: IntelPosture | null;
}) {
  const router = useRouter();
  const [voice, setVoice] = useState<IntelVoice | null>(initialVoice);
  const [posture, setPosture] = useState<IntelPosture | null>(initialPosture);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function save(patch: { defaultVoice?: IntelVoice | null; posture?: IntelPosture | null }) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/av/clients/${clientId}/pr-voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      const raw = await res.text();
      let data: { error?: string; defaultVoice?: IntelVoice | null; posture?: IntelPosture | null } = {};
      try { data = JSON.parse(raw); } catch { throw new Error(`HTTP ${res.status} (non-JSON)`); }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setVoice(data.defaultVoice ?? null);
      setPosture(data.posture ?? null);
      setSavedAt(Date.now());
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function pillClass(active: boolean): string {
    return (
      'inline-flex items-center px-2.5 py-1 rounded-md text-[11.5px] font-medium border transition ' +
      (active
        ? 'bg-amber-400/15 text-amber-200 border-amber-400/40'
        : 'bg-black/20 text-white/65 border-white/10 hover:text-white/90 hover:border-white/20')
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted mb-1">PR voice for {clientName}</div>
      <div className="text-[12.5px] text-white/70 mb-3 leading-relaxed">
        Sets the default pitch voice the PR engine uses when it drafts for {clientName}&apos;s
        leads or matched opportunities. Takes effect on the next draft.
      </div>

      <div className="space-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-white/50 mb-1.5">Default voice</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(Object.keys(VOICE_LABEL) as IntelVoice[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => save({ defaultVoice: v })}
                disabled={busy}
                title={VOICE_LABEL[v].hint}
                className={pillClass(voice === v)}
              >
                {VOICE_LABEL[v].label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => save({ defaultVoice: null })}
              disabled={busy || !voice}
              className="text-[10.5px] text-white/40 hover:text-white/70 px-2"
            >
              clear
            </button>
          </div>
          {voice && (
            <div className="text-[11px] text-white/55 mt-1.5 italic">
              {VOICE_LABEL[voice].hint}
            </div>
          )}
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-white/50 mb-1.5">Intel posture</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(Object.keys(POSTURE_LABEL) as IntelPosture[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => save({ posture: p })}
                disabled={busy}
                title={POSTURE_LABEL[p].hint}
                className={pillClass(posture === p)}
              >
                {POSTURE_LABEL[p].label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => save({ posture: null })}
              disabled={busy || !posture}
              className="text-[10.5px] text-white/40 hover:text-white/70 px-2"
            >
              clear
            </button>
          </div>
          {posture && (
            <div className="text-[11px] text-white/55 mt-1.5 italic">
              {POSTURE_LABEL[posture].hint}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 text-[10.5px]">
        {busy && <span className="text-amber-300/70">Saving…</span>}
        {!busy && savedAt && <span className="text-emerald-300/70">Saved.</span>}
        {err && <span className="text-rose-300">Couldn&apos;t save: {err}</span>}
      </div>
    </div>
  );
}
