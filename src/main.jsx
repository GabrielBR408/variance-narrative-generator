import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Hub from './routes/Hub.jsx'
import './styles/app.css'
import { registerUpdatePrompt } from './pwa/registerUpdate.js'

// --- Lightweight path routing ---------------------------------------------
// The app has no router dependency; a single pathname switch keeps it that way.
//   /vng → the existing Variance Narrative Generator app (unchanged)
//   /    → the hub landing page (and any other in-app path falls back to it)
// Deep paths still load index.html (the SPA rewrite in vercel.json), so this
// switch decides what renders. /downdriller and /orgen never reach here —
// vercel.json proxies them to other Vercel projects.
function pickRoute() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/vng') return <App />
  return <Hub />
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>{pickRoute()}</React.StrictMode>
)

// Register the service worker and surface the "new version available" banner.
registerUpdatePrompt()
