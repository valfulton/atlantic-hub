/**
 * lib/campaigns/propose_lines.ts
 *
 * Auto-propose narrative-line CANDIDATES from a client's intake/brief. Closes the
 * onboarding loop: instead of a blank cockpit, the moment a client's intake is in,
 * the hub suggests the top 2-3 market theses they could credibly lead.
 *
 * Reuses the editable `thesis_suggester` system prompt (Constitution: do not
 * reinvent the suggester) and `createLane`. Lines land as 'candidate' (never
 * auto-active), so val reviews/activates them. Guarded: if the client already has
 * lines, it does nothing — re-running intake extraction won't spam duplicates.
 */
import { createLane, listLinesForCockpit } from '@/lib/campaigns/store';
import { getBriefForPrompt, getBriefPayload } from '@/lib/client/brief_store';
import { getSystemPrompt } from '@/lib/ai/prompt_registry';
import { parseOpenAIJson } from '@/lib/openai/client';
import { runLlm } from '@/lib/llm/router';
import { logEvent } from '@/lib/events/log';

// (#361) Model decided by TASK_MODEL['narrative_line_propose'].
const MAX_LINES = 3;

export interface ProposeLinesResult {
  proposed: number;
  theses: string[];
  reason?: 'already_has_lines' | 'empty';
}

export async function proposeLinesFromIntake(args: {
  clientId: number;
  tenantId?: string;
}): Promise<ProposeLinesResult> {
  const tenantId = args.tenantId ?? 'av';
  const { clientId } = args;

  // Guard against duplicate spam: only propose for a client with no lines yet.
  try {
    const all = await listLinesForCockpit();
    if (all.some((l) => l.tenantId === tenantId && l.clientId === clientId)) {
      return { proposed: 0, theses: [], reason: 'already_has_lines' };
    }
  } catch {
    /* if the listing fails, proceed — better to propose than to block */
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await getBriefPayload(tenantId, clientId)) ?? {};
  } catch {
    payload = {};
  }
  const brief = await getBriefForPrompt({ tenantId, clientId });

  const system = await getSystemPrompt('thesis_suggester');
  const user = [
    brief.block,
    ``,
    `This is a CLIENT account. From the client's intake/brief below, propose up to ${MAX_LINES} DISTINCT, believable market-thesis narrative lines this client could credibly lead — grounded in their positioning, audience, differentiators, and authority topics. Each thesis is ONE present-tense sentence asserting a market shift the client can own (a thesis, NOT a slogan or category).`,
    ``,
    `CLIENT_INTAKE (JSON — their answers):`,
    JSON.stringify(payload).slice(0, 6000),
    ``,
    `Return ONLY JSON: {"theses":[{"thesis":"...","audience":"...","why":"..."}]}`
  ].join('\n');

  const theses: { thesis: string; audience?: string }[] = [];
  try {
    // (#361) Event-cached on brief hash — brief edit produces fresh theses.
    const briefStamp = JSON.stringify(payload).slice(0, 500);
    const completion = await runLlm({
      taskKind: 'narrative_line_propose',
      clientId,
      note: `narrative_line_propose · client ${clientId}`,
      prompt: `SYSTEM:\n${system}\n\nUSER:\n${user}`,
      cacheKeyExtras: [String(clientId), briefStamp, system.slice(0, 200)],
      json: true,
      temperature: 0.8,
      maxTokens: 700
    });
    const parsed = parseOpenAIJson<{ theses?: Array<{ thesis?: unknown; audience?: unknown }> }>(completion.text);
    for (const t of parsed?.theses ?? []) {
      const thesis = typeof t.thesis === 'string' ? t.thesis.trim() : '';
      if (!thesis) continue;
      theses.push({
        thesis: thesis.slice(0, 280),
        audience: typeof t.audience === 'string' ? t.audience.trim().slice(0, 280) : undefined
      });
      if (theses.length >= MAX_LINES) break;
    }
  } catch {
    return { proposed: 0, theses: [], reason: 'empty' };
  }

  if (theses.length === 0) return { proposed: 0, theses: [], reason: 'empty' };

  let proposed = 0;
  for (const t of theses) {
    try {
      await createLane({
        tenantId,
        clientId,
        name: t.thesis.slice(0, 80),
        thesis: t.thesis,
        audience: t.audience ?? null,
        state: 'candidate'
      });
      proposed++;
    } catch {
      /* skip a line that fails to persist; keep the rest */
    }
  }

  await logEvent({
    eventType: 'ai.lines_proposed',
    source: 'intake',
    payload: { client_id: clientId, proposed }
  }).catch(() => {});

  return { proposed, theses: theses.map((t) => t.thesis) };
}
