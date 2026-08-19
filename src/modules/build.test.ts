/**
 * Build module, with particular attention to the target-SDK floor.
 *
 * SHIFT hardcoded `v < 35` next to the sentence "API 35 as of Aug 2025". Google
 * Play raises the floor to API 36 for new submissions on 2026-08-31 — so that
 * comparison was days away from being silently wrong when this was written.
 *
 * These tests pin the date-dependent behaviour so the rule can be re-confirmed
 * and updated without guessing at what it used to do.
 */

import { describe, expect, it } from 'vitest';
import { auditBuild, detectConfigKind } from './build';
import { isAssessed } from '../core/types';
import { playSubmissionFloor } from '../core/rules';

const BEFORE = new Date('2026-08-19T00:00:00Z'); // floor is 35
const AFTER = new Date('2026-09-15T00:00:00Z'); // floor is 36

function manifest(targetSdk: number): string {
  return (
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n' +
    `  <uses-sdk android:targetSdkVersion="${targetSdk}" />\n` +
    '</manifest>'
  );
}

function findingsOf(result: ReturnType<typeof auditBuild>) {
  return isAssessed(result) ? result.findings : [];
}

describe('input gate', () => {
  it('returns not_assessed for empty config rather than a score', () => {
    const r = auditBuild({ config: '', now: BEFORE });
    expect(r.status).toBe('not_assessed');
    expect(r).not.toHaveProperty('score');
  });

  it('returns not_assessed for whitespace-only config', () => {
    expect(auditBuild({ config: '   \n\t ', now: BEFORE }).status).toBe('not_assessed');
  });

  it('assesses anything with real content', () => {
    expect(auditBuild({ config: manifest(36), now: BEFORE }).status).toBe('assessed');
  });
});

describe('config kind detection', () => {
  it.each([
    ['<manifest><uses-permission android:name="android.permission.CAMERA"/></manifest>', 'android'],
    ['<plist><key>CFBundleName</key></plist>', 'ios'],
    ['{"dependencies": {"react": "18.0.0"}}', 'node'],
    ['some other config = true', 'generic'],
    ['', 'none'],
  ])('detects %s as %s', (cfg, want) => {
    expect(detectConfigKind(cfg)).toBe(want);
  });
});

describe('Play target SDK floor is date-aware', () => {
  it('resolves the floor from the registry, not a literal', () => {
    expect(playSubmissionFloor(BEFORE)).toBe(35);
    expect(playSubmissionFloor(AFTER)).toBe(36);
  });

  it('flags API 33 as below the floor on both sides of the change', () => {
    for (const now of [BEFORE, AFTER]) {
      const f = findingsOf(auditBuild({ config: manifest(33), now }));
      const sdk = f.find((x) => x.rule.id === 'build.sdk.play-target-floor');
      expect(sdk?.severity).toBe('warn');
      expect(sdk?.title).toContain('below the Play submission floor');
    }
  });

  it('warns early that API 35 stops being enough on 2026-08-31', () => {
    const f = findingsOf(auditBuild({ config: manifest(35), now: BEFORE }));
    const sdk = f.find((x) => x.rule.id === 'build.sdk.play-target-floor');
    expect(sdk).toBeDefined();
    expect(sdk!.severity).toBe('info');
    expect(sdk!.title).toContain('2026-08-31');
  });

  it('treats API 35 as an outright failure once the change lands', () => {
    const f = findingsOf(auditBuild({ config: manifest(35), now: AFTER }));
    const sdk = f.find((x) => x.rule.id === 'build.sdk.play-target-floor');
    expect(sdk!.severity).toBe('warn');
    expect(sdk!.title).toContain('below the Play submission floor of 36');
  });

  it('says nothing when the target already meets the coming floor', () => {
    for (const now of [BEFORE, AFTER]) {
      const f = findingsOf(auditBuild({ config: manifest(36), now }));
      expect(f.find((x) => x.rule.id === 'build.sdk.play-target-floor')).toBeUndefined();
    }
  });
});

describe('secret detection', () => {
  it.each([
    ['AKIAIOSFODNN7EXAMPLE', 'build.secret.aws-key'],
    ['AIzaSyD-EXAMPLEKEY1234567890abcdefghijk', 'build.secret.google-api-key'],
    ['sk_live_abcdefghijklmnop', 'build.secret.stripe-live-key'],
    ['-----BEGIN RSA PRIVATE KEY-----', 'build.secret.private-key'],
  ])('detects %s', (secret, ruleId) => {
    const cfg = `<manifest>\n  <meta-data android:value="${secret}" />\n</manifest>`;
    const f = findingsOf(auditBuild({ config: cfg, now: BEFORE }));
    const hit = f.find((x) => x.rule.id === ruleId);
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('critical');
  });

  it('masks the credential in the evidence excerpt', () => {
    const secret = 'AKIAIOSFODNN7EXAMPLE';
    const f = findingsOf(auditBuild({ config: `key = "${secret}"`, now: BEFORE }));
    const hit = f.find((x) => x.rule.id === 'build.secret.aws-key')!;
    expect(hit.evidence.excerpt).not.toBe(secret);
    expect(hit.evidence.excerpt).toContain('AKIAIOSF');
    expect(hit.evidence.excerpt).toContain('chars');
  });

  it('locates the finding by line number', () => {
    const cfg = 'line one\nline two\nkey = "AKIAIOSFODNN7EXAMPLE"';
    const f = findingsOf(auditBuild({ config: cfg, now: BEFORE }));
    const hit = f.find((x) => x.rule.id === 'build.secret.aws-key')!;
    expect(hit.evidence.locator).toBe('config:L3');
  });
});

describe('cleartext and debug flags', () => {
  it('ignores XML schema URLs when looking for cleartext endpoints', () => {
    const cfg = '<manifest xmlns:android="http://schemas.android.com/apk/res/android"></manifest>';
    const f = findingsOf(auditBuild({ config: cfg, now: BEFORE }));
    expect(f.find((x) => x.rule.id === 'build.cleartext.http-url')).toBeUndefined();
  });

  it('flags a genuine cleartext endpoint', () => {
    const cfg = '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n' +
      '<meta-data android:value="http://analytics.example.com/collect" /></manifest>';
    const f = findingsOf(auditBuild({ config: cfg, now: BEFORE }));
    expect(f.find((x) => x.rule.id === 'build.cleartext.http-url')).toBeDefined();
  });

  it('flags debuggable as critical', () => {
    const f = findingsOf(auditBuild({ config: '<application android:debuggable="true">', now: BEFORE }));
    expect(f.find((x) => x.rule.id === 'build.debug.android-debuggable')?.severity).toBe('critical');
  });
});

describe('node dependency checks only run for node config', () => {
  it('flags wildcard versions in package.json', () => {
    const cfg = '{"name": "app", "dependencies": {"left-pad": "*"}}';
    const f = findingsOf(auditBuild({ config: cfg, now: BEFORE }));
    expect(f.find((x) => x.rule.id === 'build.deps.wildcard-version')).toBeDefined();
    expect(f.find((x) => x.rule.id === 'build.deps.not-private')).toBeDefined();
  });

  it('does not flag a private package', () => {
    const cfg = '{"name": "app", "private": true, "dependencies": {"react": "18.0.0"}}';
    const f = findingsOf(auditBuild({ config: cfg, now: BEFORE }));
    expect(f.find((x) => x.rule.id === 'build.deps.not-private')).toBeUndefined();
  });

  it('does not run node checks against an Android manifest', () => {
    const r = auditBuild({ config: manifest(36), now: BEFORE });
    if (!isAssessed(r)) throw new Error('expected assessed');
    expect(r.checksRun).not.toContain('build.deps.wildcard-version');
  });
});

describe('checksRun is the honest denominator', () => {
  it('records every rule that executed, not just the ones that fired', () => {
    const r = auditBuild({ config: manifest(36), now: BEFORE });
    if (!isAssessed(r)) throw new Error('expected assessed');
    expect(r.checksRun.length).toBeGreaterThan(10);
    expect(r.findings.length).toBeLessThan(r.checksRun.length);
  });
});
