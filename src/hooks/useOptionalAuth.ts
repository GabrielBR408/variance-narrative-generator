/**
 * src/hooks/useOptionalAuth.ts
 *
 * Purpose: The single hook every chiefeotool.com tool (VNG, Owner Report
 *          Generator, GL Down Driller, ChiefEO Inspector) uses to read
 *          optional auth state. Phase 1: awareness only — no gating.
 *
 * Integration notes:
 * - Usage:
 *     const { isLoggedIn, user, profile, referralCode, loading } = useOptionalAuth();
 * - ZERO-BREAKAGE GUARANTEE: if called outside an <AuthProvider>, this hook
 *   does NOT throw — it returns the canonical anon state and logs a
 *   dev-only console.warn. Tools can adopt the hook before (or without)
 *   the provider being wired in.
 * - Phase 2 note: gating will be introduced by swapping consumers to a
 *   gated variant of this hook; adopting useOptionalAuth() now IS the
 *   migration path. Do not build a parallel auth-reading mechanism.
 */

import { useContext } from 'react';
import type { OptionalAuthState } from '../lib/auth/types';
import {
  ANON_AUTH_STATE,
  OptionalAuthContext,
} from '../components/auth/AuthProvider';

export function useOptionalAuth(): OptionalAuthState {
  const state = useContext(OptionalAuthContext);
  if (state === null) {
    if (import.meta.env.DEV) {
      // Dev-only heads-up; intentionally NOT an error — anon fallback is
      // valid behavior by design (zero-breakage guarantee).
      // eslint-disable-next-line no-console
      console.warn(
        '[useOptionalAuth] No <AuthProvider> found above this component. ' +
          'Returning anon state. Wrap your app root in <AuthProvider> ' +
          'to enable auth awareness (see docs/VITE_INTEGRATION.md).'
      );
    }
    return ANON_AUTH_STATE;
  }
  return state;
}
