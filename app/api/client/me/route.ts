/**
 * GET /api/client/me
 *
 * Authenticated client-user only.
 *
 * Returns the logged-in client_user's profile + their most recent
 * Strategic Marketing Audit (joined from shhdbite_AV.leads on email).
 *
 * Why join on email: leads.client_id is mostly NULL today because the
 * audit-form path predates the clients table linkage. Email is the
 * stable join key between an intake submission and any prior audit.
 * If a client_users row also has a non-NULL client_id we ALSO try the
 * client_id join and pick whichever produces an audit.
 *
 * Shape: { user, audit, leads_count, tier_features }
 *
 * Search marker: [client-portal:me].
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAvDb } from '@/lib/db/av';
import { findClientUserById } from '@/lib/auth/client-user';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { writeAuditRow, extractClientIp } from '@/lib/audit';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface AuditRow extends RowDataPacket {
  audit_id: string | null;
  company: string | null;
  industry: string | null;
  audit_content: string | null;
  audit_generated: Date | null;
  created_at: Date | null;
}

interface CountRow extends RowDataPacket {
  c: number;
}

const TIER_FEATURES: Record<
  'audit_only' | 'starter' | 'growth' | 'scale',
  { included: string[]; locked: { name: string; tier: string }[] }
> = {
  audit_only: {
    included: [
      'AI-generated Strategic Marketing Audit',
      'Portal access with your audit always available'
    ],
    locked: [
      { name: 'Multi-source lead discovery (Apollo + Places + Instagram)', tier: 'Starter' },
      { name: 'AI lead scoring + Hot/Warm/Cool bands', tier: 'Starter' },
      { name: 'Automated email enrichment via Hunter.io', tier: 'Starter' },
      { name: 'AI social-content generation (LinkedIn + X + Instagram)', tier: 'Growth' },
      { name: 'Email outreach automation with reply tracking', tier: 'Growth' },
      { name: 'AI commercial generation (scripts, images, video)', tier: 'Scale' },
      { name: 'White-label deployment for your agency', tier: 'Scale' }
    ]
  },
  starter: {
    included: [
      'AI-generated Strategic Marketing Audit',
      'Multi-source lead discovery (Apollo + Places + Instagram)',
      'AI lead scoring with Hot/Warm/Cool bands',
      'Automated email enrichment via Hunter.io',
      'CSV import + bulk pipeline management',
      'Portal access with your audit + leads always available'
    ],
    locked: [
      { name: 'AI social-content generation (LinkedIn + X + Instagram)', tier: 'Growth' },
      { name: 'Email outreach automation with reply tracking', tier: 'Growth' },
      { name: 'AI commercial generation (scripts, images, video)', tier: 'Scale' },
      { name: 'White-label deployment for your agency', tier: 'Scale' }
    ]
  },
  growth: {
    included: [
      'Everything in Starter',
      'AI social-content generation (LinkedIn + X + Instagram)',
      'Email outreach automation with reply tracking',
      'Advanced pipeline analytics'
    ],
    locked: [
      { name: 'AI commercial generation (scripts, images, video)', tier: 'Scale' },
      { name: 'White-label deployment for your agency', tier: 'Scale' }
    ]
  },
  scale: {
    included: [
      'Everything in Growth',
      'AI commercial generation (scripts, images, video)',
      'White-label deployment for your agency',
      'Dedicated strategist + priority support'
    ],
    locked: []
  }
};

export async function GET(req: NextRequest) {
  const ip = extractClientIp(req.headers);
  const ua = req.headers.get('user-agent');

  const actor = readClientActorFromHeaders(req.headers);
  if (!actor) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const user = await findClientUserById(actor.clientUserId);
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const db = getAvDb();

    // Find the most relevant audit: prefer a row matched by client_id,
    // fall back to email match. Most recent first.
    const [auditRows] = await db.execute<AuditRow[]>(
      `SELECT audit_id, company, industry, audit_content, audit_generated, created_at
         FROM leads
        WHERE archived_at IS NULL
          AND audit_content IS NOT NULL
          AND (
            (? IS NOT NULL AND client_id = ?)
            OR email = ?
          )
        ORDER BY (client_id = ?) DESC,
                 COALESCE(audit_generated, created_at) DESC
        LIMIT 1`,
      [user.client_id, user.client_id, user.email, user.client_id]
    );

    const [countRows] = await db.execute<CountRow[]>(
      `SELECT COUNT(*) AS c FROM leads
        WHERE archived_at IS NULL
          AND (
            (? IS NOT NULL AND client_id = ?)
            OR email = ?
          )`,
      [user.client_id, user.client_id, user.email]
    );

    const audit = auditRows[0]
      ? {
          audit_id: auditRows[0].audit_id,
          company: auditRows[0].company,
          industry: auditRows[0].industry,
          audit_content: auditRows[0].audit_content,
          audit_generated:
            auditRows[0].audit_generated?.toISOString() ??
            auditRows[0].created_at?.toISOString() ??
            null
        }
      : null;

    await writeAuditRow({
      actorUserId: user.client_user_id,
      actorRole: 'client_user',
      targetResource: '/api/client/me',
      action: 'me_view',
      ip,
      userAgent: ua,
      statusCode: 200
    });

    return NextResponse.json({
      ok: true,
      user: {
        client_user_id: user.client_user_id,
        email: user.email,
        display_name: user.display_name,
        tier: user.tier,
        password_set: Boolean(user.password_hash),
        last_login_at: user.last_login_at?.toISOString() ?? null
      },
      audit,
      leads_count: Number(countRows[0]?.c ?? 0),
      tier_features: TIER_FEATURES[user.tier]
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[client-portal:me] error:', (err as Error).message);
    return NextResponse.json({ error: 'server error' }, { status: 500 });
  }
}
