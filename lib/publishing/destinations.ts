/**
 * lib/publishing/destinations.ts
 *
 * The publishing-destination model. A piece of approved (+ branded) content can
 * be routed to one of several places, chosen per item:
 *
 *   - newsroom    : the hub-hosted public newsroom (app/newsroom). LIVE today.
 *   - brand_site  : one of val's own brand sites (Atlantic & Vine, Events by
 *                   Water, HunterHoney). Requires an authenticated push connector
 *                   to that site -- not built yet.
 *   - client_site : a client-owned site val is webmaster for (e.g. Central
 *                   Business Bureau). Authenticated push, per-client connector.
 *
 * `connected` = "can we actually publish there right now". Only the newsroom is
 * connected today; the rest are registered so the UI shows the roadmap and the
 * operator/client can pick a target, but publishing to them is gated until the
 * connector + authorization (see [[publishing-destinations]]) are in place.
 *
 * Client-owned sites are intentionally not hard-coded here -- they'll come from
 * a per-client config once the connector exists. This module is the single
 * source of truth both the operator desk and the client hub read from.
 */

export type DestinationKind = 'newsroom' | 'brand_site' | 'client_site';

export interface PublishDestination {
  id: string;
  label: string;
  kind: DestinationKind;
  /** True if publishing can actually happen now. */
  connected: boolean;
  /** Short operator-facing explanation of status. */
  note: string;
}

export const NEWSROOM_DESTINATION_ID = 'newsroom';

/**
 * Globally-available destinations (the newsroom + val's own brands). Client-owned
 * sites are appended per-client elsewhere once connectors land.
 */
export const PUBLISH_DESTINATIONS: PublishDestination[] = [
  {
    id: 'newsroom',
    label: 'Atlantic & Vine Newsroom',
    kind: 'newsroom',
    connected: true,
    note: 'Public, hub-hosted. Live now — appears on /newsroom the moment you publish.'
  },
  {
    id: 'av_site',
    label: 'atlanticandvine.netlify.app',
    kind: 'brand_site',
    connected: false,
    note: 'Connect the site to publish posts straight onto it.'
  },
  {
    id: 'ebw_site',
    label: 'Events by Water',
    kind: 'brand_site',
    connected: false,
    note: 'Brand site not connected yet.'
  },
  {
    id: 'hh_site',
    label: 'HunterHoney',
    kind: 'brand_site',
    connected: false,
    note: 'Brand site not connected yet.'
  }
];

export function getDestination(id: string | null | undefined): PublishDestination | null {
  if (!id) return null;
  return PUBLISH_DESTINATIONS.find((d) => d.id === id) ?? null;
}

export function isDestinationConnected(id: string | null | undefined): boolean {
  return getDestination(id)?.connected ?? false;
}
