# Atlantic Hub — Security Wins Log
> A founder-readable log of subtle security decisions that distinguish a real platform from a weekend project. Each entry is a future blog post and a future client conversation.

---

## Win 1 — Secrets via environment variables, not command-line arguments

### What we did
In `tests/smoke.sh`, the shared webhook secret is passed to the Node JWS-generation snippet via inline environment variables (`JWS_SECRET="$secret" node -e "..."`) rather than as a command-line argument to the Node process.

### Why it matters
On any Unix system, command-line arguments to running processes are visible in the process table — any user with access to `ps aux` can read them. Environment variables scoped to a child process are not exposed that way. On a shared CI runner or a developer machine with other users, the difference between "secret visible to everyone" and "secret visible to the process only" is one design choice.

### Compliance mapping
SOC 2 CC6.1 (logical access controls over sensitive data) and SEC Reg S-P Safeguards Rule (protection of client information) — both require that credentials not be exposed through unintended channels. Keeping secrets out of the process table is a concrete, auditable instance of that control.

### Client-facing one-liner
> "We treat your webhook credentials the same way we'd treat a production database password — never in a place where another process could read it."

### Blog post idea (TODO)
**"The `ps aux` Attack Nobody Warns You About"** — most developers know not to hardcode secrets in source, but fewer know their test scripts are leaking them to the process table right now.

---

## Win 2 — Consistent timestamps across signature components

### What we did
In test 4 of `tests/smoke.sh`, the Unix timestamp used in the request body (`id`, `email`) is captured once into `ts=$(date +%s)` and reused throughout, ensuring the body passed to `generate_jws` and the body sent by `curl` are byte-for-byte identical.

### Why it matters
JWS signature verification works by recomputing a SHA-256 digest of the raw body and comparing it to the `sha256` claim inside the signed token. If `$(date +%s)` were called twice — once in the body string construction and once implicitly — there is a one-second window where the two calls could return different values, producing a mismatch that would cause a spurious 401 even with a correct secret. The test would produce a false failure, masking a working implementation.

### Compliance mapping
SOC 2 CC6.7 (transmission integrity) — the underlying principle is that a system claiming to verify payload integrity must itself demonstrate that it understands hash determinism. A test suite that accidentally breaks body consistency is not actually testing integrity.

### Client-facing one-liner
> "Our test suite verifies signatures the same way our server does — against the exact bytes that were sent, not an approximation."

### Blog post idea (TODO)
**"The One-Second Race Condition in Your Webhook Tests"** — a subtle timestamp drift bug that produces intermittent false failures and is almost impossible to reproduce on demand.

---

## Win 3 — `--data-raw` instead of `-d` in curl

### What we did
Both webhook smoke tests (4 and 5) use `curl --data-raw "$body"` rather than `curl -d "$body"` to send the request body.

### Why it matters
`curl -d` interprets `@` as a file reference and performs URL-form encoding on certain characters, which can silently mangle the body string before it hits the wire. `--data-raw` sends the string exactly as provided, with no interpretation. Since the JWS `sha256` claim is a digest of the precise bytes transmitted, any silent transformation between "what we signed" and "what we sent" would produce a signature mismatch. Using `-d` in a JWS smoke test is a false green waiting to happen.

### Compliance mapping
SOC 2 CC4.1 (quality of testing) — test fidelity is a control, not just a convenience. A test that passes because it never actually sent the payload it signed is not testing the control it claims to test.

### Client-facing one-liner
> "We verified our tests actually send what they sign — a detail that sounds obvious until you've debugged a signature mismatch at midnight."

### Blog post idea (TODO)
**"curl -d Will Lie to You"** — a practical guide to the difference between `-d`, `--data-raw`, `--data-binary`, and `--data-urlencode`, and why it matters for any test that touches request integrity.

---

## Win 4 — Tampered valid token vs hardcoded fake secret

### What we did
Smoke test 5 was rewritten from sending a hardcoded string (`X-Atlantic-Hub-Webhook-Secret: wrong-secret-value-here`) to generating a cryptographically valid JWS with the real secret, then corrupting the last four characters of the signature segment before sending it.

### Why it matters
The old test only proved that the server rejected an obviously wrong header value. It did not prove that the HMAC verification code path ever ran — a server that returned 401 for any unrecognised header shape would have passed. The new test generates a structurally correct, properly formatted JWS and then introduces a minimal, targeted corruption. A 401 response now proves that the server parsed the token, extracted the signature, recomputed the HMAC, compared them, and correctly detected the mismatch. The crypto math is actually running.

### Compliance mapping
SOC 2 CC4.1 (negative testing) — auditors distinguish between tests that verify rejection of garbage input and tests that verify rejection of plausible-but-invalid input. The latter is the harder and more meaningful bar.

### Client-facing one-liner
> "We don't just test that our front door rejects strangers — we test that it rejects someone who's copied the shape of the key but not the teeth."

### Blog post idea (TODO)
**"Your Negative Tests Are Probably Not Testing What You Think"** — the difference between testing that a system rejects noise versus testing that it rejects a well-formed forgery, and why only one of those finds real vulnerabilities.
