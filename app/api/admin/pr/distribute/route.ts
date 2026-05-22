/**
 * /api/admin/pr/distribute
 *
 * GET  -> recent distribution log rows (optionally filtered by release/pitch).
 * POST -> record a distribution attempt for a release or pitch to a channel.
 *
 * Honesty rule (kickoff): v1 does not fake integrations. For channels with a
 * real API/email submit we would fire and record the outcome; every other
 * channel is "guided" -- we log the intent as 'queued' and return a
 * guided-submit payload (the content + target) the operator completes manually.
 * The UI must show which channels are automated vs guided.
 *
 * Body: { releaseId?, pitchId?, channel, url?, detail?, tenantId? }
 *
 * Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import {
  DEFAULT_TENANT,
  DISTRIBUTION_CHANNELS,
  PR_EVENTS,
  channelMode
} from '@/lib/pr/types';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';
export const maxDuration = 30;

interface LogRow extends RowDataPacket {
  id: number;
  release_id: number | null;
  pitch_id: number | null;
  tenant_id: string | null;
  channel: string;
  outcome: string;
  url: string | null;
  detail: string | null;
  attempted_at: string;
}

function mapLog(r: LogRow) {
  return {
    id: r.id,
    releaseId: r.release_id,
    pitchId: r.pitch_id,
    tenantId: r.tenant_id,
    channel: r.channel,
    outcome: r.outcome,
    url: r.url,
    detail: r.detail,
    attemptedAt: r.attempted_at
  };
}

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/pr/distribute', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const releaseId = Number(url.searchParams.get('releaseId')) || null;
  const pitchId = Number(url.searchParams.get('pitchId')) || null;
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 50));

  try {
    const db = getAvDb();
    const where: string[] = [];
    const vals: unknown[] = [];
    if (releaseId) { where.push('release_id = ?'); vals.push(releaseId); }
    if (pitchId) { where.push('pitch_id = ?'); vals.push(pitchId); }
    vals.push(limit);
    const [rows] = await db.execute<LogRow[]>(
      `SELECT id, release_id, pitch_id, tenant_id, channel, outcome, url, detail, attempted_at
         FROM press_distribution_log
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY id DESC
        LIMIT ?`,
      vals
    );
    return NextResponse.json({ ok: true, items: rows.map(mapLog), channels: DISTRIBUTION_CHANNELS });
  } catch (err) {
    console.error('[pr:distribute:list]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/pr/distribute:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const releaseId = typeof body.releaseId === 'number' ? body.releaseId : null;
  const pitchId = typeof body.pitchId === 'number' ? body.pitchId : null;
  const channel = typeof body.channel === 'string' ? body.channel.trim().slice(0, 64) : '';
  const url = typeof body.url === 'string' ? body.url.trim().slice(0, 1024) : null;
  const detail = typeof body.detail === 'string' ? body.detail.trim().slice(0, 500) : null;
  const tenantId = typeof body.tenantId === 'string' && body.tenantId ? body.tenantId.slice(0, 64) : DEFAULT_TENANT;

  if (!releaseId && !pitchId) {
    return NextResponse.json({ error: 'releaseId or pitchId required' }, { status: 400 });
  }
  if (!channel) {
    return NextResponse.json({ error: 'channel required' }, { status: 400 });
  }

  const mode = channelMode(channel);
  // v1: no channel actually fires an external submit yet, so everything is
  // recorded as 'queued' and the operator completes the (guided) submit. This
  // keeps the engine honest -- no faked integrations.
  const outcome: 'queued' | 'failed' = 'queued';

  try {
    const db = getAvDb();
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO press_distribution_log
         (release_id, pitch_id, tenant_id, channel, outcome, url, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [releaseId, pitchId, tenantId, channel, outcome, url, detail]
    );
    const id = res.insertId;

    // If this distribution recorded a live URL, that is earned coverage.
    if (url) {
      await logEvent({
        eventType: PR_EVENTS.coverageEarned,
        source: 'pr_desk',
        userId: guard.actor.userId,
        payload: { distribution_id: id, channel, url, release_id: releaseId, pitch_id: pitchId }
      });
    }

    await logEvent({
      eventType: PR_EVENTS.distributionQueued,
      source: 'pr_desk',
      userId: guard.actor.userId,
      payload: { distribution_id: id, channel, mode, release_id: releaseId, pitch_id: pitchId }
    });

    return NextResponse.json({
      ok: true,
      id,
      channel,
      mode,
      outcome,
      // For guided channels, the operator finishes the submit themselves.
      guided: mode === 'guided',
      message:
        mode === 'guided'
          ? 'Logged as queued. This channel is guided: complete the submit on the channel, then paste the live URL back here to record earned coverage.'
          : 'Logged.'
    });
  } catch (err) {
    console.error('[pr:distribute:create]', (err as Error).message);
    await logEvent({
      eventType: PR_EVENTS.distributionFailed,
      source: 'pr_desk',
      status: 'failure',
      errorMessage: (err as Error).message,
      payload: { channel, release_id: releaseId, pitch_id: pitchId }
    });
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
