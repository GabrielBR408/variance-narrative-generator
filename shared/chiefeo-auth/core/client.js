/**
 * shared/chiefeo-auth/core/client.js
 *
 * Purpose: Singleton browser Supabase client for the ChiefEO auth core.
 *          Framework-free: the client is built with the createClient function
 *          injected via configureAuth() (npm import in a bundler; the UMD
 *          global window.supabase.createClient on a zero-build page), so this
 *          file has NO dependency on @supabase/supabase-js and NO bundler
 *          assumptions.
 *
 * Behavior:
 * - Browser-side only. PKCE flow with detectSessionInUrl, so the email
 *   verification / OAuth redirect completes the session on load — no server
 *   route or callback endpoint is ever needed.
 * - getSupabase() returns null (never throws) when config is missing/unset, so
 *   tools keep working before auth env is wired — the zero-breakage contract.
 * - The cached instance is dropped automatically whenever configureAuth() is
 *   called again, so a late/changed config is honored.
 */

import { getConfig, onConfigChange } from './config.js';

/** @type {any} undefined = not yet built; null = unavailable; else the client. */
let cached;

// Drop the cache when config is re-injected so the next getSupabase() rebuilds.
onConfigChange(() => {
  cached = undefined;
});

/**
 * Returns the app-wide Supabase client, or null when config is absent or client
 * construction fails. Never throws.
 * @returns {any|null}
 */
export function getSupabase() {
  if (cached !== undefined) return cached;

  const { supabaseUrl, supabaseAnonKey, createClient } = getConfig();
  if (!supabaseUrl || !supabaseAnonKey || typeof createClient !== 'function') {
    cached = null;
    return cached;
  }

  try {
    cached = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        flowType: 'pkce',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    });
  } catch {
    cached = null;
  }
  return cached;
}
