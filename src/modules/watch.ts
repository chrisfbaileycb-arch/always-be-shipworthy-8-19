/**
 * Watch module — is this app instrumented for production?
 *
 * The launch-readiness half of post-launch monitoring: before you ship, can you
 * tell when it breaks? An app with no error reporting fails silently, and the
 * developer finds out from a one-star review.
 *
 * VENDOR NEUTRALITY IS THE DESIGN CONSTRAINT
 *
 * Findings name the missing *capability* and offer the field. There is no
 * recommended provider anywhere in this module, and no code path that mentions
 * one vendor without offering the others — a test asserts that. The predecessor
 * hardcoded a single vendor's setup script and DSN columns, which reported a
 * false gap for every team that had chosen differently.
 *
 * WHAT IS HONESTLY DETECTABLE
 *
 * Dependencies and environment references, from the config the user pasted. That
 * is enough to tell whether an SDK is installed and whether it looks configured.
 *
 * It is NOT enough to tell whether uptime monitoring exists — that lives in an
 * external dashboard and leaves no trace in a build config. So uptime is not
 * guessed at: it is reported as undeclared, with the menu, and the user says.
 * Inventing a "no uptime monitoring" finding from the absence of evidence would
 * be exactly the fabrication this codebase refuses everywhere else.
 */

import { assessed, makeFinding, notAssessed } from '../core/finding';
import {
  CATEGORY_LABEL,
  describeOptions,
  detectProviders,
  type Provider,
} from '../core/providers';
import type { RuleId } from '../core/rules';
import type { Finding, ModuleResult } from '../core/types';

const MODULE = 'watch' as const;

export interface WatchInput {
  /** package.json, manifest, or any build config the user pasted. */
  config: string;
  /**
   * Whether the user has declared uptime monitoring. Undefined means unanswered
   * — which is reported as undeclared, never as absent.
   */
  uptimeDeclared?: boolean;
}

export interface WatchAssembly {
  result: ModuleResult;
  /** Providers detected, for display. Empty is meaningful, not an error. */
  detected: Provider[];
}

/** Does this config carry dependency information we can actually read? */
function hasDependencyInfo(config: string): boolean {
  return /"(dependencies|devDependencies|peerDependencies)"\s*:/.test(config);
}

function lineOfMatch(config: string, needle: string): number {
  const idx = config.indexOf(needle);
  if (idx < 0) return 1;
  let line = 1;
  for (let i = 0; i < idx; i++) if (config[i] === '\n') line++;
  return line;
}

export function auditWatch({ config, uptimeDeclared }: WatchInput): WatchAssembly {
  // Without dependency information there is nothing to read. Not a gap — unknown.
  if (!hasDependencyInfo(config)) {
    return {
      result: notAssessed(MODULE, [
        'your package.json — instrumentation is read from dependencies, and this config has none listed',
      ]),
      detected: [],
    };
  }

  const findings: Finding[] = [];
  const checksRun: RuleId[] = [];
  const errorProviders = detectProviders(config, 'error-tracking');

  // ── error reporting ────────────────────────────────────────────────────────
  checksRun.push('watch.errors.not-instrumented');
  if (errorProviders.length === 0) {
    findings.push(
      makeFinding({
        module: MODULE,
        ruleId: 'watch.errors.not-instrumented',
        severity: 'warn',
        title: 'No error or crash reporting found in dependencies',
        evidence: {
          // Evidence for an absence is what we searched and what we searched for.
          excerpt: `searched dependencies for ${CATEGORY_LABEL['error-tracking']} SDKs; none matched`,
          locator: 'config#dependencies',
          source: 'config',
        },
        // A menu, in alphabetical order, with no recommendation.
        fix:
          `Wire up error reporting before launch so failures reach you instead of a review. ` +
          `Options include ${describeOptions('error-tracking')}. ` +
          `Pick on your own criteria — self-hostable ones matter if you have data-residency obligations.`,
      }),
    );
  } else {
    // Installed. Is it actually switched on?
    checksRun.push('watch.errors.not-initialised');
    const configured = errorProviders.filter((p) =>
      p.envHints.some((env) => new RegExp(`\\b${env}\\b`).test(config)),
    );
    if (configured.length === 0) {
      const p = errorProviders[0]!;
      const pkg = p.packages.find((x) => config.includes(x)) ?? p.packages[0]!;
      findings.push(
        makeFinding({
          module: MODULE,
          ruleId: 'watch.errors.not-initialised',
          severity: 'warn',
          title: `${p.name} is installed but no project key is referenced`,
          evidence: {
            excerpt: pkg,
            locator: `config#dependencies:L${lineOfMatch(config, pkg)}`,
            source: 'config',
          },
          fix:
            `An installed SDK reports nothing until it is initialised. Set ${p.envHints[0] ?? 'the project key'} ` +
            `in your deployment environment and confirm a test exception arrives. See ${p.docs}.`,
        }),
      );
    }
  }

  // ── source maps ────────────────────────────────────────────────────────────
  checksRun.push('watch.sourcemaps.published');
  const sourcemapOn = config.match(/["']?sourcemap["']?\s*:\s*true/i);
  if (sourcemapOn) {
    findings.push(
      makeFinding({
        module: MODULE,
        ruleId: 'watch.sourcemaps.published',
        severity: 'info',
        title: 'Source maps are enabled for the production build',
        evidence: {
          excerpt: sourcemapOn[0],
          locator: `config:L${lineOfMatch(config, sourcemapOn[0])}`,
          source: 'config',
        },
        fix:
          'Error reporters can consume source maps without publishing them — upload them to your ' +
          'provider at build time and set sourcemap to "hidden" so they are generated but not served. ' +
          'Published maps expose your original source, comments, and file layout to anyone.',
      }),
    );
  }

  // ── uptime, which cannot be detected ───────────────────────────────────────
  checksRun.push('watch.uptime.undeclared');
  if (uptimeDeclared === undefined) {
    findings.push(
      makeFinding({
        module: MODULE,
        ruleId: 'watch.uptime.undeclared',
        severity: 'info',
        title: 'Uptime monitoring has not been declared',
        evidence: {
          excerpt: 'uptime monitoring leaves no trace in a build config and cannot be detected',
          locator: 'config#not-detectable',
          source: 'config',
        },
        fix:
          `Tell Shipworthy whether you have uptime monitoring, or set some up — ` +
          `${describeOptions('uptime')}. This is asked rather than inferred because the answer ` +
          `lives in an external dashboard, and guessing "no" from silence would be wrong.`,
      }),
    );
  }

  return { result: assessed(MODULE, findings, checksRun), detected: errorProviders };
}
