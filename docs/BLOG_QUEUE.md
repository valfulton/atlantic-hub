# Atlantic Hub — Blog Content Queue

> Source of truth for blog content ideas across HunterHoney, Atlantic & Vine, and Events by Water. A future auto-blog agent reads this file and produces drafts. Until that agent is built, this is also a human-readable backlog for any writer to work from.

## How to add an entry
Append a new `###` section to the right brand. Fill every field. Mark `status` as `queued` until written, `drafted` once a draft exists, `published` once live.

## Schema for each entry
- **id** — slug like `hh-2026-05-jws-secrets`
- **brand** — `hunterhoney` | `atlantic-and-vine` | `events-by-water`
- **status** — `queued` | `drafted` | `published`
- **target_audience** — who the post is for, one sentence
- **working_title**
- **angle** — the lens of the post, 1–2 sentences
- **key_points** — 3–5 bullets
- **compliance_hook** — which regime / control this maps to, if any
- **client_one_liner** — the quotable sentence
- **estimated_word_count** — 600 / 1000 / 1500
- **cta** — what action the reader should take
- **internal_links** — files in this repo that an agent could pull context from
- **created** — date

---

## HunterHoney brand

### hh-2026-05-process-list-secrets
- **id**: hh-2026-05-process-list-secrets
- **brand**: hunterhoney
- **status**: queued
- **target_audience**: Financial advisors and RIA compliance officers evaluating Atlantic Hub as a vendor
- **working_title**: "The `ps aux` Attack Nobody Warns You About"
- **angle**: Most developers know not to hardcode secrets in source, but fewer know their test scripts are leaking them to the process table right now.
- **key_points**:
  - Command-line arguments to any running process are visible via `ps aux` to all users on the system
  - Environment variables scoped to a child process are not exposed the same way
  - CI runners are often shared — a secret passed as an argument is a secret exposed to every job on that runner
  - The fix is one line: prefix the command with `KEY="$val" node ...` instead of `node ... "$val"`
  - This is the kind of detail that separates a security-reviewed platform from a weekend project
- **compliance_hook**: SOC 2 CC6.1 (logical access controls over sensitive data); SEC Reg S-P Safeguards Rule (protection of client information)
- **client_one_liner**: "We treat your webhook credentials the same way we'd treat a production database password — never in a place where another process could read it."
- **estimated_word_count**: 800
- **cta**: Schedule a 20-minute Atlantic Hub demo to see the audit log in action.
- **internal_links**: ["docs/SECURITY_WINS.md"]
- **created**: 2026-05-11

---

### hh-2026-05-signature-determinism
- **id**: hh-2026-05-signature-determinism
- **brand**: hunterhoney
- **status**: queued
- **target_audience**: Financial advisors and RIA compliance officers evaluating Atlantic Hub as a vendor
- **working_title**: "The One-Second Race Condition in Your Webhook Tests"
- **angle**: A subtle timestamp drift bug that produces intermittent false failures and is almost impossible to reproduce on demand.
- **key_points**:
  - JWS verification recomputes a SHA-256 digest of the raw body and compares it to the signed claim
  - If a timestamp is generated twice — once when building the body, once when building the signature input — a one-second drift produces a mismatch
  - The test passes on 99% of runs and fails mysteriously on the rest
  - The fix: capture the timestamp once and reuse it throughout
  - Hash determinism is not just a cryptographic principle — it's a test design principle
- **compliance_hook**: SOC 2 CC6.7 (transmission integrity)
- **client_one_liner**: "Our test suite verifies signatures the same way our server does — against the exact bytes that were sent, not an approximation."
- **estimated_word_count**: 800
- **cta**: Schedule a 20-minute Atlantic Hub demo to see the audit log in action.
- **internal_links**: ["docs/SECURITY_WINS.md"]
- **created**: 2026-05-11

---

### hh-2026-05-curl-data-raw
- **id**: hh-2026-05-curl-data-raw
- **brand**: hunterhoney
- **status**: queued
- **target_audience**: Financial advisors and RIA compliance officers evaluating Atlantic Hub as a vendor
- **working_title**: "curl -d Will Lie to You"
- **angle**: A practical guide to the difference between `-d`, `--data-raw`, `--data-binary`, and `--data-urlencode`, and why it matters for any test that touches request integrity.
- **key_points**:
  - `curl -d` silently interprets `@` as a file reference and URL-encodes certain characters
  - `--data-raw` sends the string exactly as provided, with no transformation
  - In a JWS smoke test, any silent body transformation breaks the SHA-256 claim match
  - A test using `-d` with a JWS payload is a false green — it passes without ever verifying real signature integrity
  - Test fidelity is a security control, not just a code quality preference
- **compliance_hook**: SOC 2 CC4.1 (quality of testing / test fidelity)
- **client_one_liner**: "We verified our tests actually send what they sign — a detail that sounds obvious until you've debugged a signature mismatch at midnight."
- **estimated_word_count**: 800
- **cta**: Schedule a 20-minute Atlantic Hub demo to see the audit log in action.
- **internal_links**: ["docs/SECURITY_WINS.md"]
- **created**: 2026-05-11

---

### hh-2026-05-negative-crypto-testing
- **id**: hh-2026-05-negative-crypto-testing
- **brand**: hunterhoney
- **status**: queued
- **target_audience**: Financial advisors and RIA compliance officers evaluating Atlantic Hub as a vendor
- **working_title**: "Your Negative Tests Are Probably Not Testing What You Think"
- **angle**: The difference between testing that a system rejects noise versus testing that it rejects a well-formed forgery, and why only one of those finds real vulnerabilities.
- **key_points**:
  - A test that sends a hardcoded garbage string only proves the server rejects malformed input
  - It does not prove the HMAC verification code path ever ran
  - A real negative test generates a valid, structurally correct token — then corrupts one field
  - A 401 from that test proves the server parsed the token, ran the crypto, and detected the mismatch
  - SOC 2 auditors distinguish between noise-rejection tests and forgery-rejection tests
- **compliance_hook**: SOC 2 CC4.1 (negative testing)
- **client_one_liner**: "We don't just test that our front door rejects strangers — we test that it rejects someone who's copied the shape of the key but not the teeth."
- **estimated_word_count**: 800
- **cta**: Schedule a 20-minute Atlantic Hub demo to see the audit log in action.
- **internal_links**: ["docs/SECURITY_WINS.md"]
- **created**: 2026-05-11

---

## Atlantic & Vine brand

<!-- queue entries for atlantic-and-vine go here -->

---

## Events by Water brand

<!-- queue entries for events-by-water go here -->

---

## Future: auto-generation roadmap

When we build the blog generator agent, it reads this file and produces Markdown drafts to a separate `drafts/` folder. The agent will need:

- Brand voice prompts for each of the three brands (separate prompts, separate audience)
- A reviewer approval step (no auto-publish in v1)
- A cost cap per month
- A "do not publish without compliance review" flag on any entry tagged with a compliance_hook
- A "regenerate with feedback" loop so drafts can be iterated

See docs/SECURITY_WINS.md for the source material on HunterHoney security entries.
