/**
 * Watch module, and the vendor-neutrality guarantee.
 *
 * BrandGuard's pre-flight checklist hardcoded one vendor: its "Production
 * Instrumentation" milestone was a Sentry setup script and its schema carried
 * `sentry_dsn_frontend` / `sentry_dsn_backend` columns. That reported a false gap
 * for every team using something else — the same class of error as a false pass,
 * because the tool is confidently wrong about the app.
 *
 * The neutrality test below is the guard. If someone adds a "we recommend X"
 * branch, it fails.
 */

import { describe, expect, it } from 'vitest';
import { auditWatch } from './watch';
import {
  CATEGORY_LABEL,
  PROVIDERS,
  describeOptions,
  detectProviders,
  providersIn,
} from '../core/providers';
import { isAssessed } from '../core/types';

const PKG = (deps: Record<string, string>) =>
  JSON.stringify({ name: 'app', private: true, dependencies: deps }, null, 2);

function findingsOf(config: string, uptimeDeclared?: boolean) {
  const { result } = auditWatch(
    uptimeDeclared === undefined ? { config } : { config, uptimeDeclared },
  );
  if (!isAssessed(result)) throw new Error('expected assessed');
  return result;
}

describe('vendor neutrality', () => {
  it('offers several error-reporting choices, not one', () => {
    expect(providersIn('error-tracking').length).toBeGreaterThanOrEqual(8);
    expect(providersIn('uptime').length).toBeGreaterThanOrEqual(4);
  });

  it('includes self-hostable and open-source options in every category', () => {
    for (const category of ['error-tracking', 'uptime'] as const) {
      const list = providersIn(category);
      expect(list.some((p) => p.selfHostable), `${category} has a self-hostable option`).toBe(true);
      expect(list.some((p) => p.openSource), `${category} has an open-source option`).toBe(true);
    }
  });

  it('never names one vendor without offering the alternatives', () => {
    const r = findingsOf(PKG({ react: '18.3.1' }));
    const errorFinding = r.findings.find((f) => f.rule.id === 'watch.errors.not-instrumented')!;
    // Several distinct provider names must appear in the fix.
    const named = providersIn('error-tracking').filter((p) => errorFinding.fix.includes(p.name));
    expect(named.length).toBeGreaterThanOrEqual(5);
  });

  it('carries no recommendation language anywhere in the module output', () => {
    const configs = [
      PKG({ react: '18.3.1' }),
      PKG({ '@sentry/react': '8.0.0' }),
      PKG({ rollbar: '2.26.4', ROLLBAR_ACCESS_TOKEN: 'x' }),
    ];
    for (const config of configs) {
      const text = JSON.stringify(auditWatch({ config })).toLowerCase();
      for (const banned of ['we recommend', 'recommended', 'best option', 'you should use ']) {
        expect(text, `"${banned}" must not appear`).not.toContain(banned);
      }
    }
  });

  it('lists providers alphabetically, so ordering implies no preference', () => {
    for (const category of ['error-tracking', 'uptime'] as const) {
      const ids = providersIn(category).map((p) => p.id);
      expect(ids).toEqual([...ids].sort());
    }
  });
});

describe('provider detection', () => {
  it.each([
    ['@sentry/react', 'sentry'],
    ['@bugsnag/js', 'bugsnag'],
    ['rollbar', 'rollbar'],
    ['@datadog/browser-rum', 'datadog'],
    ['highlight.run', 'highlight'],
    ['@honeybadger-io/js', 'honeybadger'],
    ['@opentelemetry/sdk-node', 'opentelemetry'],
  ])('detects %s as %s', (pkg, id) => {
    const found = detectProviders(PKG({ [pkg]: '1.0.0' }), 'error-tracking');
    expect(found.map((p) => p.id)).toContain(id);
  });

  it('detects a provider by environment variable as well as package', () => {
    const found = detectProviders('ROLLBAR_ACCESS_TOKEN=abc123', 'error-tracking');
    expect(found.map((p) => p.id)).toContain('rollbar');
  });

  it('does not match a package name that merely appears as a substring', () => {
    // "newrelic" must not fire on an unrelated dependency mentioning it loosely.
    const found = detectProviders(PKG({ 'my-newrelic-helper': '1.0.0' }), 'error-tracking');
    expect(found.map((p) => p.id)).not.toContain('newrelic');
  });
});

describe('error reporting findings', () => {
  it('flags an app with no instrumentation at all', () => {
    const r = findingsOf(PKG({ react: '18.3.1' }));
    const f = r.findings.find((x) => x.rule.id === 'watch.errors.not-instrumented')!;
    expect(f.severity).toBe('warn');
    expect(f.evidence.excerpt).toContain(CATEGORY_LABEL['error-tracking']);
  });

  it('does not flag an app that has instrumentation configured', () => {
    const config = PKG({ '@sentry/react': '8.0.0' }) + '\nSENTRY_DSN=https://x@o1.ingest.example/1';
    const r = findingsOf(config);
    expect(r.findings.find((x) => x.rule.id === 'watch.errors.not-instrumented')).toBeUndefined();
    expect(r.findings.find((x) => x.rule.id === 'watch.errors.not-initialised')).toBeUndefined();
  });

  it('flags an SDK installed but never given a key', () => {
    const r = findingsOf(PKG({ '@bugsnag/js': '8.0.0' }));
    const f = r.findings.find((x) => x.rule.id === 'watch.errors.not-initialised')!;
    expect(f.title).toContain('Bugsnag');
    expect(f.evidence.excerpt).toBe('@bugsnag/js');
    expect(f.fix).toContain('BUGSNAG_API_KEY');
  });

  it('accepts any provider as satisfying the requirement', () => {
    for (const p of providersIn('error-tracking')) {
      if (!p.packages.length) continue;
      const config = PKG({ [p.packages[0]!]: '1.0.0' }) + `\n${p.envHints[0]}=value`;
      const r = findingsOf(config);
      expect(
        r.findings.find((x) => x.rule.id === 'watch.errors.not-instrumented'),
        `${p.name} should satisfy instrumentation`,
      ).toBeUndefined();
    }
  });
});

describe('source maps', () => {
  it('flags production source maps as an information exposure', () => {
    const r = findingsOf(PKG({ react: '18.3.1' }) + '\nbuild: { sourcemap: true }');
    const f = r.findings.find((x) => x.rule.id === 'watch.sourcemaps.published')!;
    expect(f.severity).toBe('info');
    expect(f.fix).toContain('hidden');
  });

  it('says nothing when source maps are off', () => {
    const r = findingsOf(PKG({ react: '18.3.1' }) + '\nbuild: { sourcemap: false }');
    expect(r.findings.find((x) => x.rule.id === 'watch.sourcemaps.published')).toBeUndefined();
  });
});

describe('uptime is asked, never inferred', () => {
  it('reports it as undeclared when unanswered', () => {
    const r = findingsOf(PKG({ react: '18.3.1' }));
    const f = r.findings.find((x) => x.rule.id === 'watch.uptime.undeclared')!;
    expect(f.title).toContain('not been declared');
    // The wording must not claim monitoring is missing — only that we do not know.
    expect(f.title.toLowerCase()).not.toContain('no uptime');
    expect(f.fix).toContain('guessing');
  });

  it('drops the finding once the user has answered either way', () => {
    for (const answer of [true, false]) {
      const r = findingsOf(PKG({ react: '18.3.1' }), answer);
      expect(r.findings.find((x) => x.rule.id === 'watch.uptime.undeclared')).toBeUndefined();
    }
  });

  it('offers self-hostable uptime options', () => {
    expect(describeOptions('uptime')).toContain('self-hostable');
  });
});

describe('input gate', () => {
  it('returns not_assessed when there are no dependencies to read', () => {
    const { result } = auditWatch({ config: '<manifest><uses-sdk /></manifest>' });
    expect(result.status).toBe('not_assessed');
    expect(result).not.toHaveProperty('score');
  });

  it('assesses anything carrying dependency information', () => {
    expect(auditWatch({ config: PKG({ react: '18.3.1' }) }).result.status).toBe('assessed');
  });
});

describe('catalog hygiene', () => {
  it('gives every provider a docs URL and a stable id', () => {
    const ids = new Set<string>();
    for (const p of PROVIDERS) {
      expect(p.docs, `${p.name} needs docs`).toMatch(/^https:\/\//);
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(p.id), `duplicate id ${p.id}`).toBe(false);
      ids.add(p.id);
    }
  });

  it('records no pricing or free-tier claims, which would go stale', () => {
    const text = JSON.stringify(PROVIDERS).toLowerCase();
    for (const banned of ['free tier', 'per month', '$', 'pricing', 'cheap']) {
      expect(text, `"${banned}" must not be in the catalog`).not.toContain(banned);
    }
  });
});
