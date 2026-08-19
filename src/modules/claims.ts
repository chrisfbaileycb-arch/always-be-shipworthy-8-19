/**
 * Claims module — can the promises in your listing be substantiated?
 *
 * The one module whose findings originate from a model rather than a regex, and
 * therefore the one where the evidence rule has to be enforced hardest.
 *
 * The gate: every quote the model returns is looked up in the source text the
 * user actually submitted. A quote that cannot be located is discarded and
 * counted. The excerpt stored on the finding is the SOURCE's wording, not the
 * model's — so what the user reads back is their own sentence, character for
 * character, even if the model tidied it on the way through.
 *
 * This is what makes `makeFinding()` honest for model output. Without it,
 * `evidence.excerpt` would be whatever the model typed, and a fabricated quote
 * would sail through the same constructor that a real one does — which is
 * precisely how BrandGuard came to print USPTO serial numbers for a registry it
 * never called.
 *
 * Two cost tiers:
 *   - Deterministic pre-checks run locally, free, signed-out, and catch the
 *     absolute language that is wrong regardless of what the app does.
 *   - The model pass runs server-side behind auth and a rate limit, and finds
 *     the claims a pattern cannot: implied comparisons, unstated conditions,
 *     promises assembled across a sentence.
 */

import { assessed, makeFinding, notAssessed } from '../core/finding';
import type { RuleId } from '../core/rules';
import type { Finding, ModuleResult, Severity } from '../core/types';
import {
  CLAIMS_INPUT_MIN,
  keepWellFormed,
  lineOf,
  locateQuote,
  type ClaimSeverity,
  type ClaimType,
  type ClaimsResponse,
  type RawClaim,
} from '../../supabase/functions/_shared/claims-contract';
import { getSupabase } from '../lib/supabase';

const MODULE = 'claims' as const;

/** Model claim type → the registered rule it cites. */
const CLAIM_RULE: Record<ClaimType, RuleId> = {
  superlative: 'claims.superlative.unsubstantiated',
  comparison: 'claims.comparison.competitor',
  efficacy: 'claims.efficacy.unproven',
  earnings: 'claims.earnings.income',
  guarantee: 'claims.guarantee.absolute',
  endorsement: 'claims.endorsement.unverified',
  security: 'claims.security.absolute',
  privacy: 'claims.privacy.overbroad',
  health: 'claims.health.medical',
  pricing: 'claims.pricing.misleading',
};

const SEVERITY_MAP: Record<ClaimSeverity, Severity> = {
  critical: 'critical',
  warn: 'warn',
  info: 'info',
};

// ─── Deterministic pre-checks (free, local, no account) ──────────────────────

interface LocalCheck {
  ruleId: RuleId;
  re: RegExp;
  severity: Severity;
  title: (m: string) => string;
  fix: string;
}

/**
 * Absolute language only. These are claims that are indefensible as written
 * regardless of how good the product is, which is why a pattern is enough — no
 * judgement about the app is being made, only about the sentence.
 */
const LOCAL_CHECKS: LocalCheck[] = [
  {
    ruleId: 'claims.security.absolute',
    re: /\b(unhackable|100%\s*secure|completely\s+secure|totally\s+secure|impenetrable|cannot\s+be\s+hacked|military[- ]grade\s+(security|encryption))\b/i,
    severity: 'critical',
    title: (m) => `Absolute security claim: "${m}"`,
    fix: 'Replace with what you actually do — "encrypted in transit and at rest with AES-256", say. Absolute security claims are treated as deceptive because no system can honour them.',
  },
  {
    ruleId: 'claims.privacy.overbroad',
    re: /\b(we\s+never\s+collect\s+(any\s+)?data|zero\s+data\s+collection|completely\s+anonymous|totally\s+private|no\s+data\s+is\s+ever\s+collected)\b/i,
    severity: 'critical',
    title: (m) => `Absolute privacy claim: "${m}"`,
    fix: 'State the specific practice instead, and make sure it matches your Play Data safety form and Apple privacy labels. Crash logs and analytics usually make "never" untrue.',
  },
  {
    ruleId: 'claims.guarantee.absolute',
    re: /\b(guaranteed|100%\s*(guaranteed|accurate|reliable)|never\s+fails|always\s+works|risk[- ]free)\b/i,
    severity: 'warn',
    title: (m) => `Unqualified guarantee: "${m}"`,
    fix: 'Either qualify it with the conditions that actually apply, or be ready to honour it exactly as written — an unqualified guarantee is read literally.',
  },
  {
    ruleId: 'claims.earnings.income',
    re: /\b(?:earn|make|generate|profit)\s+(?:up\s+to\s+)?\$[\d,]+|\$[\d,]+\s*(?:per|\/|a)\s*(?:day|week|month|year)|\b\d+[kK]\s*(?:per|\/|a)\s*(?:day|week|month|year)/i,
    severity: 'critical',
    title: (m) => `Income claim: "${m}"`,
    fix: 'Earnings claims need substantiation and a disclosure of typical results. If you cannot document what an average user actually earns, remove the figure.',
  },
];

/** Character span of a finding's evidence in the source, keyed by finding id. */
export type SpanIndex = Record<string, [number, number]>;

export interface LocalClaimsResult {
  findings: Finding[];
  checksRun: RuleId[];
  spans: SpanIndex;
}

/** Free local pass. Returns findings for absolute language, with real evidence. */
export function localClaimFindings(source: string): LocalClaimsResult {
  const findings: Finding[] = [];
  const checksRun: RuleId[] = [];
  const spans: SpanIndex = {};

  for (const check of LOCAL_CHECKS) {
    checksRun.push(check.ruleId);
    const m = source.match(check.re);
    if (!m || m.index === undefined) continue;
    const finding = makeFinding({
      module: MODULE,
      ruleId: check.ruleId,
      severity: check.severity,
      title: check.title(m[0]),
      evidence: {
        excerpt: m[0],
        locator: `listing.description:L${lineOf(source, m.index)}`,
        source: 'description',
      },
      fix: check.fix,
    });
    findings.push(finding);
    spans[finding.id] = [m.index, m.index + m[0].length];
  }
  return { findings, checksRun, spans };
}

// ─── Model pass — verification and construction ──────────────────────────────

export interface ClaimsBuildResult {
  findings: Finding[];
  /** Quotes the model returned that do not occur in the source. Dropped. */
  unverifiedCount: number;
  /** The dropped quotes, for logging and for surfacing model quality problems. */
  unverifiedQuotes: string[];
  /** Where each finding's evidence sits in the source, for span-based dedup. */
  spans: SpanIndex;
}

/**
 * Turn raw model claims into Findings, dropping anything ungrounded.
 *
 * Pure and synchronous, so the gate is unit-testable without a network or a key.
 */
export function buildVerifiedFindings(source: string, rawClaims: unknown): ClaimsBuildResult {
  const claims = keepWellFormed(rawClaims);
  const findings: Finding[] = [];
  const unverifiedQuotes: string[] = [];
  const spans: SpanIndex = {};
  const seen = new Set<string>();

  for (const claim of claims as RawClaim[]) {
    const located = locateQuote(source, claim.quote);
    if (!located) {
      // The model quoted something that is not in the user's text. Drop it.
      unverifiedQuotes.push(claim.quote);
      continue;
    }

    // One finding per (rule, span). A model that flags the same sentence twice
    // should not double-count against the score.
    const key = `${claim.type}:${located.index}:${located.excerpt}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const fix = claim.rewrite.trim()
      ? `${claim.substantiation.trim()} Suggested rewrite: "${claim.rewrite.trim()}"`
      : claim.substantiation.trim() ||
        'Remove the claim, or document the evidence that supports it before publishing.';

    const finding = makeFinding({
        module: MODULE,
        ruleId: CLAIM_RULE[claim.type],
        severity: SEVERITY_MAP[claim.severity],
        title: claim.why.trim() || `Unsubstantiated ${claim.type} claim`,
        evidence: {
          // The source's own wording, never the model's rendering of it.
          excerpt: located.excerpt,
          locator: `listing.description:L${lineOf(source, located.index)}`,
          source: 'description',
        },
        // A model is not an authoritative source. Nothing it produces is
        // 'verified' — that word is reserved for a live registry lookup.
        confidence: 'heuristic',
        fix,
    });
    findings.push(finding);
    spans[finding.id] = [located.index, located.index + located.excerpt.length];
  }

  return { findings, unverifiedCount: unverifiedQuotes.length, unverifiedQuotes, spans };
}

/** Assemble a claims ModuleResult from a local pass and an optional model pass. */
export function assembleClaims(
  source: string,
  model?: Pick<ClaimsBuildResult, 'findings' | 'spans'>,
  extraChecks: RuleId[] = [],
): ModuleResult {
  const trimmed = source.trim();
  if (trimmed.length < CLAIMS_INPUT_MIN) {
    return notAssessed(MODULE, [
      `at least ${CLAIMS_INPUT_MIN} characters of store description — claims analysis needs real copy to read`,
    ]);
  }

  const local = localClaimFindings(source);

  // Both tiers can flag the same sentence. Collapse a model finding into a local
  // one only when they cite the same rule AND their evidence spans actually
  // overlap — matching on the excerpt string alone was wrong, because the regex
  // and the model routinely quote different fragments of one sentence ("100%
  // secure" vs "completely unhackable"), which are two real claims, not one.
  const localByRule = new Map<string, [number, number][]>();
  for (const f of local.findings) {
    const span = local.spans[f.id];
    if (!span) continue;
    const list = localByRule.get(f.rule.id) ?? [];
    list.push(span);
    localByRule.set(f.rule.id, list);
  }

  const deduped = (model?.findings ?? []).filter((f) => {
    const span = model?.spans?.[f.id];
    if (!span) return true; // no span known — keep rather than silently drop
    const overlapping = localByRule.get(f.rule.id) ?? [];
    return !overlapping.some(([ls, le]) => span[0] < le && ls < span[1]);
  });

  return assessed(MODULE, [...local.findings, ...deduped], [...local.checksRun, ...extraChecks]);
}

// ─── Calling the Edge Function ───────────────────────────────────────────────

export class ClaimsUnavailableError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ClaimsUnavailableError';
    this.code = code;
  }
}

/**
 * Run the model pass. Requires sign-in — the endpoint spends money.
 *
 * Returns the verified findings plus how many quotes were discarded, so the UI
 * can be honest about it rather than quietly presenting a filtered list.
 */
export async function analyzeClaims(source: string): Promise<ClaimsBuildResult> {
  const supabase = getSupabase();
  if (!supabase) {
    throw new ClaimsUnavailableError(
      'not_configured',
      'Claims analysis needs a backend. Local claim checks still ran.',
    );
  }

  const { data, error } = await supabase.functions.invoke<ClaimsResponse>('claims-analyze', {
    body: { text: source.trim() },
  });

  if (error) {
    throw new ClaimsUnavailableError(
      'provider_unavailable',
      'Could not reach the claims analysis service. Local claim checks still ran.',
    );
  }
  if (!data || data.ok !== true) {
    throw new ClaimsUnavailableError(
      data?.code ?? 'malformed_response',
      data?.message ?? 'The claims analysis could not be completed.',
    );
  }

  return buildVerifiedFindings(source, data.claims);
}
