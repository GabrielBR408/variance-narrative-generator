/**
 * src/components/auth/AuthProvider.tsx
 *
 * Purpose: Non-blocking auth-awareness context provider for the
 *          chiefeotool.com tools hub (Vite/React SPA). Wrap the app once
 *          (e.g. around the router/root in main.tsx or App.tsx) and every
 *          tool can read OptionalAuthState via useOptionalAuth().
 *
 * Integration notes:
 * - GUARANTEES (the zero-breakage contract):
 *   1. Children ALWAYS render immediately — no loading gate, no spinner,
 *      no null return. Anon users keep full tool access.
 *   2. NEVER throws and NEVER redirects. Any failure (missing VITE_* env
 *      vars, network error, RLS denial, missing profiles row) resolves to
 *      the clean anon state.
 *   3. No tool logic changes required — wrapping the root is sufficient;
 *      consuming the state is opt-in.
 * - On mount it also calls captureReferralCode(), so `?ref=` links work
 *   with zero extra wiring anywhere.
 * - Because getSupabase() sets detectSessionInUrl, mounting this provider
 *   is also what completes the email-verification redirect: the user lands
 *   on chiefeotool.com from the email link and is signed in automatically.
 * - Soft-deleted profiles (deleted_at != null) are treated as absent.
 * - Phase 2 note: gating, when it arrives, lives in consumers of this same
 *   context — this provider stays non-blocking.
 */

import React, { createContext, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabase } from '../../lib/supabase/client';
import { captureReferralCode } from '../../lib/auth/refCapture';
import type { OptionalAuthState, Profile } from '../../lib/auth/types';

/** The canonical anon state — also the zero-breakage fallback everywhere. */
export const ANON_AUTH_STATE: OptionalAuthState = {
  isLoggedIn: false,
  user: null,
  profile: null,
  referralCode: null,
  loading: false,
};

/**
 * Context value is `null` when no AuthProvider is mounted; useOptionalAuth()
 * detects that and falls back to ANON_AUTH_STATE (it never throws).
 */
export const OptionalAuthContext = createContext<OptionalAuthState | null>(
  null
);

/**
 * Fetches the signed-in user's own profiles row. Tolerates a missing row
 * (e.g. trigger lag right after signup) and any query error by returning
 * null. Soft-deleted rows are normalized to null.
 */
async function fetchOwnProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<Profile | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return null;
    const profile = data as Profile;
    if (profile.deleted_at !== null) return null; // soft-deleted = absent
    return profile;
  } catch {
    return null;
  }
}

export interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;

    // Capture ?ref=CODE into the chiefeo_ref cookie — the SPA replacement
    // for the Next.js middleware. Safe no-op when absent/invalid.
    captureReferralCode();

    const supabase = getSupabase();
    if (!supabase) {
      // Env not configured (or client construction failed): clean anon
      // state, tools keep working exactly as before auth existed.
      setUser(null);
      setProfile(null);
      setLoading(false);
      return;
    }

    const applyUser = async (nextUser: User | null): Promise<void> => {
      if (cancelled) return;
      setUser(nextUser);
      if (!nextUser) {
        setProfile(null);
        setLoading(false);
        return;
      }
      const nextProfile = await fetchOwnProfile(supabase, nextUser.id);
      if (cancelled) return;
      setProfile(nextProfile);
      setLoading(false);
    };

    // Initial resolution on mount.
    supabase.auth
      .getUser()
      .then(({ data }) => applyUser(data.user ?? null))
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setProfile(null);
          setLoading(false);
        }
      });

    // Keep state fresh across login/logout/token refresh (any tab), and
    // pick up the session created by the email-verification redirect.
    let subscription: { unsubscribe: () => void } | null = null;
    try {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        void applyUser(session?.user ?? null);
      });
      subscription = data.subscription;
    } catch {
      // Subscription failure is non-fatal; initial state still resolved.
    }

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, []);

  const value = useMemo<OptionalAuthState>(
    () => ({
      isLoggedIn: user !== null,
      user,
      profile,
      referralCode: profile?.referral_code ?? null,
      loading,
    }),
    [user, profile, loading]
  );

  // Children render immediately, always — no gate, no spinner.
  return (
    <OptionalAuthContext.Provider value={value}>
      {children}
    </OptionalAuthContext.Provider>
  );
}
