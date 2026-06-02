/**
 * lib/social/org_acls.ts  (#45 Phase C, val 2026-06-02)
 *
 * Fetch the LinkedIn organizations the just-authenticated member can post as.
 * Called from the OAuth callback right after the personal `social_connections`
 * row is inserted, so for every org returned we upsert a `social_targets` row
 * with status='connected', target_type='organization', and the org's URN --
 * which is what the publisher passes as the share author.
 *
 * Endpoint: GET https://api.linkedin.com/rest/organizationAcls
 *   ?q=roleAssignee&role=ADMINISTRATOR&projection=...
 *
 * Requires the `w_organization_social` scope on the token. If the token
 * lacks the scope LinkedIn returns 403 -- we treat that as "no orgs" and
 * surface the reason in last_error so val knows the account needs to
 * reconnect with the new scope.
 *
 * No token value is ever logged. Provider error bodies are truncated.
 */

const FETCH_TIMEOUT_MS = 10000;
const MAX_ORGS = 25; // safety cap; the typical user admins 0-3

export interface LinkedInOrgAcl {
  orgUrn: string;     // e.g. urn:li:organization:18234567
  orgId: string;      // e.g. '18234567' (extracted from URN)
  orgName: string | null;
  orgLogoUrl: string | null;
}

export interface FetchOrgsResult {
  ok: boolean;
  orgs: LinkedInOrgAcl[];
  reason?: string;
}

function truncate(s: string, n = 300): string {
  return s.length > n ? `${s.slice(0, n)}...` : s;
}

function extractIdFromUrn(urn: string): string {
  const m = urn.match(/^urn:li:organization:(\d+)$/);
  return m ? m[1] : '';
}

/**
 * Returns admin-role orgs for the bearer token. On network/HTTP failure
 * returns ok=false with a short reason; never throws.
 */
export async function fetchLinkedInOrgs(accessToken: string): Promise<FetchOrgsResult> {
  if (!accessToken) return { ok: false, orgs: [], reason: 'no_token' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  // Two-step: list ACL relationships, then resolve org names/logos.
  //
  // Step 1: organization ACLs the member holds (admin role only).
  //   We use the older /v2/organizationalEntityAcls endpoint because it doesn't
  //   require the LinkedIn-Version header dance the /rest endpoints want.
  const aclsUrl =
    'https://api.linkedin.com/v2/organizationalEntityAcls' +
    '?q=roleAssignee' +
    '&role=ADMINISTRATOR' +
    '&projection=(elements*(organizationalTarget))';

  try {
    const aclsResp = await fetch(aclsUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0'
      },
      signal: controller.signal
    });
    const aclsText = await aclsResp.text();
    if (!aclsResp.ok) {
      const reason =
        aclsResp.status === 403 ? 'missing_scope' :
        aclsResp.status === 401 ? 'unauthorized' :
        `http_${aclsResp.status}`;
      return { ok: false, orgs: [], reason: `${reason}:${truncate(aclsText, 100)}` };
    }
    interface AclsResponse {
      elements?: { organizationalTarget?: string }[];
    }
    let parsed: AclsResponse;
    try {
      parsed = JSON.parse(aclsText) as AclsResponse;
    } catch {
      return { ok: false, orgs: [], reason: 'acls_parse_failed' };
    }
    const orgUrns = (parsed.elements ?? [])
      .map((e) => e.organizationalTarget)
      .filter((u): u is string => typeof u === 'string' && /^urn:li:organization:\d+$/.test(u))
      .slice(0, MAX_ORGS);

    if (orgUrns.length === 0) {
      return { ok: true, orgs: [] };
    }

    // Step 2: resolve names + logos in one batch via the multi-get endpoint.
    //   GET /v2/organizations?ids=List(18234567,9876543)
    const ids = orgUrns.map(extractIdFromUrn).filter(Boolean);
    const orgsUrl =
      'https://api.linkedin.com/v2/organizations' +
      `?ids=List(${ids.join(',')})` +
      '&projection=(results*(id,localizedName,logoV2(original~:playableStreams)))';

    const orgsResp = await fetch(orgsUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0'
      },
      signal: controller.signal
    });
    if (!orgsResp.ok) {
      // We still know the URNs; return them with empty name/logo so the UI
      // at least shows "Connected · Company #18234567" until the next refresh.
      return {
        ok: true,
        orgs: orgUrns.map((urn) => ({
          orgUrn: urn,
          orgId: extractIdFromUrn(urn),
          orgName: null,
          orgLogoUrl: null
        }))
      };
    }
    const orgsText = await orgsResp.text();
    interface OrgsResponse {
      results?: Record<string, {
        id?: number;
        localizedName?: string;
        logoV2?: {
          'original~'?: {
            elements?: { identifiers?: { identifier?: string }[] }[];
          };
        };
      }>;
    }
    let orgsParsed: OrgsResponse;
    try {
      orgsParsed = JSON.parse(orgsText) as OrgsResponse;
    } catch {
      orgsParsed = {};
    }
    const byId = orgsParsed.results ?? {};
    const out: LinkedInOrgAcl[] = orgUrns.map((urn) => {
      const id = extractIdFromUrn(urn);
      const r = byId[id];
      const logoEl = r?.logoV2?.['original~']?.elements?.[0];
      const logoUrl = logoEl?.identifiers?.[0]?.identifier ?? null;
      return {
        orgUrn: urn,
        orgId: id,
        orgName: r?.localizedName ?? null,
        orgLogoUrl: logoUrl
      };
    });
    return { ok: true, orgs: out };
  } catch (e) {
    const reason = e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'fetch_error';
    return { ok: false, orgs: [], reason };
  } finally {
    clearTimeout(timer);
  }
}
