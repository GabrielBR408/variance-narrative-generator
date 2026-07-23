/**
 * shared/chiefeo-auth/react/AuthProvider.jsx
 *
 * Purpose: Non-blocking auth-awareness context provider. Wrap a tool's app once
 *          and every component can read OptionalAuthState via useOptionalAuth().
 *          Also the single place a tool injects its Supabase config into the
 *          framework-free core, and its theme/brand/copy for the auth UI.
 *
 * Guarantees (the zero-breakage contract):
 *   1. Children ALWAYS render immediately — no loading gate, no spinner, no
 *      null return. Anonymous users keep full tool access.
 *   2. NEVER throws and NEVER redirects. Any failure (missing config, network
 *      error, RLS denial, missing profiles row) resolves to the clean anon
 *      state.
 *   3. No tool logic changes required — wrapping the root is sufficient;
 *      consuming the state is opt-in.
 *
 * On mount it also calls captureReferralCode(), so `?ref=` links work with zero
 * extra wiring. Because getSupabase() sets detectSessionInUrl, mounting this
 * provider is also what completes the email-verification / OAuth redirect.
 *
 * Supabase config: pass supabaseUrl / supabaseAnonKey / siteUrl / createClient
 * as props (the hub reads these from import.meta.env.VITE_* and the npm
 * createClient). Alternatively call configureAuth() yourself before mounting and
 * omit the props — omitted props never clobber an existing config.
 */

import React, {
  createContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { configureAuth, getSupabase, captureReferralCode } from '../core/index.js';
import { BrandingProvider } from './theme.js';

/** The canonical anon state — also the zero-breakage fallback everywhere. */
export const ANON_AUTH_STATE = {
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
export const OptionalAuthContext = createContext(null);

/**
 * Fetches the signed-in user's own profiles row. Tolerates a missing row (e.g.
 * trigger lag right after signup) and any query error by returning null.
 * Soft-deleted rows are normalized to null.
 */
async function fetchOwnProfile(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return null;
    if (data.deleted_at !== null) return null; // soft-deleted = absent
    return data;
  } catch {
    return null;
  }
}

/**
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {string} [props.supabaseUrl]
 * @param {string} [props.supabaseAnonKey]
 * @param {string} [props.siteUrl]
 * @param {Function} [props.createClient]  supabase-js createClient.
 * @param {object} [props.theme]  Palette/font overrides (see theme.js).
 * @param {object} [props.brand]  Brand identity overrides (name, links).
 * @param {object} [props.copy]   User-facing string overrides.
 */
export function AuthProvider({
  children,
  supabaseUrl,
  supabaseAnonKey,
  siteUrl,
  createClient,
  theme,
  brand,
  copy,
}) {
  // Inject Supabase config into the core once, as early as possible (before any
  // child effect could call getSupabase()). Omitted props do not clobber an
  // existing configuration (see core configureAuth()).
  const configuredRef = useRef(false);
  if (!configuredRef.current) {
    configureAuth({ supabaseUrl, supabaseAnonKey, siteUrl, createClient });
    configuredRef.current = true;
  }

  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // Capture ?ref=CODE into the chiefeo_ref cookie. Safe no-op when
    // absent/invalid.
    captureReferralCode();

    const supabase = getSupabase();
    if (!supabase) {
      // Config not set (or client construction failed): clean anon state,
      // tools keep working exactly as before auth existed.
      setUser(null);
      setProfile(null);
      setLoading(false);
      return;
    }

    const applyUser = async (nextUser) => {
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

    // Keep state fresh across login/logout/token refresh (any tab), and pick up
    // the session created by the email-verification / OAuth redirect.
    let subscription = null;
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

  const authValue = useMemo(
    () => ({
      isLoggedIn: user !== null,
      user,
      profile,
      referralCode: profile?.referral_code ?? null,
      loading,
    }),
    [user, profile, loading]
  );

  const brandingValue = useMemo(
    () => ({ theme, brand, copy }),
    [theme, brand, copy]
  );

  // Children render immediately, always — no gate, no spinner.
  return (
    <BrandingProvider value={brandingValue}>
      <OptionalAuthContext.Provider value={authValue}>
        {children}
      </OptionalAuthContext.Provider>
    </BrandingProvider>
  );
}
