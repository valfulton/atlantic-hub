/**
 * lib/public_intel/adapters/pacer_docket.ts  (#380, val 2026-06-03)
 *
 * PACER docket fetcher via CourtListener's RECAP archive — the free-public
 * mirror of federal court dockets. For bankruptcy cases (Ch 7/11/13), pulls
 * the docket entries and extracts creditor mentions from trustee filings,
 * notice-of-creditors documents, and proof-of-claim entries.
 *
 * Activates the `bankruptcy_creditor_extraction` cascade recipe — every
 * Chapter 7/11/13 in CourtListener becomes a directory of exposed creditors,
 * automatically. The collections crown jewel.
 *
 * Data source:
 *   - Lookup: GET https://www.courtlistener.com/api/rest/v4/dockets/?id=...
 *   - Entries: GET https://www.courtlistener.com/api/rest/v4/recap-documents/?docket_id=...
 *
 * Both free when the docket is already in RECAP archive. PACER per-page fees
 * only kick in if val opts to fetch live; this adapter NEVER calls PACER
 * directly — only RECAP. That's why it's safe to run on a schedule.
 *
 * Cost note: This adapter does CREDITOR-NAME EXTRACTION via text-mining
 * of docket entry text. It does NOT yet parse the Schedule of Creditors
 * PDF (Form 106). PDF parsing of bankruptcy schedules is a follow-up:
 * the structure is consistent (formatted table) but needs pdf-parse +
 * column-detection heuristics. Tracked in HANDOFF_Public_Intel_Adapters_v2.md
 * as a deepening of this adapter, not a separate adapter.
 */
import type { PublicIntelAdapter, RunContext, RunResult } from '../types';
import { storeRecord, findCachedRecord, noteRun } from '../store';

interface PacerConfig {
  /** Specific docket IDs to fetch (from CourtListener's docket id space). */
  docketIds?: number[];
  /** OR pull every recent bankruptcy docket in these states via search → docket lookup. */
  states?: string[];
  sinceDays?: number;
}

interface DocketEntry {
  entryId: number;
  filedAt: string | null;
  description: string;
  documentNumber: string | null;
}

interface DocketRecord {
  docketId: number;
  caseName: string | null;
  court: string | null;
  filedAt: string | null;
  natureOfSuit: string | null;
  chapter: string | null;
  entries: DocketEntry[];
  extractedCreditors: string[];
}

const CACHE_DAYS = 3;

function isCfg(c: unknown): c is PacerConfig {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  if (o.docketIds !== undefined && !(Array.isArray(o.docketIds) && o.docketIds.every((n) => typeof n === 'number'))) return false;
  if (o.states !== undefined && !(Array.isArray(o.states) && o.states.every((s) => typeof s === 'string'))) return false;
  return true;
}

/**
 * Naive creditor-name extraction from docket entry text. Looks for patterns
 * like "Notice of Filing of Claim by <NAME>", "Proof of Claim by <NAME>",
 * "Schedule of Creditors", "<NAME> as creditor", "filed by <NAME>".
 *
 * This is a starter pattern set. The full Schedule of Creditors PDF parse
 * (Form 106) is a follow-up — when that ships, replace this with structured
 * extraction. Until then, this catches enough of the per-entry mentions to
 * surface creditors in the watchlist.
 */
function extractCreditorMentions(entries: DocketEntry[]): string[] {
  const found = new Set<string>();
  const patterns = [
    /(?:proof of claim|claim filed)\s+(?:by|of)\s+([A-Z][A-Za-z0-9&'.\- ]{2,80}?)(?:[.,]|\s+(?:in|on|for|under)\b|$)/gi,
    /(?:notice of)\s+(?:claim|filing)\s+(?:by|from)\s+([A-Z][A-Za-z0-9&'.\- ]{2,80}?)(?:[.,]|\s+(?:in|on|for|under)\b|$)/gi,
    /filed by\s+([A-Z][A-Za-z0-9&'.\- ]{2,80}?)(?:[.,]|\s+(?:in|on|for|under)\b|$)/gi,
    /creditor[s]?:?\s+([A-Z][A-Za-z0-9&'.\- ]{2,80}?)(?:[.,]|\s+(?:in|on|for|under)\b|$)/gi
  ];
  for (const e of entries) {
    if (!e.description) continue;
    for (const re of patterns) {
      let m;
      while ((m = re.exec(e.description)) !== null) {
        const name = m[1].trim().replace(/\s+/g, ' ').replace(/[,;:]$/, '');
        if (name.length >= 3 && name.length <= 120 && !/^the\b/i.test(name)) {
          found.add(name);
        }
      }
    }
  }
  return Array.from(found).slice(0, 60);
}

async function fetchDocket(docketId: number): Promise<DocketRecord | null> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 25000);
  try {
    const token = process.env.COURTLISTENER_TOKEN;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'AtlanticHub/1.0 (research; PR@api.atlanticandvine.com)'
    };
    if (token) headers.Authorization = `Token ${token}`;

    const docRes = await fetch(`https://www.courtlistener.com/api/rest/v4/dockets/${docketId}/`, {
      signal: controller.signal,
      headers
    });
    if (!docRes.ok) return null;
    const docket = (await docRes.json()) as {
      id?: number;
      case_name?: string;
      court?: string;
      court_id?: string;
      date_filed?: string;
      nature_of_suit?: string;
      docket_number?: string;
    };

    // Pull docket entries (paginated; we take page 1 = newest ~25-50).
    const entriesRes = await fetch(
      `https://www.courtlistener.com/api/rest/v4/docket-entries/?docket=${docketId}&order_by=-date_filed&page_size=50`,
      { signal: controller.signal, headers }
    );
    const entriesJson = entriesRes.ok ? (await entriesRes.json()) as {
      results?: Array<{ id?: number; date_filed?: string; description?: string; entry_number?: number }>;
    } : { results: [] };
    const entries: DocketEntry[] = (entriesJson.results ?? []).map((r) => ({
      entryId: r.id ?? 0,
      filedAt: r.date_filed ?? null,
      description: r.description ?? '',
      documentNumber: r.entry_number != null ? String(r.entry_number) : null
    }));

    // Detect chapter from case name or court ID — bankruptcy cases name them.
    let chapter: string | null = null;
    const caseName = docket.case_name ?? '';
    if (/\bChapter\s*7\b/i.test(caseName)) chapter = '7';
    else if (/\bChapter\s*11\b/i.test(caseName)) chapter = '11';
    else if (/\bChapter\s*13\b/i.test(caseName)) chapter = '13';
    else if (/bankr/i.test(docket.court ?? '') || /bankr/i.test(docket.court_id ?? '')) chapter = 'bk';

    return {
      docketId,
      caseName: docket.case_name ?? null,
      court: docket.court ?? null,
      filedAt: docket.date_filed ?? null,
      natureOfSuit: docket.nature_of_suit ?? null,
      chapter,
      entries,
      extractedCreditors: extractCreditorMentions(entries)
    };
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

export const pacerDocketAdapter: PublicIntelAdapter = {
  kind: 'pacer_docket',
  displayName: 'PACER docket fetcher (bankruptcy creditor extraction)',
  description:
    'Fetches federal docket entries via CourtListener RECAP archive (free; no PACER per-page fees on archived cases). Text-extracts creditor mentions from trustee filings + notices + proof-of-claim entries. Lights up the bankruptcy_creditor_extraction cascade.',
  requiresKey: false,
  apiKeyEnv: 'COURTLISTENER_TOKEN',
  costNote: 'Free via RECAP archive · optional COURTLISTENER_TOKEN raises quota · NEVER calls PACER directly',
  bestFor: ['CBB (the ICP of their ICP)', 'Distressed-debt buyers', 'Credit recovery'],

  validateConfig(config) {
    if (config == null) return null;
    if (!isCfg(config)) return 'config must be { docketIds?: number[], states?: string[], sinceDays?: number }';
    const c = config as PacerConfig;
    if ((!c.docketIds || c.docketIds.length === 0) && (!c.states || c.states.length === 0)) {
      return 'set either docketIds[] OR states[] (to discover dockets from CourtListener bankruptcy search)';
    }
    return null;
  },

  async run(ctx: RunContext): Promise<RunResult> {
    const cfgRaw = ctx.source.config;
    const valError = this.validateConfig(cfgRaw);
    if (valError) {
      await noteRun({ sourceId: ctx.source.sourceId, status: 'error', detail: `bad config: ${valError}` });
      return { ok: false, written: 0, fromCache: 0, detail: `bad config: ${valError}` };
    }
    const cfg: PacerConfig = (cfgRaw as PacerConfig | null) ?? {};

    let docketIds: number[] = cfg.docketIds ?? [];

    // If states given, discover recent bankruptcy dockets via CourtListener
    // search endpoint (type=r is RECAP, court_state filter, suitNature contains "Bankruptcy").
    if (docketIds.length === 0 && cfg.states && cfg.states.length > 0) {
      const sinceDays = cfg.sinceDays ?? 30;
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      try {
        const token = process.env.COURTLISTENER_TOKEN;
        const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'AtlanticHub/1.0 (research)' };
        if (token) headers.Authorization = `Token ${token}`;
        for (const state of cfg.states) {
          const u = new URLSearchParams();
          u.set('type', 'r');
          u.set('court_state', state.toUpperCase());
          u.set('filed_after', since);
          u.set('nature_of_suit', 'Bankruptcy');
          u.set('page_size', '20');
          const r = await fetch(`https://www.courtlistener.com/api/rest/v4/search/?${u.toString()}`, { headers });
          if (!r.ok) continue;
          const j = (await r.json()) as { results?: Array<{ docket_id?: number }> };
          for (const row of j.results ?? []) {
            if (typeof row.docket_id === 'number') docketIds.push(row.docket_id);
          }
        }
      } catch { /* fail soft */ }
    }

    // Dedup + cap.
    docketIds = Array.from(new Set(docketIds)).slice(0, 50);

    let written = 0;
    let fromCache = 0;
    let creditorsEmitted = 0;
    const errors: string[] = [];
    const expires = new Date(Date.now() + CACHE_DAYS * 24 * 60 * 60 * 1000);

    for (const docketId of docketIds) {
      const entityKey = `pacer:docket:${docketId}`;
      const cached = await findCachedRecord<DocketRecord>('pacer_docket', entityKey);
      if (cached) {
        fromCache++;
        continue;
      }
      const docket = await fetchDocket(docketId);
      if (!docket) {
        errors.push(`docket=${docketId}`);
        continue;
      }
      await storeRecord<DocketRecord>({
        sourceKind: 'pacer_docket',
        entityKey,
        clientId: ctx.clientId ?? ctx.source.clientId,
        recordJson: docket,
        summaryLabel: `${docket.caseName?.slice(0, 100) ?? 'Docket'} · Ch ${docket.chapter ?? '?'} · ${docket.extractedCreditors.length} creditor mentions`,
        regionCode: docket.court ?? null,
        expiresAt: expires
      });
      written++;

      // Per-creditor cascade-ready entries. These feed bankruptcy_creditor_extraction.
      for (const creditor of docket.extractedCreditors) {
        const slug = creditor.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 100);
        await storeRecord<{
          creditor: string;
          case_name: string | null;
          docket_id: number;
          court: string | null;
          chapter: string | null;
          entity: string;
          triggered_by_record: number;
        }>({
          sourceKind: 'pacer_docket',
          entityKey: `entity:cascade:bankruptcy-creditor:${docket.docketId}-${slug}`,
          clientId: ctx.clientId ?? ctx.source.clientId,
          recordJson: {
            creditor,
            case_name: docket.caseName,
            docket_id: docket.docketId,
            court: docket.court,
            chapter: docket.chapter,
            entity: creditor,
            triggered_by_record: 0
          },
          summaryLabel: `Exposed creditor · ${creditor.slice(0, 80)} · in ${docket.caseName?.slice(0, 60) ?? 'case'} (Ch ${docket.chapter ?? '?'})`,
          regionCode: docket.court,
          expiresAt: expires
        });
        creditorsEmitted++;
      }
    }

    const detail = `${written} dockets fetched, ${fromCache} from cache, ${creditorsEmitted} creditor mentions emitted, ${errors.length} errored`;
    await noteRun({
      sourceId: ctx.source.sourceId,
      status: errors.length > 0 && written === 0 ? 'error' : 'ok',
      detail
    });
    return { ok: written > 0 || fromCache > 0, written, fromCache, detail };
  }
};
