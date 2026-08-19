/**
 * Environment boundary.
 *
 * Vite inlines every `VITE_`-prefixed variable into the production bundle as a
 * literal string. Anything with that prefix is public, permanently, to anyone
 * who opens devtools. Anything without it never reaches the browser at all.
 * That prefix is the entire security boundary, and it is easy to cross by
 * accident, so this module refuses to let the app start when it has been.
 *
 * What is allowed in the browser:
 *
 *   VITE_SUPABASE_URL        the project URL — public by design
 *   VITE_SUPABASE_ANON_KEY   the anon/publishable key — public by design,
 *                            because row-level security, not secrecy, is what
 *                            protects the data behind it
 *
 * What must never carry a VITE_ prefix:
 *
 *   SUPABASE_SERVICE_ROLE_KEY   bypasses RLS entirely — full read/write on every
 *                               row of every table for every user
 *   any model-provider API key  billable, and impersonates your account
 *   any Stripe secret key       moves money
 *
 * Those belong in Supabase Edge Function secrets (`supabase secrets set`), where
 * they are readable only by server-side code. The Claims module in Phase 2 is
 * the first thing that will need one; it must call an Edge Function rather than
 * a provider directly.
 *
 * WorkflowVerify put its OpenAI key in browser localStorage and shipped it
 * straight to api.openai.com. Its own README flagged that as a V1 shortcut
 * needing a server-side proxy. That shortcut does not get carried forward.
 */

export class EnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvironmentError';
  }
}

/** Variable names that must never appear with a VITE_ prefix. */
export const FORBIDDEN_CLIENT_VARS = [
  'SERVICE_ROLE',
  'SERVICE_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'STRIPE_SECRET',
  'STRIPE_WEBHOOK',
  'DATABASE_URL',
  'JWT_SECRET',
  'SECRET_KEY',
];

/**
 * Value shapes that are secrets wherever they appear. Reused by the build-time
 * bundle scan in scripts/check-bundle-secrets.mjs, so a leak is caught both when
 * the app boots and before the artifact is published.
 */
export const SECRET_VALUE_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'Supabase service_role key (new format)', re: /\bsb_secret_[A-Za-z0-9_-]{10,}/ },
  { name: 'OpenAI API key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/ },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'Stripe secret key', re: /\bsk_(?:live|test)_[A-Za-z0-9]{10,}/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Postgres connection string', re: /\bpostgres(?:ql)?:\/\/[^\s"']*:[^\s"']*@/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

// ─── Supabase key inspection ─────────────────────────────────────────────────

export type SupabaseKeyRole = 'anon' | 'service_role' | 'publishable' | 'secret' | 'unknown';

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json =
      typeof atob === 'function'
        ? atob(pad)
        : Buffer.from(pad, 'base64').toString('binary');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Identify what a Supabase key actually is, rather than trusting the variable
 * it was assigned to. Supabase's legacy keys are JWTs carrying a `role` claim,
 * and its newer keys are prefixed. Both formats are checked, because pasting the
 * service_role key into VITE_SUPABASE_ANON_KEY is a single-character-of-attention
 * mistake that would publish full database access to every visitor.
 */
export function classifySupabaseKey(key: string): SupabaseKeyRole {
  const k = key.trim();
  if (k.startsWith('sb_secret_')) return 'secret';
  if (k.startsWith('sb_publishable_')) return 'publishable';
  const payload = decodeJwtPayload(k);
  const role = payload?.['role'];
  if (role === 'service_role') return 'service_role';
  if (role === 'anon') return 'anon';
  return 'unknown';
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

export interface EnvCheckResult {
  /** Null when Supabase is not configured — the app runs local-only. */
  supabase: SupabaseEnv | null;
  /** Non-fatal notes worth surfacing in the console during development. */
  notes: string[];
}

/**
 * Validate the client environment, or throw.
 *
 * Absent Supabase config is NOT an error: the deterministic scan is the free,
 * signed-out front door and must keep working with no backend at all. Only a
 * genuinely dangerous configuration throws.
 */
export function checkClientEnv(raw: Record<string, unknown>): EnvCheckResult {
  const notes: string[] = [];

  // 1. Nothing secret may carry a VITE_ prefix, by name.
  for (const key of Object.keys(raw)) {
    if (!key.startsWith('VITE_')) continue;
    const bare = key.slice('VITE_'.length).toUpperCase();
    const hit = FORBIDDEN_CLIENT_VARS.find((f) => bare.includes(f));
    if (hit) {
      throw new EnvironmentError(
        `${key} would be compiled into the public bundle. Anything matching "${hit}" is a ` +
          `server-side secret. Remove the VITE_ prefix and move it to Supabase Edge Function ` +
          `secrets (\`supabase secrets set ${bare}=…\`).`,
      );
    }
  }

  // 2. Nothing secret may carry a VITE_ prefix, by value — catches a secret
  //    pasted into an innocently named variable.
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith('VITE_') || typeof value !== 'string') continue;
    for (const { name, re } of SECRET_VALUE_PATTERNS) {
      if (re.test(value)) {
        throw new EnvironmentError(
          `${key} contains what looks like a ${name}. VITE_ variables are compiled into the ` +
            `public bundle and cannot hold secrets. Rotate that credential — assume it is ` +
            `already exposed — then move it server-side.`,
        );
      }
    }
  }

  const url = typeof raw['VITE_SUPABASE_URL'] === 'string' ? raw['VITE_SUPABASE_URL'].trim() : '';
  const anonKey =
    typeof raw['VITE_SUPABASE_ANON_KEY'] === 'string' ? raw['VITE_SUPABASE_ANON_KEY'].trim() : '';

  // 3. Neither set: local-only mode. Legitimate, not an error.
  if (!url && !anonKey) {
    notes.push('Supabase is not configured. Scans run locally; sign-in and history are disabled.');
    return { supabase: null, notes };
  }

  // 4. One set without the other is a misconfiguration worth catching loudly.
  if (!url || !anonKey) {
    throw new EnvironmentError(
      `Supabase is half-configured: ${url ? 'VITE_SUPABASE_ANON_KEY' : 'VITE_SUPABASE_URL'} is missing. ` +
        `Set both, or neither to run local-only.`,
    );
  }

  // 5. The key must actually be a publishable one.
  const role = classifySupabaseKey(anonKey);
  if (role === 'service_role' || role === 'secret') {
    throw new EnvironmentError(
      `VITE_SUPABASE_ANON_KEY holds a ${role} key, not an anon key. That key bypasses row-level ` +
        `security and would give every visitor full read and write access to every row in your ` +
        `database. Rotate it now in the Supabase dashboard, then set the anon/publishable key here.`,
    );
  }
  if (role === 'unknown') {
    notes.push(
      'VITE_SUPABASE_ANON_KEY is not in a recognised Supabase key format. Double-check you copied ' +
        'the anon/publishable key from Project Settings → API.',
    );
  }

  if (!/^https:\/\//.test(url)) {
    throw new EnvironmentError(
      `VITE_SUPABASE_URL must be an https:// URL. Got "${url.slice(0, 40)}".`,
    );
  }

  return { supabase: { url, anonKey }, notes };
}
