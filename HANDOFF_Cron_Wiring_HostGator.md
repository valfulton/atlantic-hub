# HANDOFF — Cron wiring on HostGator (#380, val 2026-06-03)

The Atlantic Hub Revenue Intelligence engine pulls public data on a schedule.
We host the cron schedule on **HostGator** (not Netlify) so it doesn't burn
function-invocation credits. HostGator hits the Hub's worker-token-protected
endpoint, which then runs the adapter sweeps + cascade sweeps + distress
rescores per enabled client.

---

## 1. Migration

Run once against `shhdbite_AV`:

```
schema/070_worker_run_log.sql
```

Creates `worker_run_log` (one row per scheduled run, used by the Intelligence
Feed panel to show "last refreshed Xh ago").

---

## 2. Netlify env vars

Set in the Atlantic Hub site:

| Name                     | Value                                         |
|--------------------------|-----------------------------------------------|
| `WORKER_INTERNAL_TOKEN`  | a random 48-char string (rotate quarterly)    |
| `GOOGLE_PLACES_API_KEY`  | (already set for per-lead enrichment)         |
| `COURTLISTENER_TOKEN`    | optional · raises CourtListener rate limit    |

**Never log the token value.**

---

## 3. HostGator worker script

Save as `~/atlantic_hub_cron.sh`, chmod 700. Replace `<TOKEN>` with the value
from `WORKER_INTERNAL_TOKEN` (store in `~/.atlantic_hub_env`, mode 600, sourced
below — never inline the token in cron rows or scripts).

```bash
#!/usr/bin/env bash
# atlantic_hub_cron.sh — HostGator → Atlantic Hub worker bridge

set -euo pipefail
source "$HOME/.atlantic_hub_env"   # exports WORKER_INTERNAL_TOKEN

HUB="https://atlantic-hub.netlify.app"
TASK="${1:?usage: atlantic_hub_cron.sh <task>}"

curl --silent --show-error --max-time 55 \
  -X POST "$HUB/api/cron/public-intel" \
  -H "Authorization: Bearer ${WORKER_INTERNAL_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"task\":\"${TASK}\"}" \
  >> "$HOME/atlantic_hub_cron.log" 2>&1

echo "" >> "$HOME/atlantic_hub_cron.log"
```

`~/.atlantic_hub_env` contents (mode 600):

```bash
export WORKER_INTERNAL_TOKEN='<paste-the-48-char-token-here>'
```

---

## 4. HostGator cPanel cron entries

| Cadence                | Schedule          | Command                                                    |
|------------------------|-------------------|------------------------------------------------------------|
| Daily — CourtListener+PACER | `15 6 * * *`  | `~/atlantic_hub_cron.sh daily-courtlistener`               |
| Weekly — CFPB+SOS+UCC  | `30 6 * * MON`    | `~/atlantic_hub_cron.sh weekly-cfpb-sos-ucc`               |
| Weekly — GBP snapshots | `45 6 * * MON`    | `~/atlantic_hub_cron.sh weekly-gbp`                        |
| Monthly — HMDA+ACS     | `0 7 1 * *`       | `~/atlantic_hub_cron.sh monthly-hmda-acs`                  |
| Nightly — distress     | `30 2 * * *`      | `~/atlantic_hub_cron.sh nightly-distress`                  |

Hub-side timeout is 60s per task. Tasks process clients sequentially, so a
single task call is bounded by the number of enabled clients × their adapter
cost. If the per-task wall time approaches 50s in production, chunk the task
or accept partial completion (the run-log will reflect it).

---

## 5. Verifying

1. From a laptop terminal:
   ```
   curl -i -X POST https://atlantic-hub.netlify.app/api/cron/public-intel \
     -H "Authorization: Bearer $WORKER_INTERNAL_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"task":"nightly-distress"}'
   ```
   Expect `{ "ok": true, "task": "nightly-distress", "clientsRescored": N }`.

2. Open `/admin/av/clients/<id>` → **Intelligence feed** → click **Show**.
   You should see a `refresh · nightly-distress · ok` row near the top.

3. If 401 → token mismatch. If 400 → unknown task name.

---

## 6. Tasks <-> adapter map

`/api/cron/public-intel` accepts these tasks; each runs only the listed
adapters for clients that have those adapters enabled in
`public_intel_sources`:

| Task                       | Adapters fired                          |
|----------------------------|------------------------------------------|
| `daily-courtlistener`      | `courtlistener`, `pacer_docket`          |
| `weekly-cfpb-sos-ucc`      | `cfpb`, `ca_sos`, `ucc_ca`               |
| `weekly-gbp`               | `gbp`                                    |
| `monthly-hmda-acs`         | `hmda`, `census_acs`                     |
| `nightly-distress`         | (no adapter — rescore + cascade sweep)   |

Adding a new adapter? Add it to `TASK_TO_KINDS` in
`app/api/cron/public-intel/route.ts` and update this table.
