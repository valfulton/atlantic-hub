/**
 * POST /api/admin/av/clients/[client_id]/social/scrape-website  (#45)
 *
 * Pull socials from the brand's own website via the existing scraper
 * (lib/scraper/contact_page.findSocials). Body: { websiteUrl: string }.
 * Returns { found, saved, skipped } so the panel can show "Found 4, saved 3,
 * skipped 1 already on file."
 *
 * Operator-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { scrapeAndSuggestForBrand } from '@/lib/social/targets';
import { stampWebsiteOnBrief } from '@/lib/client/website_resolver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/social/scrape-website:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  let body: { websiteUrl?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const websiteUrl = typeof body.websiteUrl === 'string' ? body.websiteUrl.trim() : '';
  if (!websiteUrl) {
    return NextResponse.json({ error: 'websiteUrl required' }, { status: 400 });
  }

  try {
    const result = await scrapeAndSuggestForBrand(clientId, websiteUrl, guard.actor.userId ?? null);
    // (#517, val 2026-06-08) Successful scrape = that URL IS the client's
    // website. Stamp brief.website_url if currently blank.
    void stampWebsiteOnBrief('av', clientId, websiteUrl, {
      changedBy: guard.actor.userId ? `user:${guard.actor.userId}` : 'operator',
      source: 'social_scrape'
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'scrape failed';
    return NextResponse.json({ ok: false, error: msg.slice(0, 200) }, { status: 500 });
  }
}
