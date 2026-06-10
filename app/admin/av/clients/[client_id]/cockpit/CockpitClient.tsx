'use client';

/**
 * CockpitClient — the interactive client-component half of the cockpit (#550 v1).
 * Receives server-fetched cockpit data and renders the kind-aware UI.
 *
 * Visual language inherits the cream surface + champagne accent direction val
 * approved on /admin/av/brief. NO black surfaces; this is brand-aligned.
 */
import { useState } from 'react';
import EditAssetModal, { type EditableAsset } from './EditAssetModal';

type Kind = 'lead_gen' | 'defense_pr' | 'political_campaign' | 'luxury_hospitality' | 'book_pr' | string;

interface BriefPayload {
  why_advertise?: string;
  goals?: string;
  target_audience?: string;
  audience_insights?: string;
  key_message?: string;
  message_support?: string;
  brand_voice?: string;
  differentiators?: string;
  brand_colors?: string;
  preferred_channels?: string;
  timeline?: string;
  industry?: string;
  contact_name?: string;
  owner_name?: string;
  business_state?: string;
  [key: string]: unknown;
}

interface CockpitData {
  kind: Kind;
  firstName: string;
  displayName: string;
  shortName: string;
  brief: BriefPayload;
  pulse: { signalsThisWeek: number; narrativesRunning: number; pendingApprovals: number; pressTouches: number };
}

interface Approval {
  id: string;
  kind: 'commercial' | 'press_release' | 'op_ed' | 'social';
  title: string;
  angle: string;
  source: string;
  /** (#581) Campaign name from narrative_lanes — shown inline as
   *  "Campaign · Procedural Justice · A Doctor I Know" so val sees which
   *  campaign feeds the draft without clicking through. NULL when unset. */
  campaignName?: string | null;
  /** (#581) Word count of body_text. Drives the "Draft · 247 words" preview
   *  line so val knows whether there's content to review. 0/undefined = no
   *  draft yet (renders "No draft yet — click Edit"). */
  bodyWordCount?: number;
  state?: 'live' | 'killed';
}

// Kind-aware hero copy. Falls back to lead_gen on unknown kinds.
const HERO: Record<string, { eyebrow: string; title: (firstName: string) => string; sub: string }> = {
  lead_gen: {
    eyebrow: 'Campaign cockpit',
    title: (f) => `${f}, here is who is about to need you.`,
    sub: 'Live prospects, scored against your brief, ready for outreach.'
  },
  defense_pr: {
    eyebrow: 'Defense desk',
    title: (f) => `${f}, your case has a story. This desk tells it.`,
    sub: 'Press touches, journalist outreach, and case-brief drafts — grounded in the court record.'
  },
  political_campaign: {
    eyebrow: 'Campaign cockpit',
    title: (f) => `${f}, your district. Your message. Your green-light.`,
    sub: 'District pulse + narrative lines + cascade-attributed drafts, ready when you are.'
  },
  luxury_hospitality: {
    eyebrow: 'Voyage desk',
    title: (f) => `${f}, each port is a chapter.`,
    sub: 'Itinerary, local press per stop, and the stories worth telling along the way.'
  },
  book_pr: {
    eyebrow: 'Launch desk',
    title: (f) => `${f}, your book has a story arc. Here is the launch plan.`,
    sub: 'Media wins, op-ed placements, and a cadence built around the publication window.'
  }
};

const KIND_DEFAULT_APPROVALS: Record<string, Approval[]> = {
  defense_pr: [
    { id: 'a1', kind: 'commercial',     title: 'The doctor who said yes — 30s video',           angle: 'A', source: 'Public record + Banner 2025 reversal coverage' },
    { id: 'a2', kind: 'press_release',  title: 'Press release · DOJ should drop the case',      angle: 'A', source: '93-page Bredar opinion + 4th Circuit ruling' },
    { id: 'a3', kind: 'op_ed',          title: 'Op-ed · What I learned reading 93 pages',       angle: 'C', source: 'Bredar opinion full text + medical community voice' }
  ],
  political_campaign: [
    { id: 'a1', kind: 'commercial',     title: 'District spot — what your neighbors are facing', angle: 'A', source: 'HMDA mortgage stress + WARN notices in district zips' },
    { id: 'a2', kind: 'press_release',  title: 'Press release · constituent pain points',        angle: 'A', source: 'Public-intel cascade · district overlay' },
    { id: 'a3', kind: 'op_ed',          title: 'Op-ed · A doctor I know · prosecutorial overreach', angle: 'C', source: 'Connects Elfenbein case to district medical voters' }
  ],
  luxury_hospitality: [
    { id: 'a1', kind: 'social',         title: 'Instagram story — arrival at next port',         angle: '—', source: 'Itinerary · ship position · port press calendar' },
    { id: 'a2', kind: 'press_release',  title: 'Local press kit · port arrival',                 angle: '—', source: 'Local outlets within 50mi of next stop' }
  ],
  book_pr: [
    { id: 'a1', kind: 'op_ed',          title: 'Op-ed pitch · the experiments behind the book',  angle: '—', source: 'Book outline · publishing date · target outlets' },
    { id: 'a2', kind: 'social',         title: 'LinkedIn post · launch-week thread',             angle: '—', source: 'Quote bank from manuscript' }
  ],
  lead_gen: [
    { id: 'a1', kind: 'social',         title: 'LinkedIn post · weekly authority piece',         angle: '—', source: 'Brief Q5 + recent client wins' }
  ]
};

const KIND_RING: Record<string, string> = {
  defense_pr: '#854F0B',         // amber-800 — gravity
  political_campaign: '#185FA5', // blue-600
  luxury_hospitality: '#085041', // teal-800 — emerald-deep
  book_pr: '#993556',            // pink-600
  lead_gen: '#3B6D11'            // green-600
};

export default function CockpitClient({
  data,
  clientId,
  initialApprovals
}: {
  data: CockpitData;
  clientId: number;
  /** (#568, Tier 1) Brief-grounded approval titles passed in from the server
   *  component. Replaces the previous hardcoded KIND_DEFAULT_APPROVALS lookup
   *  so every defense_pr client sees drafts about THEIR case, not Ron's.
   *  Falls back to the legacy hardcoded set only if the server didn't supply. */
  initialApprovals?: Approval[];
}) {
  const hero = HERO[data.kind] ?? HERO.lead_gen;
  const ring = KIND_RING[data.kind] ?? KIND_RING.lead_gen;
  const [approvals, setApprovals] = useState<Approval[]>(
    initialApprovals && initialApprovals.length > 0
      ? initialApprovals
      : (KIND_DEFAULT_APPROVALS[data.kind] ?? KIND_DEFAULT_APPROVALS.lead_gen)
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  // (#570, Tier 1.3) Edit modal state. null = closed.
  const [editing, setEditing] = useState<EditableAsset | null>(null);

  const pendingCount = approvals.filter((a) => !a.state).length;

  async function act(id: string, action: 'green' | 'kill' | 'edit') {
    if (action === 'edit') {
      // (#570) Real editor. Opens a modal seeded with the current title/body.
      const card = approvals.find((a) => a.id === id);
      if (!card) return;
      setEditing({
        id: card.id,
        kind: card.kind,
        title: card.title,
        body: null, // v1: cockpit doesn't yet round-trip body — modal starts blank, save persists it.
        source: card.source,
        angle: card.angle
      });
      return;
    }
    setBusyId(id);
    // (#569, Tier 1.2) For in-memory cockpit cards (id starts with 'a'),
    // send the full payload so the server can create the cockpit_approvals
    // row + dispatch in one POST. For real DB-backed approvals (numeric id),
    // send the approvalId.
    const card = approvals.find((a) => a.id === id);
    const isInline = !!card && /^a\d+/.test(id);
    const body = isInline && card
      ? { clientId, action, approval: { kind: card.kind, title: card.title, source: card.source, angle: card.angle } }
      : { clientId, approvalId: Number(id) || id, action };
    try {
      await fetch(`/api/admin/av/cockpit/greenlight`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch {
      /* swallow; UI optimistically flips below */
    }
    setApprovals((prev) => prev.map((a) => a.id === id ? { ...a, state: action === 'green' ? 'live' : 'killed' } : a));
    setBusyId(null);
  }

  async function greenLightAll() {
    const ids = approvals.filter((a) => !a.state).map((a) => a.id);
    for (const id of ids) await act(id, 'green');
  }

  // Per-kind dashboard surfaces. Only mount what this kind shows.
  const showDistrictPulse = data.kind === 'political_campaign';
  const showCaseBrief     = data.kind === 'defense_pr';
  const showItinerary     = data.kind === 'luxury_hospitality';
  const showLeadsPanel    = data.kind === 'lead_gen';

  const cream = '#FFFDF5';
  const dark = '#0A0A0A';

  return (
    <div className="max-w-[1440px]" style={{ background: cream, color: dark, padding: '1.5rem 1.75rem', borderRadius: 16 }}>
      {editing && (
        <EditAssetModal
          clientId={clientId}
          asset={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            // After save, replace the in-memory row with the persisted version
            // (new id from DB so subsequent Green Light updates the same row
            // instead of creating a second one). Keep order/state intact.
            setApprovals((prev) =>
              prev.map((a) => (a.id === editing.id ? { ...a, id: saved.id, title: saved.title } : a))
            );
            setEditing(null);
          }}
        />
      )}
      {/* Header — kind-aware greeting */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#7A5A18' }}>
          {hero.eyebrow} · {data.displayName}
          {data.shortName ? <span style={{ marginLeft: 8, padding: '2px 8px', background: '#F7F1E1', borderRadius: 6, fontSize: 10 }}>{data.shortName}</span> : null}
        </div>
        <div style={{ fontSize: 28, fontWeight: 500, fontFamily: 'Fraunces, Cormorant Garamond, serif', lineHeight: 1.1, marginTop: 6 }}>
          {hero.title(data.firstName)}
        </div>
        <div style={{ fontSize: 14, color: 'rgba(10,10,10,0.65)', marginTop: 8, maxWidth: 720 }}>
          {hero.sub}
        </div>
      </div>

      {/* Top metrics — kind-aware labels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: '1.5rem' }}>
        <Metric label={data.kind === 'political_campaign' ? 'District pulse' : data.kind === 'defense_pr' ? 'Case signals' : 'Signals this week'} value={data.pulse.signalsThisWeek} />
        <Metric label="Narratives running" value={data.pulse.narrativesRunning} />
        <Metric label="Pending approvals" value={pendingCount} />
        <Metric label="Press touches" value={data.pulse.pressTouches} />
      </div>

      {/* Kind-specific panel: only one of these mounts at a time */}
      {showDistrictPulse && <DistrictPulsePanel ring={ring} state={typeof data.brief.business_state === 'string' ? data.brief.business_state : ''} />}
      {showCaseBrief && <CaseBriefPanel ring={ring} brief={data.brief} />}
      {showItinerary && <ItineraryPanel ring={ring} brief={data.brief} />}
      {showLeadsPanel && <LeadsPanelStub />}

      {/* Pending approvals — universal across kinds */}
      <div style={{ marginTop: '1.5rem' }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Pending your green light</span>
          {pendingCount > 0 && (
            <button onClick={greenLightAll} style={{ background: '#4A1B0C', color: '#FAEEDA', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
              ✓ Green-light all {pendingCount}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {approvals.map((a) => (
            <ApprovalRow key={a.id} approval={a} busy={busyId === a.id} onAct={(action) => act(a.id, action)} />
          ))}
        </div>
      </div>

      {/* Brief surfacing — show the engine is grounded */}
      <div style={{ marginTop: '1.75rem' }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>Grounded in this brief</div>
        <div style={{ background: '#F7F1E1', borderRadius: 12, padding: '14px 18px', fontSize: 13, lineHeight: 1.65 }}>
          <BriefLine label="Why" value={data.brief.why_advertise} />
          <BriefLine label="Audience" value={data.brief.target_audience} />
          <BriefLine label="One message" value={data.brief.key_message} />
          <BriefLine label="Voice" value={data.brief.brand_voice} />
          {data.brief.timeline && <BriefLine label="When" value={data.brief.timeline} />}
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: 'rgba(10,10,10,0.55)' }}>
          Every line above feeds every prompt. Edit at <a href="/admin/av/brief" style={{ color: '#7A5A18', textDecoration: 'underline' }}>/admin/av/brief</a>.
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: '#F7F1E1', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: 'rgba(10,10,10,0.6)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 500, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function BriefLine({ label, value }: { label: string; value?: string }) {
  if (!value || !value.trim()) {
    return (
      <div style={{ display: 'flex', gap: 12, padding: '4px 0' }}>
        <span style={{ minWidth: 110, color: '#7A5A18', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', paddingTop: 2 }}>{label}</span>
        <span style={{ color: 'rgba(10,10,10,0.4)', fontStyle: 'italic' }}>not set yet — fill this in</span>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 12, padding: '4px 0' }}>
      <span style={{ minWidth: 110, color: '#7A5A18', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', paddingTop: 2 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function ApprovalRow({ approval, busy, onAct }: { approval: Approval; busy: boolean; onAct: (a: 'green' | 'kill' | 'edit') => void }) {
  const live = approval.state === 'live';
  const killed = approval.state === 'killed';
  const kindLabel: Record<string, string> = { commercial: 'Commercial', press_release: 'Press release', op_ed: 'Op-ed', social: 'Social' };
  // (#581 val 2026-06-10) Body preview line + Campaign name. These give val
  // an at-a-glance answer to two questions she shouldn't have to click to ask:
  //   - "is there a draft to read, or am I greenlighting a title-only stub?"
  //   - "which campaign feeds this draft?"
  const wordCount = approval.bodyWordCount ?? 0;
  const bodyPreview = wordCount > 0
    ? `Draft · ${wordCount.toLocaleString()} words`
    : 'No draft yet — click Edit to write or wait for the generator';
  const campaignName = approval.campaignName?.trim() || null;
  return (
    <div style={{
      background: '#FFFFFF', border: '0.5px solid rgba(10,10,10,0.12)', borderRadius: 10,
      padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, opacity: killed ? 0.5 : 1
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
          {approval.title}
          {live && <span style={{ background: '#E1F5EE', color: '#085041', fontSize: 10, padding: '2px 6px', borderRadius: 6 }}>LIVE</span>}
          {killed && <span style={{ background: '#F1EFE8', color: '#444441', fontSize: 10, padding: '2px 6px', borderRadius: 6 }}>killed</span>}
        </div>
        {/* Campaign name — plain text, shows which campaign feeds the draft. */}
        {campaignName ? (
          <div style={{ fontSize: 11, color: '#0A4D3C', marginTop: 3 }}>
            Campaign · <em style={{ fontStyle: 'italic' }}>{campaignName}</em>
          </div>
        ) : null}
        {/* Body preview line — answers "is there content to greenlight yet?" */}
        <div style={{ fontSize: 11, color: wordCount > 0 ? 'rgba(10,10,10,0.7)' : 'rgba(10,10,10,0.45)', marginTop: 3, fontStyle: wordCount === 0 ? 'italic' : 'normal' }}>
          {bodyPreview}
        </div>
        <div style={{ fontSize: 10, color: 'rgba(10,10,10,0.45)', marginTop: 3 }}>
          {kindLabel[approval.kind]} · angle {approval.angle} · {approval.source}
        </div>
      </div>
      {!approval.state && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button disabled={busy} onClick={() => onAct('green')} style={{ background: '#085041', color: '#E1F5EE', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: 11, cursor: 'pointer' }}>
            ✓ Green light
          </button>
          <button disabled={busy} onClick={() => onAct('edit')} style={{ background: '#FFFFFF', border: '0.5px solid rgba(10,10,10,0.2)', borderRadius: 6, padding: '6px 10px', fontSize: 11, cursor: 'pointer' }}>
            Edit
          </button>
          <button disabled={busy} onClick={() => onAct('kill')} style={{ background: '#FFFFFF', border: '0.5px solid rgba(10,10,10,0.2)', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: '#791F1F', cursor: 'pointer' }}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function DistrictPulsePanel({ ring, state }: { ring: string; state: string }) {
  // Mock district signals — replaced by public_intel_records read in #550 v2.
  const signals = [
    { zip: state === 'MD' ? 'Annapolis · 21401' : 'District west · 92651', label: 'Foreclosure cluster · last 30d', count: 7, severity: 'rising' },
    { zip: state === 'MD' ? 'Glen Burnie · 21061' : 'District central · 92626', label: 'Plant closure WARN notice', count: 1, severity: 'new' },
    { zip: state === 'MD' ? 'Severna Park · 21146' : 'District south · 92707', label: 'Code-violation hotspot', count: 12, severity: 'rising' }
  ];
  return (
    <div style={{ background: '#FFFFFF', border: `0.5px solid rgba(10,10,10,0.12)`, borderRadius: 12, padding: '14px 18px', marginTop: 4 }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10, color: ring }}>District pulse · {state || 'set business_state in brief'}</div>
      {signals.map((s, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: i === 0 ? 'none' : '0.5px solid rgba(10,10,10,0.08)' }}>
          <div>
            <div style={{ fontSize: 13 }}>{s.label}</div>
            <div style={{ fontSize: 11, color: 'rgba(10,10,10,0.5)' }}>{s.zip}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 500 }}>{s.count}</span>
            <span style={{ background: '#FAEEDA', color: '#633806', fontSize: 10, padding: '2px 6px', borderRadius: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.severity}</span>
          </div>
        </div>
      ))}
      <div style={{ marginTop: 10, fontSize: 11, color: 'rgba(10,10,10,0.5)' }}>
        v1 mock data · live cascade pulls in #550 v2.
      </div>
    </div>
  );
}

function CaseBriefPanel({ ring, brief }: { ring: string; brief: BriefPayload }) {
  return (
    <div style={{ background: '#FFFFFF', border: `0.5px solid rgba(10,10,10,0.12)`, borderRadius: 12, padding: '14px 18px', marginTop: 4 }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10, color: ring }}>Case brief · the story behind the case</div>
      <div style={{ fontSize: 13, lineHeight: 1.65 }}>
        {typeof brief.message_support === 'string' && brief.message_support
          ? <div style={{ background: '#F7F1E1', padding: '10px 14px', borderRadius: 8, marginBottom: 10 }}>{brief.message_support}</div>
          : <div style={{ color: 'rgba(10,10,10,0.45)', fontStyle: 'italic' }}>No case-support narrative in the brief yet.</div>
        }
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
          <span style={{ background: '#E6F1FB', color: '#0C447C', fontSize: 12, padding: '4px 10px', borderRadius: 6 }}>Press window: active</span>
          <span style={{ background: '#FAEEDA', color: '#633806', fontSize: 12, padding: '4px 10px', borderRadius: 6 }}>Counsel sign-off required before any press release</span>
        </div>
      </div>
    </div>
  );
}

function ItineraryPanel({ ring, brief }: { ring: string; brief: BriefPayload }) {
  return (
    <div style={{ background: '#FFFFFF', border: `0.5px solid rgba(10,10,10,0.12)`, borderRadius: 12, padding: '14px 18px', marginTop: 4 }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10, color: ring }}>Voyage · next chapters</div>
      <div style={{ fontSize: 13, color: 'rgba(10,10,10,0.6)' }}>
        Itinerary panel ships in #550 v2 once the client submits their cruise schedule. For now, the cockpit reads the timeline field from the brief:
        <div style={{ marginTop: 8, background: '#F7F1E1', padding: '10px 14px', borderRadius: 8, color: '#0A0A0A' }}>
          {typeof brief.timeline === 'string' && brief.timeline ? brief.timeline : 'No itinerary set yet — fill in the timeline field in the brief.'}
        </div>
      </div>
    </div>
  );
}

function LeadsPanelStub() {
  return (
    <div style={{ background: '#FFFFFF', border: `0.5px solid rgba(10,10,10,0.12)`, borderRadius: 12, padding: '14px 18px', marginTop: 4, fontSize: 13, color: 'rgba(10,10,10,0.55)' }}>
      Leads pipeline lives at <a href="/admin/av/leads" style={{ color: '#7A5A18' }}>/admin/av/leads</a>. The cockpit will surface the top 3 hot leads here in #550 v2.
    </div>
  );
}
