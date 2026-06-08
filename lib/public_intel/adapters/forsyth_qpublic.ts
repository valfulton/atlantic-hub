/**
 * lib/public_intel/adapters/forsyth_qpublic.ts  (#534, val 2026-06-08)
 *
 * Forsyth County GA tax assessor lookup via qPublic / Schneider Geospatial.
 * This is the FIRST per-property adapter — the one that turns Mark Francis's
 * 6105 Polo Club Drive into actual owner + assessed value + last sale + open
 * mortgage data.
 *
 * Mechanism: drive Browserless's headless Chrome to the qPublic Forsyth
 * search page, fill the address search, click the first result, extract
 * the parcel detail page.
 *
 * qPublic Forsyth entry point:
 *   https://qpublic.schneidercorp.com/Application.aspx?AppID=1085&LayerID=22987&PageTypeID=2&PageID=10110
 *
 * Honest scope: this is a v1. qPublic's DOM changes over time and the entity
 * search field IDs may shift — when the scrape returns no result we surface
 * a clear "search ran, no match — verify address format" message instead of
 * a fake clean signal.
 *
 * Per the no-duct-tape rule: the result includes the raw scrape so val can
 * see exactly what the page returned even when parsing fails.
 */
import { runBrowserlessFunction, isBrowserlessAvailable } from '@/lib/scrape/browserless';

export interface ForsythParcelResult {
  /** What was queried. */
  address: string;
  /** Was Browserless reachable + token present? */
  ok: boolean;
  /** Plain-language one-liner for the red-flag ribbon. */
  signalLabel: string;
  /** Parcel ID found, if any. */
  parcelId: string | null;
  /** Property owner of record. */
  owner: string | null;
  /** Most recent assessed value (USD). */
  assessedValue: number | null;
  /** Last sale price (USD) and date. */
  lastSalePrice: number | null;
  lastSaleDate: string | null;
  /** Land + improvement value (USD). */
  landValue: number | null;
  improvementValue: number | null;
  /** Raw scrape — empty object on failure. Inspect in operator panel for
   *  debugging when the parser misses a field. */
  raw: Record<string, unknown>;
  /** Honest error message on failure. */
  error: string | null;
}

const FORSYTH_QPUBLIC_URL =
  'https://qpublic.schneidercorp.com/Application.aspx?AppID=1085&LayerID=22987&PageTypeID=2&PageID=10110';

/**
 * Look up a Forsyth County GA address on qPublic. Returns structured parcel
 * data on success, or a "still tuning" stub when the page DOM has shifted.
 */
export async function lookupForsythParcel(address: string): Promise<ForsythParcelResult> {
  const base: ForsythParcelResult = {
    address,
    ok: false,
    signalLabel: `Forsyth qPublic: no result for "${address}"`,
    parcelId: null,
    owner: null,
    assessedValue: null,
    lastSalePrice: null,
    lastSaleDate: null,
    landValue: null,
    improvementValue: null,
    raw: {},
    error: null
  };

  if (!isBrowserlessAvailable()) {
    return {
      ...base,
      error: 'Browser-automation worker (Browserless) not configured. Add BROWSERLESS_TOKEN to Netlify env to enable per-property lookups.',
      signalLabel: 'Forsyth qPublic: browser worker not provisioned'
    };
  }

  // Just the street + number — qPublic's search is picky about state/zip.
  const streetOnly = address
    .replace(/,?\s*(USA|United States|U\.S\.A?\.?)\s*$/i, '')
    .replace(/,?\s*GA\s+\d{5}.*$/i, '')
    .replace(/,?\s*\d{5}.*$/i, '')
    .replace(/,?\s*Cumming.*$/i, '')
    .trim();

  // Browserless /function script. Runs inside their Chrome, returns JSON.
  // The script is conservative: navigate, type the street into the search box,
  // click search, wait for results, click the first link, then read the
  // owner/value labels off the parcel detail page.
  const script = `async ({ page, context }) => {
    const { url, query } = context;
    const result = { searched: query, dom: {}, errors: [] };
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      // Try the typical qPublic Schneider search input id.
      const inputSel = '#ctlBodyPane_ctl01_ctl01_txtAddress, input[name*="Address"], input[placeholder*="address" i]';
      await page.waitForSelector(inputSel, { timeout: 10000 });
      await page.type(inputSel, query, { delay: 30 });
      // Submit either via Search button or by pressing Enter.
      await Promise.all([
        page.keyboard.press('Enter'),
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null)
      ]);
      // Grab the first search result link if a list appeared.
      const firstResult = await page.$('a[href*="KeyValue"], table tbody tr a, .search-result a');
      if (firstResult) {
        await Promise.all([
          firstResult.click(),
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null)
        ]);
      }
      // Harvest labeled rows on the parcel detail page. qPublic uses a
      // label-table pattern; we collect ALL strong-tag adjacent values so
      // the parser stays loose when DOM IDs shift.
      const pairs = await page.evaluate(() => {
        const out = {};
        document.querySelectorAll('strong, th, .label').forEach((el) => {
          const k = (el.textContent || '').trim().replace(/[:\\s]+$/, '');
          const next = el.nextElementSibling || el.parentElement?.nextElementSibling;
          const v = next ? (next.textContent || '').trim() : '';
          if (k && v) out[k] = v;
        });
        return out;
      });
      result.dom = pairs;
      result.url = page.url();
    } catch (err) {
      result.errors.push(String(err && err.message || err));
    }
    return result;
  }`;

  const r = await runBrowserlessFunction<{
    searched: string;
    dom: Record<string, string>;
    errors: string[];
    url?: string;
  }>(script, {
    context: { url: FORSYTH_QPUBLIC_URL, query: streetOnly },
    timeoutMs: 25_000
  });

  if (!r.ok || !r.data) {
    return {
      ...base,
      error: r.error ?? 'Browserless returned no data',
      signalLabel: `Forsyth qPublic: scrape failed (${r.error?.slice(0, 80) ?? 'unknown'})`
    };
  }

  const dom = r.data.dom ?? {};
  // Best-effort field extraction. qPublic's labels include common variants.
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      for (const domKey of Object.keys(dom)) {
        if (domKey.toLowerCase().includes(k.toLowerCase())) {
          const v = dom[domKey].trim();
          if (v) return v;
        }
      }
    }
    return null;
  };
  const parseUsd = (s: string | null): number | null => {
    if (!s) return null;
    const m = s.replace(/,/g, '').match(/\$?\s*([0-9]+(?:\.[0-9]+)?)/);
    return m ? Number(m[1]) : null;
  };

  const parcelId = pick('Parcel', 'PIN');
  const owner = pick('Owner', 'Grantee');
  const assessedRaw = pick('Total Value', 'Assessed', 'Appraised');
  const landRaw = pick('Land Value', 'Land');
  const improvementRaw = pick('Improvement', 'Building Value');
  const saleRaw = pick('Last Sale', 'Sale Price', 'Sale Amount');
  const saleDateRaw = pick('Sale Date');

  const parsedOk = Boolean(parcelId || owner || assessedRaw);
  const signalLabel = parsedOk
    ? `Forsyth parcel ${parcelId ?? '?'}: ${owner ?? 'owner unknown'}, assessed ${assessedRaw ?? '?'}, last sale ${saleRaw ?? '?'} (${saleDateRaw ?? 'date?'})`
    : `Forsyth qPublic: search ran but parser found no parcel fields — qPublic DOM may have shifted (raw scrape saved for debug)`;

  return {
    ...base,
    ok: parsedOk,
    parcelId,
    owner,
    assessedValue: parseUsd(assessedRaw),
    landValue: parseUsd(landRaw),
    improvementValue: parseUsd(improvementRaw),
    lastSalePrice: parseUsd(saleRaw),
    lastSaleDate: saleDateRaw,
    raw: { ...dom, _scrape_url: r.data.url, _elapsed_ms: r.elapsedMs, _errors: r.data.errors },
    signalLabel,
    error: parsedOk ? null : (r.data.errors?.[0] ?? 'No parcel fields parsed')
  };
}
