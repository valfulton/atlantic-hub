'use client';

import { useCallback, useEffect, useState } from 'react';

interface PromptListItem {
  key: string;
  label: string;
  description: string;
  isOverridden: boolean;
  updatedAt: string | null;
}

interface EffectivePrompt {
  key: string;
  label: string;
  description: string;
  userPromptNote: string;
  defaultSystem: string;
  override: string | null;
  isOverridden: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

export function PromptEditor() {
  const [list, setList] = useState<PromptListItem[]>([]);
  const [activeKey, setActiveKey] = useState<string>('');
  const [prompt, setPrompt] = useState<EffectivePrompt | null>(null);
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Load the list once.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/av/prompts', { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Could not load prompts.');
        setList(data.prompts ?? []);
        if ((data.prompts ?? []).length) setActiveKey(data.prompts[0].key);
      } catch (err) {
        setMsg({ ok: false, text: (err as Error).message });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadPrompt = useCallback(async (key: string) => {
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/av/prompts?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not load this prompt.');
      const p: EffectivePrompt = data.prompt;
      setPrompt(p);
      setText(p.override ?? p.defaultSystem);
      setDirty(false);
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    if (activeKey) loadPrompt(activeKey);
  }, [activeKey, loadPrompt]);

  const refreshListFlag = (key: string, overridden: boolean) =>
    setList((l) => l.map((it) => (it.key === key ? { ...it, isOverridden: overridden } : it)));

  const save = async () => {
    if (!prompt) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/av/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: prompt.key, systemText: text })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || 'Save failed.');
      const p: EffectivePrompt = data.prompt;
      setPrompt(p);
      setText(p.override ?? p.defaultSystem);
      setDirty(false);
      refreshListFlag(p.key, p.isOverridden);
      setMsg({ ok: true, text: p.isOverridden ? 'Saved — this prompt now runs your version.' : 'Matched the default, so it runs the built-in prompt.' });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = async () => {
    if (!prompt) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/av/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: prompt.key, action: 'reset' })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || 'Reset failed.');
      const p: EffectivePrompt = data.prompt;
      setPrompt(p);
      setText(p.defaultSystem);
      setDirty(false);
      refreshListFlag(p.key, false);
      setMsg({ ok: true, text: 'Reset to the built-in default.' });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-sm text-white/40">Loading prompts…</div>;
  if (!list.length) return <div className="text-sm text-white/40">No editable prompts registered yet.</div>;

  const onDefault = !!prompt && text.trim() === prompt.defaultSystem.trim();

  return (
    <div className="space-y-5">
      {/* Prompt picker */}
      <div className="flex flex-wrap gap-2">
        {list.map((p) => {
          const on = p.key === activeKey;
          return (
            <button
              key={p.key}
              onClick={() => setActiveKey(p.key)}
              className={
                'rounded-full px-3 py-1 text-xs border transition ' +
                (on
                  ? 'bg-amber-400/20 border-amber-400/60 text-amber-200'
                  : 'bg-white/5 border-white/10 text-white/60 hover:text-white/90')
              }
            >
              {p.label}
              {p.isOverridden && <span className="ml-1 text-amber-300/80" title="customized">●</span>}
            </button>
          );
        })}
      </div>

      {prompt && (
        <>
          <div className="rounded-md border border-white/10 bg-black/20 p-3">
            <div className="text-sm font-medium text-white/90">{prompt.label}</div>
            <div className="text-xs text-white/55 mt-1">{prompt.description}</div>
            <div className="text-[11px] text-white/40 mt-2 italic">{prompt.userPromptNote}</div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs uppercase tracking-wide text-white/50">System prompt (editable)</span>
              <span
                className={
                  'text-[11px] rounded-full px-2 py-0.5 border ' +
                  (onDefault
                    ? 'border-white/15 text-white/40'
                    : 'border-amber-400/40 text-amber-300 bg-amber-400/10')
                }
              >
                {onDefault ? 'on default' : 'customized'}
              </span>
            </div>
            <textarea
              className="w-full rounded-md bg-black/30 border border-white/10 px-3 py-2 text-[13px] leading-relaxed text-white/90 placeholder-white/30 focus:outline-none focus:border-amber-400/50 font-mono"
              rows={18}
              value={text}
              onChange={(e) => { setText(e.target.value); setDirty(true); setMsg(null); }}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving || !dirty}
              className={
                'rounded-md px-4 py-2 text-sm font-medium transition ' +
                (saving || !dirty
                  ? 'bg-white/10 text-white/40 cursor-not-allowed'
                  : 'bg-amber-400/90 text-black hover:bg-amber-300')
              }
            >
              {saving ? 'Saving…' : 'Save prompt'}
            </button>
            <button
              onClick={resetToDefault}
              disabled={saving || !prompt.isOverridden}
              className={
                'rounded-md px-3 py-2 text-xs border transition ' +
                (saving || !prompt.isOverridden
                  ? 'border-white/10 text-white/30 cursor-not-allowed'
                  : 'border-white/20 text-white/70 hover:text-white hover:border-white/40')
              }
            >
              Reset to default
            </button>
            {msg && <span className={'text-xs ' + (msg.ok ? 'text-emerald-300' : 'text-rose-300')}>{msg.text}</span>}
          </div>

          {/* Reference: the built-in default, read-only, for comparison. */}
          <details className="rounded-md border border-white/10 bg-black/20">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs text-white/60">
              View the built-in default (read-only)
            </summary>
            <pre className="px-3 pb-3 text-[11px] leading-relaxed text-white/60 whitespace-pre-wrap break-words font-mono">
              {prompt.defaultSystem}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}
