/**
 * lib/ai/reply_classifier.ts
 *
 * Classify one inbound reply into one of:
 *   positive | interested | neutral | negative | autoresponder | unsubscribe | unknown
 *
 * Used by lib/email/reply_processor.ts after a driver pulls in fresh
 * replies. Classification drives:
 *   - automatic lead_status advancement (positive -> qualified)
 *   - the celebratory once-per-day toast on positive replies
 *   - "recent replies" sorting + filtering in the UI
 *
 * Cost: ~$0.003 per reply (gpt-4o-mini, ~400-token completion).
 */

import { parseOpenAIJson } from '@/lib/llm/parse';
import { runLlm } from '@/lib/llm/router';
import { getSystemPrompt } from '@/lib/ai/prompt_registry';

const TEMPERATURE = 0.2;
const MAX_TOKENS = 200;

export type ReplyClassification =
  | 'positive'
  | 'interested'
  | 'neutral'
  | 'negative'
  | 'autoresponder'
  | 'unsubscribe'
  | 'unknown';

export interface ReplyClassifyResult {
  classification: ReplyClassification;
  confidence: number;
  model: string;
  tokensUsed: number;
}

interface ClassifierJson {
  classification: ReplyClassification;
  confidence?: number;
}

export async function classifyReply(args: {
  fromAddress: string;
  subject: string | null;
  bodyPlain: string;
  /** (#371) Optional, threaded for per-client cost attribution. */
  clientId?: number | null;
}): Promise<ReplyClassifyResult> {
  // Cheap autoresponder + unsubscribe heuristics first -- save tokens
  // and reduce ambiguity for the model.
  const heuristic = heuristicClassify(args);
  if (heuristic) {
    return { ...heuristic, model: 'heuristic', tokensUsed: 0 };
  }

  // (#80) Operator-editable system prompt: getSystemPrompt returns the override
  // from ai_prompt_overrides if set, else REPLY_CLASSIFIER_DEFAULT.
  const system = await getSystemPrompt('reply_classifier');

  const user = [
    `FROM: ${args.fromAddress}`,
    `SUBJECT: ${args.subject ?? '(no subject)'}`,
    ``,
    `BODY:`,
    args.bodyPlain.slice(0, 2000)
  ].join('\n');

  // (#371) Cached by content hash — same body → same classification, so the
  // 7-day TTL on reply_classify means re-running a reply costs $0.
  const out = await runLlm({
    taskKind: 'reply_classify',
    note: `reply from ${args.fromAddress.slice(0, 64)}`,
    clientId: args.clientId ?? null,
    prompt: `SYSTEM:\n${system}\n\nUSER:\n${user}`,
    cacheKeyExtras: [args.fromAddress, args.subject ?? '', args.bodyPlain.slice(0, 400)],
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
    json: true
  });

  const parsed = parseOpenAIJson<ClassifierJson>(out.text);
  const classification = (parsed?.classification ?? 'unknown') as ReplyClassification;
  const confidence =
    typeof parsed?.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1
      ? parsed.confidence
      : 0.5;

  return {
    classification: VALID_LABELS.has(classification) ? classification : 'unknown',
    confidence,
    model: out.model,
    tokensUsed: out.inputTokens + out.outputTokens
  };
}

const VALID_LABELS: Set<ReplyClassification> = new Set([
  'positive',
  'interested',
  'neutral',
  'negative',
  'autoresponder',
  'unsubscribe',
  'unknown'
]);

function heuristicClassify(args: {
  fromAddress: string;
  subject: string | null;
  bodyPlain: string;
}): { classification: ReplyClassification; confidence: number } | null {
  const from = args.fromAddress.toLowerCase();
  const subj = (args.subject || '').toLowerCase();
  const body = (args.bodyPlain || '').toLowerCase();

  // Autoresponder telltales
  if (
    /auto[- ]?(reply|responder)/.test(subj) ||
    /out of office/.test(subj) ||
    /out of office/.test(body) ||
    /vacation responder/.test(body) ||
    /will be (out|away) (of the office|until)/.test(body) ||
    from.startsWith('noreply@') ||
    from.startsWith('no-reply@') ||
    from.startsWith('do-not-reply@') ||
    from.startsWith('mailer-daemon@')
  ) {
    return { classification: 'autoresponder', confidence: 0.95 };
  }
  // Unsubscribe telltales
  if (
    /\bunsubscribe\b/.test(body) ||
    /\bremove me\b/.test(body) ||
    /\bdo not (contact|email)\b/.test(body) ||
    /\bstop (emailing|contacting)\b/.test(body)
  ) {
    return { classification: 'unsubscribe', confidence: 0.9 };
  }
  return null;
}
