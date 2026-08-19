/**
 * Persistence round-trip.
 *
 * The specific thing under test is that a withheld overall score survives being
 * written to Postgres and read back. The false-pass bug has now tried to
 * reappear twice — once in the module scorer, once in the report summariser —
 * and the database is its third opportunity: a `not null default 0` on the
 * `overall` column would turn "we could not assess this" into a stored zero, and
 * a deserialiser doing `row.overall ?? 100` would turn it into a stored pass.
 *
 * These are pure-function tests. No database is contacted.
 */

import { describe, expect, it } from 'vitest';
import { runScan, summarise } from '../core/report';
import { deserializeReport, rowHasOverall, serializeReport, type ReportRow } from './persistence';

const NOW = new Date('2026-08-19T00:00:00Z');
const EMPTY = { appName: '', title: '', shortDescription: '', description: '', config: '' };

const FLAWED = {
  appName: 'PhotoVault Pro',
  title: 'PhotoVault: The #1 Best Photo App Ever',
  shortDescription: 'Private photo storage',
  description:
    'The best photo vault ever made, better than Instagram! Unlock premium credits to upgrade. ' +
    'Track your location history and record voice notes. Perfect for kids.',
  config:
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n' +
    '  <uses-sdk android:targetSdkVersion="33" />\n' +
    '  <application android:debuggable="true" />\n' +
    '</manifest>\n' +
    '{"name": "photovault", "private": true, "dependencies": {"react": "18.3.1"}}',
  now: NOW,
};

function asRow(serialized: ReturnType<typeof serializeReport>): ReportRow {
  return { ...serialized, id: 'row-1', created_at: NOW.toISOString() };
}

describe('a withheld overall score survives the database', () => {
  it('serialises null overall as null, not zero and not a default', () => {
    const row = serializeReport(runScan({ ...EMPTY, now: NOW }));
    expect(row.overall).toBeNull();
    expect(row.overall).not.toBe(0);
    expect(row.coverage).toBe(0);
    expect(row.assessed_count).toBe(0);
    expect(row.checks_run).toBe(0);
  });

  it('serialises partial coverage with no overall', () => {
    const row = serializeReport(runScan({ ...EMPTY, title: 'PhotoVault Pro', now: NOW }));
    expect(row.overall).toBeNull();
    expect(row.coverage).toBeCloseTo(1 / 4); // 4 modules; only listing could run
    expect(row.assessed_count).toBe(1);
  });

  it('reports a stored row as having no headline score', () => {
    expect(rowHasOverall(asRow(serializeReport(runScan({ ...EMPTY, now: NOW }))))).toBe(false);
    expect(rowHasOverall(asRow(serializeReport(runScan(FLAWED))))).toBe(true);
  });

  it('keeps a genuine overall when every module ran', () => {
    const row = serializeReport(runScan(FLAWED));
    expect(row.overall).not.toBeNull();
    expect(row.coverage).toBe(1);
    expect(row.overall!).toBeLessThan(85);
  });
});

describe('report round trip', () => {
  it('restores modules, name, and rules date unchanged', () => {
    const original = runScan(FLAWED);
    const restored = deserializeReport(asRow(serializeReport(original)));

    expect(restored.appName).toBe(original.appName);
    expect(restored.rulesAsOf).toBe(original.rulesAsOf);
    expect(restored.modules).toEqual(original.modules);
  });

  it('produces an identical summary after a round trip', () => {
    const original = runScan(FLAWED);
    const restored = deserializeReport(asRow(serializeReport(original)));
    expect(summarise(restored)).toEqual(summarise(original));
  });

  it('preserves not_assessed as a distinct state, not an empty assessment', () => {
    const original = runScan({ ...EMPTY, now: NOW });
    const restored = deserializeReport(asRow(serializeReport(original)));

    for (const m of restored.modules) {
      expect(m.status).toBe('not_assessed');
      expect(m).not.toHaveProperty('score');
    }
    expect(summarise(restored).overall).toBeNull();
  });

  it('carries evidence and rule citations through storage', () => {
    const restored = deserializeReport(asRow(serializeReport(runScan(FLAWED))));
    const findings = restored.modules.flatMap((m) => (m.status === 'assessed' ? m.findings : []));
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.evidence.excerpt).toBeTruthy();
      expect(f.evidence.locator).toBeTruthy();
      expect(f.rule.url).toMatch(/^https:\/\//);
      expect(f.rule.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('stores the counts the listing UI needs without re-parsing modules', () => {
    const report = runScan(FLAWED);
    const row = serializeReport(report);
    const s = summarise(report);
    expect(row.critical_count).toBe(s.findings.critical);
    expect(row.warn_count).toBe(s.findings.warn);
    expect(row.info_count).toBe(s.findings.info);
    expect(row.checks_run).toBe(s.totalChecksRun);
  });
});

describe('ownership is never asserted by the client', () => {
  it('omits user_id from the insert payload entirely', () => {
    const row = serializeReport(runScan(FLAWED));
    // The column defaults to auth.uid() and RLS re-checks it, so the server
    // decides ownership. A client-supplied user_id would be a spoofing surface.
    expect(Object.keys(row)).not.toContain('user_id');
  });

  it('defaults app_id to null rather than inventing an association', () => {
    expect(serializeReport(runScan(FLAWED)).app_id).toBeNull();
    expect(serializeReport(runScan(FLAWED), 'app-123').app_id).toBe('app-123');
  });
});

describe('stored credential evidence stays masked', () => {
  it('never writes a full credential into the database', () => {
    const withKey = {
      ...FLAWED,
      config:
        '<manifest>\n  <meta-data android:value="AIzaSyD-EXAMPLEKEY1234567890abcdefghijk" />\n</manifest>',
    };
    const json = JSON.stringify(serializeReport(runScan(withKey)));
    expect(json).not.toContain('AIzaSyD-EXAMPLEKEY1234567890abcdefghijk');
  });
});
