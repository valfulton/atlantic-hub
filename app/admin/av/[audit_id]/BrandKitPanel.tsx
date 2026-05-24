'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtDateTime } from '@/lib/format/datetime';

/**
 * BrandKitPanel
 *
 * Sub-card on the Commercials tab. Lets the operator upload a logo
 * once per lead, then every commercial composites it into the chosen
 * corner on download / preview. Removes the "I'll add the logo in
 * Canva later" step.
 *
 * Phase 1: images. Video composite ships in Phase 2.
 *
 * Owner + staff only.
 */

type LogoPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

interface BrandKit {
  id: number;
  leadId: number;
  hasLogo: boolean;
  logoMimeType: string | null;
  logoFilename: string | null;
  logoWidth: number | null;
  logoHeight: number | null;
  logoDataUrl?: string;
  defaultPosition: LogoPosition;
  defaultOpacity: number;
  defaultScale: number;
  defaultPadding: number;
  autoApply: boolean;
  createdAt: string;
  updatedAt: string;
}

interface LibraryItem {
  id: number;
  displayName: string;
  tenantHint: string | null;
  logoMimeType: string;
  logoFilename: string | null;
  logoDataUrl: string;
  defaultPosition: LogoPosition;
  defaultOpacity: number;
  defaultScale: number;
  defaultPadding: number;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

const POSITION_OPTIONS: { value: LogoPosition; label: string }[] = [
  { value: 'top-left', label: 'Top-left' },
  { value: 'top-right', label: 'Top-right' },
  { value: 'bottom-left', label: 'Bottom-left' },
  { value: 'bottom-right', label: 'Bottom-right' }
];

// Shared input class so text shows on light + dark themes alike.
const INPUT_CLASS =
  'w-full border border-border rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder:text-slate-400';

export function BrandKitPanel({
  auditId,
  onKitChange
}: {
  auditId: string;
  onKitChange?: (kit: BrandKit | null) => void;
}) {
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reusable logo library across all leads. Sorted most-recently-used
  // first so the brand the operator uses constantly is at the front.
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [applyingLibraryId, setApplyingLibraryId] = useState<number | null>(null);
  // When uploading, optionally also save the file to the library for re-use.
  const [alsoSaveToLibrary, setAlsoSaveToLibrary] = useState(true);
  const [newLibraryName, setNewLibraryName] = useState('');

  const fetchKit = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/av/leads/${auditId}/brand-kit`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { kit: BrandKit | null };
      setKit(j.kit);
      onKitChange?.(j.kit);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [auditId, onKitChange]);

  useEffect(() => {
    void fetchKit();
  }, [fetchKit]);

  const fetchLibrary = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/brand-kit/library?limit=24`);
      if (!res.ok) {
        setLibrary([]);
        return;
      }
      const j = (await res.json()) as { items: LibraryItem[] };
      setLibrary(j.items ?? []);
    } catch {
      setLibrary([]);
    } finally {
      setLibraryLoaded(true);
    }
  }, []);

  useEffect(() => {
    void fetchLibrary();
  }, [fetchLibrary]);

  async function applyLibraryItem(itemId: number) {
    setApplyingLibraryId(itemId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/av/leads/${auditId}/brand-kit/apply-library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ libraryItemId: itemId })
      });
      const j = (await res.json()) as { ok?: boolean; kit?: BrandKit; error?: string };
      if (!res.ok || !j.ok || !j.kit) throw new Error(j.error || `HTTP ${res.status}`);
      setKit(j.kit);
      onKitChange?.(j.kit);
      // Refresh library so the just-used item floats to the top next time.
      void fetchLibrary();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApplyingLibraryId(null);
    }
  }

  async function uploadToLibrary(file: File, displayName: string) {
    const form = new FormData();
    form.append('logo', file);
    form.append('displayName', displayName);
    const res = await fetch(`/api/admin/brand-kit/library`, { method: 'POST', body: form });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error || `HTTP ${res.status}`);
    }
  }

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('logo', file);
      const res = await fetch(`/api/admin/av/leads/${auditId}/brand-kit`, {
        method: 'POST',
        body: form
      });
      const j = (await res.json()) as { ok?: boolean; kit?: BrandKit; error?: string };
      if (!res.ok || !j.ok || !j.kit) throw new Error(j.error || `HTTP ${res.status}`);
      setKit(j.kit);
      setExpanded(true);
      onKitChange?.(j.kit);

      // Optionally mirror the just-uploaded logo into the reusable library.
      if (alsoSaveToLibrary) {
        try {
          const displayName = (newLibraryName.trim() || file.name.replace(/\.[^.]+$/, '') || 'Untitled logo').slice(0, 255);
          await uploadToLibrary(file, displayName);
          setNewLibraryName('');
          void fetchLibrary();
        } catch (libErr) {
          // Non-fatal -- the lead's kit succeeded.
          console.error('library save failed:', (libErr as Error).message);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function saveSettings(patch: Partial<{
    defaultPosition: LogoPosition;
    defaultOpacity: number;
    defaultScale: number;
    defaultPadding: number;
    autoApply: boolean;
  }>) {
    setSavingSettings(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/av/leads/${auditId}/brand-kit`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      const j = (await res.json()) as { ok?: boolean; kit?: BrandKit; error?: string };
      if (!res.ok || !j.ok || !j.kit) throw new Error(j.error || `HTTP ${res.status}`);
      setKit(j.kit);
      onKitChange?.(j.kit);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function removeLogo() {
    if (!confirm('Remove this logo? You can re-upload anytime.')) return;
    setError(null);
    try {
      const res = await fetch(`/api/admin/av/leads/${auditId}/brand-kit`, { method: 'DELETE' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      await fetchKit();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!loaded) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
        Loading brand kit...
      </div>
    );
  }

  return (
    <div className="relative bg-surface border border-border rounded-2xl p-5 overflow-hidden">
      <div className="pointer-events-none absolute -top-16 -right-16 w-48 h-48 rounded-full opacity-20 blur-3xl"
           style={{ background: 'linear-gradient(135deg, #56B870, #FFC73D)' }} />

      <div className="relative flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink flex items-center gap-2">
            <span aria-hidden>🎨</span> Brand Kit
          </h3>
          <p className="text-xs text-muted mt-0.5 max-w-xl leading-relaxed">
            Upload the client&apos;s logo once. Every commercial generated from here on automatically
            composites it into the corner you pick. No more dragging into Canva.
          </p>
        </div>
        {kit?.hasLogo && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-xs px-3 py-1 rounded-full border border-border text-muted hover:text-ink hover:border-pink-400"
          >
            {expanded ? 'Hide settings' : 'Settings'}
          </button>
        )}
      </div>

      {error && (
        <div className="relative mt-3 rounded-md border border-red-400/40 bg-red-500/10 p-2.5 text-xs text-red-100 whitespace-pre-wrap">
          {error}
        </div>
      )}

      {/* Logo library -- reusable across every lead. Most-recently-used first. */}
      {libraryLoaded && library.length > 0 && (
        <div className="relative mt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted flex items-center gap-2">
              <span aria-hidden>📚</span> Logos you&apos;ve used before
              <span className="text-[10px] normal-case tracking-normal text-muted/70">
                · one click to apply
              </span>
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {library.map((item) => {
              const isCurrent = kit?.hasLogo && kit.logoDataUrl === item.logoDataUrl;
              const isApplying = applyingLibraryId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void applyLibraryItem(item.id)}
                  disabled={isApplying || isCurrent}
                  className={`shrink-0 w-24 rounded-xl border-2 p-2 text-center transition-all ${
                    isCurrent
                      ? 'border-emerald-400/60 bg-emerald-500/10'
                      : 'border-border bg-bg/40 hover:border-pink-400 hover:-translate-y-0.5'
                  } disabled:opacity-60 disabled:cursor-not-allowed`}
                  title={item.displayName + (isCurrent ? ' (currently applied)' : '')}
                >
                  <div className="aspect-square rounded-md bg-white/5 flex items-center justify-center overflow-hidden mb-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.logoDataUrl}
                      alt={item.displayName}
                      className="max-w-full max-h-full object-contain p-1"
                    />
                  </div>
                  <div className="text-[10.5px] text-ink leading-tight truncate font-medium">
                    {item.displayName}
                  </div>
                  <div className="text-[9px] text-muted/80 mt-0.5">
                    {isApplying ? 'Applying...' : isCurrent ? '✓ in use' : `used ${item.useCount}×`}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Upload area / current logo */}
      <div className="relative mt-4 grid grid-cols-1 md:grid-cols-[160px_1fr] gap-4 items-center">
        <div
          className="aspect-square rounded-xl border-2 border-dashed border-border bg-bg/40 flex items-center justify-center overflow-hidden cursor-pointer hover:border-pink-400 transition-colors relative"
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          {kit?.hasLogo && kit.logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={kit.logoDataUrl}
              alt={kit.logoFilename || 'Logo'}
              className="max-w-full max-h-full object-contain p-2"
            />
          ) : (
            <div className="text-center p-2">
              <div className="text-3xl mb-1" aria-hidden>📤</div>
              <p className="text-[11px] text-muted leading-tight">Click to upload logo</p>
              <p className="text-[10px] text-muted/70 mt-1">PNG, JPEG, WebP, or SVG. Max 2 MB.</p>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleUpload(file);
              e.target.value = ''; // allow re-uploading the same file
            }}
          />
        </div>

        <div className="space-y-1.5 text-xs">
          {kit?.hasLogo ? (
            <>
              <div className="text-ink font-medium">
                {kit.logoFilename || 'logo'}
              </div>
              <div className="text-muted">
                {kit.logoMimeType} · {kit.logoWidth || '?'}×{kit.logoHeight || '?'} px
              </div>
              <div className="text-[11px] text-muted">
                Updated {fmtDateTime(kit.updatedAt)}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="px-3 py-1 rounded-full border border-border text-xs hover:border-pink-400 text-ink"
                >
                  {uploading ? 'Uploading...' : 'Replace logo'}
                </button>
                <button
                  type="button"
                  onClick={removeLogo}
                  className="px-3 py-1 rounded-full border border-border text-xs text-muted hover:text-red-400 hover:border-red-400/60"
                >
                  Remove
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-muted leading-relaxed">
                No logo on file. Drop the client&apos;s logo (transparent PNG is best) into the square on the left.
                Once it&apos;s here, every new image commercial gets it composited automatically.
              </p>
              <div className="rounded-lg border border-border bg-bg/40 p-2.5 mt-2">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={alsoSaveToLibrary}
                    onChange={(e) => setAlsoSaveToLibrary(e.target.checked)}
                    className="w-3.5 h-3.5"
                  />
                  <span className="text-[12px] text-ink">Also save this logo to my library for re-use</span>
                </label>
                {alsoSaveToLibrary && (
                  <input
                    type="text"
                    value={newLibraryName}
                    onChange={(e) => setNewLibraryName(e.target.value)}
                    placeholder="Friendly name (e.g. Atlantic & Vine wordmark)"
                    maxLength={120}
                    className="mt-2 w-full text-[12px] px-2 py-1.5 rounded border border-border bg-white text-slate-900 placeholder:text-slate-400"
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Settings (collapsed by default once a logo exists) */}
      {kit?.hasLogo && expanded && (
        <div className="relative mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] uppercase tracking-[0.12em] text-muted mb-1.5">
              Corner
            </label>
            <select
              value={kit.defaultPosition}
              onChange={(e) => void saveSettings({ defaultPosition: e.target.value as LogoPosition })}
              className={INPUT_CLASS}
              disabled={savingSettings}
            >
              {POSITION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-[0.12em] text-muted mb-1.5">
              Scale ({Math.round(kit.defaultScale * 100)}% of width)
            </label>
            <input
              type="range"
              min={2}
              max={60}
              step={1}
              value={Math.round(kit.defaultScale * 100)}
              onChange={(e) => void saveSettings({ defaultScale: Number(e.target.value) / 100 })}
              disabled={savingSettings}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-[0.12em] text-muted mb-1.5">
              Opacity ({Math.round(kit.defaultOpacity * 100)}%)
            </label>
            <input
              type="range"
              min={20}
              max={100}
              step={5}
              value={Math.round(kit.defaultOpacity * 100)}
              onChange={(e) => void saveSettings({ defaultOpacity: Number(e.target.value) / 100 })}
              disabled={savingSettings}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-[0.12em] text-muted mb-1.5">
              Padding ({kit.defaultPadding}px from edge)
            </label>
            <input
              type="range"
              min={0}
              max={120}
              step={4}
              value={kit.defaultPadding}
              onChange={(e) => void saveSettings({ defaultPadding: Number(e.target.value) })}
              disabled={savingSettings}
              className="w-full"
            />
          </div>

          <div className="md:col-span-2 flex items-center gap-3 pt-1">
            <label className="inline-flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={kit.autoApply}
                onChange={(e) => void saveSettings({ autoApply: e.target.checked })}
                disabled={savingSettings}
                className="w-4 h-4"
              />
              Auto-apply on every new commercial
            </label>
            {savingSettings && <span className="text-xs text-muted">Saving...</span>}
          </div>
        </div>
      )}
    </div>
  );
}
