import { NextRequest, NextResponse } from 'next/server';
import { getAvDb } from '@/lib/db/av';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled, mysqlBoolToJs } from '@/lib/feature-flags';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface IntegrationRow extends RowDataPacket {
  integration_id: number;
  integration_key: string;
  display_name: string;
  category: 'content_generation' | 'social_posting' | 'other';
  capabilities: string | object;
  enabled: unknown;
  notes: string | null;
}

function safeParse(val: string | object | null): object | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return null; }
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/integrations',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;

  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (!(await isFlagEnabled('tab_av_enabled'))) {
    return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });
  }

  try {
    const db = getAvDb();
    const [rows] = await db.execute<IntegrationRow[]>(
      `SELECT integration_id, integration_key, display_name, category, capabilities, enabled, notes
       FROM ai_integrations
       ORDER BY category, integration_key`
    );

    const integrations = rows.map((r) => ({
      integrationId: r.integration_id,
      integrationKey: r.integration_key,
      displayName: r.display_name,
      category: r.category,
      capabilities: safeParse(r.capabilities as string | object | null),
      enabled: mysqlBoolToJs(r.enabled),
      notes: r.notes
    }));

    return NextResponse.json({ integrations });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
