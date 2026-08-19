/**
 * Shipworthy core types.
 *
 * The governing rule of this codebase:
 *
 *   Every finding must be grounded in a specific line from the source text or a
 *   named external standard. Ungrounded statements are not emitted.
 *
 * Two structural decisions enforce that rule, and neither is optional styling:
 *
 * 1. `Finding` cannot be constructed without `evidence` and `rule`. Both are
 *    required fields, and `makeFinding()` additionally rejects empty evidence at
 *    runtime — because findings can originate from a model, not just from our
 *    own regexes.
 *
 * 2. `ModuleResult` is a discriminated union in which `not_assessed` has no
 *    `score` field at all. A module that was given nothing to work with cannot
 *    return a number, high or low. This is what makes the false-pass bug
 *    structurally impossible rather than something a reviewer has to remember.
 *
 * There is deliberately no `'pass'` severity. A finding is a problem. Checks that
 * ran and found nothing are recorded in `checksRun`, so a report can honestly say
 * "12 checks ran, 3 found issues" — and a module where zero checks ran can never
 * be mistaken for one where twelve came back clean.
 */

import type { RuleId } from './rules';

// ─── Identity ────────────────────────────────────────────────────────────────

export type ModuleId =
  | 'name'      // trademark / domain / handle collision
  | 'build'     // app configuration and dependencies
  | 'listing'   // store metadata
  | 'policy'    // store policy and privacy obligations
  | 'claims'    // substantiation of marketing promises
  | 'watch';    // post-launch health

export const MODULE_LABEL: Record<ModuleId, string> = {
  name: 'Name',
  build: 'Build',
  listing: 'Listing',
  policy: 'Policy',
  claims: 'Claims',
  watch: 'Watch',
};

/**
 * No 'pass'. See the header note — reassurance lives in `checksRun`, not here.
 */
export type Severity = 'critical' | 'warn' | 'info';

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 25,
  warn: 8,
  info: 2,
};

/**
 * 'verified'  — a live authoritative source was queried during this run.
 * 'heuristic' — pattern match against local rules only.
 *
 * Never dress one as the other. A heuristic finding must not render registrant
 * names, serial numbers, or any other detail implying a record was retrieved.
 */
export type Confidence = 'verified' | 'heuristic';

// ─── Evidence ────────────────────────────────────────────────────────────────

/** Which user-supplied input a finding came from. */
export type InputField = 'config' | 'title' | 'shortDescription' | 'description' | 'name' | 'url';

export interface Evidence {
  /** The literal text that triggered this finding. Must be non-empty. */
  excerpt: string;
  /** Where it was found: 'config:L12', 'listing.title', 'package.json#dependencies'. */
  locator: string;
  /** Which input the excerpt came from. */
  source: InputField;
}

export interface RuleRef {
  id: RuleId;
  /** Who sets this rule: 'Google Play Console policy', 'Apple App Review Guidelines'. */
  authority: string;
  url: string;
  /** ISO date the rule text was last confirmed. Renders as "rules current as of". */
  asOf: string;
}

// ─── Finding ─────────────────────────────────────────────────────────────────

export interface Finding {
  /** Stable across runs for the same issue in the same place, so findings dedupe. */
  id: string;
  module: ModuleId;
  severity: Severity;
  title: string;
  /** Required. No evidence, no finding. */
  evidence: Evidence;
  /** Required. Which standard this touches, whose it is, and how fresh. */
  rule: RuleRef;
  confidence: Confidence;
  /** What to actually do about it. */
  fix: string;
}

// ─── Module result ───────────────────────────────────────────────────────────

export interface AssessedResult {
  module: ModuleId;
  status: 'assessed';
  /** 0–100. Only exists when the module actually ran. */
  score: number;
  findings: Finding[];
  /** Rules that executed. Length is the honest denominator for "how much was checked". */
  checksRun: RuleId[];
}

export interface NotAssessedResult {
  module: ModuleId;
  status: 'not_assessed';
  /**
   * Plain-language description of what the user must supply, e.g.
   * "your AndroidManifest.xml, Info.plist, or package.json".
   * Note the absence of `score` — that absence is the whole point.
   */
  missing: string[];
}

export type ModuleResult = AssessedResult | NotAssessedResult;

export function isAssessed(r: ModuleResult): r is AssessedResult {
  return r.status === 'assessed';
}

// ─── Report ──────────────────────────────────────────────────────────────────

export interface Report {
  appName: string;
  createdAt: number;
  /** The rules-registry date these results were produced against. */
  rulesAsOf: string;
  modules: ModuleResult[];
}
