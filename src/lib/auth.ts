/**
 * Authentication — passwordless email (magic link / OTP).
 *
 * Passwordless by choice: Shipworthy never handles, hashes, or stores a
 * password, which removes a whole category of breach exposure for a product
 * whose users are already nervous about pasting configuration files into it.
 *
 * Sign-in gates persistence only. The scan itself never requires an account —
 * that boundary is the product's free front door and should not drift.
 */

import type { Session, User } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { getSupabase, isBackendConfigured } from './supabase';

export interface AuthState {
  /** null while loading, then the user or null when signed out. */
  user: User | null;
  loading: boolean;
  /** False when Supabase is not configured — hide sign-in affordances entirely. */
  available: boolean;
}

export async function sendMagicLink(email: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Sign-in is unavailable: Supabase is not configured.');

  const trimmed = email.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
    throw new Error('That does not look like an email address.');
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw new Error(describeAuthError(error.message));
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(describeAuthError(error.message));
}

export async function getSession(): Promise<Session | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** Current auth state, kept live via Supabase's auth listener. */
export function useAuth(): AuthState {
  const available = isBackendConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(available);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setLoading(false);
      return;
    }
    let alive = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { user, loading, available };
}

/**
 * Supabase auth errors are terse and occasionally cryptic. Translate the common
 * ones into something a user can act on, and never leak raw internals.
 */
export function describeAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Too many sign-in attempts. Wait a minute and try again.';
  }
  if (m.includes('invalid') && m.includes('email')) {
    return 'That email address was rejected. Check it for typos.';
  }
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) {
    return 'New sign-ups are currently disabled for this project.';
  }
  if (m.includes('expired')) {
    return 'That sign-in link has expired. Request a new one.';
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return 'Could not reach the sign-in service. Check your connection and try again.';
  }
  return 'Sign-in failed. Please try again.';
}
