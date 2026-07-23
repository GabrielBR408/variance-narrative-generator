/**
 * shared/chiefeo-auth/core/config.js
 *
 * Purpose: Runtime configuration for the framework-free ChiefEO auth core.
 *          The core deliberately does NOT read `import.meta.env`, `process.env`,
 *          or import `@supabase/supabase-js` — those are bundler/framework
 *          concerns. Instead the host app injects everything it needs once,
 *          via configureAuth(), so the exact same core runs unchanged in:
 *            - a Vite/React SPA (this hub) — createClient imported from npm,
 *              values from import.meta.env.VITE_*
 *            - a zero-build vanilla page (GL Down Driller) — createClient read
 *              from the supabase-js UMD global (window.supabase.createClient),
 *              values inlined or read from a <meta>/global.
 *
 * Contract:
 * - configureAuth() is idempotent and may be called more than once (e.g.
 *   React StrictMode double-mount); the last call wins. Calling it also
 *   resets the cached Supabase client (see client.js) so a config change is
 *   never silently ignored.
 * - Nothing here throws. If the core is used before configureAuth() runs,
 *   getSupabase() simply returns null and every action returns a clean
 *   env_missing result — the zero-breakage contract. Anonymous access is
 *   never affected.
 */

const DEFAULT_SITE_URL = 'https://chiefeotool.com';

/**
 * @typedef {Object} AuthConfig
 * @property {string=} supabaseUrl   Supabase project URL.
 * @property {string=} supabaseAnonKey  Supabase anon (publishable) key. NEVER the service_role key.
 * @property {string=} siteUrl       Canonical site URL used for referral links and
 *                                   email/OAuth redirects. Defaults to https://chiefeotool.com.
 * @property {Function=} createClient  The supabase-js createClient function
 *                                   (from npm `@supabase/supabase-js` or the UMD
 *                                   global `window.supabase.createClient`).
 */

/** @type {AuthConfig} */
let _config = {
  supabaseUrl: undefined,
  supabaseAnonKey: undefined,
  siteUrl: DEFAULT_SITE_URL,
  createClient: undefined,
};

/** Listeners notified when config changes, so caches (e.g. the client) can reset. */
const _listeners = new Set();

/**
 * Inject the host's Supabase config + createClient. Call once at app start
 * (before the first getSupabase()/action call). Idempotent; last call wins.
 * Unknown/absent fields keep their previous value except siteUrl, which falls
 * back to the default when blank.
 * @param {AuthConfig} config
 */
export function configureAuth(config) {
  const next = config || {};
  _config = {
    supabaseUrl: next.supabaseUrl ?? _config.supabaseUrl,
    supabaseAnonKey: next.supabaseAnonKey ?? _config.supabaseAnonKey,
    siteUrl:
      typeof next.siteUrl === 'string' && next.siteUrl.trim()
        ? next.siteUrl
        : _config.siteUrl || DEFAULT_SITE_URL,
    createClient: next.createClient ?? _config.createClient,
  };
  for (const fn of _listeners) {
    try {
      fn();
    } catch {
      /* a listener must never break configuration */
    }
  }
}

/** Current config snapshot (read-only view). */
export function getConfig() {
  return _config;
}

/**
 * Canonical site URL with trailing slashes stripped, always non-empty.
 * Used by referral-link building and auth redirects.
 */
export function getSiteUrl() {
  const url = _config.siteUrl || DEFAULT_SITE_URL;
  return url.replace(/\/+$/, '');
}

/**
 * Subscribe to config changes. Returns an unsubscribe function. Used internally
 * by client.js to drop its cached client when config is re-injected.
 * @param {() => void} fn
 */
export function onConfigChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
