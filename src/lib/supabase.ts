/**
 * Supabase client.
 *
 * Deliberately nullable. Shipworthy's free, signed-out, in-browser scan is the
 * product's front door and its strongest privacy claim, so the app must run with
 * no backend configured at all. `getSupabase()` returning null is a supported
 * state — local-only mode — not a failure.
 *
 * The environment is validated on first access. A genuinely dangerous
 * configuration (a service_role key in a VITE_ variable, say) throws rather than
 * degrading, because degrading would mean shipping full database access to every
 * visitor.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { checkClientEnv, EnvironmentError } from './env';

let client: SupabaseClient | null = null;
let resolved = false;
let fatal: EnvironmentError | null = null;

function rawEnv(): Record<string, unknown> {
  try {
    return (import.meta.env ?? {}) as unknown as Record<string, unknown>;
  } catch {
    return {};
  }
}

function resolve(): void {
  if (resolved) return;
  resolved = true;
  try {
    const { supabase, notes } = checkClientEnv(rawEnv());
    for (const note of notes) console.info(`[shipworthy] ${note}`);
    if (!supabase) return;
    client = createClient(supabase.url, supabase.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    });
  } catch (err) {
    if (err instanceof EnvironmentError) {
      fatal = err;
      // Loud, because the alternative is silently serving a misconfiguration.
      console.error(`[shipworthy] environment refused:\n${err.message}`);
      return;
    }
    throw err;
  }
}

/** The client, or null when Supabase is not configured (local-only mode). */
export function getSupabase(): SupabaseClient | null {
  resolve();
  return client;
}

/** True when sign-in and history are available. */
export function isBackendConfigured(): boolean {
  resolve();
  return client !== null;
}

/** The environment error, when configuration was refused. */
export function environmentError(): EnvironmentError | null {
  resolve();
  return fatal;
}

/** Test seam — resets memoised state. */
export function __resetSupabaseForTests(): void {
  client = null;
  resolved = false;
  fatal = null;
}
