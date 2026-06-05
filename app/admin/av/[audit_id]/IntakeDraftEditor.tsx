'use client';

/**
 * IntakeDraftEditor  (#253 step 5)
 *
 * Operator-side editor for a lead's "intake draft" — the 51-field intake-shape
 * stash that lives at leads.source_payload.lead_intake_draft and gets carried
 * forward to the new client's intake when val clicks "Make client".
 *
 * Until now, the only way to populate the draft was the LLM (Smart enrich
 * from website). This panel adds the other half: hand-curated edits. Val can
 * review what the LLM drafted, fix anything wrong, fill in blanks the LLM
 * couldn't infer, and only THEN convert the lead — so the new client lands
 * with an accurate intake, not whatever the model guessed.
 *
 * UX:
 *   - Collapsed by default — a single "Edit intake draft (N of M filled)"
 *     trigger that expands into the full editor. The detail page is already
 *     dense; this only takes up space when val asks for it.
 *   - One textarea per intake field. Empty value = remove from draft.
 *   - Save button writes everything that changed in one PATCH. Only DIRTY
 *     fields are sent — the API server already does blanks-only semantics
 *     internally, but limiting the request body to actually-changed fields
 *     keeps the audit log clean ("val edited these 3 fields" not "val
 *     re-saved 51 unchanged values").
 *
 * Never blocks the rest of the page. Errors surface inline; the rest of the
 * detail page keeps working.
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface FieldRow {
  key: string;
  value: string | null;
  populated: boolean;
}

interface DraftResponse {
  ok: true;
  populatedCount: number;
  totalFieldCount: number;
  fields: FieldRow[];
}

/** Pretty label for an intake key: 'business_description' -> 'Business description'. */
function labelOf(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
}

/** Which keys are the operator-most-useful ones, surfaced at the top. The rest
 *  fall into a "More" section so the panel doesn't read like a 51-row wall. */
const PRIORITY_KEYS = new Set([
  'business_description',
  'slogan',
  'key_message',
  'target_audience',
  'differentiators',
  'notable_clients',
  'press_awards',
  'founder_story',
  'brand_voice'
]);

export function IntakeDraftEditor({ auditId }: { auditId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<DraftResponse | null>(null);
  // (#253) Local edits keyed by field name. Initialized to the loaded value
  // on first load; only the keys present here get sent on save. Lets the
  // operator save one field without touching the others.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [showMore, setShowMore] = useState(false);

  // Eager-load the inventory once the panel opens. Saves a click step;
  // closing + reopening will re-fetch in case autopilot has re-scraped.
  useEffect(() => {
    if (!open || data) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`/api/admin/av/leads/${auditId}/intake-draft`);
        const j = await res.json();
        if (cancelled) return;
        if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
        setData(j as DraftResponse);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, data, auditId]);

  async function save() {
    if (!data) return;
    if (Object.keys(edits).length === 0) {
      // Nothing changed — close cleanly rather than rejecting at the API.
      setOpen(false);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      // For each edited field, build the body. Empty string -> server treats
      // as remove (consistent with the panel UX: clearing a field = delete).
      const fields: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(edits)) {
        const t = v.trim();
        fields[k] = t.length === 0 ? null : t;
      }
      const res = await fetch(`/api/admin/av/leads/${auditId}/intake-draft`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fields })
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setData(j as DraftResponse);
      setEdits({});
      // Server-rendered ProspectIntelPanel above this editor reads the same
      // source_payload — refresh the route so it picks up the new values.
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Collapsed trigger. The label dynamically reflects population so val sees
  // "12 of 51 filled" before deciding whether to open the panel.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs px-3 py-1.5 rounded-md border border-border bg-black/20 text-ink hover:border-[color-mix(in_srgb,var(--gold-bright)_35%,transparent)] inline-flex items-center gap-1.5"
        title="Review or refine the intake-shape draft the smart scraper produced. Gets carried forward when you click Make client."
      >
        <span style={{ color: '#FFC73D' }}>✎</span>
        Edit intake draft
        {data && (
          <span className="text-muted">
            ({data.populatedCount} of {data.totalFieldCount} filled)
          </span>
        )}
      </button>
    );
  }

  const priority = (data?.fields ?? []).filter((f) => PRIORITY_KEYS.has(f.key));
  const rest = (data?.fields ?? []).filter((f) => !PRIORITY_KEYS.has(f.key));

  function currentValueFor(f: FieldRow): string {
    return f.key in edits ? edits[f.key] : (f.value ?? '');
  }
  function setEdit(key: string, value: string) {
    setEdits((p) => ({ ...p, [key]: value }));
  }

  return (
    <div className="rounded-2xl border border-[color-mix(in_srgb,var(--gold-bright)_25%,transparent)] bg-[var(--gold-bright)]/[0.03] p-4 mb-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--gold-bright)]">
            Intake draft editor
          </div>
          <div className="text-[11px] text-muted mt-0.5 max-w-md leading-relaxed">
            Refine what the smart scraper pulled. Clearing a field deletes it from the draft.
            Whatever&apos;s here when you click Make client gets carried forward.
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {data && (
            <span className="text-[11px] text-muted">
              {data.populatedCount} of {data.totalFieldCount} filled
            </span>
          )}
          <button
            type="button"
            onClick={() => { setOpen(false); setEdits({}); }}
            className="text-[11px] text-muted hover:text-ink underline-offset-2 hover:underline"
            disabled={saving}
          >
            Close
          </button>
        </div>
      </div>

      {err && (
        <div className="text-xs mb-2" style={{ color: '#fca5a5' }}>{err}</div>
      )}
      {loading && (
        <div className="text-xs text-muted">Loading draft…</div>
      )}

      {data && (
        <>
          {/* Priority fields — the 9 most operator-useful keys, on by default. */}
          <ul className="space-y-2.5">
            {priority.map((f) => (
              <li key={f.key} className="rounded-md border border-white/5 bg-black/20 p-2.5">
                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                  <span className="text-[11px] text-ink/85 font-mono">{f.key}</span>
                  {f.key in edits && (
                    <span className="text-[9.5px] uppercase tracking-wider font-medium text-[color-mix(in_srgb,var(--gold-bright)_85%,transparent)]">
                      edited
                    </span>
                  )}
                  <span className="text-[10px] text-muted ml-auto">{labelOf(f.key)}</span>
                </div>
                <textarea
                  value={currentValueFor(f)}
                  onChange={(e) => setEdit(f.key, e.target.value)}
                  rows={Math.min(3, Math.max(1, Math.ceil((currentValueFor(f).length || 1) / 80)))}
                  className="w-full bg-black/30 border border-white/10 rounded px-2 py-1.5 text-[12px] text-white/90 placeholder-white/30 focus:outline-none focus:border-[color-mix(in_srgb,var(--gold-bright)_35%,transparent)]"
                  placeholder="(empty — clear to remove)"
                  disabled={saving}
                />
              </li>
            ))}
          </ul>

          {/* "More" section — the remaining intake keys. Collapsed by default
              so the panel doesn't dump 42 fields on val every time. */}
          {rest.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowMore((v) => !v)}
                className="text-[11px] text-muted hover:text-ink underline-offset-2 hover:underline"
              >
                {showMore ? '— Hide other fields' : `+ Show other fields (${rest.length})`}
              </button>
              {showMore && (
                <ul className="space-y-2.5 mt-2">
                  {rest.map((f) => (
                    <li key={f.key} className="rounded-md border border-white/5 bg-black/15 p-2.5">
                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                        <span className="text-[11px] text-ink/85 font-mono">{f.key}</span>
                        {f.key in edits && (
                          <span className="text-[9.5px] uppercase tracking-wider font-medium text-[color-mix(in_srgb,var(--gold-bright)_85%,transparent)]">
                            edited
                          </span>
                        )}
                        <span className="text-[10px] text-muted ml-auto">{labelOf(f.key)}</span>
                      </div>
                      <textarea
                        value={currentValueFor(f)}
                        onChange={(e) => setEdit(f.key, e.target.value)}
                        rows={Math.min(3, Math.max(1, Math.ceil((currentValueFor(f).length || 1) / 80)))}
                        className="w-full bg-black/30 border border-white/10 rounded px-2 py-1.5 text-[12px] text-white/90 placeholder-white/30 focus:outline-none focus:border-[color-mix(in_srgb,var(--gold-bright)_35%,transparent)]"
                        placeholder="(empty — clear to remove)"
                        disabled={saving}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 pt-3 mt-3 border-t border-white/5">
            <button
              type="button"
              onClick={save}
              disabled={saving || Object.keys(edits).length === 0}
              className={
                'text-[12px] px-3 py-1.5 rounded-md font-medium transition ' +
                (saving || Object.keys(edits).length === 0
                  ? 'bg-white/10 text-white/40 cursor-not-allowed'
                  : 'border border-[color-mix(in_srgb,var(--gold-bright)_40%,transparent)] text-[var(--gold-bright)] hover:bg-[color-mix(in_srgb,var(--gold-bright)_10%,transparent)]')
              }
            >
              {saving ? 'Saving…' : `Save ${Object.keys(edits).length} change${Object.keys(edits).length === 1 ? '' : 's'}`}
            </button>
            <button
              type="button"
              onClick={() => setEdits({})}
              disabled={saving || Object.keys(edits).length === 0}
              className="text-[11px] text-muted hover:text-ink underline-offset-2 hover:underline"
            >
              Reset edits
            </button>
            <span className="text-[10.5px] text-muted ml-auto">
              Saved values carry over on Make client.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
