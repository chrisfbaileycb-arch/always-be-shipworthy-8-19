/**
 * The anti-hallucination gate.
 *
 * Every other module produces findings from regexes, so its evidence is real by
 * construction. This one takes findings from a model, which means a fabricated
 * quote would otherwise pass through the same `makeFinding()` that a real one
 * does — exactly how BrandGuard came to display USPTO serial numbers for a
 * registry it never queried.
 *
 * These tests are the gate. No network, no key: `buildVerifiedFindings` is pure,
 * so the check that matters is testable with hand-written model output,
 * including deliberately dishonest output.
 */

import { describe, expect, it } from 'vitest';
import { assembleClaims, buildVerifiedFindings, localClaimFindings } from './claims';
import { locateQuote, normalizeForMatch } from '../../supabase/functions/_shared/claims-contract';
import { isAssessed } from '../core/types';

const SOURCE = [
  'PhotoVault keeps your photos in encrypted albums.',
  'Our servers are 100% secure and completely unhackable — we never collect any data.',
  'Users report saving 10 hours a week on photo organisation.',
  'Earn $5,000 per month reselling your edits. Guaranteed results.',
].join('\n');

function claim(over: Partial<Record<string, unknown>> = {}) {
  return {
    quote: 'Guaranteed results.',
    type: 'guarantee',
    severity: 'warn',
    why: 'Unqualified guarantee with no stated conditions.',
    substantiation: 'Document the conditions under which the guarantee applies.',
    rewrite: 'Results vary by library size.',
    ...over,
  };
}

describe('quote verification', () => {
  it('accepts a quote that appears verbatim', () => {
    const r = buildVerifiedFindings(SOURCE, [claim()]);
    expect(r.findings).toHaveLength(1);
    expect(r.unverifiedCount).toBe(0);
    expect(r.findings[0]!.evidence.excerpt).toBe('Guaranteed results.');
  });

  it('DROPS a fabricated quote that is not in the source', () => {
    const r = buildVerifiedFindings(SOURCE, [
      claim({ quote: 'We are the number one photo app in the world.' }),
    ]);
    expect(r.findings).toHaveLength(0);
    expect(r.unverifiedCount).toBe(1);
    expect(r.unverifiedQuotes[0]).toContain('number one');
  });

  it('drops the fabricated one but keeps the real one in the same batch', () => {
    const r = buildVerifiedFindings(SOURCE, [
      claim({ quote: 'Totally invented sentence.' }),
      claim({ quote: 'completely unhackable', type: 'security', severity: 'critical' }),
    ]);
    expect(r.findings).toHaveLength(1);
    expect(r.unverifiedCount).toBe(1);
    expect(r.findings[0]!.evidence.excerpt).toBe('completely unhackable');
  });

  it('stores the SOURCE wording, not the model rendering of it', () => {
    // Model "helpfully" converts the em dash and straightens quotes.
    const source = 'We are the “best” photo app — guaranteed.';
    const r = buildVerifiedFindings(source, [
      claim({ quote: 'We are the "best" photo app - guaranteed.' }),
    ]);
    expect(r.findings).toHaveLength(1);
    // The user reads back their own characters.
    expect(r.findings[0]!.evidence.excerpt).toBe('We are the “best” photo app — guaranteed.');
  });

  it('tolerates whitespace differences but not word differences', () => {
    const source = 'Save   10 hours\na week, every week.';
    expect(locateQuote(source, 'Save 10 hours a week')).not.toBeNull();
    expect(locateQuote(source, 'Save 12 hours a week')).toBeNull();
    expect(locateQuote(source, 'Save hours a week')).toBeNull();
  });

  it('normalises only punctuation a model tends to rewrite', () => {
    expect(normalizeForMatch('“a”  —  ‘b’')).toBe('"a" - \'b\'');
  });

  it('rejects an empty or trivially short quote', () => {
    expect(locateQuote(SOURCE, '')).toBeNull();
    expect(locateQuote(SOURCE, '  ')).toBeNull();
  });
});

describe('malformed model output is dropped, never repaired', () => {
  it.each([
    ['unknown claim type', claim({ type: 'vibes' })],
    ['unknown severity', claim({ severity: 'catastrophic' })],
    ['missing quote', claim({ quote: undefined })],
    ['empty why', claim({ why: '   ' })],
    ['quote too short', claim({ quote: 'a' })],
    ['not an object', 'a string'],
    ['null entry', null],
  ])('drops %s', (_label, bad) => {
    expect(buildVerifiedFindings(SOURCE, [bad]).findings).toHaveLength(0);
  });

  it('survives a non-array payload', () => {
    expect(buildVerifiedFindings(SOURCE, null).findings).toHaveLength(0);
    expect(buildVerifiedFindings(SOURCE, { claims: [] }).findings).toHaveLength(0);
    expect(buildVerifiedFindings(SOURCE, 'nonsense').findings).toHaveLength(0);
  });

  it('deduplicates a repeated quote rather than double-counting the score', () => {
    const r = buildVerifiedFindings(SOURCE, [claim(), claim(), claim()]);
    expect(r.findings).toHaveLength(1);
  });
});

describe('model findings are never marked verified', () => {
  it('labels every model finding heuristic', () => {
    const r = buildVerifiedFindings(SOURCE, [claim()]);
    // 'verified' is reserved for a live authoritative source. A model is not one.
    expect(r.findings[0]!.confidence).toBe('heuristic');
  });

  it('cites a registered rule with a dated authority', () => {
    const r = buildVerifiedFindings(SOURCE, [claim({ type: 'earnings', quote: 'Earn $5,000 per month' })]);
    const f = r.findings[0]!;
    expect(f.rule.id).toBe('claims.earnings.income');
    expect(f.rule.url).toMatch(/^https:\/\//);
    expect(f.rule.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('deterministic pre-checks run free and local', () => {
  it('catches absolute security and privacy language with real evidence', () => {
    const { findings, checksRun } = localClaimFindings(SOURCE);
    const ids = findings.map((f) => f.rule.id);
    expect(ids).toContain('claims.security.absolute');
    expect(ids).toContain('claims.privacy.overbroad');
    expect(ids).toContain('claims.earnings.income');
    expect(checksRun.length).toBeGreaterThanOrEqual(4);
    for (const f of findings) {
      expect(SOURCE).toContain(f.evidence.excerpt);
    }
  });

  it('says nothing about ordinary feature copy', () => {
    const plain = 'Organise your photos into albums. Search by date, place, or person.';
    expect(localClaimFindings(plain).findings).toHaveLength(0);
  });
});

describe('module assembly', () => {
  it('returns not_assessed for copy too thin to read', () => {
    const r = assembleClaims('Short.');
    expect(r.status).toBe('not_assessed');
    expect(r).not.toHaveProperty('score');
  });

  it('assesses using local checks alone, with no model pass', () => {
    const r = assembleClaims(SOURCE);
    expect(r.status).toBe('assessed');
    if (!isAssessed(r)) throw new Error('expected assessed');
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(100);
  });

  it('does not charge the score twice when both tiers flag the SAME span', () => {
    // The local security regex matches "100% secure" first; have the model quote
    // a span that overlaps it, which is the genuine duplicate case.
    const model = buildVerifiedFindings(SOURCE, [
      claim({
        quote: 'Our servers are 100% secure',
        type: 'security',
        severity: 'critical',
      }),
    ]);
    expect(model.findings).toHaveLength(1);

    const withModel = assembleClaims(SOURCE, model);
    const localOnly = assembleClaims(SOURCE);
    if (!isAssessed(withModel) || !isAssessed(localOnly)) throw new Error('expected assessed');

    expect(withModel.findings.filter((f) => f.rule.id === 'claims.security.absolute')).toHaveLength(1);
    expect(withModel.score).toBe(localOnly.score);
  });

  it('keeps two distinct claims of the same type in one sentence', () => {
    // "100% secure" and "completely unhackable" are two separate absolute claims
    // that happen to share a sentence. Collapsing them would under-report.
    const model = buildVerifiedFindings(SOURCE, [
      claim({ quote: 'completely unhackable', type: 'security', severity: 'critical' }),
    ]);
    const r = assembleClaims(SOURCE, model);
    if (!isAssessed(r)) throw new Error('expected assessed');

    const security = r.findings.filter((f) => f.rule.id === 'claims.security.absolute');
    expect(security).toHaveLength(2);
    expect(security.map((f) => f.evidence.excerpt).sort()).toEqual([
      '100% secure',
      'completely unhackable',
    ]);
  });

  it('adds genuinely new model findings on top of local ones', () => {
    const model = buildVerifiedFindings(SOURCE, [
      claim({ quote: 'Users report saving 10 hours a week', type: 'efficacy', severity: 'warn' }),
    ]);
    const r = assembleClaims(SOURCE, model, ['claims.efficacy.unproven']);
    if (!isAssessed(r)) throw new Error('expected assessed');
    expect(r.findings.map((f) => f.rule.id)).toContain('claims.efficacy.unproven');
    expect(r.checksRun).toContain('claims.efficacy.unproven');
  });
});
