import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Hub from './routes/Hub.jsx'
import './styles/app.css'
import { registerUpdatePrompt } from './pwa/registerUpdate.js'
import { Analytics } from '@vercel/analytics/react'
import AccountShell from './components/auth/AccountShell.jsx'

// --- Lightweight path routing ---------------------------------------------
// The app has no router dependency; a single pathname switch keeps it that way.
//   /vng (and anything under it) → the Variance Narrative Generator app
//   /    → the hub landing page (and any other in-app path falls back to it)
// Deep paths still load index.html (the SPA rewrite in vercel.json), so this
// switch decides what renders — a stale or mistyped /vng/... deep link must
// land in the app, not silently render the hub. /downdriller and /orgen never
// reach here — vercel.json proxies them to other Vercel projects. The document
// title is set per route so the hub doesn't carry the VNG title from index.html.
// Vercel Web Analytics only works where Vercel serves the /_vercel/insights
// script — the production domains and *.vercel.app preview deploys. Everywhere
// else (local `vite preview`, GitHub Pages, any static mirror) the <Analytics />
// script request 404s on every page view, spamming the console for nothing.
// Gate it to the hosts that can actually serve it.
function analyticsEnabled() {
  const host = window.location.hostname
  return (
    host === 'chiefeotool.com' ||
    host === 'www.chiefeotool.com' ||
    host.endsWith('.vercel.app')
  )
}

function pickRoute() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/vng' || path.startsWith('/vng/')) {
    document.title = 'Variance Narrative Generator'
    return <App />
  }
  document.title = 'ChiefEO Tools'
  return <Hub />
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Optional-auth wrapper: ?ref= capture + email-verify session pickup for
        the whole SPA, plus the dismissible anon signup banner + modal. Anon
        users keep 100% tool access — this never gates or redirects. */}
    <AccountShell>{pickRoute()}</AccountShell>
    {/* App-wide Vercel Web Analytics (page views/traffic) for this single
        deployment — covers the hub and every route/proxied view. Unrelated to
        the /vng-only `app_opened` custom event, which is fired inside App.jsx.
        Rendered only on hosts Vercel actually serves (see analyticsEnabled). */}
    {analyticsEnabled() && <Analytics />}
  </React.StrictMode>
)

// Register the service worker and surface the "new version available" banner.
registerUpdatePrompt()
