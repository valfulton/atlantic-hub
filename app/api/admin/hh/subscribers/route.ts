/**
 * GET /api/admin/hh/subscribers
 *
 * List HunterHoney subscribers joined with platform account info.
 * Read-only in v1.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getHhDb } from '@/lib/db/hh';
import { getPlatformDb } from '@/lib/db/platform';
import { guardAdminRequest } from '@/lib/api-guard';
import { decryptEmail } from '@/lib/crypto/encrypt';
import { isFlagEnabled, mysqlBoolToJs } from '@/lib/feature-flags';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface SubscriberRow extends RowDataPacket {
  subscriber_id: number;
  account_id: string;
  tier: 'free' | 'member' | 'cohort';
  signup_source: string | null;
  mrr_cents: number;
  is_active: unknown;
  created_at: string;
}

interface AccountRow extends RowDataPacket {
  account_id: string;
  email_encrypted: Buffer;
  display_name: string | null;
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/hh/subscribers',
    tenantId: 'hunterhoney'
  });
  if (!guard.ok) return guard.response;

  if (!(await isFlagEnabled('tab_hh_enabled'))) {
    return NextResponse.json({ error: 'hh tab disabled' }, { status: 503 });
  }

  try {
    const hhDb = getHhDb();
    const [subs] = await hhDb.execute<SubscriberRow[]>(
      `SELECT subscriber_id, account_id, tier, signup_source, mrr_cents, is_active, created_at
       FROM subscribers
       ORDER BY created_at DESC
       LIMIT 500`
    );

    if (subs.length === 0) return NextResponse.json({ subscribers: [] });

    const accountIds = subs.map((s) => s.account_id);
    const placeholders = accountIds.map(() => '?').join(',');
    const platformDb = getPlatformDb();
    const [accounts] = await platformDb.execute<AccountRow[]>(
      `SELECT account_id, email_encrypted, display_name
       FROM accounts
       WHERE account_id IN (${placeholders})`,
      accountIds
    );
    const accountMap = new Map<string, AccountRow>(accounts.map((a) => [a.account_id, a]));

    const subscribers = subs.map((s) => {
      const acc = accountMap.get(s.account_id);
      let email: string | null = null;
      try {
        if (acc?.email_encrypted) email = decryptEmail(acc.email_encrypted);
      } catch {
        email = null;
      }
      return {
        subscriberId: s.subscriber_id,
        accountId: s.account_id,
        email,
        displayName: acc?.display_name ?? null,
        tier: s.tier,
        signupSource: s.signup_source,
        mrrCents: s.mrr_cents,
        isActive: mysqlBoolToJs(s.is_active),
        createdAt: s.created_at
      };
    });

    return NextResponse.json({ subscribers });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
