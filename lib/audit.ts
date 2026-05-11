/**
 * Audit log writer.
 *
 * Writes one row to shhdbite_atlantic_hub.audit_log_global.
 *
 * Design rules:
 *   1. NEVER throw. Audit failures must not break the user-facing request.
 *      Log to stderr instead.
 *   2. NEVER log PII. Hash IPs and user-agents before storing.
 *   3. Respect the `audit_log_writes_enabled` feature flag. If flipped
 *      off, write to stderr only.
 */
import { getPlatformDb } from '@/lib/db/platform';
import { ipHash, userAgentHash } from '@/lib/crypto/hash';
import { isFlagEnabled } from '@/lib/feature-flags';

export interface AuditEntry {
  actorUserId?: number | null;
  actorRole?: string | null;
  tenantId?: string | null;
  targetResource: string;
  action: string;
  modelVersion?: string | null;
  promptTemplateId?: string | null;
  inputHash?: string | null;
  outputHash?: string | null;
  ip: string;
  userAgent?: string | null;
  statusCode?: number | null;
  errorClass?: string | null;
}

export async function writeAuditRow(entry: AuditEntry): Promise<void> {
  try {
    const enabled = await isFlagEnabled('audit_log_writes_enabled');
    if (!enabled) {
      // Emergency kill switch is on. Log to stderr so we still have a trail.
      console.error('[audit:disabled]', {
        action: entry.action,
        target: entry.targetResource,
        actor: entry.actorUserId,
        tenant: entry.tenantId
      });
      return;
    }

    const db = getPlatformDb();
    await db.execute(
      `INSERT INTO audit_log_global
       (actor_user_id, actor_role, tenant_id, target_resource, action,
        model_version, prompt_template_id, input_hash, output_hash,
        ip_hash, user_agent_hash, status_code, error_class)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.actorUserId ?? null,
        entry.actorRole ?? null,
        entry.tenantId ?? null,
        entry.targetResource,
        entry.action,
        entry.modelVersion ?? null,
        entry.promptTemplateId ?? null,
        entry.inputHash ?? null,
        entry.outputHash ?? null,
        ipHash(entry.ip),
        userAgentHash(entry.userAgent),
        entry.statusCode ?? null,
        entry.errorClass ?? null
      ]
    );
  } catch (err) {
    // Never propagate audit failures. Log to stderr only.
    console.error('[audit:write-failed]', {
      action: entry.action,
      target: entry.targetResource,
      err: (err as Error).message
    });
  }
}

/**
 * Extract a usable client IP from a NextRequest's headers.
 * Netlify sets x-nf-client-connection-ip; we fall back to x-forwarded-for.
 */
export function extractClientIp(headers: Headers): string {
  return (
    headers.get('x-nf-client-connection-ip') ||
    headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    headers.get('x-real-ip') ||
    '0.0.0.0'
  );
}
