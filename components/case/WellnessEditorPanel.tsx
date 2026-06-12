/**
 * components/case/WellnessEditorPanel.tsx  (val 2026-06-12, Phase 3)
 *
 * Three inline-add forms for the Family Legacy Care wrapper:
 *   1. Health roster entry (doctor / medication / pharmacy / etc.)
 *   2. Care appointment (upcoming visit)
 *   3. Wellness check (post-visit observation log)
 *
 * Each form is collapsed by default — Rebecca expands the one she needs,
 * fills in, posts, and the page refreshes.
 *
 * Mounted INSIDE the operator case dashboard's wellness section so val sees
 * it next to the read-only summaries. Will mount on the client cream page
 * once Rebecca's scoped POST routes land (Phase 3 Wave 2).
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Party {
  partyId: number;
  fullName: string;
  isParent: boolean;
}

interface Props {
  caseId: number;
  parties: Party[];
}

type FormKey = 'health' | 'appointment' | 'check' | null;

const HEALTH_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'primary_care', label: 'Primary care doctor' },
  { value: 'specialist', label: 'Specialist' },
  { value: 'dentist', label: 'Dentist' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'medicare', label: 'Medicare' },
  { value: 'medicaid', label: 'Medicaid' },
  { value: 'medication', label: 'Medication' },
  { value: 'condition', label: 'Condition / diagnosis' },
  { value: 'allergy', label: 'Allergy' }
];

const OBSERVATION_KINDS: Array<{ value: string; label: string }> = [
  { value: 'in_person_visit', label: 'In-person visit' },
  { value: 'phone_check', label: 'Phone check-in' },
  { value: 'video_call', label: 'Video call' }
];

export default function WellnessEditorPanel({ caseId, parties }: Props) {
  const router = useRouter();
  const [openForm, setOpenForm] = useState<FormKey>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parentParties = parties.filter((p) => p.isParent);
  const defaultPartyId = parentParties[0]?.partyId ?? parties[0]?.partyId ?? null;

  async function postForm(path: string, payload: Record<string, unknown>) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/av/cases/${caseId}/wellness/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error || 'Save failed');
        return false;
      }
      setOpenForm(null);
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-4 border-t border-emerald-700/30 pt-4">
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setOpenForm(openForm === 'health' ? null : 'health')}
          className="text-xs uppercase tracking-wider px-3 py-1.5 rounded-md border border-emerald-700/40 bg-emerald-900/20 text-emerald-200 hover:bg-emerald-900/30"
        >
          + Add to health roster
        </button>
        <button
          type="button"
          onClick={() => setOpenForm(openForm === 'appointment' ? null : 'appointment')}
          className="text-xs uppercase tracking-wider px-3 py-1.5 rounded-md border border-emerald-700/40 bg-emerald-900/20 text-emerald-200 hover:bg-emerald-900/30"
        >
          + Schedule appointment
        </button>
        <button
          type="button"
          onClick={() => setOpenForm(openForm === 'check' ? null : 'check')}
          className="text-xs uppercase tracking-wider px-3 py-1.5 rounded-md border border-emerald-700/40 bg-emerald-900/20 text-emerald-200 hover:bg-emerald-900/30"
        >
          + Log wellness check
        </button>
      </div>

      {error && (
        <div className="mt-3 text-xs text-red-300 bg-red-950/40 border border-red-700/40 rounded px-3 py-2">
          {error}
        </div>
      )}

      {openForm === 'health' && (
        <HealthRosterForm
          parties={parties}
          defaultPartyId={defaultPartyId}
          submitting={submitting}
          onSubmit={(p) => postForm('health-roster', p)}
          onCancel={() => setOpenForm(null)}
        />
      )}
      {openForm === 'appointment' && (
        <AppointmentForm
          parties={parties}
          defaultPartyId={defaultPartyId}
          submitting={submitting}
          onSubmit={(p) => postForm('appointments', p)}
          onCancel={() => setOpenForm(null)}
        />
      )}
      {openForm === 'check' && (
        <WellnessCheckForm
          parties={parties}
          defaultPartyId={defaultPartyId}
          submitting={submitting}
          onSubmit={(p) => postForm('wellness-checks', p)}
          onCancel={() => setOpenForm(null)}
        />
      )}
    </div>
  );
}

// ── Health roster form ──────────────────────────────────────────────────

interface HealthFormProps {
  parties: Party[];
  defaultPartyId: number | null;
  submitting: boolean;
  onSubmit: (payload: Record<string, unknown>) => Promise<boolean>;
  onCancel: () => void;
}

function HealthRosterForm({ parties, defaultPartyId, submitting, onSubmit, onCancel }: HealthFormProps) {
  const [category, setCategory] = useState('primary_care');
  const [label, setLabel] = useState('');
  const [details, setDetails] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [partyId, setPartyId] = useState<number | null>(defaultPartyId);
  const [nextVisitDate, setNextVisitDate] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    await onSubmit({
      category, label: label.trim(),
      details: details.trim() || undefined,
      contactName: contactName.trim() || undefined,
      contactPhone: contactPhone.trim() || undefined,
      partyId: partyId ?? undefined,
      nextVisitDate: nextVisitDate || undefined
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 p-3 rounded-lg bg-emerald-950/30 border border-emerald-700/30 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">
          <span className="block text-emerald-300 uppercase tracking-wider mb-1">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full bg-black/30 border border-emerald-700/40 rounded px-2 py-1.5 text-sm"
          >
            {HEALTH_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-emerald-300 uppercase tracking-wider mb-1">For</span>
          <select
            value={partyId ?? ''}
            onChange={(e) => setPartyId(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="w-full bg-black/30 border border-emerald-700/40 rounded px-2 py-1.5 text-sm"
          >
            <option value="">(unspecified)</option>
            {parties.map((p) => (
              <option key={p.partyId} value={p.partyId}>
                {p.fullName}{p.isParent ? ' · parent' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="text-xs block">
        <span className="block text-emerald-300 uppercase tracking-wider mb-1">Label *</span>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
          placeholder='e.g. "Dr. Patel — Cardiology" or "Lisinopril 10mg"'
          className="w-full bg-black/30 border border-emerald-700/40 rounded px-2 py-1.5 text-sm"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">
          <span className="block text-emerald-300 uppercase tracking-wider mb-1">Contact name</span>
          <input
            type="text"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            className="w-full bg-black/30 border border-emerald-700/40 rounded px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs">
          <span className="block text-emerald-300 uppercase tracking-wider mb-1">Phone</span>
          <input
            type="tel"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            className="w-full bg-black/30 border border-emerald-700/40 rounded px-2 py-1.5 text-sm"
          />
        </label>
      </div>
      <label className="text-xs block">
        <span className="block text-emerald-300 uppercase tracking-wider mb-1">Details / dose / notes</span>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={2}
          className="w-full bg-black/30 border border-emerald-700/40 rounded px-2 py-1.5 text-sm"
        />
      </label>
      <label className="text-xs block">
        <span className="block text-emerald-300 uppercase tracking-wider mb-1">Next visit (optional)</span>
        <input
          type="date"
          value={nextVisitDate}
          onChange={(e) => setNextVisitDate(e.target.value)}
          className="bg-black/30 border border-emerald-700/40 rounded px-2 py-1.5 text-sm"
        />
      </label>
      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={submitting || !label.trim()}
          className="text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-emerald-700 text-white disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Save entry'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs uppercase tracking-wider px-3 py-1.5 rounded-md border border-emerald-700/40 text-emerald-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Appointment form ───────────────────────────────────────────────────

function AppointmentForm({ parties, defaultPartyId, submitting, onSubmit, onCancel }: HealthFormProps) {
  const [scheduledAt, setScheduledAt] = useState('');
  const [appointmentKind, setAppointmentKind] = useState('');
  const [providerName, setProviderName] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [partyId, setPartyId] = useState<number | null>(defaultPartyId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!scheduledAt) return;
    await onSubmit({
      scheduledAt,
      appointmentKind: appointmentKind.trim() || undefined,
      providerName: providerName.trim() || undefined,
      location: location.trim() || undefined,
      notes: notes.trim() || undefined,
      partyId: partyId ?? undefined
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 p-3 rounded-lg bg-emerald-950/30 border border-emerald-700/30 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">
          <span className="block text-emerald-300 uppercase tracking-wider mb-1">When *</span>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            required
            className="w-full bg-black/30 border border-emerald-700/40 rounded px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs">
          <span className="block text-emerald-300 uppercase tracking-wider mb-1">For</span>
          <select
            value={partyId ?? ''}
            onChange={(e) => setPartyId(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="w-full bg-black/30 border border-emerald-700/40 rounded px-2 py-1.5 text-sm"
          >
            <option value="">(unspecified)</option>
            {parties.map((p) => (
              <option key={p.partyId} value={p.partyId}>
                {p.fullName}{p.isParent ? ' · parent' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="text-xs block">
        <span className="block text-emerald-300 uppercase tracking-wider mb-1">Provider</span>
        <input
          type="text"
          value={providerName}
          onChange={(e) => setProviderName(e.target.value)}
          placeholder='e.g. "Dr. Patel — Cardiology"'
          className="w-full bg-black/30 border border-emerald-700/40 rounded px-2 py-1.5 text-sm"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">
          <span className="block text-emerald-300 uppercase tracking-wider mb-1">Kind</span>
          <input
            type="text"
            value={appointmentKind}
            onChange={(e) => setAppointmentKind(e.target.value)}
            placeholder="follow_up / specialist / lab / dental"
            className="w-full bg-black/30 border border-emerald-700/40 rounded px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs">
          <span className="block text-emerald-300 uppercase tracking-wider mb-1">Location</span>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-full bg-black/30 border border-emerald-700/40 rounded px-2 py-1.5 text-sm"
          />
        </label>
      </div>
      <label className="text-xs block">
        <span className="block text-emerald-300 uppercase tracking-wider mb-1">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full bg-black/30 border border-emerald-700/40 rounded px-2 py-1.5 text-sm"
        />
      </label>
      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={submitting || !scheduledAt}
          className="text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-emerald-700 text-white disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Schedule it'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs uppercase tracking-wider px-3 py-1.5 rounded-md border border-emerald-700/40 text-emerald-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Wellness check form ─────────────────────────────────────────────────

function WellnessCheckForm({ parties, defaultPartyId, submitting, onSubmit, onCancel }: HealthFormProps) {
  const [observationKind, setObservationKind] = useState('in_person_visit');
  const [cognitionNote, setCognitionNote] = useState('');
  const [moodNote, setMoodNote] = useState('');
  const [physicalNote, setPhysicalNote] = useState('');
  const [unusualContactsNote, setUnusualContactsNote] = useState('');
  const [concerns, setConcerns] = useState('');
  const [positiveObservations, setPositiveObservations] = useState('');
  const [partyObservedId, setPartyObservedId] = useState<number | null>(defaultPartyId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const anyContent =
      cognitionNote.trim() || moodNote.trim() || physicalNote.trim()
      || unusualContactsNote.trim() || concerns.trim() || positiveObservations.trim();
    if (!anyContent) return;
    await onSubmit({
      observationKind,
      partyObservedId: partyObservedId ?? undefined,
      cognitionNote: cognitionNote.trim() || undefined,
      moodNote: moodNote.trim() || undefined,
      physicalNote: physicalNote.trim() || undefined,
      unusualContactsNote: unusualContactsNote.trim() || undefined,
      concerns: concerns.trim() || undefined,
      positiveObservations: positiveObservations.trim() || undefined
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 p-3 rounded-lg bg-emerald-950/30 border border-emerald-700/30 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">
          <span className="block text-emerald-300 uppercase tracking-wider mb-1">Kind</span>
          <select
            value={observationKind}
            onChange={(e) => setObservationKind(e.target.value)}
            className="w-full bg-black/30 border border-emerald-700/40 rounded px-2 py-1.5 text-sm"
          >
            {OBSERVATION_KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-emerald-300 uppercase tracking-wider mb-1">About</span>
          <select
            value={partyObservedId ?? ''}
            onChange={(e) => setPartyObservedId(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="w-full bg-black/30 border border-emerald-700/40 rounded px-2 py-1.5 text-sm"
          >
            <option value="">(both / general)</option>
            {parties.filter((p) => p.isParent).map((p) => (
              <option key={p.partyId} value={p.partyId}>{p.fullName}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="text-xs block">
        <span className="block text-emerald-300 uppercase tracking-wider mb-1">Cognition</span>
        <input
          type="text"
          value={cognitionNote}
          onChange={(e) => setCognitionNote(e.target.value)}
          placeholder="Alert? Confused? Same as last visit?"
          className="w-full bg-black/30 border border-emerald-700/40 rounded px-2 py-1.5 text-sm"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">
          <span className="block text-emerald-300 uppercase tracking-wider mb-1">Mood</span>
          <input
            type="text"
            value={moodNote}
            onChange={(e) => setMoodNote(e.target.value)}
            className="w-full bg-black/30 border border-emerald-700/40 rounded px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs">
          <span className="block text-emerald-300 uppercase tracking-wider mb-1">Physical</span>
          <input
            type="text"
            value={physicalNote}
            onChange={(e) => setPhysicalNote(e.target.value)}
            className="w-full bg-black/30 border border-emerald-700/40 rounded px-2 py-1.5 text-sm"
          />
        </label>
      </div>
      <label className="text-xs block">
        <span className="block text-emerald-300 uppercase tracking-wider mb-1">Unusual contacts / visitors</span>
        <input
          type="text"
          value={unusualContactsNote}
          onChange={(e) => setUnusualContactsNote(e.target.value)}
          placeholder='e.g. "Cecilia came by twice this week with paperwork"'
          className="w-full bg-black/30 border border-emerald-700/40 rounded px-2 py-1.5 text-sm"
        />
      </label>
      <label className="text-xs block">
        <span className="block text-red-300 uppercase tracking-wider mb-1">Concerns</span>
        <textarea
          value={concerns}
          onChange={(e) => setConcerns(e.target.value)}
          rows={2}
          className="w-full bg-black/30 border border-red-700/40 rounded px-2 py-1.5 text-sm"
        />
      </label>
      <label className="text-xs block">
        <span className="block text-emerald-300 uppercase tracking-wider mb-1">Positive observations</span>
        <textarea
          value={positiveObservations}
          onChange={(e) => setPositiveObservations(e.target.value)}
          rows={2}
          className="w-full bg-black/30 border border-emerald-700/40 rounded px-2 py-1.5 text-sm"
        />
      </label>
      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="text-xs uppercase tracking-wider px-3 py-1.5 rounded-md bg-emerald-700 text-white disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Log check-in'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs uppercase tracking-wider px-3 py-1.5 rounded-md border border-emerald-700/40 text-emerald-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
