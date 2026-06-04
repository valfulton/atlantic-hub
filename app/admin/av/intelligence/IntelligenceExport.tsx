'use client';
/**
 * IntelligenceExport  (#321)
 *
 * Client-side CSV export of the trifecta chain. No API round-trip: the page
 * already loaded the numbers, so we serialize them in the browser and hand
 * back a download. Keeps the export honest — it's exactly what's on screen.
 */
import type { IntelligenceTrifecta } from '@/lib/av/intelligence_metrics';

function toCsv(t: IntelligenceTrifecta): string {
  const rows: (string | number)[][] = [
    ['Section', 'Metric', 'Value'],
    ['Scope', 'Client', t.clientName ?? 'All clients'],
    ['Scope', 'Window (days)', t.sinceDays],
    ['Scope', 'Generated', t.generatedAt],
    ['Intelligence Created', 'Narrative lines', t.created.narrativeLines],
    ['Intelligence Created', 'Authority topics', t.created.authorityTopics],
    ['Intelligence Created', 'PR opportunities', t.created.prOpportunities],
    ['Intelligence Created', 'ICP / positioning patterns', t.created.icpPatterns],
    ['Intelligence Created', 'Conversion insights', t.created.conversionInsights],
    ['Intelligence Created', 'TOTAL', t.created.total],
    ['Intelligence Created', 'Trend vs prior window (%)', t.created.trendVsPrior],
    ['Intelligence Activated', 'In PR', t.activated.activatedInPR],
    ['Intelligence Activated', 'In outreach', t.activated.activatedInOutreach],
    ['Intelligence Activated', 'In commercials', t.activated.activatedInCommercials],
    ['Intelligence Activated', 'In social', t.activated.activatedInSocial],
    ['Intelligence Activated', 'In sales calls', t.activated.activatedInSalesCalls],
    ['Intelligence Activated', 'TOTAL', t.activated.totalActivated],
    ['Intelligence Activated', 'Activation rate (%)', Math.round(t.activated.activationRate * 100)],
    ['Revenue Influenced', 'Meetings booked', t.revenue.meetingsBooked],
    ['Revenue Influenced', 'Proposals sent', t.revenue.proposalsSent],
    ['Revenue Influenced', 'Opportunities created', t.revenue.opportunitiesCreated],
    ['Revenue Influenced', 'Deals won', t.revenue.dealsClosedWon],
    ['Revenue Influenced', 'Deals lost', t.revenue.dealsClosedLost],
    ['Revenue Influenced', 'Dollar value won ($)', t.revenue.dollarValueClosed]
  ];
  return rows
    .map((r) => r.map((c) => {
      const s = String(c);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
    .join('\n');
}

export function IntelligenceExport({ trifecta }: { trifecta: IntelligenceTrifecta }) {
  function download() {
    const blob = new Blob([toCsv(trifecta)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const scope = (trifecta.clientName ?? 'all-clients').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    a.href = url;
    a.download = `intelligence-chain_${scope}_${trifecta.sinceDays}d.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  return (
    <button
      type="button"
      onClick={download}
      className="text-[12px] rounded-md border border-border bg-surface px-3 py-1.5 text-ink hover:border-[#EBCB6B]/35 hover:text-[#EBCB6B] transition"
    >
      ↓ Export CSV
    </button>
  );
}
