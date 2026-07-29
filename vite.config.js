import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// --- Build stamp (version + commit SHA) -------------------------------------
// Ties a built bundle to the exact deploy it came from. Vercel provides the SHA
// via env; local builds fall back to git; 'unknown' only if neither is
// available.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
function buildCommitSha() {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA
  if (fromEnv) return fromEnv.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'unknown'
  }
}

// Base public path. '/' for local dev/preview and the Vercel deploy, which is
// the only deploy target now that the GitHub Pages mirror is retired. Kept as an
// env override so a sub-path deploy stays possible without code changes.
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __COMMIT_SHA__: JSON.stringify(buildCommitSha())
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt' (not 'autoUpdate') so a freshly deployed service worker waits
      // and surfaces an "update available" banner via onNeedRefresh instead of
      // silently swapping in on the next load. See src/pwa/registerUpdate.js.
      registerType: 'prompt',
      // Hub restructure: the previously-deployed Workbox service worker cached the
      // VNG shell at '/' and hijacks ALL navigations, so returning visitors would
      // keep getting the old VNG app for the new root hub, /vng, /downdriller, and
      // /orgen. `selfDestroying` ships a service worker that UNREGISTERS the old
      // one and clears its caches on next load, so every path is served fresh from
      // the network. This is stronger than a navigate denylist alone — it removes
      // the interception entirely. Trade-off: no offline precache while active;
      // acceptable for these server-backed routing changes.
      selfDestroying: true,
      // Belt-and-suspenders: never let the SPA navigate-fallback answer the proxied
      // paths, so they always hit the network (and the Vercel rewrites). /vng is
      // now proxied to the extracted `chiefeo-vng` project like the other three,
      // so this entry is load-bearing — the SPA has no /vng route to fall back to.
      workbox: {
        navigateFallbackDenylist: [/^\/downdriller/, /^\/orgen/, /^\/chiefeoinspector/, /^\/vng/]
      },
      includeAssets: ['favicon.svg', 'icons/icon-180.png'],
      manifest: {
        // Canonical site identity is the hub (ChiefEO Tool), so the installed PWA
        // and its apple-mobile-web-app-title carry the hub brand.
        name: 'ChiefEO Tool',
        short_name: 'ChiefEO',
        description: 'Practical tools for commercial property management.',
        theme_color: '#1c2a3a',
        background_color: '#f4f5f7',
        display: 'standalone',
        // VNG has been extracted to its own repo/Vercel project and is reached
        // through a rewrite, so it is no longer part of this PWA's scope and
        // must not be the launch target — an installed app that started at /vng
        // would leave its own scope on first paint. Launch into the hub instead.
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      }
    })
  ]
})
