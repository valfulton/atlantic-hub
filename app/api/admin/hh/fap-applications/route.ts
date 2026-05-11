import { NextRequest, NextResponse } from 'next/server';
import { getHhDb } from '@/lib/db/hh';
import { getPlatformDb } from '@/lib/db/platform';
import { guardAdminRequest } from '@/lib/api-guard';
import { decryptEmail } from '@/lib/crypto/encrypt';
import { isFlagEnabled } from '@/lib/feature-flags';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface FapRow extends RowDataPacket {
  fap_app_id: number;
  account_id: string;
  firm_name: string | null;
  aum_range: string | null;
  crd_number: string | null;
  state_registered: string | null;
  status: 'submitted' | 'in_review' | 'approved' | 'rejected' | 'withdrawn';
  submitted_at: string;
  reviewed_at: string | null;
}

interface AccountRow extends RowDataPacket {
  account_id: string;
  email_encrypted: Buffer;
  display_name: string | null;
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/hh/fap-applications',
    tenantId: 'hunterhoney'
  });
  if (!guard.ok) return guard.response;

  if (!(await isFlagEnabled('tab_hh_enabled'))) {
    return NextResponse.json({ error: 'hh tab disabled' }, { status: 503 });
  }

  try {
    const hhDb = getHhDb();
    const [apps] = await hhDb.execute<FapRow[]>(
      `SELECT fap_app_id, account_id, firm_name, aum_range, crd_number,
              state_registered, status, submitted_at, reviewed_at
       FROM fap_applications
       ORDER BY submitted_at DESC
       LIMIT 500`
    );

    if (apps.length === 0) return NextResponse.json({ applications: [] });

    const accountIds = apps.map((a) => a.account_id);
    const placeholders = accountIds.map(() => '?').join(',');
    const platformDb = getPlatformDb();
    const [accounts] = await platformDb.execute<AccountRow[]>(
      `SELECT account_id, email_encrypted, display_name
       FROM accounts WHERE account_id IN (${placeholders})`,
      accountIds
    );
    const accountMap = new Map<string, AccountRow>(accounts.map((a) => [a.account_id, a]));

    const applications = apps.map((a) => {
      const acc = accountMap.get(a.account_id);
      let email: string | null = null;
      try { if (acc?.email_encrypted) email = decryptEmail(acc.email_encrypted); } catch {}
      return {
        fapAppId: a.fap_app_id,
        accountId: a.account_id,
        email,
        displayName: acc?.display_name ?? null,
        firmName: a.firm_name,
        aumRange: a.aum_range,
        crdNumber: a.crd_number,
        stateRegistered: a.state_registered,
        status: a.status,
        submittedAt: a.submitted_at,
        reviewedAt: a.reviewed_at
      };
    });

    return NextResponse.json({ applications });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
