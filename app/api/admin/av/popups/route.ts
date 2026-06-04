/**
 * /api/admin/av/popups  (#408)
 *
 * GET  → current slides (override or default)
 * POST → save new slides. Operator-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getWelcomePopupSlides, saveWelcomePopupSlides, DEFAULT_SLIDES, type WelcomeSlide } from '@/lib/welcome/copy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requireOperator(): NextResponse | null {
  const role = headers().get('x-ah-user-role') as 'owner' | 'staff' | 'client_user' | null;
  if (role !== 'owner' && role !== 'staff') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const forbidden = requireOperator();
  if (forbidden) return forbidden;
  const slides = await getWelcomePopupSlides();
  return NextResponse.json({ ok: true, slides, defaults: DEFAULT_SLIDES });
}

export async function POST(req: NextRequest) {
  const forbidden = requireOperator();
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 });
  }
  const slides = (body as { slides?: unknown })?.slides;
  if (!Array.isArray(slides) || slides.length === 0) {
    return NextResponse.json({ ok: false, error: 'slides_required' }, { status: 400 });
  }
  // Minimal shape validation — keeps DB row well-formed without being
  // pedantic about every property (the editor enforces shape too).
  const cleaned: WelcomeSlide[] = slides.map((s: unknown) => {
    const x = s as Record<string, unknown>;
    return {
      eyebrow: String(x.eyebrow ?? ''),
      title: String(x.title ?? ''),
      body: String(x.body ?? ''),
      hrefLabel: x.hrefLabel ? String(x.hrefLabel) : undefined,
      href: x.href ? String(x.href) : undefined,
      tiers: Array.isArray(x.tiers) ? (x.tiers as string[]).filter((t) =>
        ['audit_only', 'sprint', 'momentum', 'scale'].includes(t)
      ) as WelcomeSlide['tiers'] : undefined
    };
  });

  await saveWelcomePopupSlides(cleaned, 'operator');
  return NextResponse.json({ ok: true, slides: cleaned });
}
