/**
 * The client/server secret boundary, enforced.
 *
 * The failure this guards against is not exotic: pasting the service_role key
 * into VITE_SUPABASE_ANON_KEY looks identical in a diff and hands every visitor
 * full read/write on every row, because service_role bypasses RLS. These tests
 * make that a startup failure rather than a breach.
 */

import { describe, expect, it } from 'vitest';
import { checkClientEnv, classifySupabaseKey, EnvironmentError } from './env';

/** Build an unsigned JWT with the given role claim — shape is all we inspect. */
function jwtWithRole(role: string): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'supabase' })}.signature`;
}

const ANON = jwtWithRole('anon');
const SERVICE = jwtWithRole('service_role');
const URL = 'https://abcdefgh.supabase.co';

describe('classifySupabaseKey', () => {
  it('identifies keys by what they are, not what they are named', () => {
    expect(classifySupabaseKey(ANON)).toBe('anon');
    expect(classifySupabaseKey(SERVICE)).toBe('service_role');
    expect(classifySupabaseKey('sb_publishable_abc123def456')).toBe('publishable');
    expect(classifySupabaseKey('sb_secret_abc123def456')).toBe('secret');
    expect(classifySupabaseKey('not-a-key')).toBe('unknown');
  });
});

describe('local-only mode is supported', () => {
  it('returns null supabase with no config, and does not throw', () => {
    const r = checkClientEnv({});
    expect(r.supabase).toBeNull();
    expect(r.notes.join(' ')).toContain('Scans run locally');
  });

  it('accepts a correct configuration', () => {
    const r = checkClientEnv({ VITE_SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: ANON });
    expect(r.supabase).toEqual({ url: URL, anonKey: ANON });
  });

  it('rejects a half-configured environment', () => {
    expect(() => checkClientEnv({ VITE_SUPABASE_URL: URL })).toThrow(EnvironmentError);
    expect(() => checkClientEnv({ VITE_SUPABASE_ANON_KEY: ANON })).toThrow(EnvironmentError);
  });

  it('requires https for the project URL', () => {
    expect(() =>
      checkClientEnv({ VITE_SUPABASE_URL: 'http://abc.supabase.co', VITE_SUPABASE_ANON_KEY: ANON }),
    ).toThrow(/https/);
  });
});

describe('a service_role key in the client environment is fatal', () => {
  it('refuses a legacy service_role JWT', () => {
    expect(() => checkClientEnv({ VITE_SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: SERVICE })).toThrow(
      /bypasses row-level security/,
    );
  });

  it('refuses a new-format secret key', () => {
    expect(() =>
      checkClientEnv({ VITE_SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: 'sb_secret_abcdefghijklmnop' }),
    ).toThrow(EnvironmentError);
  });

  it('tells the user to rotate, not merely to fix', () => {
    try {
      checkClientEnv({ VITE_SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: SERVICE });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).toMatch(/rotate/i);
    }
  });
});

describe('secrets cannot ride along under a VITE_ prefix', () => {
  it.each([
    ['VITE_SUPABASE_SERVICE_ROLE_KEY', 'anything'],
    ['VITE_OPENAI_API_KEY', 'anything'],
    ['VITE_ANTHROPIC_API_KEY', 'anything'],
    ['VITE_STRIPE_SECRET_KEY', 'anything'],
    ['VITE_DATABASE_URL', 'anything'],
  ])('rejects %s by name', (key, value) => {
    expect(() => checkClientEnv({ [key]: value })).toThrow(/server-side secret/);
  });

  it.each([
    ['OpenAI key', 'sk-proj-abcdefghijklmnopqrstuvwxyz123456'],
    ['Anthropic key', 'sk-ant-abcdefghijklmnopqrstuvwxyz123'],
    ['Stripe secret', 'sk_live_abcdefghijklmnop'],
    ['AWS key id', 'AKIAIOSFODNN7EXAMPLE'],
    ['Supabase secret', 'sb_secret_abcdefghijklmnop'],
    ['Postgres URL', 'postgresql://user:password@db.example.com:5432/postgres'],
    ['private key', '-----BEGIN RSA PRIVATE KEY-----'],
  ])('rejects a %s pasted into an innocently named variable', (_label, value) => {
    expect(() => checkClientEnv({ VITE_ANALYTICS_TOKEN: value })).toThrow(/public bundle/);
  });

  it('tells the user to assume exposure and rotate', () => {
    try {
      checkClientEnv({ VITE_ANALYTICS_TOKEN: 'sk_live_abcdefghijklmnop' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).toMatch(/already exposed/i);
    }
  });

  it('leaves non-VITE variables alone — they never reach the browser', () => {
    const r = checkClientEnv({
      SUPABASE_SERVICE_ROLE_KEY: SERVICE,
      OPENAI_API_KEY: 'sk-proj-abcdefghijklmnopqrstuvwxyz123456',
      VITE_SUPABASE_URL: URL,
      VITE_SUPABASE_ANON_KEY: ANON,
    });
    expect(r.supabase).not.toBeNull();
  });
});
