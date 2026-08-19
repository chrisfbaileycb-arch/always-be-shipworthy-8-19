/**
 * Policy module — store policy and privacy obligations.
 *
 * Ported from SHIFT Pre-Flight's `auditLegal`.
 *
 * Two deliberate changes beyond the shared contract:
 *
 * 1. This module is fundamentally about the gap between what an app *does* (the
 *    config) and what it *says* (the listing). Without the listing copy there is
 *    no gap to measure, so a missing description returns `not_assessed` rather
 *    than a score derived from the one or two checks that could still run.
 *
 * 2. Finding titles name the pattern and the rule it touches. They never assert
 *    a legal conclusion — this is not legal advice and must not read as if it is.
 */

import { assessed, makeFinding, notAssessed } from '../core/finding';
import type { RuleId } from '../core/rules';
import type { Evidence, Finding, ModuleResult } from '../core/types';
import { SENSITIVE_PERMISSIONS } from './build';

const MODULE = 'policy' as const;

export interface PolicyInput {
  config: string;
  description: string;
}

export function auditPolicy({ config, description }: PolicyInput): ModuleResult {
  const d = description.trim();
  const cfg = config;

  if (!d) {
    return notAssessed(MODULE, [
      'your full store description — policy checks compare what the app does against what the listing claims',
    ]);
  }

  const allText = `${cfg}\n${d}`;
  const findings: Finding[] = [];
  const checksRun: RuleId[] = [];
  const run = (ruleId: RuleId, fn: () => Finding | Finding[] | null) => {
    checksRun.push(ruleId);
    const out = fn();
    if (!out) return;
    if (Array.isArray(out)) findings.push(...out);
    else findings.push(out);
  };

  const inDescription = (excerpt: string): Evidence => ({
    excerpt,
    locator: 'listing.description',
    source: 'description',
  });

  // ── platform billing ───────────────────────────────────────────────────────
  run('policy.billing.platform-required', () => {
    const m = d.match(
      /subscription|premium|in.?app purchase|unlock|upgrade|credits?|coins|token pack|paywall|pro version/i,
    );
    if (!m) return null;
    const billingReferenced =
      /play billing|com\.android\.vending\.BILLING|in.?app purchase|storekit|app store billing/i.test(allText);
    if (billingReferenced) return null;
    return makeFinding({
      module: MODULE,
      ruleId: 'policy.billing.platform-required',
      severity: 'critical',
      title: `Listing mentions "${m[0]}" but nothing references platform billing`,
      evidence: inDescription(m[0]),
      fix: 'If you sell digital goods, integrate Google Play Billing or StoreKit and declare the in-app products in the store console. Selling digital content outside platform billing is a removal-grade violation.',
    });
  });

  // ── privacy policy ─────────────────────────────────────────────────────────
  run('policy.privacy.policy-required', () => {
    if (/privacy policy|privacy\.html|\/privacy/i.test(allText)) return null;
    return makeFinding({
      module: MODULE,
      ruleId: 'policy.privacy.policy-required',
      severity: 'critical',
      title: 'No privacy policy referenced anywhere in the listing or config',
      // The evidence for an absence is the text we searched.
      evidence: {
        excerpt: d.slice(0, 160),
        locator: 'listing.description (searched, no policy URL found)',
        source: 'description',
      },
      fix: 'Publish a privacy policy, link it in the listing, and complete the Play Data safety form and Apple privacy labels. Every app needs one regardless of what data it collects.',
    });
  });

  // ── child-directed content ─────────────────────────────────────────────────
  run('policy.coppa.child-directed', () => {
    const m = d.match(/\bkids?\b|\bchild(ren)?\b|toddler|preschool|for families|family friendly/i);
    if (!m) return null;
    return makeFinding({
      module: MODULE,
      ruleId: 'policy.coppa.child-directed',
      severity: 'warn',
      title: `Child-directed language in listing: "${m[0]}"`,
      evidence: inDescription(m[0]),
      fix: 'Confirm your target-audience declaration matches this copy. Child-directed apps face restricted ads, no behavioural tracking, and parental-consent obligations under Play Families policy and COPPA.',
    });
  });

  // ── permissions with no stated purpose ─────────────────────────────────────
  run('policy.permissions.unjustified', () => {
    const out: Finding[] = [];
    for (const [perm, meta] of Object.entries(SENSITIVE_PERMISSIONS)) {
      const declared = cfg.match(new RegExp(`(android\\.permission\\.)?${perm}`));
      if (!declared) continue;
      if (meta.justify.test(d)) continue;
      out.push(
        makeFinding({
          module: MODULE,
          ruleId: 'policy.permissions.unjustified',
          severity: 'warn',
          title: `${perm} requested, but the listing never explains why`,
          evidence: {
            excerpt: declared[0],
            locator: 'config',
            source: 'config',
          },
          fix: `Describe the feature that needs ${meta.label} in the store description, or drop the permission. Reviewers reject apps whose permissions exceed the functionality the listing describes.`,
        }),
      );
    }
    return out.length ? out : null;
  });

  // ── empty iOS usage descriptions ───────────────────────────────────────────
  run('policy.ios.empty-usage-description', () => {
    const out: Finding[] = [];
    for (const key of cfg.match(/NS\w+UsageDescription/g) ?? []) {
      const empty = cfg.match(new RegExp(`<key>${key}</key>\\s*<string>\\s*</string>`));
      if (!empty) continue;
      out.push(
        makeFinding({
          module: MODULE,
          ruleId: 'policy.ios.empty-usage-description',
          severity: 'warn',
          title: `${key} is empty`,
          evidence: { excerpt: empty[0], locator: 'config', source: 'config' },
          fix: `Write a specific sentence explaining why the app needs this access — it is shown verbatim in the iOS permission prompt, and App Review rejects empty or generic strings.`,
        }),
      );
    }
    return out.length ? out : null;
  });

  // ── regulated categories ───────────────────────────────────────────────────
  run('policy.health.medical-claims', () => {
    const m = d.match(/medical|diagnos|health advice|symptom|treatment|therapy/i);
    if (!m) return null;
    return makeFinding({
      module: MODULE,
      ruleId: 'policy.health.medical-claims',
      severity: 'info',
      title: `Health or medical language in listing: "${m[0]}"`,
      evidence: inDescription(m[0]),
      fix: 'Add a clear "not medical advice" notice and avoid diagnostic claims unless you hold the relevant certification. Health copy draws extra review and can pull the app into medical-device regulation.',
    });
  });

  run('policy.finance.regulated-category', () => {
    const m = d.match(/invest|trading|loan|crypto|wallet|gambling|casino|betting/i);
    if (!m) return null;
    return makeFinding({
      module: MODULE,
      ruleId: 'policy.finance.regulated-category',
      severity: 'info',
      title: `Financial or gaming language in listing: "${m[0]}"`,
      evidence: inDescription(m[0]),
      fix: 'Check the declarations, licensing, and country restrictions both stores require for this category before submitting.',
    });
  });

  // ── accuracy disclaimer for automated output ───────────────────────────────
  run('policy.disclaimer.automated-results', () => {
    const m = d.match(/\bai\b|automated|analysis|recommend/i);
    if (!m) return null;
    const hasNotice =
      /may (contain|include) (errors|mistakes)|verify|no (guarantee|warranty)|as.?is/i.test(allText);
    if (hasNotice) return null;
    return makeFinding({
      module: MODULE,
      ruleId: 'policy.disclaimer.automated-results',
      severity: 'info',
      title: `Listing describes automated output ("${m[0]}") with no accuracy notice`,
      evidence: inDescription(m[0]),
      fix: 'Add a short line that results may contain errors and should be verified. Claims about automated analysis need substantiation, and the notice is cheap insurance.',
    });
  });

  return assessed(MODULE, findings, checksRun);
}
