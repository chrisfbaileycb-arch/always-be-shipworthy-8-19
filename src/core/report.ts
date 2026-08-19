/**
 * Report assembly and export.
 *
 * Because every module returns the same shape and every finding carries the same
 * fields, machine-readable export is nearly free — which is the feature SHIFT's
 * fix list wanted (item 7) and could not cheaply have while each check invented
 * its own output.
 */

import { auditBuild } from '../modules/build';
import { auditListing } from '../modules/listing';
import { auditPolicy } from '../modules/policy';
import { auditWatch } from '../modules/watch';
import { RULES_AS_OF } from './rules';
import { isAssessed, MODULE_LABEL, type Finding, type ModuleResult, type Report } from './types';

export interface ScanInput {
  appName: string;
  title: string;
  shortDescription: string;
  description: string;
  config: string;
  /**
   * Whether the user has declared uptime monitoring. Undefined means unanswered,
   * which Watch reports as undeclared rather than guessing "no".
   */
  uptimeDeclared?: boolean;
  /** Injected rather than read from the clock, so a report is reproducible. */
  now?: Date;
}

export function runScan(input: ScanInput): Report {
  const now = input.now ?? new Date();
  return {
    appName: input.appName.trim() || 'Untitled app',
    createdAt: now.getTime(),
    rulesAsOf: RULES_AS_OF,
    modules: [
      auditBuild({ config: input.config, now }),
      auditListing({
        title: input.title,
        shortDescription: input.shortDescription,
        description: input.description,
      }),
      auditPolicy({ config: input.config, description: input.description }),
      auditWatch(
        input.uptimeDeclared === undefined
          ? { config: input.config }
          : { config: input.config, uptimeDeclared: input.uptimeDeclared },
      ).result,
    ],
  };
}

// ─── Summary ─────────────────────────────────────────────────────────────────

export interface ReportSummary {
  assessedCount: number;
  notAssessedCount: number;
  totalChecksRun: number;
  findings: { critical: number; warn: number; info: number; total: number };
  /**
   * Mean score across modules — but ONLY when every module was assessed.
   * Null otherwise.
   *
   * This is stricter than it first looks, and deliberately so. An earlier cut of
   * this function averaged the assessed modules and ignored the rest. Running the
   * thin sample through it produced a headline "Overall 100/100" for a
   * submission where two of three modules had nothing to read and the third ran
   * two checks against a title. That is the false-pass bug reappearing one level
   * up from where it was fixed.
   *
   * An overall score is a claim about the whole app. You cannot make that claim
   * with modules missing, so when coverage is partial there is no number — the
   * per-module scores and `coverage` tell the honest story instead.
   */
  overall: number | null;
  /** Fraction of modules that could be assessed, 0–1. Always safe to display. */
  coverage: number;
}

export function summarise(report: Report): ReportSummary {
  const assessedModules = report.modules.filter(isAssessed);
  const all = allFindings(report);
  return {
    assessedCount: assessedModules.length,
    notAssessedCount: report.modules.length - assessedModules.length,
    totalChecksRun: assessedModules.reduce((n, m) => n + m.checksRun.length, 0),
    findings: {
      critical: all.filter((f) => f.severity === 'critical').length,
      warn: all.filter((f) => f.severity === 'warn').length,
      info: all.filter((f) => f.severity === 'info').length,
      total: all.length,
    },
    // Only when nothing is missing. See the note on `overall` above.
    overall:
      assessedModules.length === report.modules.length && report.modules.length > 0
        ? Math.round(assessedModules.reduce((n, m) => n + m.score, 0) / assessedModules.length)
        : null,
    coverage: report.modules.length ? assessedModules.length / report.modules.length : 0,
  };
}

export function allFindings(report: Report): Finding[] {
  const order = { critical: 0, warn: 1, info: 2 } as const;
  return report.modules
    .flatMap((m) => (isAssessed(m) ? m.findings : []))
    .sort((a, b) => order[a.severity] - order[b.severity]);
}

// ─── Export ──────────────────────────────────────────────────────────────────

/** Full report as JSON — paste straight into a coding agent. */
export function toJSON(report: Report): string {
  return JSON.stringify({ ...report, summary: summarise(report) }, null, 2);
}

export function toMarkdown(report: Report): string {
  const s = summarise(report);
  const out: string[] = [];

  out.push(`# Shipworthy report — ${report.appName}`);
  out.push('');
  out.push(`Scanned ${new Date(report.createdAt).toISOString()} · rules current as of ${report.rulesAsOf}`);
  out.push('');
  if (s.overall === null) {
    out.push(
      s.assessedCount === 0
        ? '**No module could be assessed.** See "Not assessed" below for what to supply.'
        : `**No overall score.** Only ${s.assessedCount} of ${s.assessedCount + s.notAssessedCount} ` +
            'modules could be assessed, so there is not enough coverage to score the app as a whole. ' +
            'Per-module results below.',
    );
  } else {
    out.push(
      `**Overall ${s.overall}/100** · all ${s.assessedCount} modules assessed · ` +
        `${s.totalChecksRun} checks run · ` +
        `${s.findings.critical} critical, ${s.findings.warn} warning, ${s.findings.info} info`,
    );
  }
  out.push('');

  const notAssessed = report.modules.filter((m) => !isAssessed(m));
  if (notAssessed.length) {
    out.push('## Not assessed');
    out.push('');
    out.push('These produced no score because there was nothing to check. This is not a pass.');
    out.push('');
    for (const m of notAssessed) {
      if (isAssessed(m)) continue;
      out.push(`- **${MODULE_LABEL[m.module]}** — supply ${m.missing.join('; ')}`);
    }
    out.push('');
  }

  for (const m of report.modules) {
    if (!isAssessed(m)) continue;
    out.push(`## ${MODULE_LABEL[m.module]} — ${m.score}/100`);
    out.push('');
    out.push(`${m.checksRun.length} checks ran, ${m.findings.length} found something.`);
    out.push('');
    if (!m.findings.length) {
      out.push('_No findings._');
      out.push('');
      continue;
    }
    for (const f of m.findings) {
      out.push(`### [${f.severity.toUpperCase()}] ${f.title}`);
      out.push('');
      out.push(`- **Evidence** (\`${f.evidence.locator}\`): \`${f.evidence.excerpt}\``);
      out.push(`- **Rule**: ${f.rule.id} — ${f.rule.authority} ([source](${f.rule.url}), as of ${f.rule.asOf})`);
      out.push(`- **Confidence**: ${f.confidence}`);
      out.push(`- **Fix**: ${f.fix}`);
      out.push('');
    }
  }

  out.push('---');
  out.push('');
  out.push(
    'Automated analysis of the material provided. Not legal advice, not a security audit, ' +
      'and not a guarantee of store approval. Every finding above cites the text that triggered ' +
      'it and the rule it touches — verify both before acting.',
  );

  return out.join('\n');
}

/** Modules that could not run, for prompting the user. */
export function missingInputs(report: Report): { module: string; missing: string[] }[] {
  return report.modules
    .filter((m): m is Extract<ModuleResult, { status: 'not_assessed' }> => !isAssessed(m))
    .map((m) => ({ module: MODULE_LABEL[m.module], missing: m.missing }));
}
