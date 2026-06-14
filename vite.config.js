import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// --- Local /generate endpoint (dev + preview middleware) -------------------
// TEMPORARY. NOT a production server.
// TODO: Replace Vite middleware with server endpoint before production.
// This placeholder backend lives in the Vite middleware chain so the front
// end has a real HTTP round-trip to call.
// Phase 4: verifies request structure, mints a Job ID, and returns a
// placeholder narrative. No parsing, AI, storage, calculations, or export.
function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) }
      catch { resolve(null) } // signal malformed body
    })
  })
}

function generateEndpoint() {
  const handler = (server) => {
    server.middlewares.use('/generate', async (req, res, next) => {
      if (req.method !== 'POST') return next()
      res.setHeader('Content-Type', 'application/json')

      const body = await readJsonBody(req)

      // Structure verification (no validation of file contents).
      if (body === null) {
        res.statusCode = 400
        res.end(JSON.stringify({ success: false, error: 'Malformed request body.' }))
        return
      }
      // Structure verification only (no inspection of file contents).
      const files = Array.isArray(body.files) ? body.files : null
      if (!files || files.length === 0 || !body.style || !body.variance) {
        res.statusCode = 422
        res.end(JSON.stringify({
          success: false,
          error: 'Request is missing required fields (files, style, or variance).'
        }))
        return
      }

      // Server-minted placeholder Job ID. No real processing happens here.
      const jobId = 'JOB-' + String(Date.now()).slice(-6)
      res.statusCode = 200
      res.end(JSON.stringify({
        success: true,
        jobId,
        filesReceived: files.length,
        settingsReceived: true,
        narrative: {
          summary: 'Narrative generation placeholder. Analysis engine not connected yet.'
        }
      }))
    })
  }
  return {
    name: 'generate-endpoint',
    configureServer: handler,   // dev
    configurePreviewServer: handler // preview
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
