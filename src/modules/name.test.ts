/**
 * Name module — the two failures it exists not to repeat.
 *
 * 1. BrandGuard printed USPTO serial numbers from a 23-token hardcoded
 *    dictionary. Nothing here may render an identifier the registry did not
 *    return, and there is no code path that supplies a default.
 *
 * 2. "404 means the domain is free" is the false-pass bug in a new costume.
 *    rdap.org is a bootstrap redirector: its own 404 means it knows no
 *    authoritative server for that TLD, which says nothing about the domain.
 *    Only the authoritative registry's 404 means "no record" — and even that is
 *    not "available to register".
 */

import { describe, expect, it } from 'vitest';
import { assembleName } from './name';
import {
  classifyRdap,
  readRdapRecord,
  toDomainSlug,
  normalizeMark,
  isExactMark,
  type NameCheckSuccess,
} from '../../supabase/functions/_shared/name-contract';
import { isAssessed } from '../core/types';

function response(over: Partial<NameCheckSuccess> = {}): NameCheckSuccess {
  return {
    ok: true,
    name: 'PhotoVault',
    slug: 'photovault',
    domains: [],
    trademarks: { state: 'checked', hits: [], source: 'api.uspto.gov' },
    checkedAt: '2026-08-19T00:00:00.000Z',
    ...over,
  };
}

describe('RDAP has three states, not two', () => {
  it('treats a registry 200 as registered', () => {
    expect(classifyRdap(200, 'rdap.verisign.com')).toEqual({ state: 'registered' });
  });

  it('treats a 404 from the AUTHORITATIVE registry as no record', () => {
    expect(classifyRdap(404, 'rdap.verisign.com')).toEqual({ state: 'unregistered' });
  });

  it('does NOT treat a bootstrap 404 as no record', () => {
    // rdap.org answering 404 means it knows no server for this TLD.
    expect(classifyRdap(404, 'rdap.org')).toEqual({
      state: 'unknown',
      reason: 'no_rdap_server',
    });
  });

  it('treats rate limiting and errors as unknown, never as free', () => {
    expect(classifyRdap(429, 'rdap.verisign.com').state).toBe('unknown');
    expect(classifyRdap(500, 'rdap.verisign.com').state).toBe('unknown');
    expect(classifyRdap(403, 'rdap.org').state).toBe('unknown');
  });
});

describe('RDAP records are read, never invented', () => {
  it('extracts only fields the registry sent', () => {
    const r = readRdapRecord({
      ldhName: 'example.com',
      status: ['client transfer prohibited', 'server delete prohibited'],
      events: [
        { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
        { eventAction: 'expiration', eventDate: '2027-08-13T04:00:00Z' },
      ],
    });
    expect(r.statuses).toEqual(['client transfer prohibited', 'server delete prohibited']);
    expect(r.registeredOn).toBe('1995-08-14T04:00:00Z');
  });

  it('returns nothing for a body with no usable fields', () => {
    expect(readRdapRecord({})).toEqual({});
    expect(readRdapRecord(null)).toEqual({});
    expect(readRdapRecord('nonsense')).toEqual({});
    expect(readRdapRecord({ events: [{ eventAction: 'expiration', eventDate: 'x' }] })).toEqual({});
  });
});

describe('a registered domain produces a verified finding', () => {
  const r = response({
    domains: [
      {
        domain: 'photovault.com',
        tld: 'com',
        state: 'registered',
        statuses: ['client transfer prohibited'],
        registeredOn: '2011-04-02T00:00:00Z',
        source: 'rdap.verisign.com',
      },
    ],
  });

  it('marks it verified, because a live registry answered', () => {
    const { result } = assembleName(r);
    if (!isAssessed(result)) throw new Error('expected assessed');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.confidence).toBe('verified');
    expect(result.findings[0]!.evidence.locator).toContain('rdap.verisign.com');
  });

  it('quotes only what the registry reported', () => {
    const { result } = assembleName(r);
    if (!isAssessed(result)) throw new Error('expected assessed');
    const excerpt = result.findings[0]!.evidence.excerpt;
    expect(excerpt).toContain('photovault.com');
    expect(excerpt).toContain('2011-04-02');
    expect(excerpt).toContain('client transfer prohibited');
  });
});

describe('unregistered is never reported as available', () => {
  it('produces no finding and never promises availability', () => {
    const { result } = assembleName(
      response({
        domains: [
          { domain: 'photovault.io', tld: 'io', state: 'unregistered', source: 'rdap.identitydigital.services' },
        ],
      }),
    );
    if (!isAssessed(result)) throw new Error('expected assessed');
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/available to register|is available/i);
  });
});

describe('unreachable lookups are reported as gaps, not as clean', () => {
  it('lists each unchecked TLD with the reason', () => {
    const { gaps } = assembleName(
      response({
        domains: [
          { domain: 'photovault.app', tld: 'app', state: 'unknown', reason: 'no_rdap_server' },
          { domain: 'photovault.ai', tld: 'ai', state: 'unknown', reason: 'rate_limited' },
          { domain: 'photovault.com', tld: 'com', state: 'unregistered', source: 'r.example' },
        ],
      }),
    );
    expect(gaps.join(' ')).toContain('no public RDAP server');
    expect(gaps.join(' ')).toContain('rate-limited');
  });

  it('reports a missing USPTO key as an unchecked trademark, not a clean one', () => {
    const { result, gaps } = assembleName(
      response({
        domains: [{ domain: 'photovault.com', tld: 'com', state: 'unregistered', source: 'r.example' }],
        trademarks: { state: 'unknown', reason: 'no_api_key', hits: [] },
      }),
    );
    expect(gaps.join(' ')).toContain('not configured');
    if (!isAssessed(result)) throw new Error('expected assessed — domains did resolve');
    // No trademark rule may appear in checksRun: nothing was checked.
    expect(result.checksRun.filter((c) => c.startsWith('name.trademark'))).toHaveLength(0);
  });

  it('returns not_assessed when NOTHING was reachable', () => {
    const { result } = assembleName(
      response({
        domains: [
          { domain: 'photovault.com', tld: 'com', state: 'unknown', reason: 'timeout' },
          { domain: 'photovault.io', tld: 'io', state: 'unknown', reason: 'error' },
        ],
        trademarks: { state: 'unknown', reason: 'no_api_key', hits: [] },
      }),
    );
    expect(result.status).toBe('not_assessed');
    expect(result).not.toHaveProperty('score');
  });
});

describe('trademark hits carry only registry-supplied identifiers', () => {
  it('renders serial and owner when the registry returned them', () => {
    const { result } = assembleName(
      response({
        trademarks: {
          state: 'checked',
          source: 'api.uspto.gov',
          hits: [
            {
              markText: 'PHOTOVAULT',
              owner: 'Example Holdings LLC',
              serialNumber: '90123456',
              status: 'LIVE/REGISTRATION',
              live: true,
              match: 'exact',
            },
          ],
        },
      }),
    );
    if (!isAssessed(result)) throw new Error('expected assessed');
    const f = result.findings[0]!;
    expect(f.severity).toBe('critical');
    expect(f.confidence).toBe('verified');
    expect(f.evidence.excerpt).toContain('90123456');
    expect(f.evidence.excerpt).toContain('Example Holdings LLC');
  });

  it('omits identifiers entirely when the registry did not return them', () => {
    const { result } = assembleName(
      response({
        trademarks: {
          state: 'checked',
          source: 'api.uspto.gov',
          hits: [{ markText: 'PHOTOVAULT', live: true, match: 'exact' }],
        },
      }),
    );
    if (!isAssessed(result)) throw new Error('expected assessed');
    const excerpt = result.findings[0]!.evidence.excerpt;
    expect(excerpt).toBe('"PHOTOVAULT"');
    // No placeholder, no "unknown", no invented number.
    expect(excerpt).not.toMatch(/serial|reg\.|owner|n\/a|unknown/i);
  });

  it('never asserts infringement', () => {
    const { result } = assembleName(
      response({
        trademarks: {
          state: 'checked',
          hits: [{ markText: 'PHOTOVAULT', live: true, match: 'exact' }],
        },
      }),
    );
    const text = JSON.stringify(result).toLowerCase();
    expect(text).not.toContain('infring');
    expect(text).not.toContain('illegal');
    expect(text).not.toContain('cease and desist');
  });

  it('drops dead marks that are only similar', () => {
    const { result } = assembleName(
      response({
        trademarks: {
          state: 'checked',
          hits: [
            { markText: 'PHOTOVAULTED', live: false, match: 'similar' },
            { markText: 'PHOTO VAULT', live: true, match: 'similar' },
          ],
        },
      }),
    );
    if (!isAssessed(result)) throw new Error('expected assessed');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.evidence.excerpt).toContain('PHOTO VAULT');
  });
});

describe('name normalisation', () => {
  it('builds a domain slug', () => {
    expect(toDomainSlug('PhotoVault Pro')).toBe('photovaultpro');
    expect(toDomainSlug('Café Münster')).toBe('cafemunster');
    expect(toDomainSlug('!!!')).toBeNull();
    expect(toDomainSlug('a')).toBeNull();
  });

  it('compares marks on case, spacing, and punctuation only', () => {
    expect(normalizeMark('Photo-Vault!')).toBe('photo vault');
    expect(isExactMark('PhotoVault', 'PHOTOVAULT')).toBe(true);
    expect(isExactMark('Photo Vault', 'photo-vault')).toBe(true);
    expect(isExactMark('PhotoVault', 'PhotoVaults')).toBe(false);
  });
});
