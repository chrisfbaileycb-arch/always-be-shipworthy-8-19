/**
 * Name module — trademark and domain collision.
 *
 * This is the module BrandGuard got wrong, so it is worth being explicit about
 * what "right" means here.
 *
 * 1. **No lookup, no claim.** A finding is produced only from a response
 *    received in this run. When the registry was not reached, the module says so
 *    and — if nothing at all was reached — returns `not_assessed`. There is no
 *    heuristic fallback presented as clearance.
 *
 * 2. **No synthesised identifiers, ever.** Serial numbers, registration numbers,
 *    and registrant names are rendered only when the registry returned them.
 *    BrandGuard printed invented ones from a 23-token dictionary; that is the
 *    single worst thing this product could inherit.
 *
 * 3. **"No registration record" is not "available".** An RDAP 404 from the
 *    authoritative registry means no record exists. Reserved, premium, blocked,
 *    and registry-held names also have no record and still cannot be bought — so
 *    the copy never promises availability.
 *
 * 4. **No legal conclusions.** A live mark is reported as a collision risk worth
 *    a lawyer's time, never as infringement.
 */

import { assessed, makeFinding, notAssessed } from '../core/finding';
import type { RuleId } from '../core/rules';
import type { Finding, ModuleResult } from '../core/types';
import {
  isExactMark,
  type DomainResult,
  type MarkHit,
  type NameCheckResponse,
  type NameCheckSuccess,
  type TrademarkResult,
} from '../../supabase/functions/_shared/name-contract';
import { getSupabase } from '../lib/supabase';

const MODULE = 'name' as const;

const UNKNOWN_REASON: Record<string, string> = {
  no_rdap_server: 'no public RDAP server is published for that TLD',
  no_api_key: 'the trademark registry is not configured on this deployment',
  rate_limited: 'the registry rate-limited the request',
  timeout: 'the registry did not respond in time',
  error: 'the registry returned an error',
  unsupported: 'that lookup is not supported',
};

function describeReason(reason?: string): string {
  return (reason && UNKNOWN_REASON[reason]) || 'the lookup did not complete';
}

// ─── Domain findings ─────────────────────────────────────────────────────────

function domainFindings(result: NameCheckSuccess): { findings: Finding[]; checksRun: RuleId[] } {
  const findings: Finding[] = [];
  const checksRun: RuleId[] = [];

  const registered = result.domains.filter((d) => d.state === 'registered');
  const free = result.domains.filter((d) => d.state === 'unregistered');

  if (registered.length || free.length) {
    checksRun.push('name.domain.registered', 'name.domain.unregistered');
  }

  for (const d of registered) {
    findings.push(
      makeFinding({
        module: MODULE,
        ruleId: 'name.domain.registered',
        severity: d.tld === 'com' ? 'warn' : 'info',
        title: `${d.domain} is already registered`,
        evidence: {
          // Only what the registry actually said.
          excerpt: describeRegistration(d),
          locator: `rdap:${d.source ?? 'registry'}/${d.domain}`,
          source: 'name',
        },
        // A live registry answered in this run.
        confidence: 'verified',
        fix:
          d.tld === 'com'
            ? 'Pick a different name, or plan to launch on another TLD and accept that the .com will point somewhere else.'
            : `The .${d.tld} is taken. Decide whether you need it before committing to the name.`,
      }),
    );
  }

  return { findings, checksRun };
}

function describeRegistration(d: DomainResult): string {
  const parts: string[] = [`${d.domain} has a registration record`];
  if (d.registeredOn) parts.push(`registered ${d.registeredOn.slice(0, 10)}`);
  if (d.statuses?.length) parts.push(`status: ${d.statuses.join(', ')}`);
  return parts.join('; ');
}

// ─── Trademark findings ──────────────────────────────────────────────────────

function trademarkFindings(
  candidate: string,
  tm: TrademarkResult,
): { findings: Finding[]; checksRun: RuleId[] } {
  const findings: Finding[] = [];
  const checksRun: RuleId[] = [];
  if (tm.state !== 'checked') return { findings, checksRun };

  checksRun.push('name.trademark.live-mark', 'name.trademark.similar-mark');

  for (const hit of tm.hits.slice(0, 10)) {
    const exact = hit.match === 'exact' || isExactMark(candidate, hit.markText);
    const live = hit.live !== false;
    if (!live && !exact) continue; // dead similar marks are noise

    findings.push(
      makeFinding({
        module: MODULE,
        ruleId: exact ? 'name.trademark.live-mark' : 'name.trademark.similar-mark',
        severity: exact && live ? 'critical' : 'warn',
        title: exact
          ? `Existing mark with the same name: "${hit.markText}"`
          : `Similar existing mark: "${hit.markText}"`,
        evidence: {
          excerpt: describeMark(hit),
          locator: `uspto:${tm.source ?? 'registry'}`,
          source: 'name',
        },
        confidence: 'verified',
        // Names the collision and the decision. Never asserts infringement.
        fix: exact
          ? 'Have a trademark attorney assess this before you commit to the name — an identical live mark in a related class is the expensive kind of collision.'
          : 'Check whether this mark covers goods or services close to yours. Similarity plus overlapping class is what drives a refusal.',
      }),
    );
  }

  return { findings, checksRun };
}

/**
 * Render a mark using ONLY fields the registry returned.
 *
 * Absent fields are simply absent. This function is the reason the module can
 * never print an invented serial number: there is no default, no placeholder,
 * and no formatting branch that fabricates one.
 */
function describeMark(hit: MarkHit): string {
  const parts: string[] = [`"${hit.markText}"`];
  if (hit.owner) parts.push(`owner: ${hit.owner}`);
  if (hit.serialNumber) parts.push(`serial ${hit.serialNumber}`);
  if (hit.registrationNumber) parts.push(`reg. ${hit.registrationNumber}`);
  if (hit.status) parts.push(`status: ${hit.status}`);
  if (hit.classes?.length) parts.push(`class ${hit.classes.join(', ')}`);
  return parts.join(' · ');
}

// ─── Assembly ────────────────────────────────────────────────────────────────

export interface NameAssembly {
  result: ModuleResult;
  /** Lookups that did not complete, phrased for display. */
  gaps: string[];
}

/**
 * Build the module result from a completed lookup.
 *
 * Pure and synchronous, so every branch — including "nothing was reachable" —
 * is testable without a network.
 */
export function assembleName(response: NameCheckSuccess): NameAssembly {
  const domains = domainFindings(response);
  const trademarks = trademarkFindings(response.name, response.trademarks);

  const gaps: string[] = [];

  const unknownDomains = response.domains.filter((d) => d.state === 'unknown');
  for (const d of unknownDomains) {
    gaps.push(`.${d.tld} could not be checked — ${describeReason(d.reason)}`);
  }
  if (response.trademarks.state !== 'checked') {
    gaps.push(`trademarks were not checked — ${describeReason(response.trademarks.reason)}`);
  }

  const anyDomainChecked = response.domains.some((d) => d.state !== 'unknown');
  const trademarksChecked = response.trademarks.state === 'checked';

  // Nothing was reached. That is not a clean name — it is an unknown one.
  if (!anyDomainChecked && !trademarksChecked) {
    return {
      result: notAssessed(MODULE, [
        'a working connection to the domain and trademark registries — none of the lookups completed, so nothing about this name has been established',
      ]),
      gaps,
    };
  }

  return {
    result: assessed(
      MODULE,
      [...trademarks.findings, ...domains.findings],
      [...trademarks.checksRun, ...domains.checksRun],
    ),
    gaps,
  };
}

// ─── Calling the Edge Function ───────────────────────────────────────────────

export class NameCheckError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'NameCheckError';
    this.code = code;
  }
}

export async function checkName(name: string, tlds?: string[]): Promise<NameAssembly> {
  const supabase = getSupabase();
  if (!supabase) {
    throw new NameCheckError(
      'not_configured',
      'Name checking needs a backend. Nothing about this name has been checked.',
    );
  }

  const { data, error } = await supabase.functions.invoke<NameCheckResponse>('name-check', {
    body: tlds?.length ? { name, tlds } : { name },
  });

  if (error) {
    throw new NameCheckError(
      'upstream_unavailable',
      'Could not reach the name check service. Nothing about this name has been checked.',
    );
  }
  if (!data || data.ok !== true) {
    throw new NameCheckError(
      data?.code ?? 'upstream_unavailable',
      data?.message ?? 'The name check could not be completed.',
    );
  }

  return assembleName(data);
}
