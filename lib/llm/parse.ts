/**
 * lib/llm/parse.ts  (#372, val 2026-06-03)
 *
 * The JSON-response parser for runLlm output. OpenAI sometimes wraps JSON in
 * ```json fences even with response_format=json_object; other providers do
 * the same. This helper strips fences + parses safely.
 *
 * Moved from lib/openai/client.ts after the LLM Coverage 100% sweep (#371) so
 * call sites no longer carry a legacy `@/lib/openai/client` import path. The
 * function is pure string work — no API dependency.
 */

/**
 * Safe JSON parse with fallback. Strips ```json / ``` fences before parsing.
 * Returns null on failure rather than throwing — caller decides what to do.
 */
export function parseLlmJson<T = unknown>(text: string): T | null {
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

// (#372) Back-compat alias — older imports still reference parseOpenAIJson by
// name from the legacy module. Re-exporting under the new neutral name lets
// us cut the import path over without changing call-site names.
export { parseLlmJson as parseOpenAIJson };
