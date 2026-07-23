/**
 * src/lib/auth/types.ts
 *
 * Purpose: Canonical shared auth types for ChiefEO Phase 1 optional auth —
 *          Vite/React edition for the chiefeotool.com tools hub
 *          (variance-narrative-generator repo).
 *
 * Integration notes:
 * - All auth files import these types from this module. Do not redeclare
 *   Profile anywhere else.
 * - Timestamps are ISO 8601 strings as returned by supabase-js.
 * - A profile with non-null `deleted_at` is soft-deleted and must be treated
 *   as deleted everywhere (AuthProvider normalizes this to `null`).
 * - `OptionalAuthState` is intentionally nullable-everywhere: anon users are
 *   first-class. `isLoggedIn: false` never blocks anything in Phase 1.
 */

import type { User } from '@supabase/supabase-js';

/** Exact shape of a row in `public.profiles` (live in project dsmbppzvembacitwdrsj). */
export interface Profile {
  user_id: string;
  email: string;
  created_at: string;
  referral_code: string;
  referred_by: string | null;
  referral_count: number;
  free_until: string | null;
  deleted_at: string | null;
}

/**
 * Auth-awareness state available to every tool via useOptionalAuth().
 *
 * Guarantees:
 * - Never blocks rendering: `loading` is informational only.
 * - Anon state is always valid: { isLoggedIn: false, user: null,
 *   profile: null, referralCode: null, loading: false }.
 * - `referralCode` is a convenience mirror of `profile?.referral_code ?? null`.
 */
export interface OptionalAuthState {
  isLoggedIn: boolean;
  user: User | null;
  profile: Profile | null;
  referralCode: string | null;
  loading: boolean;
}
