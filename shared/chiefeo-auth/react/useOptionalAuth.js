/**
 * shared/chiefeo-auth/react/useOptionalAuth.js
 *
 * The single hook every tool uses to read optional auth state. Phase 1:
 * awareness only — no gating.
 *
 *   const { isLoggedIn, user, profile, referralCode, loading } = useOptionalAuth();
 *
 * ZERO-BREAKAGE GUARANTEE: if called outside an <AuthProvider>, this hook does
 * NOT throw — it returns the canonical anon state and logs a dev-only
 * console.warn. Tools can adopt the hook before (or without) the provider being
 * wired in.
 */

import { useContext } from 'react';
import { ANON_AUTH_STATE, OptionalAuthContext } from './AuthProvider.jsx';

export function useOptionalAuth() {
  const state = useContext(OptionalAuthContext);
  if (state === null) {
    // Dev-only heads-up; intentionally NOT an error — anon fallback is valid
    // behavior by design (zero-breakage guarantee). Guarded so it is silent in
    // production builds and in environments without import.meta.env.
    try {
      if (import.meta && import.meta.env && import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn(
          '[useOptionalAuth] No <AuthProvider> found above this component. ' +
            'Returning anon state. Wrap your app root in <AuthProvider> to ' +
            'enable auth awareness.'
        );
      }
    } catch {
      /* import.meta unavailable (non-bundler context) — stay silent. */
    }
    return ANON_AUTH_STATE;
  }
  return state;
}
