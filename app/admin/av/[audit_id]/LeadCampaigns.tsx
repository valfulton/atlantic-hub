'use client';

/**
 * LeadCampaigns -- the lead-side campaign picker. Dip into a lead and see/choose
 * which campaigns it belongs to (the reverse of attach-by-pain on the lanes
 * board). Reads/writes the campaign_leads join.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiCall } from '@/lib/http';

interface NamedCampaign {
  id: number;
  name: string;
}

export function LeadCampaigns({ leadId }: { leadId: number }) {
  const [all, setAll] = useState<NamedCampaign[]>([]);
  const [mine, setMine] = useState<NamedCampaign[]>([]);
  const [busy, setBusy] = useState(false);

  const loadMine = useCallback(async () => {
    try {
      const j = await apiCall<{ campaigns?: NamedCampaign[] }>(`/api/admin/campaigns?leadId=${leadId}`);
      setMine(j.campaigns || []);
    } catch {
      /* ignore */
    }
  }, [leadId]);

  useEffect(() => {
    apiCall<{ campaigns?: { id: number; name: string }[] }>('/api/admin/campaigns')
      .then((j) => setAll((j.campaigns || []).map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => {});
    void loadMine();
  }, [loadMine]);

  const add = useCallback(async (campaignId: number) => {
    if (!campaignId) return;
    setBusy(true);
    try {
      try {
        await apiCall(`/api/admin/campaigns/${campaignId}/targets`, { leadIds: [leadId] });
      } catch {
        /* best-effort: the pre-apiCall code didn't surface HTTP errors here either */
      }
      await loadMine();
    } finally {
      setBusy(false);
    }
  }, [leadId, loadMine]);

  const remove = useCallback(async (campaignId: number) => {
    setBusy(true);
    try {
      try {
        await apiCall(`/api/admin/campaigns/${campaignId}/targets`, { leadId }, { method: 'DELETE' });
      } catch {
        /* best-effort: the pre-apiCall code didn't surface HTTP errors here either */
      }
      await loadMine();
    } finally {
      setBusy(false);
    }
  }, [leadId, loadMine]);

  const mineIds = new Set(mine.map((c) => c.id));
  const addable = all.filter((c) => !mineIds.has(c.id));

  return (
    <div className="bg-surface border border-border rounded-xl px-4 py-3 mb-4 flex flex-wrap items-center gap-2">
      <span className="text-[10px] uppercase tracking-[0.14em] text-muted mr-1">Campaigns</span>
      {mine.length === 0 && <span className="text-xs text-muted">Not in any campaign yet.</span>}
      {mine.map((c) => (
        <span key={c.id} className="inline-flex items-center gap-1.5 text-[12px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,156,91,0.16)', color: '#FFD9BE', border: '1px solid rgba(255,156,91,0.35)' }}>
          {c.name}
          <button type="button" onClick={() => void remove(c.id)} disabled={busy} aria-label={`Remove from ${c.name}`} className="text-[#FFD9BE] hover:text-white disabled:opacity-50">×</button>
        </span>
      ))}
      {addable.length > 0 && (
        <select
          defaultValue=""
          disabled={busy}
          onChange={(e) => { const v = Number(e.target.value); if (v > 0) void add(v); e.currentTarget.selectedIndex = 0; }}
          className="rounded-lg px-2 py-1 text-[12px] focus-visible:ring-2 focus-visible:ring-brand"
          style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}
        >
          <option value="" style={{ color: '#000' }}>+ Add to campaign…</option>
          {addable.map((c) => (
            <option key={c.id} value={c.id} style={{ color: '#000' }}>{c.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}
