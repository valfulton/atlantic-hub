'use client';

/**
 * ClientAccessGroup  (val 2026-06-02)
 *
 * Wraps the four "how to give this client access" surfaces in ONE collapsible
 * card with two clearly-labeled sub-sections so they stop looking identical:
 *
 *   Portal access (logs them in)
 *     - Magic link (intake-gated, 24h)
 *     - Email + password (alt to magic link)
 *
 *   Form-only share (no portal access)
 *     - Prefilled intake link (anonymous, 30d)
 *     - All-brands intake link (when owner has >1 brand)
 *
 * Default expanded so val sees everything; toggle hides the whole group when
 * she's working on something else. Sub-section headers carry color stripes
 * so at-a-glance you know "this gives portal access" vs "this is form-only".
 */
import { useState, type ReactNode } from 'react';

export default function ClientAccessGroup({
  portal,
  share,
  defaultOpen = true
}: {
  portal: ReactNode;
  share: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-border bg-surface mb-6 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-white/[0.02]"
      >
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted">Send to client</div>
          <div className="text-sm text-ink mt-0.5">
            Magic link · password · prefilled intake · all-brands link
          </div>
        </div>
        <span className="text-muted text-xs shrink-0">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 grid gap-5 border-t border-border/60 pt-4">
          <section>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-block w-1 h-4 rounded-sm bg-emerald-400/70" aria-hidden />
              <h3 className="text-[11px] uppercase tracking-[0.14em] text-emerald-300/85">
                Portal access — logs them into the hub
              </h3>
            </div>
            <p className="text-[11px] text-muted mb-2">
              Use these when they ask for a way to sign in. The hub stays gated by the intake form until it&apos;s complete.
            </p>
            <div className="grid gap-3">{portal}</div>
          </section>
          <section>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-block w-1 h-4 rounded-sm bg-brand/80" aria-hidden />
              <h3 className="text-[11px] uppercase tracking-[0.14em] text-brand">
                Form-only share — no portal access
              </h3>
            </div>
            <p className="text-[11px] text-muted mb-2">
              Use these for &ldquo;just review and submit this form.&rdquo; The link opens a prefilled intake page. No password, no sign-in.
            </p>
            <div className="grid gap-3">{share}</div>
          </section>
        </div>
      )}
    </div>
  );
}
