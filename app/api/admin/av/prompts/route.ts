/**
 * GET  /api/admin/av/prompts            -> list every editable prompt (+ overridden flag)
 * GET  /api/admin/av/prompts?key=KEY    -> full view of one prompt (default + override)
 * POST /api/admin/av/prompts            -> { key, systemText }          save an override
 * POST /api/admin/av/prompts            -> { key, action: 'reset' }     reset to default
 *
 * The one place val views/edits the platform's AI prompts. Owner + staff only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { isFlagEnabled } from '@/lib/feature-flags';
import {
  listPromptDefs,
  getEffectivePrompt,
  savePromptOverride,
  resetPromptOverride
} from '@/lib/ai/prompt_registry';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/prompts', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_av_enabled'))) return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });

  const key = new URL(req.url).searchParams.get('key');
  if (key) {
    const prompt = await getEffectivePrompt(key);
    if (!prompt) return NextResponse.json({ error: 'unknown prompt key' }, { status: 404 });
    return NextResponse.json({ ok: true, prompt });
  }

  // List view: each def + whether it currently has an override.
  const defs = listPromptDefs();
  const list = await Promise.all(
    defs.map(async (d) => {
      const eff = await getEffectivePrompt(d.key);
      return {
        key: d.key,
        label: d.label,
        description: d.description,
        isOverridden: !!eff?.isOverridden,
        updatedAt: eff?.updatedAt ?? null
      };
    })
  );
  return NextResponse.json({ ok: true, prompts: list });
}

export async function POST(req: NextRequest) {
  const guard = await guardAdminRequest(req, { targetResource: '/api/admin/av/prompts:POST', tenantId: 'av' });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await isFlagEnabled('tab_av_enabled'))) return NextResponse.json({ error: 'av tab disabled' }, { status: 403 });

  let body: { key?: unknown; systemText?: unknown; action?: unknown } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const key = typeof body.key === 'string' ? body.key : '';
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });

  const updatedBy = (guard.actor as { email?: string }).email ?? null;

  try {
    if (body.action === 'reset') {
      const ok = await resetPromptOverride(key);
      if (!ok) return NextResponse.json({ error: 'unknown prompt key' }, { status: 404 });
    } else {
      const systemText = typeof body.systemText === 'string' ? body.systemText : '';
      const ok = await savePromptOverride(key, systemText, updatedBy);
      if (!ok) return NextResponse.json({ error: 'unknown prompt key' }, { status: 404 });
    }
    const prompt = await getEffectivePrompt(key);
    return NextResponse.json({ ok: true, prompt });
  } catch (err) {
    return NextResponse.json({ error: 'server error', errorClass: (err as Error).name }, { status: 500 });
  }
}
