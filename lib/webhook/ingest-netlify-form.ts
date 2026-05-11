/**
 * Netlify Forms webhook ingestion.
 *
 * Maps form_name → tenant + account_type + detail table + insert SQL.
 *
 * The four HH forms supported in v1:
 *   hh_subscribe              → tenant=hunterhoney, type=individual_learner, detail=subscribers
 *   hh_fap_apply              → tenant=hunterhoney, type=advisor_partner,    detail=fap_applications
 *   hh_cohort_waitlist        → tenant=hunterhoney, type=individual_learner, detail=cohort_waitlist
 *   hh_research_api_inquiry   → tenant=hunterhoney, type=research_api_customer, detail=research_api_customers
 *
 * Adding a new form later: extend the FORM_MAP. Adding a new tenant
 * later: same pattern, different db pool.
 */
import type { PoolConnection } from 'mysql2/promise';
import { getPlatformDb } from '@/lib/db/platform';
import { getHhDb } from '@/lib/db/hh';
import { emailHash, sha256Hex } from '@/lib/crypto/hash';
import { encryptEmail } from '@/lib/crypto/encrypt';
import { newAccountId } from '@/lib/ulid';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface NetlifyFormsPayload {
  // Netlify Forms wraps user-submitted fields inside a `data` object
  // and includes top-level metadata.
  id?: string; // Netlify submission id
  form_name?: string;
  data?: Record<string, string | undefined>;
  created_at?: string;
}

export type IngestionStatus = 'ingested' | 'duplicate' | 'failed';

export interface IngestionResult {
  status: IngestionStatus;
  accountId?: string;
  detailRowId?: number;
  error?: string;
}

type DetailWriter = (params: {
  hhConn: PoolConnection;
  accountId: string;
  data: Record<string, string | undefined>;
}) => Promise<number>;

interface FormMapping {
  tenantId: string;
  accountType: string;
  detailTable: string;
  detailWriter: DetailWriter;
  initialMrrCents: (data: Record<string, string | undefined>) => number;
  initialStatus: 'lead' | 'active';
  tier?: (data: Record<string, string | undefined>) => string | null;
}

const FORM_MAP: Record<string, FormMapping> = {
  hh_subscribe: {
    tenantId: 'hunterhoney',
    accountType: 'individual_learner',
    detailTable: 'subscribers',
    initialMrrCents: () => 0,
    initialStatus: 'active',
    tier: () => 'free',
    detailWriter: async ({ hhConn, accountId, data }) => {
      const [res] = await hhConn.execute<ResultSetHeader>(
        `INSERT INTO subscribers (account_id, tier, signup_source, mrr_cents, is_active)
         VALUES (?, 'free', ?, 0, TRUE)
         ON DUPLICATE KEY UPDATE
           is_active = TRUE,
           updated_at = CURRENT_TIMESTAMP`,
        [accountId, data['signup_source'] ?? 'hh_subscribe']
      );
      return res.insertId || 0;
    }
  },
  hh_fap_apply: {
    tenantId: 'hunterhoney',
    accountType: 'advisor_partner',
    detailTable: 'fap_applications',
    initialMrrCents: () => 0,
    initialStatus: 'lead',
    detailWriter: async ({ hhConn, accountId, data }) => {
      const [res] = await hhConn.execute<ResultSetHeader>(
        `INSERT INTO fap_applications
         (account_id, firm_name, aum_range, crd_number, state_registered, application_notes, status)
         VALUES (?, ?, ?, ?, ?, ?, 'submitted')`,
        [
          accountId,
          data['firm_name'] ?? null,
          data['aum_range'] ?? null,
          data['crd_number'] ?? null,
          data['state_registered'] ?? null,
          data['notes'] ?? null
        ]
      );
      return res.insertId;
    }
  },
  hh_cohort_waitlist: {
    tenantId: 'hunterhoney',
    accountType: 'individual_learner',
    detailTable: 'cohort_waitlist',
    initialMrrCents: () => 0,
    initialStatus: 'lead',
    detailWriter: async ({ hhConn, accountId, data }) => {
      const [res] = await hhConn.execute<ResultSetHeader>(
        `INSERT INTO cohort_waitlist (account_id, cohort_target, experience_level)
         VALUES (?, ?, ?)`,
        [accountId, data['cohort_target'] ?? null, data['experience_level'] ?? null]
      );
      return res.insertId;
    }
  },
  hh_research_api_inquiry: {
    tenantId: 'hunterhoney',
    accountType: 'research_api_customer',
    detailTable: 'research_api_customers',
    initialMrrCents: () => 0,
    initialStatus: 'lead',
    detailWriter: async ({ hhConn, accountId, data }) => {
      const [res] = await hhConn.execute<ResultSetHeader>(
        `INSERT INTO research_api_customers
         (account_id, organization_name, use_case, estimated_volume, status, mrr_cents)
         VALUES (?, ?, ?, ?, 'inquiry', 0)`,
        [
          accountId,
          data['organization_name'] ?? null,
          data['use_case'] ?? null,
          data['estimated_volume'] ?? null
        ]
      );
      return res.insertId;
    }
  }
};

/**
 * Upsert an account row, returning the canonical account_id.
 *
 * If an account already exists for this email_hash, return it.
 * Otherwise insert with a new ULID.
 */
async function upsertAccount(
  conn: PoolConnection,
  email: string,
  displayName: string | null
): Promise<string> {
  const eh = emailHash(email);
  const encryptedEmail = encryptEmail(email);

  // Try to find an existing account.
  const [existing] = await conn.execute<(RowDataPacket & { account_id: string })[]>(
    'SELECT account_id FROM accounts WHERE email_hash = ? LIMIT 1',
    [eh]
  );
  if (existing.length > 0) {
    // Bump last_seen_at and return.
    await conn.execute(
      'UPDATE accounts SET last_seen_at = CURRENT_TIMESTAMP WHERE account_id = ?',
      [existing[0].account_id]
    );
    return existing[0].account_id;
  }

  // Create new.
  const accountId = newAccountId();
  await conn.execute(
    `INSERT INTO accounts (account_id, email_hash, email_encrypted, display_name)
     VALUES (?, ?, ?, ?)`,
    [accountId, eh, encryptedEmail, displayName]
  );
  return accountId;
}

/**
 * Main entry point.
 * Returns { status, accountId, detailRowId } or throws on auth-layer errors.
 */
export async function ingestNetlifyFormsSubmission(
  payload: NetlifyFormsPayload,
  rawBody: string
): Promise<IngestionResult> {
  const formName = payload.form_name;
  const submissionId = payload.id;
  const data = payload.data ?? {};

  if (!formName || !submissionId) {
    return { status: 'failed', error: 'missing form_name or id' };
  }

  const mapping = FORM_MAP[formName];
  if (!mapping) {
    return { status: 'failed', error: `unsupported form_name: ${formName}` };
  }

  const email = (data['email'] ?? '').trim();
  if (!email || !email.includes('@')) {
    return { status: 'failed', error: 'invalid or missing email' };
  }

  const displayName = data['name'] ?? data['display_name'] ?? null;
  const payloadSha256 = sha256Hex(rawBody);

  const platformDb = getPlatformDb();
  const hhDb = getHhDb();

  // Idempotency check: have we already ingested this submission?
  const platformConn = await platformDb.getConnection();
  try {
    const [existingEvent] = await platformConn.execute<(RowDataPacket & { event_id: number; ingestion_status: string })[]>(
      `SELECT event_id, ingestion_status FROM webhook_events
       WHERE source = 'netlify_forms' AND external_id = ?
       LIMIT 1`,
      [submissionId]
    );
    if (existingEvent.length > 0 && existingEvent[0].ingestion_status === 'ingested') {
      return { status: 'duplicate' };
    }

    // Record the event as pending.
    await platformConn.execute(
      `INSERT INTO webhook_events (source, external_id, form_name, payload_sha256, ingestion_status)
       VALUES ('netlify_forms', ?, ?, ?, 'pending')
       ON DUPLICATE KEY UPDATE ingestion_status = 'pending', payload_sha256 = VALUES(payload_sha256)`,
      [submissionId, formName, payloadSha256]
    );
  } finally {
    platformConn.release();
  }

  // Open per-DB connections. Two-DB writes can't be in a single MySQL
  // transaction, so we order them: platform writes first (account +
  // link), tenant write second. If tenant write fails, we mark the
  // event as failed and the next retry from Netlify will retry both.
  const pConn = await platformDb.getConnection();
  const hhConn = await hhDb.getConnection();
  try {
    await pConn.beginTransaction();
    const accountId = await upsertAccount(pConn, email, displayName);

    // Upsert the tenant_account_link row.
    await pConn.execute(
      `INSERT INTO tenant_account_link
         (account_id, tenant_id, account_type, status, tier, mrr_cents, source, detail_table)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         tier = COALESCE(VALUES(tier), tier),
         updated_at = CURRENT_TIMESTAMP`,
      [
        accountId,
        mapping.tenantId,
        mapping.accountType,
        mapping.initialStatus,
        mapping.tier ? mapping.tier(data) : null,
        mapping.initialMrrCents(data),
        `netlify_form:${formName}`,
        mapping.detailTable
      ]
    );
    await pConn.commit();

    // Write the per-tenant detail row.
    await hhConn.beginTransaction();
    const detailRowId = await mapping.detailWriter({ hhConn, accountId, data });
    await hhConn.commit();

    // Backfill detail_row_id on the link row now that we have it.
    await pConn.execute(
      `UPDATE tenant_account_link
       SET detail_row_id = ?
       WHERE account_id = ? AND tenant_id = ? AND account_type = ?`,
      [detailRowId, accountId, mapping.tenantId, mapping.accountType]
    );

    // Mark the webhook event as ingested.
    await pConn.execute(
      `UPDATE webhook_events
       SET ingestion_status = 'ingested', processed_at = CURRENT_TIMESTAMP, error_message = NULL
       WHERE source = 'netlify_forms' AND external_id = ?`,
      [submissionId]
    );

    return { status: 'ingested', accountId, detailRowId };
  } catch (err) {
    try { await pConn.rollback(); } catch {}
    try { await hhConn.rollback(); } catch {}
    const message = (err as Error).message.slice(0, 480);
    try {
      await pConn.execute(
        `UPDATE webhook_events
         SET ingestion_status = 'failed', processed_at = CURRENT_TIMESTAMP, error_message = ?
         WHERE source = 'netlify_forms' AND external_id = ?`,
        [message, submissionId]
      );
    } catch {}
    return { status: 'failed', error: message };
  } finally {
    pConn.release();
    hhConn.release();
  }
}
