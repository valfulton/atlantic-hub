/**
 * lib/clients/pr_inbox.ts  (#226)
 *
 * Per-client PR inbox slug helpers. The slug is the local-part of an
 * email address that lives on pr.atlanticandvine.com (e.g.
 * "john-x7q9k3mn4p5q"). HostGator's catch-all forwards everything for
 * that domain to POST /api/pr/inbox/<slug> -- so the slug IS the
 * authentication. Slugs MUST be unguessable.
 *
 * Generation strategy: a short human-friendly hint + 14 random
 * alphanumeric chars. The hint is for the operator's sake -- a glance at
 * the address tells you which client it routes to. The random tail makes
 * it impossible to enumerate by guessing names.
 *
 * Rotation: overwriting the column invalidates the old slug. There is
 * no slug history table -- this is intentional. If a slug leaks, val
 * rotates it and tells the affected journalist contact list.
 */
import { randomBytes } from 'crypto';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const RANDOM_LEN = 14;

/** The hostname clients hand to journalists. Used to build the full email address. */
export const PR_INBOX_DOMAIN = process.env.PR_INBOX_DOMAIN || 'pr.atlanticandvine.com';

export interface ClientPrInboxRecord {
  clientId: number;
  clientName: string | null;
  slug: string | null;
  setAt: string | null;
  /** Convenience: full email address derived from slug + PR_INBOX_DOMAIN. Null when slug is null. */
  email: string | null;
}

/** Slugify a free-text name to a short, URL-safe hint (a-z, 0-9, dashes). Max 16 chars. */
function hintFromName(name: string | null | undefined): string {
  if (!name) return 'client';
  const cleaned = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!cleaned) return 'client';
  return cleaned.slice(0, 16);
}

function randomTail(): string {
  // 14 chars from a 36-char alphabet => log2(36^14) ~= 72 bits of entropy.
  const buf = randomBytes(RANDOM_LEN);
  let out = '';
  for (let i = 0; i < RANDOM_LEN; i++) {
    out += ALPHABET[buf[i] % ALPHABET.length];
  }
  return out;
}

/**
 * Generate a fresh slug for a client and write it (overwriting any existing slug).
 * Returns the new slug AND the full email address.
 */
export async function generateAndPersistSlug(
  clientId: number,
  hintFromCallerName: string | null
): Promise<{ slug: string; email: string; setAt: string }> {
  const hint = hintFromName(hintFromCallerName);
  // Loop with retries on the unique-key collision; should be effectively never.
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${hint}-${randomTail()}`;
    try {
      const db = getAvDb();
      await db.execute<ResultSetHeader>(
        `UPDATE clients SET pr_inbox_slug = ?, pr_inbox_set_at = NOW() WHERE client_id = ?`,
        [candidate, clientId]
      );
      const setAt = new Date().toISOString();
      return {
        slug: candidate,
        email: `${candidate}@${PR_INBOX_DOMAIN}`,
        setAt
      };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('Duplicate entry') && attempt < 4) continue;
      throw err;
    }
  }
  throw new Error('Could not generate a unique slug after 5 attempts.');
}

/** Get the current slug record for a client, computing the full email when slug is set. */
export async function getInboxRecord(clientId: number): Promise<ClientPrInboxRecord | null> {
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & {
    client_id: number;
    client_name: string | null;
    pr_inbox_slug: string | null;
    pr_inbox_set_at: string | null;
  })[]>(
    `SELECT client_id, client_name, pr_inbox_slug, pr_inbox_set_at
       FROM clients
      WHERE client_id = ?
      LIMIT 1`,
    [clientId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    clientId: r.client_id,
    clientName: r.client_name,
    slug: r.pr_inbox_slug,
    setAt: r.pr_inbox_set_at,
    email: r.pr_inbox_slug ? `${r.pr_inbox_slug}@${PR_INBOX_DOMAIN}` : null
  };
}

/** Reverse lookup: which client does this incoming slug belong to? Returns null if invalid. */
export async function findClientBySlug(slug: string): Promise<{ clientId: number; clientName: string | null } | null> {
  if (!slug || typeof slug !== 'string') return null;
  // Defensive: the slug should match our generation alphabet + dash. Reject
  // anything else immediately to avoid abuse via path injection.
  if (!/^[a-z0-9-]{4,80}$/.test(slug)) return null;
  const db = getAvDb();
  const [rows] = await db.execute<(RowDataPacket & {
    client_id: number;
    client_name: string | null;
  })[]>(
    `SELECT client_id, client_name FROM clients WHERE pr_inbox_slug = ? LIMIT 1`,
    [slug]
  );
  const r = rows[0];
  return r ? { clientId: r.client_id, clientName: r.client_name } : null;
}
