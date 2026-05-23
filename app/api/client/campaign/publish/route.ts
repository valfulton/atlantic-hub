/**
 * POST /api/client/campaign/publish
 *
 * Lets a logged-in CLIENT publish one of their OWN already-approved content
 * pieces to the public newsroom. Mirrors the operator publish, scoped to the
 * client:
 *   - middleware (matcher: /api/client/campaign/:path*) verifies the client
 *     session and sets x-ah-client-user-id.
 *   - we re-verify the artifact's lead belongs to this client (client_id/email),
 *     exactly the scoping in lib/client/campaign.ts, so a client can never
 *     publish someone else's content.
 *   - we ONLY publish items already at status 'approved' -- the operator's
 *     approval gate ([[approval-branding-gate]]) still stands; the client cannot
 *     push raw drafts live. Destination is the newsroom (the one live, safe,
 *     hub-hosted target); brand/external sites stay operator-only for now.
 *
 * Body: { artifactId: number }
 */
import { NextRequest, NextResponse } from 'next/server';
import { readClientActorFromHeaders } from '@/lib/auth/client-session';
import { findClientUserById } from '@/lib/auth/client-user';
import { getAvDb } from '@/lib/db/av';
import { logEvent } from '@/lib/events/log';
import { articleSlug } from '@/lib/newsroom/published';
import { CONTENT_EVENTS } from '@/lib/pr/types';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const runtime = 'nodejs';

const PUBLIC_TYPES = ['blog_article', 'seo_article', 'own_brand_post'];

interface ArtifactRow extends RowDataPacket {
  id: number;
  title: string | null;
  artifact_type: string;
  status: string;
}

export async function POST(req: NextRequest) {
  const actor = readClientActorFromHeaders(req.headers);
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const user = await findClientUserById(actor.clientUserId);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const artifactId =
    typeof body.artifactId === 'number' ? body.artifactId : Number.parseInt(String(body.artifactId), 10);
  if (!Number.isFinite(artifactId) || artifactId <= 0) {
    return NextResponse.json({ error: 'artifactId required' }, { status: 400 });
  }

  try {
    const db = getAvDb();
    // Ownership + state check: the artifact must belong to this client's leads
    // and already be approved.
    const [rows] = await db.execute<ArtifactRow[]>(
      `SELECT a.id, a.title, a.artifact_type, a.status
         FROM content_artifacts a
         JOIN leads l ON l.id = a.lead_id
        WHERE a.id = ?
          AND l.archived_at IS NULL
          AND ((? IS NOT NULL AND l.client_id = ?) OR l.email = ?)
        LIMIT 1`,
      [artifactId, user.client_id, user.client_id, user.email]
    );
    const art = rows[0];
    if (!art) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (!PUBLIC_TYPES.includes(art.artifact_type)) {
      return NextResponse.json({ error: 'this content type cannot be published to the newsroom' }, { status: 400 });
    }
    if (art.status === 'published') {
      return NextResponse.json({ ok: true, alreadyPublished: true, slug: articleSlug(art.title, art.id) });
    }
    if (art.status !== 'approved') {
      return NextResponse.json(
        { error: 'this piece is still in review and is not ready to publish yet' },
        { status: 409 }
      );
    }

    await db.execute<ResultSetHeader>(
      `UPDATE content_artifacts SET status = 'published', updated_at = NOW() WHERE id = ?`,
      [artifactId]
    );

    await logEvent({
      eventType: CONTENT_EVENTS.artifactPublished,
      source: 'client_portal',
      status: 'success',
      payload: { artifact_id: artifactId, destination: 'newsroom', published_by: 'client', client_user_id: user.client_user_id }
    });

    return NextResponse.json({ ok: true, slug: articleSlug(art.title, art.id) });
  } catch (err) {
    console.error('[client:campaign:publish]', (err as Error).message);
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
