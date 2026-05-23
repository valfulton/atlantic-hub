/**
 * lib/publishing/github_site.ts
 *
 * Publishes a generated post into a static site's GitHub repo. val's brand /
 * client sites (atlanticandvine, central_business_bureau, events-by-water-website,
 * hunterhoney) are HTML static sites built from repos under `valfulton` and
 * hosted on Netlify. Committing a post file triggers Netlify's auto-rebuild, so
 * "publish to the website" = "commit the post + let Netlify deploy."
 *
 * Auth: a GitHub token with `contents:write` on the target repo, provided via
 * the GITHUB_PUBLISH_TOKEN env var (set in Netlify). Never logged.
 *
 * Uses the Contents API (create-or-update a single file). Idempotent on path: if
 * the file already exists we update it (using its sha); otherwise we create it.
 */

export class GitHubTokenMissingError extends Error {
  constructor() {
    super('GITHUB_PUBLISH_TOKEN is not set; cannot publish to the site repo.');
    this.name = 'GitHubTokenMissingError';
  }
}

export class GitHubPublishError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'GitHubPublishError';
  }
}

const API = 'https://api.github.com';

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'atlantic-hub-publisher'
  };
}

/** Look up an existing file's sha (needed to update), or null if it doesn't exist. */
async function getExistingSha(opts: {
  owner: string;
  repo: string;
  path: string;
  branch: string;
  token: string;
}): Promise<string | null> {
  const url = `${API}/repos/${opts.owner}/${opts.repo}/contents/${encodeURI(opts.path)}?ref=${encodeURIComponent(opts.branch)}`;
  const res = await fetch(url, { headers: authHeaders(opts.token) });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new GitHubPublishError(`GitHub lookup ${res.status}: ${body.slice(0, 200)}`, res.status);
  }
  const json = (await res.json()) as { sha?: string };
  return json.sha ?? null;
}

export interface PublishToRepoResult {
  ok: true;
  path: string;
  commitSha: string | null;
  htmlUrl: string | null;
}

/**
 * Create-or-update a file in the repo. `content` is UTF-8 text (HTML/markdown).
 */
export async function publishFileToRepo(opts: {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  content: string;
  message: string;
}): Promise<PublishToRepoResult> {
  const token = process.env.GITHUB_PUBLISH_TOKEN;
  if (!token) throw new GitHubTokenMissingError();

  const sha = await getExistingSha({ ...opts, token });

  const url = `${API}/repos/${opts.owner}/${opts.repo}/contents/${encodeURI(opts.path)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: opts.message,
      content: Buffer.from(opts.content, 'utf8').toString('base64'),
      branch: opts.branch,
      ...(sha ? { sha } : {})
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new GitHubPublishError(`GitHub publish ${res.status}: ${body.slice(0, 240)}`, res.status);
  }

  const json = (await res.json()) as { commit?: { sha?: string }; content?: { html_url?: string } };
  return {
    ok: true,
    path: opts.path,
    commitSha: json.commit?.sha ?? null,
    htmlUrl: json.content?.html_url ?? null
  };
}
