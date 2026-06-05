/**
 * POST /api/admin/av/clients/[client_id]/public-intel/smoke-test   (#429, val 2026-06-05)
 *
 * One-click "is every adapter actually working?" endpoint. Runs each
 * available adapter that already has a configured source row, captures
 * per-adapter result, returns a single roll-up. Adapters with no source
 * row (never configured) get reported as 'not_configured' rather than
 * silently skipped — that's the visibility val asked for after MD
 * Land Records swallowed every error before this bundle.
 *
 * Owner / staff only. Capped at 60s — if an adapter is slow it'll
 * timeout cleanly with status='timeout' rather than poisoning the rest.
 */
import { NextRequest, NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/api-guard';
import { listAdapters } from '@/lib/public_intel/registry';
import { listSourcesForClient } from '@/lib/public_intel/store';
import type { PublicIntelKind, PublicIntelAdapter, RunResult, PublicIntelSource } from '@/lib/public_intel/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface AdapterResult {
  kind: PublicIntelKind;
  displayName: string;
  status: 'ok' | 'error' | 'skipped' | 'timeout' | 'not_configured' | 'disabled' | 'not_available';
  written: number;
  fromCache: number;
  detail: string;
  elapsedMs: number;
}

/** Race adapter.run() vs a hard timeout so one slow source can't sink the sweep. */
async function runWithTimeout(
  adapter: PublicIntelAdapter,
  source: PublicIntelSource,
  clientId: number,
  timeoutMs: number
): Promise<RunResult & { timedOut?: boolean }> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      adapter.run({ source, clientId }),
      new Promise<RunResult & { timedOut: true }>((resolve) => {
        timer = setTimeout(
          () => resolve({ ok: false, written: 0, fromCache: 0, detail: `timeout after ${timeoutMs}ms`, timedOut: true }),
          timeoutMs
        );
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function POST(req: NextRequest, { params }: { params: { client_id: string } }) {
  const guard = await guardAdminRequest(req, {
    targetResource: '/api/admin/av/clients/public-intel/smoke-test:POST',
    tenantId: 'av'
  });
  if (!guard.ok) return guard.response;
  if (guard.actor.role === 'client_user') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const clientId = Number.parseInt(params.client_id, 10);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return NextResponse.json({ error: 'invalid client id' }, { status: 400 });
  }

  const adapters = listAdapters();
  const sources = await listSourcesForClient(clientId);
  const byKind = new Map(sources.map((s) => [s.sourceKind, s]));

  // Each adapter gets ~10s before we move on. Conservative — total run time
  // is capped at maxDuration; if all adapters take their full budget we
  // run sequentially to keep memory + outbound-connection pressure low.
  const PER_ADAPTER_TIMEOUT = 10_000;
  const results: AdapterResult[] = [];
  const startedAt = Date.now();

  for (const { adapter, available } of adapters) {
    const t0 = Date.now();

    if (!available) {
      results.push({
        kind: adapter.kind,
        displayName: adapter.displayName,
        status: 'not_available',
        written: 0,
        fromCache: 0,
        detail: 'adapter not yet implemented (registered as stub)',
        elapsedMs: 0
      });
      continue;
    }

    const source = byKind.get(adapter.kind);
    if (!source) {
      results.push({
        kind: adapter.kind,
        displayName: adapter.displayName,
        status: 'not_configured',
        written: 0,
        fromCache: 0,
        detail: 'no source row for this client — open the adapter card and click Save',
        elapsedMs: 0
      });
      continue;
    }
    if (!source.enabled) {
      results.push({
        kind: adapter.kind,
        displayName: adapter.displayName,
        status: 'disabled',
        written: 0,
        fromCache: 0,
        detail: 'source row exists but is toggled off',
        elapsedMs: 0
      });
      continue;
    }

    try {
      const r = await runWithTimeout(adapter, source, clientId, PER_ADAPTER_TIMEOUT);
      const elapsedMs = Date.now() - t0;
      const timedOut = (r as { timedOut?: boolean }).timedOut === true;
      const status: AdapterResult['status'] = timedOut
        ? 'timeout'
        : r.ok
          ? r.written === 0 && r.fromCache === 0
            ? 'skipped'
            : 'ok'
          : 'error';
      results.push({
        kind: adapter.kind,
        displayName: adapter.displayName,
        status,
        written: r.written,
        fromCache: r.fromCache,
        detail: (r.detail || '').slice(0, 280),
        elapsedMs
      });
    } catch (err) {
      const elapsedMs = Date.now() - t0;
      results.push({
        kind: adapter.kind,
        displayName: adapter.displayName,
        status: 'error',
        written: 0,
        fromCache: 0,
        detail: `${(err as Error).name}: ${(err as Error).message}`.slice(0, 280),
        elapsedMs
      });
    }

    // If we're close to the function budget, stop early and mark the rest.
    if (Date.now() - startedAt > 45_000) {
      const seen = new Set(results.map((r) => r.kind));
      for (const { adapter: rest } of adapters) {
        if (seen.has(rest.kind)) continue;
        results.push({
          kind: rest.kind,
          displayName: rest.displayName,
          status: 'timeout',
          written: 0,
          fromCache: 0,
          detail: 'smoke-test budget exhausted before this adapter ran',
          elapsedMs: 0
        });
      }
      break;
    }
  }

  // Roll-up counts for the operator card.
  const summary = results.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    },
    {} as Record<AdapterResult['status'], number>
  );

  return NextResponse.json({
    ok: true,
    clientId,
    ranAt: new Date().toISOString(),
    totalElapsedMs: Date.now() - startedAt,
    summary,
    results
  });
}
