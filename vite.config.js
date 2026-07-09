import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { handleGenerate } from './server/generate.js'

// Build stamp: read the app version from package.json and the deploy commit from
// Vercel's build env, then expose both as compile-time constants (see
// src/lib/buildInfo.js). 'dev' is the local/unknown fallback.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
const commitSha = process.env.VERCEL_GIT_COMMIT_SHA || 'dev'

// --- Local /generate endpoint (dev + preview middleware) -------------------
// The real request handler now lives in server/generate.js so it can graduate
// to a production Node/Express server unchanged. Here it is simply mounted in
// the Vite middleware chain so the front end has a real HTTP round-trip during
// dev and preview.
// Phase 5: receives multipart/form-data with actual file bytes, verifies
// surface facts (filename, size, MIME, role), and returns a placeholder
// response. No parsing, AI, storage, calculations, persistence, or export.
function generateEndpoint() {
  const mount = (server) => {
    server.middlewares.use('/api/generate', (req, res) => {
      if (req.method !== 'POST') {
        // Match production (api/generate.js): non-POST gets a clean 405 with an
        // Allow header instead of falling through to the SPA shell.
        res.statusCode = 405
        res.setHeader('Allow', 'POST')
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ success: false, error: 'Method not allowed.' }))
        return
      }
      handleGenerate(req, res)
    })
  }
  return {
    name: 'generate-endpoint',
    configureServer: mount,   // dev
    configurePreviewServer: mount // preview
  }
}

// Base public path. Defaults to '/' for local dev/preview and any server deploy;
// the GitHub Pages workflow sets VITE_BASE to the project sub-path
// ('/variance-narrative-generator/') so built asset URLs resolve there.
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __COMMIT_SHA__: JSON.stringify(commitSha)
  },
  plugins: [
    react(),
    generateEndpoint(),
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
      // / moved paths, so they always hit the network (and the Vercel rewrites).
      workbox: {
        navigateFallbackDenylist: [/^\/downdriller/, /^\/orgen/, /^\/chiefeoinspector/, /^\/vng/]
      },
      includeAssets: ['favicon.svg', 'icons/icon-180.png'],
      manifest: {
        name: 'Variance Narrative Generator',
        short_name: 'Variance',
        description: 'Generate variance comments on income statements.',
        theme_color: '#1c2a3a',
        background_color: '#f4f5f7',
        display: 'standalone',
        // Hub restructure: the VNG app itself lives at /vng (the root is the
        // hub), so an installed PWA must launch into the app, not the hub. The
        // scope stays at the base — it must contain start_url. Under a GitHub
        // Pages sub-path deploy the base IS the app, so start_url stays there.
        start_url: base === '/' ? '/vng' : base,
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
