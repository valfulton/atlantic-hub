/**
 * lib/copy/accent.tsx  (newsroom team, 2026-06-04)
 *
 * Render an editable copy string while preserving the brand fingerprint: the
 * one italicised accent word. Authors mark the accent with *asterisks* and
 * interpolate variables with {name}:
 *
 *   accent("Who's about to need you, *{firstName}.*", { firstName })
 *     → Who's about to need you, <em>Adriana.</em>
 *
 * Keeps headlines fully editable in /admin/av/copy without baking <em> into
 * the page or losing the italic accent.
 */
import React from 'react';

export function accent(tpl: string, vars: Record<string, string> = {}): React.ReactNode {
  let s = tpl ?? '';
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
  const parts = s.split('*');
  return parts.map((p, i) =>
    i % 2 === 1
      ? <em key={i}>{p}</em>
      : <React.Fragment key={i}>{p}</React.Fragment>
  );
}
