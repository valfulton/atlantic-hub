import { NextRequest, NextResponse } from 'next/server';
import { getHhDb } from '@/lib/db/hh';
import { getPlatformDb } from '@/lib/db/platform';
import { guardAdminRequest } from '@/lib/api-guard';
import { decryptEmail } from '@/lib/crypto/encrypt';
import { isFlagEnabled } from '@/lib/feature-flags';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface CustomerRow extends RowDataPacket {
  customer_id: number;
  account_id: string;
  organization_name: string | null;
  use_case: string | null;
  estimated_volume: string | null;
  status: 'inquiry' | 'pilot' | 'active' | 'churned';
  mrr_cents: number;
  created_at: string;
}

interface AccountRow extends RowDataPacket {
  account_id: string;
  email_encrypted: Buffer;
  display_name: string | null;
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/hh/research-api',
    tenantId: 'hunterhoney'
  });
  if (!guard.ok) return guard.response;

  if (!(await isFlagEnabled('tab_hh_enabled'))) {
    return NextResponse.json({ error: 'hh tab disabled' }, { status: 503 });
  }

  try {
    const hhDb = getHhDb();
    const [customers] = await hhDb.execute<CustomerRow[]>(
      `SELECT customer_id, account_id, organization_name, use_case,
              estimated_volume, status, mrr_cents, created_at
       FROM research_api_customers
       ORDER BY created_at DESC
       LIMIT 500`
    );
    if (customers.length === 0) return NextResponse.json({ customers: [] });

    const accountIds = customers.map((c) => c.account_id);
    const placeholders = accountIds.map(() => '?').join(',');
    const platformDb = getPlatformDb();
    const [accounts] = await platformDb.execute<AccountRow[]>(
      `SELECT account_id, email_encrypted, display_name
       FROM accounts WHERE account_id IN (${placeholders})`,
      accountIds
    );
    const accountMap = new Map<string, AccountRow>(accounts.map((a) => [a.account_id, a]));

    const out = customers.map((c) => {
      const acc = accountMap.get(c.account_id);
      let email: string | null = null;
      try { if (acc?.email_encrypted) email = decryptEmail(acc.email_encrypted); } catch {}
      return {
        customerId: c.customer_id,
        accountId: c.account_id,
        email,
        displayName: acc?.display_name ?? null,
        organizationName: c.organization_name,
        useCase: c.use_case,
        estimatedVolume: c.estimated_volume,
        status: c.status,
        mrrCents: c.mrr_cents,
        createdAt: c.created_at
      };
    });

    return NextResponse.json({ customers: out });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
