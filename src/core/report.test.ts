/**
 * Regression tests for the false-pass bug.
 *
 * Background. SHIFT Pre-Flight computed each pillar's score starting at 100 and
 * only ever subtracting. A thin input had nothing to subtract from, so it scored
 * near-perfect. Running SHIFT's own audit functions against these exact inputs
 * produced:
 *
 *     title only ("PhotoVault Pro")  →  Safety 98 / Legal 100 / Marketing 98
 *     completely empty form          →  Safety 98 / Legal 100 / Marketing  96
 *
 * All six numbers rendered green (>= 85), with zero high- or warn-severity
 * findings. A user who pasted nothing got a clean bill of health for an app that
 * had never been examined. SHIFT's own e2e test for that path checked only that
 * findings rendered and nothing crashed — it never asserted on the scores, so
 * the bug passed CI.
 *
 * These tests exist so that can never come back. If someone reintroduces a
 * "default to a high score" path, this file fails.
 */

import { describe, expect, it } from 'vitest';
import { isAssessed } from './types';
import { allFindings, runScan, summarise, toJSON, toMarkdown } from './report';

const EMPTY = { appName: '', title: '', shortDescription: '', description: '', config: '' };
const NOW = new Date('2026-08-19T00:00:00Z');

describe('false-pass regression', () => {
  it('produces no score at all for a completely empty submission', () => {
    const report = runScan({ ...EMPTY, now: NOW });

    expect(report.modules).toHaveLength(4);
    for (const m of report.modules) {
      expect(m.status).toBe('not_assessed');
      // The load-bearing assertion: there is no score property to read.
      expect(m).not.toHaveProperty('score');
    }

    const s = summarise(report);
    expect(s.overall).toBeNull(); // not 96, not 0 — null
    expect(s.assessedCount).toBe(0);
    expect(s.notAssessedCount).toBe(4);
    expect(s.totalChecksRun).toBe(0);
  });

  it('produces no score for a title-only submission (SHIFT scored this 98/100/98)', () => {
    const report = runScan({ ...EMPTY, title: 'PhotoVault Pro', appName: 'PhotoVault Pro', now: NOW });

    const build = report.modules.find((m) => m.module === 'build')!;
    const policy = report.modules.find((m) => m.module === 'policy')!;
    const listing = report.modules.find((m) => m.module === 'listing')!;

    // No config → build cannot run. No description → policy cannot run.
    expect(build.status).toBe('not_assessed');
    expect(policy.status).toBe('not_assessed');

    // Listing has a title, so it legitimately runs — but on one field only,
    // and checksRun makes that visible rather than hiding it behind a number.
    expect(listing.status).toBe('assessed');
    if (isAssessed(listing)) {
      expect(listing.checksRun.length).toBeLessThanOrEqual(2);
    }

    // The headline number is withheld: with 2 of 3 modules unassessed there is
    // not enough coverage to make a claim about the app as a whole. An earlier
    // cut of summarise() averaged only the assessed modules and reported a
    // headline "100/100" here — the false-pass bug one level up.
    const s = summarise(report);
    expect(s.overall).toBeNull();
    expect(s.notAssessedCount).toBe(3);
    expect(s.coverage).toBeCloseTo(1 / 4);
  });

  it('withholds the overall score whenever any module is unassessed', () => {
    const partial = runScan({ ...EMPTY, title: 'PhotoVault Pro', now: NOW });
    expect(summarise(partial).overall).toBeNull();

    const md = toMarkdown(partial);
    expect(md).toContain('No overall score');
    expect(md).toContain('not enough coverage');
  });

  it('tells the user exactly what to supply instead of implying a pass', () => {
    const report = runScan({ ...EMPTY, now: NOW });
    for (const m of report.modules) {
      if (isAssessed(m)) continue;
      expect(m.missing.length).toBeGreaterThan(0);
      for (const item of m.missing) expect(item.trim()).not.toBe('');
    }
  });

  it('never renders a not-assessed module as a pass in Markdown', () => {
    const md = toMarkdown(runScan({ ...EMPTY, now: NOW }));
    expect(md).toContain('Not assessed');
    expect(md).toContain('This is not a pass.');
    expect(md).toContain('No module could be assessed');
    // No score-looking output anywhere.
    expect(md).not.toMatch(/\b\d{1,3}\/100\b/);
  });
});

describe('a real submission is assessed normally', () => {
  const FLAWED = {
    appName: 'PhotoVault Pro',
    title: 'PhotoVault: The #1 Best Photo App Ever',
    shortDescription: 'Private photo storage',
    description:
      'The best photo vault ever made, better than Instagram! Unlock premium credits to upgrade to the pro version today. ' +
      'Track your location history and record voice notes. Perfect for kids and families.',
    config:
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n' +
      '  <uses-sdk android:targetSdkVersion="33" />\n' +
      '  <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />\n' +
      '  <uses-permission android:name="android.permission.RECORD_AUDIO" />\n' +
      '  <application android:debuggable="true" android:usesCleartextTraffic="true">\n' +
      '    <meta-data android:name="key" android:value="AIzaSyD-EXAMPLEKEY1234567890abcdefghijk" />\n' +
      '    <meta-data android:name="a" android:value="http://analytics.example.com/collect" />\n' +
      '  </application>\n' +
      '</manifest>\n' +
      '{"name": "photovault", "private": true, "dependencies": {"react": "18.3.1"}}',
    now: NOW,
  };

  it('assesses every module and finds real problems', () => {
    const report = runScan(FLAWED);
    for (const m of report.modules) expect(m.status).toBe('assessed');

    const s = summarise(report);
    expect(s.findings.critical).toBeGreaterThan(0);
    expect(s.findings.total).toBeGreaterThan(5);
    expect(s.overall).not.toBeNull();
    expect(s.overall!).toBeLessThan(85); // not green
    expect(s.coverage).toBe(1); // every module ran, so a headline score is legitimate
    expect(s.totalChecksRun).toBeGreaterThan(15);
  });

  it('grounds every single finding in evidence and a dated rule', () => {
    const findings = allFindings(runScan(FLAWED));
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.evidence.excerpt.trim()).not.toBe('');
      expect(f.evidence.locator.trim()).not.toBe('');
      expect(f.rule.id).toBeTruthy();
      expect(f.rule.authority).toBeTruthy();
      expect(f.rule.url).toMatch(/^https:\/\//);
      expect(f.rule.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(f.fix.trim()).not.toBe('');
    }
  });

  it('never echoes a detected credential back in full', () => {
    const findings = allFindings(runScan(FLAWED));
    const keyFinding = findings.find((f) => f.rule.id === 'build.secret.google-api-key');
    expect(keyFinding).toBeDefined();
    expect(keyFinding!.evidence.excerpt).not.toContain('AIzaSyD-EXAMPLEKEY1234567890abcdefghijk');
    expect(keyFinding!.evidence.excerpt).toContain('…');
  });

  it('gives findings stable ids across runs so they dedupe', () => {
    const a = allFindings(runScan(FLAWED)).map((f) => f.id);
    const b = allFindings(runScan(FLAWED)).map((f) => f.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });

  it('exports valid JSON carrying the summary', () => {
    const parsed = JSON.parse(toJSON(runScan(FLAWED)));
    expect(parsed.summary.findings.total).toBeGreaterThan(0);
    expect(parsed.rulesAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parsed.modules).toHaveLength(4);
  });

  it('exports Markdown that cites rules and dates them', () => {
    const md = toMarkdown(runScan(FLAWED));
    expect(md).toContain('rules current as of');
    expect(md).toContain('**Rule**');
    expect(md).toContain('**Evidence**');
    expect(md).toMatch(/not legal advice/i);
  });
});
