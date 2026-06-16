/**
 * lib/imap/poll.ts  (val 2026-06-16, #707)
 *
 * IMAP poller for the case + PR inbound mailboxes. Called from
 * /api/admin/inbox/imap-poll on a HostGator cron every 5 minutes.
 *
 * Flow per call:
 *   1. Connect IMAP to each configured mailbox (inbox@case, inbox@pr)
 *   2. Fetch UNSEEN messages, capped at BATCH_LIMIT to stay under
 *      Netlify's 60s timeout
 *   3. Parse each message (mailparser → headers + body + attachments)
 *   4. Route by To: header:
 *        - <local>@case.atlanticandvine.com → match case by name slug
 *          → insert into case_notes (audience='family', author=
 *          From: header sender) + log to inbound_emails audit
 *        - <slug>@pr.atlanticandvine.com → look up client by
 *          pr_inbox_slug → log to inbound_emails audit (and we'd POST
 *          to the existing /api/pr/inbox handler, but for v0 the
 *          audit row is the visible signal)
 *   5. Mark message as \\Seen on the IMAP server so it never re-routes
 *
 * Idempotency: inbound_emails has a UNIQUE KEY on (message_uid,
 * source_mailbox). A retry of the same message no-ops at the audit
 * insert and skips the route step.
 *
 * Env required:
 *   IMAP_HOST, IMAP_PORT, CASE_IMAP_USER, CASE_IMAP_PASS,
 *   PR_IMAP_USER, PR_IMAP_PASS
 *
 * Returns a summary the caller (cron endpoint) reports back.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { getAvDb } from '@/lib/db/av';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import crypto from 'crypto';

/** Per-call cap so one giant backlog doesn't time out the function. */
const BATCH_LIMIT = 20;

/** ImapFlow connection options shared across mailboxes. */
function imapOptionsFor(user: string, pass: string) {
  return {
    host: process.env.IMAP_HOST || 'mail.atlanticandvine.com',
    port: Number(process.env.IMAP_PORT || 993),
    secure: true,
    auth: { user, pass },
    logger: false as const
  };
}

export interface PollOneResult {
  mailbox: string;
  fetched: number;
  routedCaseNote: number;
  routedCaseInbound: number;
  routedPrInbox: number;
  unroutable: number;
  errors: string[];
}

export interface PollAllResult {
  totalFetched: number;
  perMailbox: PollOneResult[];
}

/**
 * Slug a free-text case name to a comparable token. "Johnson Family ·
 * Home-Ranch Trust" → "johnsonfamilyhomeranchtrust". Used to match the
 * local-part of johnson@case... to a case by its name.
 */
function slugifyCaseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface CaseRow extends RowDataPacket {
  case_id: number;
  case_name: string;
  client_id: number;
  email_slug: string | null;
}

/**
 * Resolve a "<local>@case.atlanticandvine.com" address to a case_id.
 * Two paths:
 *   1. If <local> matches cases.email_slug exactly, that wins.
 *   2. Otherwise we match against slugify(case_name): if <local> is a
 *      prefix of the slug (e.g. "johnson" → "johnsonfamilyhomeranchtrust")
 *      and exactly one case qualifies, we use it. Multiple matches → null
 *      (we won't guess).
 */
async function findCaseForLocalPart(localPart: string): Promise<CaseRow | null> {
  const db = getAvDb();
  const lp = localPart.toLowerCase().trim();
  if (!lp) return null;
  // Path 1: exact email_slug match
  const [bySlug] = await db.execute<CaseRow[]>(
    `SELECT case_id, case_name, client_id, email_slug FROM cases WHERE email_slug = ? LIMIT 1`,
    [lp]
  );
  if (bySlug[0]) return bySlug[0];
  // Path 2: case name prefix match
  const [allCases] = await db.execute<CaseRow[]>(
    `SELECT case_id, case_name, client_id, email_slug FROM cases`
  );
  const matches = allCases.filter((r) => slugifyCaseName(r.case_name).startsWith(lp));
  return matches.length === 1 ? matches[0] : null;
}

interface ClientPrRow extends RowDataPacket {
  client_id: number;
  client_name: string | null;
  pr_inbox_slug: string | null;
}

async function findClientForPrSlug(slug: string): Promise<ClientPrRow | null> {
  if (!slug) return null;
  const db = getAvDb();
  const [rows] = await db.execute<ClientPrRow[]>(
    `SELECT client_id, client_name, pr_inbox_slug
       FROM clients WHERE pr_inbox_slug = ? LIMIT 1`,
    [slug]
  );
  return rows[0] || null;
}

/** Format the email body into a case_note. Includes sender + subject + body. */
function noteBodyFromParsed(p: ParsedMail): string {
  const from = p.from?.text || 'unknown sender';
  const subject = p.subject || '(no subject)';
  const body = (p.text || '').trim();
  const attachLine = p.attachments && p.attachments.length > 0
    ? `\n\n— ${p.attachments.length} attachment${p.attachments.length === 1 ? '' : 's'} sent.`
    : '';
  return `From: ${from}\nSubject: ${subject}\n\n${body}${attachLine}`;
}

/**
 * Best-effort message-id derivation. Real RFC 822 Message-ID is preferred;
 * fall back to a hash of (mailbox + uid + date) so we still get a unique
 * key for idempotency.
 */
function deriveMessageUid(p: ParsedMail, mailbox: string, uid: number): string {
  if (p.messageId && p.messageId.length > 0) return p.messageId.slice(0, 250);
  const seed = `${mailbox}::${uid}::${p.date?.toISOString() || ''}`;
  return 'sha1:' + crypto.createHash('sha1').update(seed).digest('hex');
}

interface AuditInsertArgs {
  messageUid: string;
  sourceMailbox: string;
  envelopeTo: string | null;
  envelopeFrom: string | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  attachmentCount: number;
  routedTo: 'case_note' | 'case_inbound' | 'pr_inbox' | 'unroutable' | 'error';
  routedCaseId: number | null;
  routedClientId: number | null;
  routedNoteId: number | null;
  routeReason: string | null;
}

/**
 * Write the audit row. Returns true if the row was NEW (we should
 * process the routing side-effect), false if it was a duplicate (no-op).
 */
async function insertAuditRow(a: AuditInsertArgs): Promise<boolean> {
  const db = getAvDb();
  try {
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO inbound_emails
         (message_uid, source_mailbox, envelope_to, envelope_from, subject,
          body_text, body_html, attachment_count, routed_to,
          routed_case_id, routed_client_id, routed_note_id, route_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        a.messageUid, a.sourceMailbox, a.envelopeTo, a.envelopeFrom, a.subject,
        a.bodyText, a.bodyHtml, a.attachmentCount, a.routedTo,
        a.routedCaseId, a.routedClientId, a.routedNoteId, a.routeReason
      ]
    );
    return (res.affectedRows || 0) > 0;
  } catch (err) {
    const msg = (err as Error).message || '';
    // Duplicate key (already processed) — not an error, just skip.
    if (msg.includes('Duplicate entry')) return false;
    throw err;
  }
}

/** Insert a case_note record. Returns the new note_id or null on failure. */
async function postCaseNote(args: {
  caseId: number;
  body: string;
  authorEmail: string;
}): Promise<number | null> {
  const db = getAvDb();
  try {
    const [res] = await db.execute<ResultSetHeader>(
      `INSERT INTO case_notes
         (case_id, body, author_role, author_display_name, audience, source)
       VALUES (?, ?, 'family', ?, 'family', 'email_inbound')`,
      [args.caseId, args.body, args.authorEmail]
    );
    return res.insertId ? Number(res.insertId) : null;
  } catch (err) {
    console.error('[imap-poll] postCaseNote failed:', (err as Error).message);
    return null;
  }
}

/** Poll a single mailbox and route every fetched message. */
async function pollOneMailbox(args: {
  mailbox: string;
  user: string;
  pass: string;
  expectedDomain: 'case.atlanticandvine.com' | 'pr.atlanticandvine.com';
}): Promise<PollOneResult> {
  const result: PollOneResult = {
    mailbox: args.mailbox,
    fetched: 0,
    routedCaseNote: 0,
    routedCaseInbound: 0,
    routedPrInbox: 0,
    unroutable: 0,
    errors: []
  };
  const client = new ImapFlow(imapOptionsFor(args.user, args.pass));
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ seen: false });
      const batch = (uids || []).slice(0, BATCH_LIMIT);
      for (const uid of batch) {
        try {
          // Fetch the raw RFC 822 source so mailparser can do the work.
          const msg = await client.fetchOne(uid, { source: true });
          if (!msg || !msg.source) continue;
          const parsed = await simpleParser(msg.source as Buffer);
          result.fetched += 1;
          const messageUid = deriveMessageUid(parsed, args.mailbox, Number(uid));
          // Resolve the destination address from the To: header(s). When
          // multiple To: are present, pick the one ending in expectedDomain.
          const tos = Array.isArray(parsed.to) ? parsed.to : (parsed.to ? [parsed.to] : []);
          const matchingTo = tos.flatMap((addr) => addr.value || [])
            .map((v) => (v.address || '').toLowerCase())
            .find((a) => a.endsWith('@' + args.expectedDomain)) || null;
          const fromText = parsed.from?.text || null;
          const baseAudit = {
            messageUid,
            sourceMailbox: args.mailbox,
            envelopeTo: matchingTo,
            envelopeFrom: fromText,
            subject: parsed.subject || null,
            bodyText: (parsed.text || '').slice(0, 65535),
            bodyHtml: (parsed.html || '').toString().slice(0, 16_777_215),
            attachmentCount: (parsed.attachments || []).length
          };
          if (!matchingTo) {
            const inserted = await insertAuditRow({
              ...baseAudit,
              routedTo: 'unroutable',
              routedCaseId: null,
              routedClientId: null,
              routedNoteId: null,
              routeReason: 'No To: address matched ' + args.expectedDomain
            });
            if (inserted) result.unroutable += 1;
            await client.messageFlagsAdd(uid, ['\\Seen']);
            continue;
          }
          const localPart = matchingTo.split('@')[0] || '';
          if (args.expectedDomain === 'case.atlanticandvine.com') {
            // Case routing
            const caseRow = await findCaseForLocalPart(localPart);
            if (!caseRow) {
              const inserted = await insertAuditRow({
                ...baseAudit,
                routedTo: 'unroutable',
                routedCaseId: null,
                routedClientId: null,
                routedNoteId: null,
                routeReason: `No case matched local-part "${localPart}"`
              });
              if (inserted) result.unroutable += 1;
            } else {
              const body = noteBodyFromParsed(parsed);
              const senderEmail = (parsed.from?.value?.[0]?.address || fromText || 'unknown').slice(0, 160);
              const noteId = await postCaseNote({
                caseId: caseRow.case_id,
                body,
                authorEmail: senderEmail
              });
              const inserted = await insertAuditRow({
                ...baseAudit,
                routedTo: noteId ? 'case_note' : 'error',
                routedCaseId: caseRow.case_id,
                routedClientId: caseRow.client_id,
                routedNoteId: noteId,
                routeReason: noteId
                  ? `Matched case "${caseRow.case_name}" via local-part`
                  : 'Matched case but case_notes insert failed'
              });
              if (inserted && noteId) result.routedCaseNote += 1;
            }
          } else {
            // PR routing
            const clientRow = await findClientForPrSlug(localPart);
            const inserted = await insertAuditRow({
              ...baseAudit,
              routedTo: clientRow ? 'pr_inbox' : 'unroutable',
              routedCaseId: null,
              routedClientId: clientRow?.client_id || null,
              routedNoteId: null,
              routeReason: clientRow
                ? `Matched client "${clientRow.client_name}" via pr_inbox_slug`
                : `No client matched pr_inbox_slug "${localPart}"`
            });
            if (inserted) {
              if (clientRow) result.routedPrInbox += 1;
              else result.unroutable += 1;
            }
          }
          await client.messageFlagsAdd(uid, ['\\Seen']);
        } catch (err) {
          result.errors.push(`uid=${uid}: ${(err as Error).message}`);
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    result.errors.push((err as Error).message);
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
  return result;
}

/** Poll all configured mailboxes once and return the summary. */
export async function pollAllMailboxes(): Promise<PollAllResult> {
  const out: PollAllResult = { totalFetched: 0, perMailbox: [] };
  const caseUser = process.env.CASE_IMAP_USER;
  const casePass = process.env.CASE_IMAP_PASS;
  const prUser = process.env.PR_IMAP_USER;
  const prPass = process.env.PR_IMAP_PASS;
  if (caseUser && casePass) {
    const r = await pollOneMailbox({
      mailbox: caseUser,
      user: caseUser,
      pass: casePass,
      expectedDomain: 'case.atlanticandvine.com'
    });
    out.totalFetched += r.fetched;
    out.perMailbox.push(r);
  }
  if (prUser && prPass) {
    const r = await pollOneMailbox({
      mailbox: prUser,
      user: prUser,
      pass: prPass,
      expectedDomain: 'pr.atlanticandvine.com'
    });
    out.totalFetched += r.fetched;
    out.perMailbox.push(r);
  }
  return out;
}
