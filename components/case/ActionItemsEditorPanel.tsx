'use client';

/**
 * ActionItemsEditorPanel  (val 2026-06-14, #632)
 *
 * Operator-only editor for case_action_items. Replaces the SQL workflow val
 * was using to rewrite Options A–E on the Johnson trust matter.
 *
 * Mounts inside the existing dark "Action items" section on
 * /admin/av/clients/[clientId]/cases/[caseId]/page.tsx — the section header
 * + count stay where they are; this panel renders inside.
 *
 * Capabilities:
 *   - Inline edit (title, detail, status, priority, visibility, due_date)
 *   - Add new action item at top via inline form
 *   - Delete with confirm
 *   - Visibility toggle: parents_safe vs operator_only (#635 visibility filter)
 *
 * Server data comes from loadFullCase().actionItems; refresh strategy is
 * router.refresh() after each mutation so the Server Component re-runs.
 */

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { CaseActionItem } from '@/lib/case/case_store';

// (val 2026-06-15, #693) Duplicate detection lives at module scope so it's
// pure + testable. Three tiers caught:
//   1. EXACT — identical normalized titles (case/punct/whitespace insensitive)
//   2. NEAR  — one normalized title is a substring of the other, OR they
//              share an identical normalized first-80-chars of detail body
//   3. FUZZY — Jaccard token overlap ≥ 0.65 on title tokens (stopwords
//              stripped); catches "Request beneficiary statements" vs
//              "Get beneficiary statements from trustee"
// Items can belong to ONE group only — first-detected wins. Each group is
// shown with a colored ring + chip so val can compare side-by-side.

const DUPE_STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'and', 'or', 'for', 'with', 'in', 'on',
  'at', 'is', 'are', 'be', 'by', 'from', 'as', 'that', 'this', 'it',
  'all', 'any', 'each', 'every', 'any'
]);

function normalizeForDupe(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleTokens(s: string | null | undefined): Set<string> {
  const norm = normalizeForDupe(s);
  if (!norm) return new Set();
  return new Set(
    norm
      .split(' ')
      .filter((w) => w.length > 2 && !DUPE_STOPWORDS.has(w))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const x of a) if (b.has(x)) intersect++;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

interface DupeGroup {
  groupId: number;
  reason: 'exact' | 'near' | 'fuzzy';
  memberIds: number[];
}

function findDuplicates(items: CaseActionItem[]): {
  groups: DupeGroup[];
  groupByActionId: Map<number, DupeGroup>;
} {
  const groups: DupeGroup[] = [];
  const groupByActionId = new Map<number, DupeGroup>();
  const tokenCache = new Map<number, Set<string>>();
  const normTitleCache = new Map<number, string>();
  const normDetailHeadCache = new Map<number, string>();

  for (const a of items) {
    tokenCache.set(a.actionId, titleTokens(a.title));
    normTitleCache.set(a.actionId, normalizeForDupe(a.title));
    normDetailHeadCache.set(a.actionId, normalizeForDupe(a.detail || '').slice(0, 80));
  }

  let nextGroupId = 1;

  function joinOrCreate(reason: DupeGroup['reason'], a: number, b: number) {
    const existingA = groupByActionId.get(a);
    const existingB = groupByActionId.get(b);
    if (existingA && existingB) {
      if (existingA === existingB) return;
      // Merge — keep A's group, fold B's members in.
      for (const id of existingB.memberIds) {
        if (!existingA.memberIds.includes(id)) existingA.memberIds.push(id);
        groupByActionId.set(id, existingA);
      }
      // Drop the absorbed group.
      const idx = groups.indexOf(existingB);
      if (idx >= 0) groups.splice(idx, 1);
      return;
    }
    if (existingA) {
      if (!existingA.memberIds.includes(b)) existingA.memberIds.push(b);
      groupByActionId.set(b, existingA);
      // Upgrade severity if this new pair is more severe.
      if (reason === 'exact' || (reason === 'near' && existingA.reason === 'fuzzy')) {
        existingA.reason = reason;
      }
      return;
    }
    if (existingB) {
      if (!existingB.memberIds.includes(a)) existingB.memberIds.push(a);
      groupByActionId.set(a, existingB);
      if (reason === 'exact' || (reason === 'near' && existingB.reason === 'fuzzy')) {
        existingB.reason = reason;
      }
      return;
    }
    const g: DupeGroup = { groupId: nextGroupId++, reason, memberIds: [a, b] };
    groups.push(g);
    groupByActionId.set(a, g);
    groupByActionId.set(b, g);
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const tA = normTitleCache.get(a.actionId) || '';
      const tB = normTitleCache.get(b.actionId) || '';
      if (!tA || !tB) continue;

      // Tier 1: exact normalized title match.
      if (tA === tB) {
        joinOrCreate('exact', a.actionId, b.actionId);
        continue;
      }

      // Tier 2: substring containment (one fully contains the other), OR
      // identical normalized first-80 of detail body when both non-empty.
      const dA = normDetailHeadCache.get(a.actionId) || '';
      const dB = normDetailHeadCache.get(b.actionId) || '';
      if (
        (tA.length >= 8 && tB.length >= 8 && (tA.includes(tB) || tB.includes(tA))) ||
        (dA.length >= 20 && dA === dB)
      ) {
        joinOrCreate('near', a.actionId, b.actionId);
        continue;
      }

      // Tier 3: fuzzy Jaccard on title tokens.
      const tokA = tokenCache.get(a.actionId) || new Set();
      const tokB = tokenCache.get(b.actionId) || new Set();
      if (tokA.size >= 2 && tokB.size >= 2 && jaccard(tokA, tokB) >= 0.65) {
        joinOrCreate('fuzzy', a.actionId, b.actionId);
      }
    }
  }

  return { groups, groupByActionId };
}

// Cycle colors for visual group identification on the cream-on-dark editor.
const DUPE_GROUP_COLORS = [
  { ring: '#E0A93C', label: 'amber',   bg: 'rgba(224,169,60,0.10)' },
  { ring: '#7AA6D8', label: 'sky',     bg: 'rgba(122,166,216,0.10)' },
  { ring: '#C97B8A', label: 'rose',    bg: 'rgba(201,123,138,0.10)' },
  { ring: '#7DB89C', label: 'mint',    bg: 'rgba(125,184,156,0.10)' },
  { ring: '#B89AD8', label: 'lilac',   bg: 'rgba(184,154,216,0.10)' },
  { ring: '#D8A87A', label: 'peach',   bg: 'rgba(216,168,122,0.10)' }
];

interface Props {
  caseId: number;
  initialItems: CaseActionItem[];
}

type Priority = 'low' | 'normal' | 'high' | 'urgent';
type Status = 'open' | 'in_progress' | 'done' | 'blocked';
// (val 2026-06-15, #685) legal_team = Rebecca + Adriana + val. Hidden from parents.
type Visibility = 'parents_safe' | 'operator_only' | 'legal_team';
// (val 2026-06-15, #694 + #696) Family bucket — which group on the family case view.
// Schema 099 (initial 3) + 100 (add family_action). Must stay in sync with
// ActionFamilyBucket in lib/case/case_store.ts.
type FamilyBucket = 'reviewer_handling' | 'family_decision' | 'family_action' | 'info_only';

const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'urgent'];
const STATUSES: Status[] = ['open', 'in_progress', 'done', 'blocked'];

interface DraftItem {
  title: string;
  detail: string;
  priority: Priority;
  status: Status;
  visibility: Visibility;
  dueDate: string;
  // (val 2026-06-15, #694) Family-view fields.
  familyNextStep: string;
  familyBucket: FamilyBucket;
}

function emptyDraft(): DraftItem {
  return {
    title: '',
    detail: '',
    priority: 'normal',
    status: 'open',
    visibility: 'parents_safe',
    dueDate: '',
    familyNextStep: '',
    familyBucket: 'reviewer_handling'
  };
}

function toDraft(a: CaseActionItem): DraftItem {
  return {
    title: a.title,
    detail: a.detail || '',
    priority: (a.priority as Priority) || 'normal',
    status: (a.status as Status) || 'open',
    visibility: a.visibility || 'parents_safe',
    dueDate: a.dueDate ? a.dueDate.slice(0, 10) : '',
    familyNextStep: a.familyNextStep || '',
    familyBucket: (a.familyBucket as FamilyBucket) || 'reviewer_handling'
  };
}

export default function ActionItemsEditorPanel({ caseId, initialItems }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftItem>(emptyDraft());
  const [addingNew, setAddingNew] = useState(false);
  const [newDraft, setNewDraft] = useState<DraftItem>(emptyDraft());
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // (val 2026-06-15, #687) Collapsible items — default state is collapsed
  // so val can scan 27 items + spot redundancy fast. Click a row header to
  // toggle. Detail body + Edit affordance hide when collapsed; title +
  // priority + visibility + status + due-date stay visible (no info loss).
  // Expand-all / Collapse-all buttons at the top for bulk control.
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const allExpanded = expandedIds.size === initialItems.length && initialItems.length > 0;

  // (val 2026-06-15, #693) Find duplicates toggle. When ON we run the
  // three-tier dupe finder, color-ring the matched rows, and auto-expand
  // them so val can compare titles + detail bodies without clicking.
  const [showDupes, setShowDupes] = useState(false);
  const dupeAnalysis = useMemo(() => findDuplicates(initialItems), [initialItems]);
  const groupColorByGroupId = useMemo(() => {
    const map = new Map<number, typeof DUPE_GROUP_COLORS[number]>();
    dupeAnalysis.groups.forEach((g, i) => {
      map.set(g.groupId, DUPE_GROUP_COLORS[i % DUPE_GROUP_COLORS.length]);
    });
    return map;
  }, [dupeAnalysis]);

  function toggleFindDupes() {
    const next = !showDupes;
    setShowDupes(next);
    if (next) {
      // Auto-expand every dupe member so val can compare side-by-side.
      setExpandedIds((prev) => {
        const out = new Set(prev);
        for (const g of dupeAnalysis.groups) {
          for (const id of g.memberIds) out.add(id);
        }
        return out;
      });
    }
  }

  function toggleExpand(actionId: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(actionId)) next.delete(actionId);
      else next.add(actionId);
      return next;
    });
  }
  function expandAll() {
    setExpandedIds(new Set(initialItems.map((a) => a.actionId)));
  }
  function collapseAll() {
    setExpandedIds(new Set());
  }

  function startEdit(a: CaseActionItem) {
    setEditingId(a.actionId);
    setDraft(toDraft(a));
    setErr(null);
    // (#687) Auto-expand when entering edit — the form needs the room.
    setExpandedIds((prev) => {
      if (prev.has(a.actionId)) return prev;
      const next = new Set(prev);
      next.add(a.actionId);
      return next;
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft());
    setErr(null);
  }

  async function saveEdit(actionId: number) {
    setErr(null);
    setBusyId(actionId);
    try {
      const res = await fetch(
        `/api/admin/av/cases/${caseId}/actions/${actionId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: draft.title,
            detail: draft.detail || null,
            priority: draft.priority,
            status: draft.status,
            visibility: draft.visibility,
            dueDate: draft.dueDate || null,
            // (val 2026-06-15, #694) Family-view writes.
            familyNextStep: draft.familyNextStep.trim() || null,
            familyBucket: draft.familyBucket
          })
        }
      );
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || 'save failed');
      startTransition(() => {
        setEditingId(null);
        router.refresh();
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'save failed');
    } finally {
      setBusyId(null);
    }
  }

  async function deleteItem(actionId: number, title: string) {
    if (!confirm(`Delete "${title}"?\n\nThis can't be undone. Notes attached to this action item are deleted too.`)) {
      return;
    }
    setErr(null);
    setBusyId(actionId);
    try {
      const res = await fetch(
        `/api/admin/av/cases/${caseId}/actions/${actionId}`,
        { method: 'DELETE' }
      );
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || 'delete failed');
      startTransition(() => router.refresh());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'delete failed');
    } finally {
      setBusyId(null);
    }
  }

  async function createNew() {
    if (!newDraft.title.trim()) {
      setErr('Title is required.');
      return;
    }
    setErr(null);
    try {
      const res = await fetch(
        `/api/admin/av/cases/${caseId}/actions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: newDraft.title.trim(),
            detail: newDraft.detail || null,
            priority: newDraft.priority,
            dueDate: newDraft.dueDate || null
          })
        }
      );
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || 'create failed');
      startTransition(() => {
        setAddingNew(false);
        setNewDraft(emptyDraft());
        router.refresh();
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'create failed');
    }
  }

  return (
    <div className="space-y-3">
      {/* Add-new toggle row + bulk-collapse controls (val 2026-06-15, #687) */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-xs text-muted">
          {initialItems.length} item{initialItems.length === 1 ? '' : 's'}
          {expandedIds.size > 0 && initialItems.length > 0 && (
            <span className="ml-2 text-[10px]">· {expandedIds.size} open</span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {/* (val 2026-06-15, #693) Find duplicates toggle. Stays out of
              the way until pressed; when active, banner appears below
              with group count + summary. */}
          {initialItems.length >= 3 && (
            <button
              type="button"
              onClick={toggleFindDupes}
              className={`text-[11px] uppercase tracking-wider px-2 py-1 rounded border transition-colors ${
                showDupes
                  ? 'border-amber-600/60 bg-amber-900/30 text-amber-200'
                  : 'border-amber-700/30 text-amber-300/80 hover:text-amber-200 hover:bg-amber-900/20'
              }`}
              title="Scan for items that say the same thing in different words"
            >
              {showDupes ? '◉ Showing duplicates' : '🔍 Find duplicates'}
            </button>
          )}
          {initialItems.length > 1 && (
            <button
              type="button"
              onClick={allExpanded ? collapseAll : expandAll}
              className="text-[11px] uppercase tracking-wider px-2 py-1 text-emerald-300 hover:text-emerald-200"
            >
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </button>
          )}
          {!addingNew && (
            <button
              type="button"
              onClick={() => { setAddingNew(true); setNewDraft(emptyDraft()); setErr(null); }}
              className="text-xs px-2 py-1 rounded border border-emerald-700/40 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-900/50 transition-colors"
            >
              + Add action item
            </button>
          )}
        </div>
      </div>

      {/* (val 2026-06-15, #693) Duplicate summary banner — only shown
          when Find duplicates is active. Reports clean / N groups, with
          breakdown by severity tier. */}
      {showDupes && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            dupeAnalysis.groups.length === 0
              ? 'border-emerald-700/40 bg-emerald-900/20 text-emerald-200'
              : 'border-amber-700/40 bg-amber-900/20 text-amber-100'
          }`}
        >
          {dupeAnalysis.groups.length === 0 ? (
            <span>✓ No duplicates found. All {initialItems.length} items look distinct.</span>
          ) : (
            <div className="space-y-1">
              <div>
                Found <strong>{dupeAnalysis.groups.length}</strong> potential duplicate{dupeAnalysis.groups.length === 1 ? '' : ' group'}s
                {' '}across{' '}
                <strong>
                  {dupeAnalysis.groups.reduce((sum, g) => sum + g.memberIds.length, 0)}
                </strong>{' '}items.
              </div>
              <div className="text-[11px] opacity-80">
                {(['exact', 'near', 'fuzzy'] as const).map((reason) => {
                  const n = dupeAnalysis.groups.filter((g) => g.reason === reason).length;
                  if (n === 0) return null;
                  const label = reason === 'exact'
                    ? 'exact title match'
                    : reason === 'near'
                    ? 'one contains the other'
                    : 'fuzzy / shared keywords';
                  return (
                    <span key={reason} className="mr-3">
                      <strong>{n}</strong> {label}
                    </span>
                  );
                })}
              </div>
              <div className="text-[10px] opacity-60 italic">
                Click any item to compare. Edit the keeper, delete the others — or merge their details into one.
              </div>
            </div>
          )}
        </div>
      )}

      {err && (
        <div className="text-xs text-red-300 bg-red-900/20 border border-red-700/40 rounded p-2">
          {err}
        </div>
      )}

      {/* New action form */}
      {addingNew && (
        <div className="border border-emerald-700/30 bg-emerald-950/20 rounded-lg p-3 space-y-2">
          <input
            type="text"
            placeholder="What needs to happen?"
            value={newDraft.title}
            onChange={(e) => setNewDraft({ ...newDraft, title: e.target.value })}
            className="w-full bg-[var(--surface-1)] border border-border rounded px-2 py-1.5 text-sm"
            autoFocus
          />
          <textarea
            placeholder="Detail (supports paragraphs)"
            value={newDraft.detail}
            onChange={(e) => setNewDraft({ ...newDraft, detail: e.target.value })}
            rows={3}
            className="w-full bg-[var(--surface-1)] border border-border rounded px-2 py-1.5 text-xs font-mono"
          />
          <div className="flex flex-wrap gap-2 text-xs">
            <label className="flex items-center gap-1 text-muted">
              Priority
              <select
                value={newDraft.priority}
                onChange={(e) => setNewDraft({ ...newDraft, priority: e.target.value as Priority })}
                className="bg-[var(--surface-1)] border border-border rounded px-1.5 py-1 text-xs"
              >
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1 text-muted">
              Due
              <input
                type="date"
                value={newDraft.dueDate}
                onChange={(e) => setNewDraft({ ...newDraft, dueDate: e.target.value })}
                className="bg-[var(--surface-1)] border border-border rounded px-1.5 py-1 text-xs"
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setAddingNew(false); setNewDraft(emptyDraft()); setErr(null); }}
              className="text-xs px-2 py-1 text-muted hover:text-white"
              disabled={isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={createNew}
              className="text-xs px-3 py-1 rounded bg-emerald-900/50 text-emerald-200 border border-emerald-700/50 hover:bg-emerald-900/70 transition-colors"
              disabled={isPending}
            >
              {isPending ? 'Saving…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* Item list */}
      {initialItems.length === 0 && !addingNew ? (
        <div className="text-sm text-muted italic">No action items yet.</div>
      ) : (
        <ul className="space-y-3 text-sm">
          {initialItems.map((a) => {
            const isEditing = editingId === a.actionId;
            const busy = busyId === a.actionId;
            // (val 2026-06-15, #693) Dupe decoration when Find is on.
            const dupeGroup = showDupes ? dupeAnalysis.groupByActionId.get(a.actionId) : undefined;
            const dupeColor = dupeGroup ? groupColorByGroupId.get(dupeGroup.groupId) : undefined;
            const dupeIndexInGroup = dupeGroup
              ? dupeGroup.memberIds.indexOf(a.actionId) + 1
              : 0;
            return (
              <li
                key={a.actionId}
                className="border-b border-border pb-2 last:border-0"
                style={dupeColor ? {
                  borderLeft: `3px solid ${dupeColor.ring}`,
                  background: dupeColor.bg,
                  paddingLeft: 10,
                  borderRadius: 6
                } : undefined}
              >
                {isEditing ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                      className="w-full bg-[var(--surface-1)] border border-border rounded px-2 py-1.5 text-sm font-medium"
                    />
                    <textarea
                      value={draft.detail}
                      onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
                      rows={6}
                      placeholder="Detail (supports paragraphs; line breaks render on family view)"
                      className="w-full bg-[var(--surface-1)] border border-border rounded px-2 py-1.5 text-xs font-mono whitespace-pre-wrap"
                    />
                    <div className="flex flex-wrap gap-2 text-xs">
                      <label className="flex items-center gap-1 text-muted">
                        Status
                        <select
                          value={draft.status}
                          onChange={(e) => setDraft({ ...draft, status: e.target.value as Status })}
                          className="bg-[var(--surface-1)] border border-border rounded px-1.5 py-1 text-xs"
                        >
                          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                      <label className="flex items-center gap-1 text-muted">
                        Priority
                        <select
                          value={draft.priority}
                          onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}
                          className="bg-[var(--surface-1)] border border-border rounded px-1.5 py-1 text-xs"
                        >
                          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </label>
                      <label className="flex items-center gap-1 text-muted">
                        Visibility
                        <select
                          value={draft.visibility}
                          onChange={(e) => setDraft({ ...draft, visibility: e.target.value as Visibility })}
                          className="bg-[var(--surface-1)] border border-border rounded px-1.5 py-1 text-xs"
                        >
                          <option value="parents_safe">Family sees it</option>
                          <option value="legal_team">Investigation (Rebecca + Adriana)</option>
                          <option value="operator_only">Operator only (val + Rebecca)</option>
                        </select>
                      </label>
                      {/* (val 2026-06-15, #694) Family bucket — which group on the
                          family case view this item lands in. Only meaningful
                          when visibility is parents_safe; we still show it for
                          legal_team so val can stage items that will become
                          parents_safe later. */}
                      <label className="flex items-center gap-1 text-muted">
                        Family bucket
                        <select
                          value={draft.familyBucket}
                          onChange={(e) => setDraft({ ...draft, familyBucket: e.target.value as FamilyBucket })}
                          className="bg-[var(--surface-1)] border border-border rounded px-1.5 py-1 text-xs"
                        >
                          <option value="family_decision">Decision for family</option>
                          <option value="family_action">Things you can do</option>
                          <option value="reviewer_handling">Adriana is handling</option>
                          <option value="info_only">Just so you know</option>
                        </select>
                      </label>
                      <label className="flex items-center gap-1 text-muted">
                        Due
                        <input
                          type="date"
                          value={draft.dueDate}
                          onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
                          className="bg-[var(--surface-1)] border border-border rounded px-1.5 py-1 text-xs"
                        />
                      </label>
                    </div>
                    {/* (val 2026-06-15, #694) "What we're doing about this" —
                        one-line plain-English status the family sees ABOVE
                        the legal detail. Replaces the implicit "read the
                        legal analysis to figure out what's happening" UX
                        that was overwhelming parents. Universal across
                        case_kinds — leave blank to suppress the green
                        highlight box on the family card. */}
                    <textarea
                      value={draft.familyNextStep}
                      onChange={(e) => setDraft({ ...draft, familyNextStep: e.target.value })}
                      rows={2}
                      placeholder="What we're doing about this — plain English for the family. e.g. Adriana is preparing a 17200 petition to ask the court to remove Cecilia as Trustee."
                      maxLength={500}
                      className="w-full bg-[var(--surface-1)] border border-emerald-700/30 rounded px-2 py-1.5 text-xs italic"
                    />
                    <div className="flex justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => deleteItem(a.actionId, a.title)}
                        className="text-[11px] uppercase tracking-wider px-2 py-1 text-red-400 hover:text-red-300"
                        disabled={busy || isPending}
                      >
                        Delete
                      </button>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="text-xs px-2 py-1 text-muted hover:text-white"
                          disabled={busy || isPending}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => saveEdit(a.actionId)}
                          className="text-xs px-3 py-1 rounded bg-emerald-900/50 text-emerald-200 border border-emerald-700/50 hover:bg-emerald-900/70 transition-colors"
                          disabled={busy || isPending}
                        >
                          {busy || isPending ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* (val 2026-06-15, #687) Collapsible read-view. Title row is
                      clickable to toggle. Title + priority + visibility +
                      status + due chips always visible (so collapsing doesn't
                      lose scanning info). Detail body + Edit/Delete only
                      render when expanded — 27-item lists become scannable. */
                  <div className="group">
                    <button
                      type="button"
                      onClick={() => toggleExpand(a.actionId)}
                      aria-expanded={expandedIds.has(a.actionId)}
                      className="w-full text-left flex items-start justify-between gap-2 mb-1 hover:bg-emerald-900/10 rounded -mx-1 px-1 py-0.5 transition-colors"
                    >
                      <div className="flex items-start gap-1.5 flex-1 min-w-0">
                        <span
                          className="text-[10px] text-muted mt-1 transition-transform inline-block"
                          style={{ transform: expandedIds.has(a.actionId) ? 'rotate(90deg)' : 'rotate(0deg)' }}
                          aria-hidden="true"
                        >
                          ▸
                        </span>
                        <div className="flex-1 font-medium">
                          {a.title}
                          {dupeGroup && dupeColor && (
                            <span
                              className="ml-2 inline-flex items-center text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold"
                              style={{
                                background: dupeColor.bg,
                                color: dupeColor.ring,
                                border: `1px solid ${dupeColor.ring}`
                              }}
                              title={`${dupeGroup.reason === 'exact' ? 'Exact title match' : dupeGroup.reason === 'near' ? 'One contains the other' : 'Fuzzy / shared keywords'} — ${dupeGroup.memberIds.length} items in this group`}
                            >
                              Dupe #{dupeGroup.groupId} ({dupeIndexInGroup}/{dupeGroup.memberIds.length})
                            </span>
                          )}
                        </div>
                      </div>
                      <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${priorityPill(a.priority)}`}>
                        {a.priority}
                      </span>
                    </button>
                    {/* Compact meta strip — visibility + status + due, always shown */}
                    <div className="text-xs text-muted mt-0.5 ml-4 flex items-center gap-2 flex-wrap">
                      <span>{a.status}</span>
                      {a.dueDate && <span>· due {formatDate(a.dueDate)}</span>}
                      <span className={`text-[9px] uppercase tracking-wider px-1 py-0.5 rounded ${
                        a.visibility === 'operator_only'
                          ? 'bg-[var(--surface-3)] text-amber-300 border border-amber-700/40'
                          : a.visibility === 'legal_team'
                          ? 'bg-indigo-900/30 text-indigo-300 border border-indigo-700/40'
                          : 'bg-emerald-900/20 text-emerald-300 border border-emerald-700/30'
                      }`}>
                        {a.visibility === 'operator_only'
                          ? 'Operator only'
                          : a.visibility === 'legal_team'
                          ? 'Investigation'
                          : 'Family sees it'}
                      </span>
                      {expandedIds.has(a.actionId) && (
                        <button
                          type="button"
                          onClick={() => startEdit(a)}
                          className="ml-auto text-[10px] uppercase tracking-wider text-emerald-300 hover:text-emerald-200"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                    {/* Detail body — only when expanded */}
                    {expandedIds.has(a.actionId) && a.detail && (
                      <div className="text-xs text-muted whitespace-pre-wrap mt-2 ml-4">{a.detail}</div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function priorityPill(p: string): string {
  const styles: Record<string, string> = {
    urgent: 'bg-red-900/30 text-red-300 border-red-700/40',
    high: 'bg-amber-900/30 text-amber-300 border-amber-700/40',
    normal: 'bg-[var(--surface-3)] text-muted border-border',
    low: 'bg-[var(--surface-3)] text-muted border-border'
  };
  return styles[p] || styles.normal;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}
