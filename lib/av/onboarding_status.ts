/**
 * lib/av/onboarding_status.ts  (#347 + #355, val 2026-06-02)
 *
 * Computes the 13-stage onboarding state + per-action status for a client.
 * Two consumers:
 *   - StageStrip (top of /admin/av/clients/[id]) — bird's eye, all 13 chips.
 *   - Action panels (BrandKit, FillIntake, FindLeads, etc.) — each card's
 *     "last run · what it produced" badge.
 *
 * Tolerant of missing tables / missing columns: queries are individually
 * try/catch'd so a partially-deployed schema doesn't blank the whole strip.
 * Every check falls back to "notStarted" on error.
 *
 * One pass per page render. Calls run in parallel via Promise.all where possible.
 */
import { getAvDb } from '@/lib/db/av';
import { INTAKE_KEYS } from '@/lib/client/intake_fields';
import type { RowDataPacket } from 'mysql2';

export type StageStatus = 'done' | 'inProgress' | 'notStarted';

export interface StageState {
  id: number;
  key: string;
  label: string;
  status: StageStatus;
  /** Short label rendered under the title (e.g. "32 / 51", "4 colors", "12 leads"). */
  detail?: string;
  /** When set, chip clicks scroll to this DOM id on the page. */
  anchor?: string;
}

export interface ActionStatus {
  hasRun: boolean;
  lastAt: Date | null;
  detail: string | null;
}

export interface OnboardingStatus {
  stages: StageState[];
  doneCount: number;
  totalCount: number;
  demoReady: boolean;
  actions: {
    brandKit: ActionStatus;
    intelligence: ActionStatus;
    intakeWebFill: ActionStatus;
    leads: ActionStatus;
    icp: ActionStatus;
    socials: ActionStatus;
    password: ActionStatus;
    magicLink: ActionStatus;
  };
}

const NOT_STARTED: ActionStatus = { hasRun: false, lastAt: null, detail: null };

/** Count rows for a query; returns 0 on any error. */
async function safeCount(sql: string, params: unknown[] = []): Promise<number> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<(RowDataPacket & { n: number })[]>(sql, params);
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

async function safeOne<T extends RowDataPacket>(sql: string, params: unknown[] = []): Promise<T | null> {
  try {
    const db = getAvDb();
    const [rows] = await db.execute<T[]>(sql, params);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Count "substantively populated" fields in the brief payload.
 * A field counts if it's a non-empty string, a non-zero number, or a non-empty array.
 *
 * (val 2026-06-07) MAJOR FIX. Previously this function counted against a
 * hardcoded list of 51 camelCase keys (`companyName`, `companyDescription`,
 * `whyAdvertise`, ...) — keys the intake form NEVER WRITES. The intake form
 * uses canonical snake_case keys (`company`, `business_description`,
 * `why_advertise`, `ideal_client`) defined in lib/client/intake_fields.ts.
 *
 * So every client looked '0/51' even with a fully populated intake, because
 * the counter was reading from a fictional key set that no part of the system
 * ever populated. NewClientForm wrote `company` → counter looked for
 * `companyName` → reported 0. Multi-page scrape wrote 11 fields → counter
 * found only the 2 that happened to match (industry, brand_voice). That's
 * why val saw '2/51' after applying 11 suggestions — the data WAS saved,
 * the counter was just reading the wrong column names.
 *
 * Fix: import INTAKE_KEYS from intake_fields and count against the actual
 * canonical key list. Total auto-updates when fields are added (e.g. the
 * 6 KPI fields added in commit f25d747 → total goes 51 → 57).
 */
function countFilledBriefFields(payload: Record<string, unknown> | null): { filled: number; total: number } {
  let filled = 0;
  if (payload) {
    for (const k of INTAKE_KEYS) {
      const v = (payload as Record<string, unknown>)[k];
      if (v == null) continue;
      if (typeof v === 'string' && v.trim().length > 0) filled += 1;
      else if (typeof v === 'number' && v !== 0) filled += 1;
      else if (Array.isArray(v) && v.length > 0) filled += 1;
      else if (typeof v === 'object' && v && Object.keys(v as object).length > 0) filled += 1;
    }
  }
  return { filled, total: INTAKE_KEYS.length };
}

export async function loadOnboardingStatus(clientId: number): Promise<OnboardingStatus> {
  const tenantClient = `client:${clientId}`;

  // Run independent queries in parallel.
  const [
    userRow,
    briefRow,
    intelCountRow,
    intelLastRow,
    icpRow,
    socialsCount,
    campaignsCount,
    leadsCount,
    leadsLast,
    auditCount,
    contentCount,
    contentLast,
    outreachCount,
    callConnectedCount
  ] = await Promise.all([
    safeOne<RowDataPacket & {
      client_user_id: number;
      password_hash: string | null;
      magic_token: string | null;
      magic_token_expires_at: Date | null;
      intake_link_sent_at: Date | null;
      last_login_at: Date | null;
      created_at: Date | null;
      updated_at: Date | null;
    }>(
      // (#511) intake_link_sent_at lights up the badge ONLY after val actually
      // sent the access link (send-password or magic-link endpoints set it).
      // Auto-generated magic_token at create-time no longer counts as "sent".
      // Wrapped in COALESCE so the query keeps working before schema 078 applies.
      `SELECT client_user_id, password_hash, magic_token, magic_token_expires_at,
              intake_link_sent_at, last_login_at, created_at, updated_at
         FROM client_users WHERE client_id = ? ORDER BY client_user_id ASC LIMIT 1`,
      [clientId]
    ),
    safeOne<RowDataPacket & { brief_payload: unknown; updated_at: Date | null }>(
      `SELECT brief_payload, updated_at FROM creative_briefs
         WHERE tenant_id='av' AND client_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [clientId]
    ),
    safeCount(
      `SELECT COUNT(*) AS n FROM intelligence_objects WHERE tenant_id = ?`,
      [tenantClient]
    ),
    safeOne<RowDataPacket & { last_at: Date | null }>(
      `SELECT MAX(updated_at) AS last_at FROM intelligence_objects WHERE tenant_id = ?`,
      [tenantClient]
    ),
    safeOne<RowDataPacket & { target_industries: unknown; updated_at: Date | null }>(
      `SELECT target_industries, updated_at FROM client_icps WHERE client_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [clientId]
    ),
    safeCount(
      `SELECT COUNT(*) AS n FROM social_targets WHERE client_id = ?`,
      [clientId]
    ),
    safeCount(
      `SELECT COUNT(*) AS n FROM narrative_lanes WHERE client_id = ?`,
      [clientId]
    ),
    safeCount(
      `SELECT COUNT(*) AS n FROM leads WHERE client_id = ?`,
      [clientId]
    ),
    safeOne<RowDataPacket & { last_at: Date | null }>(
      `SELECT MAX(last_activity_at) AS last_at FROM leads WHERE client_id = ?`,
      [clientId]
    ),
    safeCount(
      `SELECT COUNT(*) AS n FROM lead_audits la
         JOIN leads l ON l.id = la.lead_id
        WHERE l.client_id = ?`,
      [clientId]
    ),
    safeCount(
      `SELECT COUNT(*) AS n FROM content_artifacts WHERE tenant_id = ?`,
      [tenantClient]
    ),
    safeOne<RowDataPacket & { last_at: Date | null }>(
      `SELECT MAX(updated_at) AS last_at FROM content_artifacts WHERE tenant_id = ?`,
      [tenantClient]
    ),
    safeCount(
      `SELECT COUNT(*) AS n FROM outreach_messages om
         JOIN leads l ON l.id = om.lead_id
        WHERE l.client_id = ?`,
      [clientId]
    ),
    safeCount(
      `SELECT COUNT(*) AS n FROM call_log cl
         JOIN leads l ON l.id = cl.lead_id
        WHERE l.client_id = ? AND cl.call_outcome IN ('connected','follow_up','meeting_booked','converted')`,
      [clientId]
    )
  ]);

  // ----- Brief field counting (for stage 3 detail) -----
  let briefPayload: Record<string, unknown> | null = null;
  if (briefRow?.brief_payload) {
    try {
      briefPayload = typeof briefRow.brief_payload === 'string'
        ? (JSON.parse(briefRow.brief_payload) as Record<string, unknown>)
        : (briefRow.brief_payload as Record<string, unknown>);
    } catch {
      briefPayload = null;
    }
  }
  const briefCounts = countFilledBriefFields(briefPayload);

  // ----- Brand kit: check brand_colors in brief -----
  // The apply endpoint (app/api/admin/av/clients/[id]/extract-brand-kit/route.ts)
  // stores colors as a COMMA-SEPARATED HEX STRING ("#ff0000,#00ff00,..."), NOT an
  // array. So we accept both shapes here. Logo or aesthetic also count as
  // "kit done" so a brand with a logo but no extracted palette still lights up.
  const brandColorsRaw = briefPayload?.brandColors ?? briefPayload?.brand_colors;
  let brandColorCount = 0;
  if (Array.isArray(brandColorsRaw)) {
    brandColorCount = brandColorsRaw.length;
  } else if (typeof brandColorsRaw === 'string' && brandColorsRaw.trim()) {
    brandColorCount = brandColorsRaw.split(/[,\s]+/).filter((s) => s.trim().length > 0).length;
  }
  const brandTypo = briefPayload?.brandTypography ?? briefPayload?.brand_typography;
  const hasLogo = Boolean(
    briefPayload?.logo_url || briefPayload?.logoUrl ||
    briefPayload?.has_logo === 'yes' || briefPayload?.hasLogo === 'yes' ||
    briefPayload?.brand_aesthetic || briefPayload?.brandAesthetic
  );
  const brandHasKit = brandColorCount > 0 || hasLogo;

  // ----- ICP -----
  let icpIndustryCount = 0;
  if (icpRow?.target_industries) {
    try {
      const t = typeof icpRow.target_industries === 'string'
        ? JSON.parse(icpRow.target_industries)
        : icpRow.target_industries;
      icpIndustryCount = Array.isArray(t) ? t.length : 0;
    } catch {
      icpIndustryCount = 0;
    }
  }
  const icpDone = icpIndustryCount > 0;

  // ----- Stages -----
  const stages: StageState[] = [
    {
      id: 1,
      key: 'account',
      label: 'Account',
      status: 'done',
      anchor: 'account'
    },
    (() => {
      // (#511) Step 2 must reflect ACTUAL send, not just the presence of an
      // auto-generated magic_token. 'done' requires either an explicit send
      // (intake_link_sent_at, set by send-password / magic-link endpoints) OR
      // the client has already signed in once (last_login_at). 'inProgress'
      // covers the in-between state where a user row exists but val hasn't
      // shared the link with the client yet.
      const sentAt = userRow?.intake_link_sent_at ?? null;
      const loggedAt = userRow?.last_login_at ?? null;
      let stat: StageStatus = 'notStarted';
      let detail: string | undefined;
      if (!userRow) {
        stat = 'notStarted';
      } else if (loggedAt) {
        stat = 'done';
        detail = 'client has signed in';
      } else if (sentAt) {
        stat = 'done';
        detail = 'link sent · awaiting first sign-in';
      } else {
        stat = 'inProgress';
        detail = 'login ready · not yet shared';
      }
      return {
        id: 2,
        key: 'intake_sent',
        // (val 2026-06-08) Was "Intake sent" — which lied when login row
        // existed but val hadn't shared the link yet. The actual step is
        // "make sure the client has the access link they need to sign in",
        // so the label now matches the action and the in-progress detail
        // is no longer a contradiction.
        label: 'Send access',
        status: stat,
        detail,
        anchor: 'access-group'
      } as StageState;
    })(),
    {
      id: 3,
      key: 'intake_filled',
      label: 'Intake',
      status: briefCounts.filled === 0 ? 'notStarted' : (briefCounts.filled >= 25 ? 'done' : 'inProgress'),
      detail: `${briefCounts.filled} / ${briefCounts.total}`,
      anchor: 'fill-intake'
    },
    {
      id: 4,
      key: 'intelligence',
      label: 'Intelligence',
      status: intelCountRow > 0 ? 'done' : 'notStarted',
      detail: intelCountRow > 0 ? `${intelCountRow} objects` : undefined,
      anchor: 'extract-intel'
    },
    {
      id: 5,
      key: 'icp',
      label: 'ICP',
      status: icpDone ? 'done' : 'notStarted',
      detail: icpDone ? `${icpIndustryCount} industries` : undefined,
      anchor: 'icp'
    },
    {
      id: 6,
      key: 'brand_kit',
      label: 'Brand kit',
      status: brandHasKit ? 'done' : 'notStarted',
      detail: brandHasKit
        ? ([
            brandColorCount > 0 ? `${brandColorCount} color${brandColorCount === 1 ? '' : 's'}` : null,
            hasLogo ? 'logo' : null,
            brandTypo ? 'type' : null
          ].filter(Boolean).join(' · ') || 'kit saved')
        : undefined,
      anchor: 'brand-kit'
    },
    {
      id: 7,
      key: 'socials',
      label: 'Socials',
      status: socialsCount > 0 ? 'done' : 'notStarted',
      detail: socialsCount > 0 ? `${socialsCount} on file` : undefined,
      anchor: 'social-channels'
    },
    {
      id: 8,
      key: 'campaigns',
      label: 'Campaigns',
      status: campaignsCount > 0 ? 'done' : 'notStarted',
      detail: campaignsCount > 0 ? `${campaignsCount} active` : undefined
    },
    {
      id: 9,
      key: 'leads',
      label: 'Leads',
      status: leadsCount > 0 ? 'done' : 'notStarted',
      detail: leadsCount > 0 ? `${leadsCount} found` : undefined,
      anchor: 'find-leads'
    },
    {
      id: 10,
      key: 'first_audit',
      label: 'First audit',
      status: auditCount > 0 ? 'done' : 'notStarted',
      detail: auditCount > 0 ? `${auditCount} audited` : undefined
    },
    {
      id: 11,
      key: 'first_content',
      label: 'Content',
      status: contentCount > 0 ? 'done' : 'notStarted',
      detail: contentCount > 0 ? `${contentCount} drafted` : undefined
    },
    {
      id: 12,
      key: 'first_outreach',
      label: 'Outreach',
      status: (outreachCount + callConnectedCount) > 0 ? 'done' : 'notStarted',
      detail: (outreachCount + callConnectedCount) > 0
        ? `${outreachCount + callConnectedCount} touches`
        : undefined
    }
  ];

  const doneOfFirst12 = stages.filter((s) => s.status === 'done').length;
  // "Demo ready" auto-flips green when at least 9 of the prior 12 stages are done
  // AND brand kit + at least one content artifact exist (the two "looks complete"
  // signals val flagged as most important for not embarrassing herself on calls).
  const demoReady = doneOfFirst12 >= 9 && brandHasKit && contentCount > 0;
  stages.push({
    id: 13,
    key: 'demo_ready',
    label: 'Demo ready',
    status: demoReady ? 'done' : 'notStarted',
    detail: demoReady ? 'ship it' : `${doneOfFirst12} / 12 lit`
  });

  // ----- Action statuses (used by panel headers) -----
  const actions: OnboardingStatus['actions'] = {
    brandKit: brandHasKit
      ? {
          hasRun: true,
          lastAt: briefRow?.updated_at ?? null,
          detail: [
            brandColorCount > 0 ? `${brandColorCount} color${brandColorCount === 1 ? '' : 's'}` : null,
            hasLogo ? 'logo' : null,
            brandTypo ? 'type' : null
          ].filter(Boolean).join(' · ') || 'kit saved'
        }
      : NOT_STARTED,
    intelligence: intelCountRow > 0
      ? {
          hasRun: true,
          lastAt: intelLastRow?.last_at ?? null,
          detail: `${intelCountRow} object${intelCountRow === 1 ? '' : 's'}`
        }
      : NOT_STARTED,
    intakeWebFill: briefCounts.filled > 0
      ? {
          hasRun: true,
          lastAt: briefRow?.updated_at ?? null,
          detail: `${briefCounts.filled} / ${briefCounts.total} fields`
        }
      : NOT_STARTED,
    leads: leadsCount > 0
      ? {
          hasRun: true,
          lastAt: leadsLast?.last_at ?? null,
          detail: `${leadsCount} on this account`
        }
      : NOT_STARTED,
    icp: icpDone
      ? {
          hasRun: true,
          lastAt: icpRow?.updated_at ?? null,
          detail: `${icpIndustryCount} industries`
        }
      : NOT_STARTED,
    socials: socialsCount > 0
      ? {
          hasRun: true,
          lastAt: null,
          detail: `${socialsCount} on file`
        }
      : NOT_STARTED,
    password: userRow?.password_hash
      ? { hasRun: true, lastAt: userRow.updated_at ?? null, detail: 'password set' }
      : NOT_STARTED,
    magicLink: userRow?.magic_token
      ? { hasRun: true, lastAt: userRow.updated_at ?? null, detail: 'token live' }
      : NOT_STARTED
  };

  return {
    stages,
    doneCount: stages.filter((s) => s.status === 'done').length,
    totalCount: stages.length,
    demoReady,
    actions
  };
}
