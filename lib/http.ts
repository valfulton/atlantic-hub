/**
 * lib/http.ts
 *
 * apiCall<T> — one client-side helper for talking to our own /api routes,
 * replacing the ~215 hand-rolled `fetch(..., { method, headers, body:
 * JSON.stringify(...) })` blocks across app/ and components/ (Lean Pass,
 * Duplication_Audit.md item #1).
 *
 * What it standardizes:
 *   - JSON bodies: sets Content-Type + JSON.stringify automatically.
 *   - FormData bodies: passed through untouched so the browser sets the
 *     multipart boundary (used by uploads, e.g. BrandKitPanel).
 *   - Method inference: GET when no body, POST when a body is given; override
 *     via opts.method for PUT/PATCH/DELETE.
 *   - cache: 'no-store' by default (matches how nearly every call site reads
 *     live data); override via opts.cache.
 *   - Errors: throws ApiError on a non-2xx response, carrying status + body
 *     text so callers can branch on err.status. Call sites that previously
 *     ignored !res.ok silently MUST wrap in try/catch — that surfacing is
 *     intentional, not a regression.
 *   - Empty/204 responses return undefined; JSON responses are parsed and
 *     returned as T; anything else returns the raw text.
 *
 * Server-side data access does NOT use this — it talks to the DB directly via
 * lib/db. apiCall is for browser → our API only.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly body: string;
  readonly path: string;
  constructor(status: number, body: string, path: string) {
    super(`apiCall ${path} failed: ${status} ${body || ''}`.trim());
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

export interface ApiOpts {
  /** Override the inferred method (GET when no body, else POST). */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Extra headers, merged after the auto Content-Type for JSON bodies. */
  headers?: Record<string, string>;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Override the default 'no-store'. */
  cache?: RequestCache;
}

/**
 * Call one of our own /api routes and get back parsed JSON typed as T.
 *
 *   const data = await apiCall<Campaign[]>('/api/admin/campaigns');           // GET
 *   await apiCall('/api/admin/av/enrich', { auditIds });                      // POST JSON
 *   await apiCall('/api/admin/brand-kit/library', form);                      // POST FormData
 *   await apiCall(`/api/x/${id}`, body, { method: 'PUT' });                   // PUT
 *
 * Throws ApiError on a non-2xx response.
 */
export async function apiCall<T = unknown>(
  path: string,
  body?: unknown,
  opts: ApiOpts = {},
): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const method = opts.method ?? (body === undefined ? 'GET' : 'POST');

  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  let payload: BodyInit | undefined;

  if (body !== undefined) {
    if (isForm) {
      payload = body as FormData; // let the browser set the multipart boundary
    } else {
      headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
      payload = JSON.stringify(body);
    }
  }

  const res = await fetch(path, {
    method,
    cache: opts.cache ?? 'no-store',
    signal: opts.signal,
    headers,
    body: payload,
  });

  if (!res.ok) {
    let text = '';
    try {
      text = await res.text();
    } catch {
      /* body already consumed or unavailable */
    }
    throw new ApiError(res.status, text, path);
  }

  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}
