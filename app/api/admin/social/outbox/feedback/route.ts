/**
 * GET /api/admin/social/outbox/feedback   (#61 Inc 4-polish-A)
 *
 * The operator-side feed of recent client feedback on queued drafts. Returns
 * the most-recent N rows in social_outbox (across all client tenants) where
 * client_notes is non-empty, decorated with the line name + customer label
 * so val can see who said what without leaving the cockpit.
 *
 * Read-only. Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import type { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

interface FeedbackRow extends RowDataPacket {
  outbox_id: number;
  tenant_id: string;
  client_id: number | null;
  client_label: string | null;
  status: string;
  body_text: string | null;
  client_edited_body: string | null;
  client_notes: string;
  narrative_line_id: number | null;
  line_name: string | null;
  updated_at: string;
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/social/outbox/feedback:GET',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const db = getAvDb();
  try {
    // tenant_id of the form 'client:<id>' encodes the owning client; we parse
    // it out so we can resolve a friendly label via clients_overview later.
    // For now, list everything with a note and let the UI render the tenant
    // alongside the line name — val can identify the customer at a glance.
    const [rows] = await db.execute<FeedbackRow[]>(
      `SELECT o.id AS outbox_id, o.tenant_id, o.status,
              o.body_text, o.client_edited_body, o.client_notes,
              a.narrative_line_id, nl.name AS line_name,
              nl.client_id, NULL AS client_label,
              o.updated_at
         FROM social_outbox o
         LEFT JOIN grok_imagine_assets a ON a.id = o.asset_id
         LEFT JOIN narrative_lanes nl ON nl.id = a.narrative_line_id
        WHERE o.client_notes IS NOT NULL
          AND o.client_notes <> ''
          AND o.archived_at IS NULL
        ORDER BY o.updated_at DESC
        LIMIT 30`
    );

    // Resolve customer labels in one round trip — the cockpit's existing
    // listCockpitCustomers covers brands; clients we pull names for via the
    // clients table. Best-effort; missing names degrade to tenant string.
    const clientIds = Array.from(new Set(rows.map((r) => r.client_id).filter((id): id is number => !!id && id > 0)));
    const labelMap = new Map<number, string>();
    if (clientIds.length > 0) {
      const placeholders = clientIds.map(() => '?').join(',');
      const [cRows] = await db.execute<(RowDataPacket & { id: number; name: string | null })[]>(
        `SELECT id, name FROM clients WHERE id IN (${placeholders})`,
        clientIds
      );
      for (const c of cRows) labelMap.set(c.id, c.name?.trim() || `Client #${c.id}`);
    }

    return NextResponse.json({
      ok: true,
      items: rows.map((r) => ({
        outboxId: r.outbox_id,
        tenantId: r.tenant_id,
        clientId: r.client_id,
        clientLabel: r.client_id ? (labelMap.get(r.client_id) ?? r.tenant_id) : 'House brand',
        status: r.status,
        bodyText: r.body_text,
        clientEditedBody: r.client_edited_body,
        clientNotes: r.client_notes,
        narrativeLineId: r.narrative_line_id,
        narrativeLineName: r.line_name,
        updatedAt: String(r.updated_at)
      }))
    });
  } catch (err) {
    console.error('[outbox-feedback]', (err as Error).message);
    return NextResponse.json({ ok: true, items: [] });
  }
}
