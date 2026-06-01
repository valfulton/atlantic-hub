/**
 * NewsroomProvenanceFooter  (#331)
 *
 * Drop-in editorial colophon for every published newsroom article. Renders
 * BELOW the article body, ABOVE the "Work with us" CTA. Designed to read like
 * a magazine imprint page — never a crypto badge. Visual + copy contract is
 * from the branding chat's `/newsroom-provenance-footer.html` artifact, ported
 * to a React server component with safe defaults and graceful row omission.
 *
 * **Current state (stub, awaiting #329 C2PA chat):**
 * - The Fingerprint hash is computed inline from the article body + id as a
 *   deterministic SHA-256. Once #329 ships the C2PA manifest writer
 *   (`lib/provenance/c2pa.ts` with signAsset / verifyAsset), this component
 *   should read the asset's signed manifest hash + cert fingerprint instead.
 * - The Verify link points at `/verify/article/<id>` — a stub today; #329
 *   builds the real `/verify/[asset_id]` page that resolves the signed manifest.
 *
 * **Anti-language (CRITICAL — see memory `project_c2pa_content_credentials.md`):**
 * - Never "blockchain provenance," "crypto badge," "NFT," "Web3 authentication."
 * - Always editorial register: "Edited," "Photo by," "Tools," "Fingerprint."
 * - When AI was used, name the tool honestly — "Research-mode AI assistance;
 *   human edit." Never "Powered by AI."
 *
 * Future-state (when wallet activates per `project_asset_provenance`):
 * `verifyUrl` flips from the local route to the Arweave / Irys tx URL via a
 * one-file PermanenceProvider activation. No HTML changes here.
 */
import { createHash } from 'node:crypto';

interface NewsroomProvenanceFooterProps {
  articleId: number;
  bodyText: string;
  /** ISO date of publication / last edit. */
  publishedAt: string | null;
  /** Human editor display name. Defaults to the editorial desk. */
  editedBy?: string;
  /** Optional photo / illustration credit. Omitted from the footer when null. */
  photoBy?: string | null;
  /** Optional AI-tools transparency note. Omitted when null (no AI involvement). */
  toolsNote?: string | null;
}

function fmtEditedAt(iso: string | null): { label: string; iso: string } {
  if (!iso) {
    const fallback = new Date();
    return {
      label: fallback.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }),
      iso: fallback.toISOString()
    };
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { label: '', iso };
  return {
    label: d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }),
    iso: d.toISOString()
  };
}

/** Deterministic content hash. Stub until #329 wires the signed C2PA manifest. */
function computeStubHash(articleId: number, bodyText: string, publishedAt: string | null): {
  short: string;
  full: string;
} {
  const input = `av-article-${articleId}\n${publishedAt ?? ''}\n${bodyText}`;
  const full = createHash('sha256').update(input).digest('hex');
  const short = `${full.slice(0, 4)}…${full.slice(-4)}`;
  return { short, full };
}

export default function NewsroomProvenanceFooter({
  articleId,
  bodyText,
  publishedAt,
  editedBy = 'The Atlantic & Vine Editorial Desk',
  photoBy = null,
  toolsNote = 'Research-mode AI assistance; human edit'
}: NewsroomProvenanceFooterProps) {
  const editedAt = fmtEditedAt(publishedAt);
  const { short, full } = computeStubHash(articleId, bodyText, publishedAt);
  const verifyUrl = `/verify/article/${articleId}`;

  return (
    <aside
      className="av-provenance on-dark"
      aria-labelledby={`av-prov-heading-${articleId}`}
    >
      <div className="av-provenance-rule" aria-hidden="true" />

      <p className="av-provenance-eyebrow" id={`av-prov-heading-${articleId}`}>
        &mdash; On this piece &mdash;
      </p>

      <dl className="av-provenance-rows">
        <div className="av-provenance-row">
          <dt>Edited</dt>
          <dd>
            {editedBy},{' '}
            <time dateTime={editedAt.iso}>{editedAt.label}</time>
          </dd>
        </div>

        {photoBy && (
          <div className="av-provenance-row">
            <dt>Photo by</dt>
            <dd>{photoBy}</dd>
          </div>
        )}

        {toolsNote && (
          <div className="av-provenance-row">
            <dt>Tools</dt>
            <dd>{toolsNote}</dd>
          </div>
        )}

        <div className="av-provenance-row av-provenance-hash">
          <dt>Fingerprint</dt>
          <dd>
            <span
              className="av-hash"
              title={full}
              aria-label={`SHA-256 fingerprint: ${full}`}
            >
              sha-256 &middot; {short}
            </span>
            <span className="av-provenance-sep" aria-hidden="true">
              {' '}&middot;{' '}
            </span>
            <a className="av-verify-link" href={verifyUrl}>
              Verify &rarr;
            </a>
          </dd>
        </div>
      </dl>

      <div className="av-provenance-rule" aria-hidden="true" />

      <style>{`
        .av-provenance {
          max-width: 660px;
          margin: 48px auto 36px;
          padding: 0 24px;
          font-family: var(--cs-sans, "Inter", system-ui, sans-serif);
        }
        .av-provenance-rule {
          height: 1px;
          background: linear-gradient(90deg,
            transparent,
            var(--c-accent-deep, #A77A3F) 30%,
            var(--c-accent-deep, #A77A3F) 70%,
            transparent);
          opacity: .35;
        }
        .av-provenance-eyebrow {
          font-size: 10px;
          letter-spacing: .3em;
          text-transform: uppercase;
          text-align: center;
          margin: 18px 0 16px;
          color: var(--c-eyebrow-on-dark, #B89366);
        }
        .av-provenance-rows {
          margin: 0 0 20px;
          display: grid;
          gap: 6px;
        }
        .av-provenance-row {
          display: grid;
          grid-template-columns: 110px 1fr;
          gap: 14px;
          align-items: baseline;
          font-size: 11px;
          line-height: 1.6;
        }
        .av-provenance-row dt {
          font-weight: 500;
          letter-spacing: .22em;
          text-transform: uppercase;
          margin: 0;
          color: var(--c-on-dark-muted, #8B96A4);
        }
        .av-provenance-row dd {
          margin: 0;
          font-family: var(--cs-serif, "Cormorant Garamond", Georgia, serif);
          font-size: 14px;
          font-style: italic;
          letter-spacing: .005em;
          color: var(--c-on-dark, #DDD3BD);
        }
        .av-provenance-hash dd {
          font-family: ui-monospace, "SF Mono", "Menlo", "Consolas", monospace;
          font-style: normal;
          font-size: 12px;
          letter-spacing: 0;
          color: var(--c-on-dark-muted, #8B96A4);
        }
        .av-hash {
          cursor: help;
          border-bottom: 1px dotted rgba(201,152,88,.35);
        }
        .av-verify-link {
          color: var(--c-on-dark, #DDD3BD);
          text-decoration: none;
          border-bottom: 1px dotted rgba(201,152,88,.35);
        }
        .av-verify-link:hover {
          color: var(--c-accent-deep, #c9a227);
        }
        .av-provenance-sep {
          margin: 0 4px;
          color: rgba(201,152,88,.35);
        }
        @media (max-width: 520px) {
          .av-provenance-row { grid-template-columns: 1fr; gap: 2px; }
          .av-provenance-row dt { font-size: 9px; }
        }
      `}</style>
    </aside>
  );
}
