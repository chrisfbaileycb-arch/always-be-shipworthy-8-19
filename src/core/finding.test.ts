/**
 * The evidence rule, enforced.
 *
 * These tests are the mechanism behind "cite or stay silent". If someone relaxes
 * makeFinding to allow an ungrounded finding through — which is how BrandGuard's
 * scan engine came to print USPTO serial numbers for a registry it never
 * queried — this file fails.
 */

import { describe, expect, it } from 'vitest';
import { assessed, makeFinding, notAssessed, scoreOf, UngroundedFindingError } from './finding';
import type { Evidence } from './types';

const GOOD: Evidence = { excerpt: 'android:debuggable="true"', locator: 'config:L4', source: 'config' };

const base = {
  module: 'build' as const,
  ruleId: 'build.debug.android-debuggable' as const,
  severity: 'critical' as const,
  title: 'Debuggable build',
  fix: 'Remove the attribute.',
};

describe('makeFinding refuses ungrounded findings', () => {
  it('accepts a properly grounded finding', () => {
    const f = makeFinding({ ...base, evidence: GOOD });
    expect(f.evidence.excerpt).toBe('android:debuggable="true"');
    expect(f.rule.authority).toBeTruthy();
    expect(f.rule.url).toMatch(/^https:\/\//);
    expect(f.confidence).toBe('heuristic'); // conservative default
  });

  it('throws when the evidence excerpt is empty', () => {
    expect(() => makeFinding({ ...base, evidence: { ...GOOD, excerpt: '' } })).toThrow(
      UngroundedFindingError,
    );
    expect(() => makeFinding({ ...base, evidence: { ...GOOD, excerpt: '   ' } })).toThrow(
      UngroundedFindingError,
    );
  });

  it('throws when there is no locator to say where it was found', () => {
    expect(() => makeFinding({ ...base, evidence: { ...GOOD, locator: '' } })).toThrow(
      UngroundedFindingError,
    );
  });

  it('throws when the rule is not in the registry', () => {
    expect(() =>
      // @ts-expect-error — deliberately unregistered rule id
      makeFinding({ ...base, ruleId: 'build.invented.rule', evidence: GOOD }),
    ).toThrow(UngroundedFindingError);
  });

  it('throws when the finding gives the user nothing to do', () => {
    expect(() => makeFinding({ ...base, fix: '', evidence: GOOD })).toThrow(UngroundedFindingError);
    expect(() => makeFinding({ ...base, title: '', evidence: GOOD })).toThrow(UngroundedFindingError);
  });

  it('defaults confidence to heuristic and only marks verified when asked', () => {
    expect(makeFinding({ ...base, evidence: GOOD }).confidence).toBe('heuristic');
    expect(makeFinding({ ...base, evidence: GOOD, confidence: 'verified' }).confidence).toBe('verified');
  });

  it('truncates very long excerpts rather than dumping a whole config', () => {
    const long = 'x'.repeat(5000);
    const f = makeFinding({ ...base, evidence: { ...GOOD, excerpt: long } });
    expect(f.evidence.excerpt.length).toBeLessThanOrEqual(300);
  });
});

describe('module results', () => {
  it('not_assessed carries no score and must say what is missing', () => {
    const r = notAssessed('build', ['your AndroidManifest.xml']);
    expect(r.status).toBe('not_assessed');
    expect(r).not.toHaveProperty('score');
    expect(() => notAssessed('build', [])).toThrow();
  });

  it('assessed reports how many checks actually ran', () => {
    const r = assessed('build', [], ['build.debug.android-debuggable', 'build.secret.aws-key']);
    expect(r.status).toBe('assessed');
    expect(r.score).toBe(100);
    expect(r.checksRun).toHaveLength(2);
  });

  it('scores by severity and floors at zero', () => {
    expect(scoreOf([])).toBe(100);
    const crit = makeFinding({ ...base, evidence: GOOD });
    expect(scoreOf([crit])).toBe(75);
    expect(scoreOf(Array.from({ length: 20 }, () => crit))).toBe(0);
  });
});
