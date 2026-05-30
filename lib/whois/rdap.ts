/**
 * lib/whois/rdap.ts
 *
 * WHOIS lookup via RDAP (Registration Data Access Protocol — the modern,
 * JSON-based replacement for the old port-43 WHOIS protocol). No API key
 * required for most TLDs; bootstrap via the IANA RDAP registry.
 *
 * Strategy:
 *   1. Resolve the domain's authoritative RDAP server via IANA bootstrap.
 *   2. Fetch /domain/<name> from that server.
 *   3. Parse the response for the interesting bits — registrant org, email,
 *      registration date, expiration, nameservers.
 *
 * Privacy caveat: most registrars now redact registrant contact info under
 * GDPR/ICANN policy. We treat missing values as honest signal — "registrar
 * privacy is enabled" is itself useful (it means you can't cold-email from
 * here). Returns null fields rather than throwing.
 *
 * Soft failures (privacy redacted, network, RDAP server down) come back as
 * RdapResult with mostly nulls + a `note`. Never throws.
 */

const IANA_RDAP_BOOTSTRAP = 'https://data.iana.org/rdap/dns.json';
const FETCH_TIMEOUT_MS = 12_000;

interface RdapBootstrapEntry {
  // Each entry is [["tld1", "tld2"], ["https://rdap.server/"]].
  // IANA's actual JSON structure is { services: [["tlds[]", "urls[]"], ...] }.
}
interface RdapBootstrapResponse {
  services?: Array<[string[], string[]]>;
}

let bootstrapCache: { fetchedAt: number; map: Map<string, string> } | null = null;
const BOOTSTRAP_TTL_MS = 6 * 60 * 60 * 1000; // 6h

async function loadRdapBootstrap(): Promise<Map<string, string>> {
  const now = Date.now();
  if (bootstrapCache && now - bootstrapCache.fetchedAt < BOOTSTRAP_TTL_MS) {
    return bootstrapCache.map;
  }
  const map = new Map<string, string>();
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(IANA_RDAP_BOOTSTRAP, { signal: controller.signal });
    clearTimeout(t);
    if (res.ok) {
      const j = (await res.json()) as RdapBootstrapResponse;
      for (const svc of j.services ?? []) {
        const [tlds, urls] = svc;
        if (!Array.isArray(tlds) || !Array.isArray(urls)) continue;
        const url = urls.find((u) => /^https?:\/\//.test(u));
        if (!url) continue;
        for (const tld of tlds) {
          map.set(tld.toLowerCase(), url.replace(/\/$/, ''));
        }
      }
    }
  } catch {
    /* fall through with empty map; we'll fall back to known TLDs below */
  }
  // Hard-coded fallbacks for the most common TLDs so a flaky IANA fetch
  // doesn't break the feature. These mirror what the registry returns.
  const fallbacks: Record<string, string> = {
    com: 'https://rdap.verisign.com/com/v1',
    net: 'https://rdap.verisign.com/net/v1',
    org: 'https://rdap.publicinterestregistry.net/rdap',
    io:  'https://rdap.identitydigital.services/rdap',
    co:  'https://rdap.nic.co',
    ai:  'https://rdap.nic.ai',
    app: 'https://www.registry.google/rdap',
    dev: 'https://www.registry.google/rdap'
  };
  for (const [tld, url] of Object.entries(fallbacks)) {
    if (!map.has(tld)) map.set(tld, url);
  }
  bootstrapCache = { fetchedAt: now, map };
  return map;
}

export interface RdapResult {
  ok: boolean;
  domain: string;
  registrar: string | null;
  registrant: {
    name: string | null;
    organization: string | null;
    email: string | null;
    country: string | null;
  };
  /** ISO date strings, or null if not provided. */
  registeredAt: string | null;
  expiresAt: string | null;
  lastChangedAt: string | null;
  nameservers: string[];
  /** Status codes from the registry (clientHold, ok, redemptionPeriod, etc.) */
  statuses: string[];
  /** Honest note for the operator — "privacy enabled", "no RDAP for .xyz", etc. */
  note: string | null;
  /** Raw RDAP JSON for the events tab / audit. Trimmed to the most useful keys. */
  raw?: Record<string, unknown>;
}

/**
 * Pull a string property out of a vCard array (RDAP entities are encoded as
 * vCard 4.0 arrays). vCard shape is ["vcard", [["fn", {}, "text", "Name"], ...]].
 * We accept the role name (e.g. "fn", "email", "adr") and return the first value.
 */
function vCardField(vcard: unknown, fieldName: string): string | null {
  if (!Array.isArray(vcard) || vcard.length < 2) return null;
  const props = vcard[1];
  if (!Array.isArray(props)) return null;
  for (const prop of props) {
    if (!Array.isArray(prop) || prop.length < 4) continue;
    if (prop[0] === fieldName) {
      const val = prop[3];
      if (typeof val === 'string') return val;
      if (Array.isArray(val)) {
        // adr is an array of [pobox, ext, street, city, region, postal, country]
        return val.filter((p) => typeof p === 'string' && p.trim()).join(', ') || null;
      }
    }
  }
  return null;
}

interface RdapEntity {
  roles?: string[];
  vcardArray?: unknown;
}

interface RdapEvent {
  eventAction: string;
  eventDate?: string;
}

interface RdapNameserver {
  ldhName?: string;
}

interface RdapDomainResponse {
  ldhName?: string;
  status?: string[];
  entities?: RdapEntity[];
  events?: RdapEvent[];
  nameservers?: RdapNameserver[];
}

/** Best-effort domain normalization. Strips scheme, paths, fragments, www. */
export function normalizeDomainForRdap(input: string): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.split('/')[0].split('?')[0].split('#')[0];
  // Strip port.
  s = s.split(':')[0];
  if (!s || !s.includes('.')) return null;
  // Conservative LDH check — letters, digits, hyphens, dots only.
  if (!/^[a-z0-9.-]+$/.test(s)) return null;
  return s;
}

/** Get the TLD's RDAP server base URL. */
async function rdapServerForDomain(domain: string): Promise<string | null> {
  const parts = domain.split('.');
  if (parts.length < 2) return null;
  // Try longest match first (e.g. "co.uk" before "uk").
  const map = await loadRdapBootstrap();
  for (let i = 1; i < parts.length; i++) {
    const suffix = parts.slice(i).join('.');
    const url = map.get(suffix);
    if (url) return url;
  }
  return null;
}

/**
 * Fetch RDAP for a domain. Returns a structured RdapResult — never throws.
 * If RDAP is unsupported for the TLD, returns ok=false + note. If the
 * registry returned 404, returns ok=false + a "domain not registered" note.
 */
export async function rdapLookup(rawDomain: string): Promise<RdapResult> {
  const domain = normalizeDomainForRdap(rawDomain);
  const empty: RdapResult = {
    ok: false,
    domain: domain ?? rawDomain,
    registrar: null,
    registrant: { name: null, organization: null, email: null, country: null },
    registeredAt: null,
    expiresAt: null,
    lastChangedAt: null,
    nameservers: [],
    statuses: [],
    note: null
  };
  if (!domain) return { ...empty, note: 'invalid domain' };

  const server = await rdapServerForDomain(domain);
  if (!server) {
    return { ...empty, note: `no RDAP server known for .${domain.split('.').pop()} — try a manual WHOIS lookup.` };
  }
  const url = `${server}/domain/${encodeURIComponent(domain)}`;

  let json: RdapDomainResponse;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/rdap+json, application/json' }
    });
    clearTimeout(t);
    if (res.status === 404) {
      return { ...empty, note: 'domain not registered (RDAP 404).' };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ...empty, note: `RDAP ${res.status}: ${body.slice(0, 160)}` };
    }
    json = (await res.json()) as RdapDomainResponse;
  } catch (err) {
    return { ...empty, note: `RDAP fetch failed: ${(err as Error).message.slice(0, 200)}` };
  }

  // Parse the response. RDAP fields are nullable everywhere — we pick the
  // first useful value rather than insisting on a specific shape.
  const out: RdapResult = { ...empty, ok: true };
  out.statuses = json.status ?? [];

  // Events → registered / expires / last-changed.
  for (const ev of json.events ?? []) {
    if (!ev.eventDate) continue;
    switch (ev.eventAction) {
      case 'registration': out.registeredAt = ev.eventDate; break;
      case 'expiration':   out.expiresAt = ev.eventDate; break;
      case 'last changed': out.lastChangedAt = ev.eventDate; break;
    }
  }
  // Nameservers.
  out.nameservers = (json.nameservers ?? [])
    .map((n) => n.ldhName?.toLowerCase())
    .filter((n): n is string => !!n);

  // Entities → registrar + registrant. Match by role.
  for (const ent of json.entities ?? []) {
    const roles = ent.roles ?? [];
    if (roles.includes('registrar')) {
      const fn = vCardField(ent.vcardArray, 'fn');
      if (fn) out.registrar = fn;
    }
    if (roles.includes('registrant')) {
      out.registrant.name = vCardField(ent.vcardArray, 'fn');
      out.registrant.organization = vCardField(ent.vcardArray, 'org');
      out.registrant.email = vCardField(ent.vcardArray, 'email');
      const adr = vCardField(ent.vcardArray, 'adr');
      if (adr) {
        // The last comma-separated chunk of adr is the country, by convention.
        const parts = adr.split(',').map((p) => p.trim()).filter(Boolean);
        if (parts.length) out.registrant.country = parts[parts.length - 1];
      }
    }
  }

  // Honest "privacy enabled" hint so val knows whether to bother chasing.
  if (!out.registrant.name && !out.registrant.organization && !out.registrant.email) {
    out.note = 'Registrar privacy enabled — registrant contact info redacted.';
  }
  return out;
}
