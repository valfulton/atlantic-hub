import { NextRequest, NextResponse } from 'next/server';
import { getHhDb } from '@/lib/db/hh';
import { getPlatformDb } from '@/lib/db/platform';
import { guardAdminRequest } from '@/lib/api-guard';
import { decryptEmail } from '@/lib/crypto/encrypt';
import { isFlagEnabled } from '@/lib/feature-flags';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface WaitlistRow extends RowDataPacket {
  waitlist_id: number;
  account_id: string;
  cohort_target: string | null;
  experience_level: string | null;
  added_at: string;
}

interface AccountRow extends RowDataPacket {
  account_id: string;
  email_encrypted: Buffer;
  display_name: string | null;
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/hh/cohort-waitlist',
    tenantId: 'hunterhoney'
  });
  if (!guard.ok) return guard.response;

  if (!(await isFlagEnabled('tab_hh_enabled'))) {
    return NextResponse.json({ error: 'hh tab disabled' }, { status: 503 });
  }

  try {
    const hhDb = getHhDb();
    const [items] = await hhDb.execute<WaitlistRow[]>(
      `SELECT waitlist_id, account_id, cohort_target, experience_level, added_at
       FROM cohort_waitlist
       ORDER BY added_at DESC
       LIMIT 500`
    );
    if (items.length === 0) return NextResponse.json({ waitlist: [] });

    const accountIds = items.map((i) => i.account_id);
    const placeholders = accountIds.map(() => '?').join(',');
    const platformDb = getPlatformDb();
    const [accounts] = await platformDb.execute<AccountRow[]>(
      `SELECT account_id, email_encrypted, display_name
       FROM accounts WHERE account_id IN (${placeholders})`,
      accountIds
    );
    const accountMap = new Map<string, AccountRow>(accounts.map((a) => [a.account_id, a]));

    const waitlist = items.map((i) => {
      const acc = accountMap.get(i.account_id);
      let email: string | null = null;
      try { if (acc?.email_encrypted) email = decryptEmail(acc.email_encrypted); } catch {}
      return {
        waitlistId: i.waitlist_id,
        accountId: i.account_id,
        email,
        displayName: acc?.display_name ?? null,
        cohortTarget: i.cohort_target,
        experienceLevel: i.experience_level,
        addedAt: i.added_at
      };
    });

    return NextResponse.json({ waitlist });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
