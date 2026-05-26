/**
 * lib/client/intake_gate.ts
 *
 * The intake GATE. A client gets NO hub access (dashboard / leads / audit /
 * campaign) until THEY have filled and submitted their intake. The client's own
 * submission (POST /api/client/intake-update) stamps `client_completed_at` into
 * their brief payload; operator prefill alone never sets it. Until it's set,
 * every hub page redirects them to /client/intake.
 *
 * Fails CLOSED for the gate's purpose: if we can't confirm completion, we treat
 * intake as NOT done (send them to the form) — the rule is no access without it.
 */
import { getBriefPayload } from '@/lib/client/brief_store';

/**
 * May this client into the hub? True if EITHER:
 *   - the operator granted full portal access (`portal_full_access` — val's
 *     override; she controls it, no permission needed), OR
 *   - the client has completed their own intake (`client_completed_at`).
 * The gate is a default val can lift per-account, never a cage.
 */
export async function clientMayAccessHub(clientId: number | null | undefined): Promise<boolean> {
  if (!clientId || !Number.isInteger(clientId) || clientId <= 0) return false;
  try {
    const payload = (await getBriefPayload('av', clientId)) as Record<string, unknown> | null;
    if (payload?.portal_full_access === true) return true; // operator override
    const stamp = payload?.client_completed_at;
    return typeof stamp === 'string' && stamp.trim().length > 0;
  } catch {
    return false;
  }
}

/** Back-compat alias. */
export const clientHasCompletedIntake = clientMayAccessHub;
