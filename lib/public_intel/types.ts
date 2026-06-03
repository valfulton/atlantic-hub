/**
 * lib/public_intel/types.ts  (#368, val 2026-06-02)
 *
 * Public Intelligence Layer — per-client adapters that pull free public data
 * into the same intelligence spine the LLM extractors feed. The moat alongside
 * LLM cost discipline: data nobody else aggregates, in the same scoring loop
 * the operator already trusts.
 *
 * Adapter ids that already have stubs or implementations:
 *   - 'hmda'       — Home Mortgage Disclosure Act, federal, public (Marty)
 *   - 'cfpb'       — Consumer Financial Protection Bureau complaint database
 *   - 'census_acs' — Census American Community Survey (household income, tenure)
 *   - 'ca_sos'     — California Secretary of State bizfileOnline (LLC/Corp)
 *   - 'ca_recorder'— County recorder filings (per-county, scraped) (Adriana)
 *   - 'datasf'     — San Francisco Open Data (business registrations, permits)
 *   - 'la_assessor'— LA County Assessor parcel + assessor data
 *
 * Each adapter implements PublicIntelAdapter. Only kind + config validation
 * are required at registry time; run() is invoked manually or by cron.
 */

export type PublicIntelKind =
  | 'hmda'
  | 'cfpb'
  | 'census_acs'
  | 'ca_sos'
  | 'ca_recorder'
  | 'datasf'
  | 'la_assessor'
  // (#372) Added during the Revenue Distress Intelligence Engine bundle.
  | 'courtlistener';

export interface PublicIntelSource {
  sourceId: number;
  clientId: number | null;
  sourceKind: PublicIntelKind;
  enabled: boolean;
  config: Record<string, unknown> | null;
  lastRunAt: Date | null;
  lastRunStatus: 'ok' | 'error' | 'skipped' | null;
  lastRunDetail: string | null;
}

export interface PublicIntelRecord<TPayload = Record<string, unknown>> {
  recordId: number;
  sourceKind: PublicIntelKind;
  entityKey: string;
  clientId: number | null;
  leadId: number | null;
  recordJson: TPayload;
  summaryLabel: string | null;
  regionCode: string | null;
  fetchedAt: Date;
  expiresAt: Date | null;
}

export interface RunContext {
  /** The source row this run belongs to (config + scope). */
  source: PublicIntelSource;
  /** Optional lead being enriched — when set, adapter scopes to that lead. */
  leadId?: number | null;
  /** Optional client being enriched — when set, adapter scopes to client. */
  clientId?: number | null;
  /** Per-run override for time horizon (e.g. "last 90 days"). */
  sinceDays?: number;
}

export interface RunResult {
  ok: boolean;
  /** New records written this run. */
  written: number;
  /** Records read from cache. */
  fromCache: number;
  /** Free-form summary for the operator log (under 500 chars). */
  detail: string;
}

/**
 * A PublicIntelAdapter is a stateless module describing how to fetch + cache
 * one specific kind of public data. Adapters never write to leads/clients
 * directly — they write to public_intel_records and let downstream scoring
 * pick them up.
 */
export interface PublicIntelAdapter {
  /** Canonical id of the data source. */
  kind: PublicIntelKind;
  /** Human label shown in the operator picker. */
  displayName: string;
  /** One-line description — the value prop for the operator. */
  description: string;
  /** Adapter requires an API key or token? When false, fully free. */
  requiresKey: boolean;
  /** ENV var name carrying the API key, if any. */
  apiKeyEnv?: string;
  /** Cost note for the operator — e.g. "Free" / "Free w/ rate limit". */
  costNote: string;
  /** Best-fit client examples (Marty, Adriana, John). */
  bestFor: string[];
  /** Validate operator-supplied config — returns null on success or message. */
  validateConfig(config: Record<string, unknown> | null): string | null;
  /** Pull records from the upstream API and persist into public_intel_records.
   *  Idempotent on entity_key — re-running won't dup rows. */
  run(ctx: RunContext): Promise<RunResult>;
}
