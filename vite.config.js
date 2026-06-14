import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { handleGenerate } from './server/generate.js'

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
    server.middlewares.use('/generate', (req, res, next) => {
      if (req.method !== 'POST') return next()
      handleGenerate(req, res)
    })
  }
  return {
    name: 'generate-endpoint',
    configureServer: mount,   // dev
    configurePreviewServer: mount // preview
  }
}

export default defineConfig({
  plugins: [
    react(),
    generateEndpoint(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Variance Narrative Generator',
        short_name: 'Variance',
        description: 'Build property variance reports.',
        theme_color: '#1c2a3a',
        background_color: '#f4f5f7',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      }
    })
  ]
})
