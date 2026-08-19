/**
 * Name check — Supabase Edge Function (Deno).
 *
 * Queries RDAP and USPTO directly. No integration platform in the middle: a
 * direct call answers in a few hundred milliseconds, costs nothing per run, and
 * is one less service to monitor.
 *
 * WHAT IT WILL NOT DO
 *
 * It will not report a trademark result it did not retrieve. If USPTO_API_KEY is
 * absent, or the lookup fails, `trademarks.state` is `unknown` and the client
 * reports that half as unassessed. There is no pattern-matching fallback dressed
 * up as clearance — that is the specific failure this whole codebase was built
 * in reaction to.
 *
 * Deploy:
 *   supabase secrets set USPTO_API_KEY=...        # optional; without it,
 *                                                 # trademark checks report unknown
 *   supabase functions deploy name-check
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

import {
  DEFAULT_TLDS,
  MAX_TLDS,
  NAME_MAX,
  NAME_MIN,
  classifyRdap,
  isExactMark,
  normalizeMark,
  readRdapRecord,
  toDomainSlug,
  type DomainResult,
  type MarkHit,
  type NameCheckResponse,
  type TrademarkResult,
} from '../_shared/name-contract.ts';

const RDAP_BOOTSTRAP = 'https://rdap.org';
const RDAP_TIMEOUT_MS = 6_000;
const USPTO_TIMEOUT_MS = 8_000;

/**
 * rdap.org sits behind Cloudflare at roughly 10 requests per 10 seconds. Four
 * TLDs in parallel is comfortably inside that for one user; the per-user rate
 * limit below keeps the aggregate sane.
 */
const RDAP_CONCURRENCY = 4;

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(body: NameCheckResponse, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function fail(code: Extract<NameCheckResponse, { ok: false }>['code'], message: string, status: number) {
  return reply({ ok: false, code, message }, status);
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── RDAP ────────────────────────────────────────────────────────────────────

async function checkDomain(slug: string, tld: string): Promise<DomainResult> {
  const domain = `${slug}.${tld}`;
  const base: DomainResult = { domain, tld, state: 'unknown' };

  try {
    // redirect: 'follow' lands us on the authoritative registry. Which host
    // actually answered is what separates "no record" from "no server".
    const res = await fetchWithTimeout(
      `${RDAP_BOOTSTRAP}/domain/${encodeURIComponent(domain)}`,
      { headers: { Accept: 'application/rdap+json, application/json' }, redirect: 'follow' },
      RDAP_TIMEOUT_MS,
    );

    const finalHost = (() => {
      try {
        return new URL(res.url).host;
      } catch {
        return 'rdap.org';
      }
    })();

    const { state, reason } = classifyRdap(res.status, finalHost);
    const out: DomainResult = { ...base, state, source: finalHost };
    if (reason) out.reason = reason;

    if (state === 'registered') {
      try {
        Object.assign(out, readRdapRecord(await res.json()));
      } catch {
        // A registered domain whose body will not parse is still registered.
      }
    }
    return out;
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    return { ...base, reason: aborted ? 'timeout' : 'error' };
  }
}

async function checkDomains(slug: string, tlds: string[]): Promise<DomainResult[]> {
  const out: DomainResult[] = [];
  for (let i = 0; i < tlds.length; i += RDAP_CONCURRENCY) {
    const batch = tlds.slice(i, i + RDAP_CONCURRENCY);
    out.push(...(await Promise.all(batch.map((t) => checkDomain(slug, t)))));
  }
  return out;
}

// ─── USPTO ───────────────────────────────────────────────────────────────────

/**
 * Trademark search by mark text.
 *
 * Note what this is NOT: TSDR. TSDR is a status API keyed by serial or
 * registration number and cannot be queried by mark text, so it cannot answer
 * "is this name taken". Mark-text search is the Open Data Portal, which has
 * required an authenticated USPTO.gov account since 18 June 2026.
 *
 * Response shapes across USPTO surfaces vary and have changed more than once, so
 * every field is read defensively and anything absent stays absent. A missing
 * serial number is rendered as a missing serial number — never invented.
 */
async function checkTrademarks(name: string): Promise<TrademarkResult> {
  const apiKey = Deno.env.get('USPTO_API_KEY');
  if (!apiKey) {
    return { state: 'unknown', reason: 'no_api_key', hits: [] };
  }

  const endpoint =
    Deno.env.get('USPTO_SEARCH_URL') ??
    `https://api.uspto.gov/api/v1/trademarks/search?query=${encodeURIComponent(name)}`;

  try {
    const res = await fetchWithTimeout(
      endpoint,
      { headers: { 'X-API-KEY': apiKey, Accept: 'application/json' } },
      USPTO_TIMEOUT_MS,
    );

    if (res.status === 429) return { state: 'unknown', reason: 'rate_limited', hits: [] };
    if (res.status === 404) {
      // No results is a real answer: nothing matched.
      return { state: 'checked', hits: [], source: new URL(endpoint).host };
    }
    if (!res.ok) {
      console.error(`USPTO search returned ${res.status}`);
      return { state: 'unknown', reason: 'error', hits: [] };
    }

    const body = await res.json();
    return {
      state: 'checked',
      hits: extractMarks(body, name),
      source: new URL(endpoint).host,
    };
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    console.error('USPTO search failed:', aborted ? 'timeout' : err);
    return { state: 'unknown', reason: aborted ? 'timeout' : 'error', hits: [] };
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Pull marks out of whatever envelope USPTO used, taking only present fields. */
function extractMarks(body: unknown, candidate: string): MarkHit[] {
  if (typeof body !== 'object' || body === null) return [];
  const b = body as Record<string, unknown>;

  const rows =
    (Array.isArray(b['results']) && b['results']) ||
    (Array.isArray(b['trademarks']) && b['trademarks']) ||
    (Array.isArray(b['items']) && b['items']) ||
    (Array.isArray(b['docs']) && b['docs']) ||
    [];

  const hits: MarkHit[] = [];
  for (const row of rows.slice(0, 25)) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;

    const markText =
      str(r['markText']) ?? str(r['mark_identification']) ?? str(r['markIdentification']) ?? str(r['wordMark']);
    if (!markText) continue;

    const statusText = str(r['status']) ?? str(r['statusText']) ?? str(r['markStatus']);
    const live = typeof r['live'] === 'boolean'
      ? (r['live'] as boolean)
      : statusText
        ? /live|registered|pending|published/i.test(statusText)
        : undefined;

    const classesRaw = r['classes'] ?? r['internationalClasses'] ?? r['niceClasses'];
    const classes = Array.isArray(classesRaw)
      ? classesRaw.map((c) => String(c)).slice(0, 10)
      : undefined;

    const hit: MarkHit = {
      markText,
      match: isExactMark(candidate, markText) ? 'exact' : 'similar',
    };
    // Only assign what the registry actually returned.
    const owner = str(r['owner']) ?? str(r['ownerName']) ?? str(r['registrant']);
    const serial = str(r['serialNumber']) ?? str(r['serial_number']);
    const reg = str(r['registrationNumber']) ?? str(r['registration_number']);
    if (owner) hit.owner = owner;
    if (serial) hit.serialNumber = serial;
    if (reg) hit.registrationNumber = reg;
    if (statusText) hit.status = statusText;
    if (live !== undefined) hit.live = live;
    if (classes?.length) hit.classes = classes;

    hits.push(hit);
  }

  // Exact matches first — they are what a reviewer looks at.
  return hits.sort((a, b) => (a.match === b.match ? 0 : a.match === 'exact' ? -1 : 1));
}

// ─── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('invalid_name', 'Use POST.', 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    console.error('SUPABASE_URL / SUPABASE_ANON_KEY missing from function env.');
    return fail('not_configured', 'Name checking is misconfigured.', 503);
  }

  // Anon key plus the caller's JWT. This function has no reason to bypass RLS.
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return fail('unauthenticated', 'Sign in to run a name check.', 401);
  }

  let name = '';
  let tlds: string[] = [...DEFAULT_TLDS];
  try {
    const body = await req.json();
    name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (Array.isArray(body?.tlds) && body.tlds.length) {
      tlds = body.tlds
        .filter((t: unknown): t is string => typeof t === 'string')
        .map((t) => t.replace(/^\./, '').toLowerCase())
        .filter((t) => /^[a-z]{2,24}$/.test(t))
        .slice(0, MAX_TLDS);
    }
  } catch {
    return fail('invalid_name', 'Request body must be JSON.', 400);
  }

  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return fail('invalid_name', `Give a name between ${NAME_MIN} and ${NAME_MAX} characters.`, 400);
  }
  const slug = toDomainSlug(name);
  if (!slug) {
    return fail('invalid_name', 'That name has no letters or digits to form a domain from.', 400);
  }
  if (!tlds.length) tlds = [...DEFAULT_TLDS];

  // Reuse the claims rate limiter — this endpoint hits third-party services that
  // rate-limit us in turn, so per-user pacing protects both us and them.
  const { data: limit, error: limitErr } = await supabase
    .rpc('claim_rate_limit', { p_hourly_limit: 30, p_daily_limit: 150 })
    .single();
  if (!limitErr) {
    const allowance = limit as { allowed: boolean; retry_after_seconds: number };
    if (!allowance.allowed) {
      const mins = Math.ceil((allowance.retry_after_seconds ?? 60) / 60);
      return reply(
        {
          ok: false,
          code: 'rate_limited',
          message: `Name check limit reached. Try again in about ${mins} minute${mins === 1 ? '' : 's'}.`,
        },
        429,
      );
    }
  }

  const [domains, trademarks] = await Promise.all([
    checkDomains(slug, tlds),
    checkTrademarks(normalizeMark(name) ? name : slug),
  ]);

  return reply(
    {
      ok: true,
      name,
      slug,
      domains,
      trademarks,
      checkedAt: new Date().toISOString(),
    },
    200,
  );
});
