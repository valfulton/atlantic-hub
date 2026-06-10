/**
 * SmartFillPanel  (#582, val 2026-06-10)
 *
 * Universal "paste a paragraph, get a brief" component. Drops into any of the
 * 4 intake surfaces with the same props:
 *
 *   - /admin/av/clients/new                — operator create-client
 *   - /admin/av/clients/[id]/intake        — operator intake editor
 *   - /client/intake                       — client-facing intake
 *   - atlanticandvine.netlify.app/audit    — marketing-site free audit
 *
 * Two API endpoints exist (operator + client) but the SHAPE is the same;
 * the caller passes `endpoint` and the component handles the rest.
 *
 * Per val's QC rule (memory: feedback_prompt_visibility): the prompt and the
 * raw response are always SHOWABLE — clicking "show the prompt" reveals the
 * exact text sent to the LLM so val can audit before any subsequent run
 * spends credits.
 */
'use client';

import { useState } from 'react';

export interface SmartFillFields {
  engagement_kind?: string;
  company?: string;
  contact_name?: string;
  owner_name?: string;
  key_message?: string;
  message_support?: string;
  audience_insights?: string;
  differentiators?: string;
  timeline?: string;
  district?: string;
  industry?: string;
  red_lines?: string;
  website_url?: string;
  _confidence?: 'high' | 'medium' | 'low';
  _notes?: string;
}

export interface SmartFillPanelProps {
  /** Which API endpoint to POST to. Operator surfaces use the admin route;
   *  client + marketing surfaces use the client route. */
  endpoint: '/api/admin/av/intake/smart_fill' | '/api/client/intake/smart_fill';
  /** Optional engagement-kind hint when the surrounding form already has one. */
  hintKind?: string | null;
  /** Cost reporting scope (operator surfaces only — client route reads its own). */
  clientId?: number | null;
  /** Called when val clicks "Apply these to the brief." The parent form should
   *  merge the fields into its own state (existing brief values win unless the
   *  parent wants overwrite semantics — that's a parent decision). */
  onApply: (fields: SmartFillFields) => void;
  /** Title shown above the textarea. Default: "Smart fill from a paragraph". */
  title?: string;
  /** Helper text below the title. Default explains the use case. */
  helper?: string;
}

const KIND_LABEL: Record<string, string> = {
  lead_gen: 'Lead-gen / authority',
  defense_pr: 'Defense PR',
  political_campaign: 'Political campaign',
  luxury_hospitality: 'Luxury hospitality',
  book_pr: 'Book PR'
};

const FIELD_LABEL: Record<keyof SmartFillFields, string> = {
  engagement_kind: 'Engagement kind',
  company: 'Company',
  contact_name: 'Contact name',
  owner_name: 'Owner / principal',
  key_message: 'Key message',
  message_support: 'Supporting proof',
  audience_insights: 'Audience insights',
  differentiators: 'Differentiators',
  timeline: 'Timeline / urgency',
  district: 'District / territory',
  industry: 'Industry',
  red_lines: 'Do-not-say',
  website_url: 'Website',
  _confidence: 'Model confidence',
  _notes: 'Model notes'
};

export default function SmartFillPanel({
  endpoint,
  hintKind,
  clientId,
  onApply,
  title = 'Smart fill from a paragraph',
  helper = 'Paste any source paragraph — press release, founder bio, hotel positioning copy, book pitch, anything — and the brief fields fill themselves. Review every field before applying.'
}: SmartFillPanelProps) {
  const [paragraph, setParagraph] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SmartFillFields | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [costMicrocents, setCostMicrocents] = useState(0);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    setPrompt('');
    setCostMicrocents(0);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paragraph, hintKind, clientId })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.error) {
        setError(body?.errorMessage || body?.error || `Smart-fill failed (${res.status}).`);
        return;
      }
      setResult(body.fields || {});
      setPrompt(body.prompt || '');
      setCostMicrocents(body.costMicrocents ?? 0);
    } catch (e) {
      setError((e as Error).message || 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  const filledKeys: (keyof SmartFillFields)[] = result
    ? (Object.keys(result) as (keyof SmartFillFields)[]).filter(
        (k) => k !== '_confidence' && k !== '_notes' && !!result[k]
      )
    : [];

  return (
    <section
      style={{
        background: 'var(--paper, #FFFDF5)',
        border: '1px solid var(--card-border, rgba(10,10,10,0.12))',
        borderRadius: 12,
        padding: '14px 16px',
        marginBottom: 16
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontFamily: 'var(--serif, Fraunces, serif)', fontSize: 16, fontWeight: 500 }}>
          {title}
        </h3>
        <span style={{ fontSize: 11, color: 'var(--ink-mute, rgba(10,10,10,0.55))', letterSpacing: '.04em' }}>
          {hintKind && KIND_LABEL[hintKind] ? `· hint: ${KIND_LABEL[hintKind]}` : ''}
        </span>
      </div>
      <p style={{ fontSize: 13, color: 'var(--ink-mute, rgba(10,10,10,0.6))', marginTop: 0, marginBottom: 10, lineHeight: 1.4 }}>
        {helper}
      </p>
      <textarea
        value={paragraph}
        onChange={(e) => setParagraph(e.target.value)}
        placeholder="Paste a paragraph here…"
        rows={6}
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: 8,
          border: '1px solid var(--card-border, rgba(10,10,10,0.18))',
          background: 'var(--paper, #FFFFFF)',
          fontFamily: 'var(--sans, system-ui, sans-serif)',
          fontSize: 14,
          lineHeight: 1.45,
          resize: 'vertical',
          color: 'var(--ink, #1B2329)'
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={run}
          disabled={busy || paragraph.trim().length < 30}
          style={{
            background: 'var(--emerald-deep, #0A4D3C)',
            color: 'var(--gold-bright, #E8C25A)',
            border: 'none',
            borderRadius: 8,
            padding: '8px 14px',
            fontSize: 13,
            fontWeight: 500,
            cursor: busy || paragraph.trim().length < 30 ? 'not-allowed' : 'pointer',
            opacity: busy || paragraph.trim().length < 30 ? 0.55 : 1
          }}
        >
          {busy ? 'Filling…' : '✨ Smart fill'}
        </button>
        {prompt ? (
          <button
            type="button"
            onClick={() => setShowPrompt((v) => !v)}
            style={{
              background: 'transparent',
              border: '1px solid var(--card-border, rgba(10,10,10,0.2))',
              borderRadius: 8,
              padding: '7px 12px',
              fontSize: 12,
              cursor: 'pointer'
            }}
          >
            {showPrompt ? 'Hide prompt' : 'Show the prompt'}
          </button>
        ) : null}
        {costMicrocents > 0 ? (
          <span style={{ fontSize: 11, color: 'var(--ink-mute, rgba(10,10,10,0.5))' }}>
            cost · ${(costMicrocents / 100000).toFixed(4)}
          </span>
        ) : null}
        {result?._confidence ? (
          <span style={{ fontSize: 11, color: 'var(--ink-mute, rgba(10,10,10,0.55))' }}>
            confidence · {result._confidence}
          </span>
        ) : null}
      </div>
      {error ? (
        <div style={{ marginTop: 10, fontSize: 13, color: '#791F1F' }}>
          {error}
        </div>
      ) : null}
      {showPrompt && prompt ? (
        <pre
          style={{
            marginTop: 10,
            padding: 10,
            background: 'rgba(10,10,10,0.04)',
            borderRadius: 8,
            fontSize: 11,
            lineHeight: 1.4,
            whiteSpace: 'pre-wrap',
            maxHeight: 240,
            overflow: 'auto'
          }}
        >
          {prompt}
        </pre>
      ) : null}
      {result && filledKeys.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--ink-mute, rgba(10,10,10,0.65))', marginBottom: 6 }}>
            Filled fields — review, then apply.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 180px) 1fr', gap: '6px 12px' }}>
            {filledKeys.map((k) => (
              <FieldRow key={k} label={FIELD_LABEL[k]} value={result[k] as string} />
            ))}
          </div>
          {result._notes ? (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-mute, rgba(10,10,10,0.6))', fontStyle: 'italic' }}>
              Note: {result._notes}
            </div>
          ) : null}
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              onClick={() => onApply(result)}
              style={{
                background: 'var(--gold-bright, #E8C25A)',
                color: 'var(--ink, #1B2329)',
                border: 'none',
                borderRadius: 8,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Apply these to the brief →
            </button>
          </div>
        </div>
      ) : result && result._notes ? (
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-mute, rgba(10,10,10,0.6))', fontStyle: 'italic' }}>
          {result._notes}
        </div>
      ) : null}
    </section>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div style={{ fontSize: 11, color: 'var(--ink-mute, rgba(10,10,10,0.5))', letterSpacing: '.04em', textTransform: 'uppercase', alignSelf: 'start', paddingTop: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: 'var(--ink, #1B2329)', lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
        {value}
      </div>
    </>
  );
}
