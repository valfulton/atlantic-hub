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

import {
  openaiChatCompletion,
  parseOpenAIJson
} from '@/lib/openai/client';

const MODEL = 'gpt-4o-mini';
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
}): Promise<ReplyClassifyResult> {
  // Cheap autoresponder + unsubscribe heuristics first -- save tokens
  // and reduce ambiguity for the model.
  const heuristic = heuristicClassify(args);
  if (heuristic) {
    return { ...heuristic, model: 'heuristic', tokensUsed: 0 };
  }

  const system = [
    `You classify the FIRST inbound reply to a cold-but-personalized outreach email.`,
    `Output one of: positive | interested | neutral | negative | autoresponder | unsubscribe | unknown.`,
    ``,
    `Definitions:`,
    `- positive       => recipient wants to take a meeting, book a call, or otherwise engage commercially. "yes, send a time", "let's chat", "interested in seeing more".`,
    `- interested     => recipient asks a relevant follow-up question or signals curiosity but did not commit. "tell me more about pricing", "how does it work".`,
    `- neutral        => non-committal acknowledgment. "thanks, will look later", forwarding to a colleague.`,
    `- negative       => clearly says no. "not interested", "we already have this", "stop emailing me but not unsubscribe-y".`,
    `- autoresponder  => out-of-office, vacation, holiday, automatic reply, ticket-system noreply.`,
    `- unsubscribe    => explicit unsubscribe request, "remove me from your list", "do not contact".`,
    `- unknown        => cannot tell.`,
    ``,
    `Respond ONLY with JSON: { "classification": "...", "confidence": 0.0-1.0 }`
  ].join('\n');

  const user = [
    `FROM: ${args.fromAddress}`,
    `SUBJECT: ${args.subject ?? '(no subject)'}`,
    ``,
    `BODY:`,
    args.bodyPlain.slice(0, 2000)
  ].join('\n');

  const out = await openaiChatCompletion(
    [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    { model: MODEL, temperature: TEMPERATURE, maxTokens: MAX_TOKENS, json: true }
  );

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
    tokensUsed: out.usage.totalTokens
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
