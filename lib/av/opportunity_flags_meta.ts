/**
 * lib/av/opportunity_flags_meta.ts  (#305)
 *
 * Pure-data sidecar to lib/av/opportunity_flags.ts. Exists ONLY so client
 * components can import the SIGNAL_COPY map + types without dragging the
 * mysql2-backed query layer (and Node-only `net`/`tls`) into the browser
 * bundle.
 *
 * Rule of thumb: any constant or type a client component needs from the
 * flags module gets re-exported here. The DB-call function stays in
 * opportunity_flags.ts and is only imported by server components / API
 * routes.
 */
export type FlagSignal = 'newly_hot' | 'just_enriched_warm' | 'icp_fit_jump';

export interface OpportunityFlag {
  leadId: number;
  auditId: string | null;
  company: string;
  clientId: number | null;
  clientName: string | null;
  signal: FlagSignal;
  score: number;
  firedAt: string;
}

export const SIGNAL_COPY: Record<FlagSignal, { label: string; emoji: string; fg: string }> = {
  newly_hot: { label: 'newly hot', emoji: '🔥', fg: '#FF9AA8' },
  icp_fit_jump: { label: 'ICP fit', emoji: '🎯', fg: '#fcd34d' },
  just_enriched_warm: { label: 'just enriched', emoji: '✨', fg: '#a8cbff' }
};
