# Atlantic Hub Worker

Long-running Node process for heavy AI work (bulk refresh, score sweeps,
pain sweeps). Runs on HostGator's Node app manager so we are NOT bound by
Netlify's 60-second function timeout.

**Why this exists:** see task #225. After #201/#202 made the Mode-A prompts
longer, individual gpt-4o-mini calls can run 12-20s. Even with chunking,
bulk refresh of 8+ leads regularly hits Netlify's 60s ceiling. The worker
has a 5-minute soft deadline and can chew through 50+ leads in one request.

## Architecture in one sentence

The worker imports the SAME `lib/ai/*` modules as the hub (via tsconfig path
alias `@/lib/* → ../lib/*`), so any prompt change you push to the hub repo
lands on the worker on the next rebuild.

## Quick start (local dev)

```bash
cd worker
npm install
# Set the same DB env vars + OPENAI_API_KEY the hub uses
export WORKER_SECRET=dev-secret-change-me
export HUB_ORIGIN=http://localhost:3000
npm run dev          # tsx watch, hot reload
# In another shell, test:
curl http://localhost:4001/health
```

## Production deployment

See `Atlantic_Hub_Playbook/Worker_Deployment_HostGator.md` for the full
runbook (cPanel setup, env vars, smoke tests, release cycle, troubleshooting).

## Endpoints

| Method | Path | Auth | Body |
|---|---|---|---|
| GET | `/health` | none | — |
| POST | `/refresh-intel` | `X-Worker-Secret` | `{ auditIds: string[], audits?: bool, callScripts?: bool, outreach?: bool }` |

Auth is a single shared-secret header `X-Worker-Secret` matched against env
`WORKER_SECRET`. CORS is locked to env `HUB_ORIGIN`.

## What's wired to it

The hub UI checks `process.env.NEXT_PUBLIC_WORKER_URL` at build time:
- Set → bulk-refresh button posts to `${WORKER_URL}/refresh-intel`
- Unset → falls back to Netlify endpoint `/api/admin/av/leads/refresh-intel`

So a worker outage degrades gracefully to the Netlify path (slower, smaller
batches, but functional).

## Adding more endpoints

When you move the next piece of heavy AI work (score-sweep cron, pain-sweep
cron, etc.) to the worker:

1. Add the new endpoint in `src/server.ts`
2. Reuse the hub's existing module — `import { … } from '@/lib/ai/...'`
3. Update `Worker_Deployment_HostGator.md` "What's NOT yet on the worker" table
4. Add the Netlify-side flag/env if needed so the hub knows to route there
