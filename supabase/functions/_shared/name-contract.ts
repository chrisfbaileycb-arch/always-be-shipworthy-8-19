/**
 * Name module — the lookup contract.
 *
 * Shared between the Edge Function (Deno) and the browser client (Vite), so it
 * must stay dependency-free.
 *
 * WHY THIS MODULE IS BUILT DIFFERENTLY FROM THE OTHERS
 *
 * BrandGuard's scan engine printed things like "Smartsheet Inc., Serial
 * 87/123441, Reg 5,823,441" from a hardcoded dictionary of 23 tokens with
 * invented numbers, behind a $99 paywall. It disclosed the simulation in its
 * terms, but a finding card showing a registrant, a serial, and a registration
 * number reads as a retrieved record no matter what the footer says.
 *
 * So: this module never renders a registrant, serial, or registration number it
 * did not receive from a live registry response in the same run. If the lookup
 * did not happen, the module returns `not_assessed` — it does not fall back to
 * pattern matching and present the result as clearance.
 *
 * ── RDAP: three states, not two ─────────────────────────────────────────────
 *
 * The tempting reading is "404 means the domain is free". That is a false-pass
 * bug, and it is the same shape as every other one this codebase exists to stop:
 *
 *   - rdap.org is a BOOTSTRAP REDIRECTOR, not a data source. It answers 404 when
 *     it does not know an authoritative RDAP server for that TLD — which says
 *     nothing at all about the domain.
 *   - Only a 404 from the AUTHORITATIVE registry means "no registration record".
 *   - And even that is not "available to register": reserved, premium, blocked,
 *     and registry-held names have no RDAP record and still cannot be bought.
 *
 * Hence `DomainState` has an explicit `unknown`, and the copy never promises
 * availability — only that no registration record was found.
 *
 * ── USPTO: what the endpoints actually do ───────────────────────────────────
 *
 * Confirmed 2026-08-19 against USPTO documentation:
 *
 *   - TSDR is a STATUS API. It is keyed by serial number, registration number,
 *     reference number, or international registration number. It cannot answer
 *     "is this name taken" — there is no mark-text query. It also requires an
 *     API key.
 *   - Searching by mark text is the Open Data Portal's trademark search
 *     endpoint, and since 18 June 2026 the ODP requires a signed-in USPTO.gov
 *     account, so it needs a key too.
 *
 * There is therefore no keyless USPTO path. Without `USPTO_API_KEY` the
 * trademark half returns `unknown` and the module reports it as unassessed.
 */

// ─── Domains ─────────────────────────────────────────────────────────────────

/** TLDs checked by default. Kept small — each one is a separate RDAP request. */
export const DEFAULT_TLDS = ['com', 'io', 'app', 'ai'] as const;

export type DomainState =
  /** Authoritative registry returned a registration record. */
  | 'registered'
  /** Authoritative registry returned 404 — no record. NOT the same as available. */
  | 'unregistered'
  /** No authoritative server known, rate limited, timed out, or errored. */
  | 'unknown';

export interface DomainResult {
  domain: string;
  tld: string;
  state: DomainState;
  /** Why the state is `unknown`, for honest display. Absent otherwise. */
  reason?: 'no_rdap_server' | 'rate_limited' | 'timeout' | 'error';
  /** Registry-reported status codes, verbatim. Only present when registered. */
  statuses?: string[];
  /** ISO date of registration, verbatim from the registry. Only when registered. */
  registeredOn?: string;
  /** The RDAP host that actually answered — the provenance of this result. */
  source?: string;
}

/**
 * Classify an RDAP outcome.
 *
 * `finalHost` is the host that actually answered after redirects. A 404 from the
 * bootstrap service is a different fact from a 404 from a registry, and
 * collapsing them is the bug this function exists to prevent.
 */
export function classifyRdap(
  status: number,
  finalHost: string,
  bootstrapHost = 'rdap.org',
): { state: DomainState; reason?: DomainResult['reason'] } {
  if (status === 200) return { state: 'registered' };
  if (status === 429) return { state: 'unknown', reason: 'rate_limited' };

  if (status === 404) {
    // Still at the bootstrap service → it has no authoritative server for this
    // TLD. That tells us nothing about the domain.
    if (finalHost === bootstrapHost || finalHost.endsWith(`.${bootstrapHost}`)) {
      return { state: 'unknown', reason: 'no_rdap_server' };
    }
    return { state: 'unregistered' };
  }

  return { state: 'unknown', reason: 'error' };
}

/** Extract only fields the registry actually sent. Never synthesise. */
export function readRdapRecord(body: unknown): Pick<DomainResult, 'statuses' | 'registeredOn'> {
  if (typeof body !== 'object' || body === null) return {};
  const d = body as Record<string, unknown>;

  const statuses = Array.isArray(d['status'])
    ? d['status'].filter((s): s is string => typeof s === 'string').slice(0, 8)
    : undefined;

  let registeredOn: string | undefined;
  if (Array.isArray(d['events'])) {
    for (const ev of d['events']) {
      if (typeof ev !== 'object' || ev === null) continue;
      const e = ev as Record<string, unknown>;
      if (e['eventAction'] === 'registration' && typeof e['eventDate'] === 'string') {
        registeredOn = e['eventDate'];
        break;
      }
    }
  }

  const out: Pick<DomainResult, 'statuses' | 'registeredOn'> = {};
  if (statuses && statuses.length) out.statuses = statuses;
  if (registeredOn) out.registeredOn = registeredOn;
  return out;
}

// ─── Trademarks ──────────────────────────────────────────────────────────────

export type TrademarkState = 'checked' | 'unknown';

/** One mark, carrying ONLY fields returned by the registry. */
export interface MarkHit {
  /** The mark text as registered. */
  markText: string;
  /** Owner name, verbatim. Absent if the response did not include one. */
  owner?: string;
  /** Serial number, verbatim. NEVER synthesised — absent if not returned. */
  serialNumber?: string;
  /** Registration number, verbatim. Absent if not returned. */
  registrationNumber?: string;
  /** Status text, verbatim. */
  status?: string;
  /** Whether the registry reports this mark as live. */
  live?: boolean;
  /** Nice classes, verbatim. */
  classes?: string[];
  /** Exact match on the candidate name, or merely similar. */
  match: 'exact' | 'similar';
}

export interface TrademarkResult {
  state: TrademarkState;
  reason?: 'no_api_key' | 'rate_limited' | 'timeout' | 'error' | 'unsupported';
  hits: MarkHit[];
  /** Where the data came from, for provenance on the finding. */
  source?: string;
}

// ─── Request / response envelope ─────────────────────────────────────────────

export interface NameCheckRequest {
  /** Candidate product or app name. */
  name: string;
  /** TLDs to check. Server clamps the count. */
  tlds?: string[];
}

export interface NameCheckSuccess {
  ok: true;
  name: string;
  /** Normalised slug actually used for domain lookups. */
  slug: string;
  domains: DomainResult[];
  trademarks: TrademarkResult;
  checkedAt: string;
}

export interface NameCheckFailure {
  ok: false;
  code:
    | 'unauthenticated'
    | 'rate_limited'
    | 'invalid_name'
    | 'not_configured'
    | 'upstream_unavailable';
  message: string;
}

export type NameCheckResponse = NameCheckSuccess | NameCheckFailure;

export const NAME_MIN = 2;
export const NAME_MAX = 63;
export const MAX_TLDS = 6;

/** Domain label for a candidate name. Returns null when it cannot make one. */
export function toDomainSlug(name: string): string | null {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, NAME_MAX);
  if (slug.length < NAME_MIN) return null;
  return slug;
}

/** Normalise a mark for comparison: case, spacing, and punctuation only. */
export function normalizeMark(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function isExactMark(candidate: string, mark: string): boolean {
  return normalizeMark(candidate) === normalizeMark(mark);
}
