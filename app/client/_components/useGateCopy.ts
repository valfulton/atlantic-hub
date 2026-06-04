/**
 * useGateCopy — client hook for editable copy on PRE-AUTH gate pages.
 *
 * Pass the hardcoded DEFAULTS (the approved copy). They render immediately —
 * no flash — and any operator override (edited at /admin/av/copy, global
 * scope) is fetched from /api/public/copy and overlaid. Gate-only keys.
 *
 *   const c = useGateCopy({ 'gate.client_login.h1': 'Welcome *back.*', … });
 *   <h1>{accent(c['gate.client_login.h1'])}</h1>
 */
'use client';
import { useEffect, useState } from 'react';

export function useGateCopy(defaults: Record<string, string>): Record<string, string> {
  const [copy, setCopy] = useState<Record<string, string>>(defaults);
  useEffect(() => {
    const keys = Object.keys(defaults);
    if (!keys.length) return;
    let alive = true;
    fetch('/api/public/copy?keys=' + encodeURIComponent(keys.join(',')), { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (alive && d?.copy) setCopy({ ...defaults, ...d.copy }); })
      .catch(() => { /* keep defaults */ });
    return () => { alive = false; };
    // defaults are a stable literal per render-site; intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return copy;
}
