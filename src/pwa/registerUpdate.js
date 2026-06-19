// --- PWA update prompt -----------------------------------------------------
// Registers the service worker in 'prompt' mode (see vite.config.js) and, when a
// newly deployed worker is waiting, shows a small, dismissible banner at the top
// of the page: "A new version is available — click to update". Clicking Update
// activates the waiting worker and reloads so the new version takes over.
//
// Kept as a plain DOM module (not a React component) so it can run from main.jsx
// before/independently of the React tree and never blocks first paint. The
// 'virtual:pwa-register' module is provided by vite-plugin-pwa at build time.
import { registerSW } from 'virtual:pwa-register'

const BANNER_ID = 'pwa-update-banner'

export function registerUpdatePrompt() {
  // updateSW(true) tells the waiting worker to skipWaiting and reloads the page.
  const updateSW = registerSW({
    onNeedRefresh() {
      showUpdateBanner(() => updateSW(true))
    }
  })
}

function showUpdateBanner(onUpdate) {
  // Never stack more than one banner.
  if (document.getElementById(BANNER_ID)) return

  const banner = document.createElement('div')
  banner.id = BANNER_ID
  banner.className = 'update-banner'
  banner.setAttribute('role', 'status')

  const text = document.createElement('span')
  text.className = 'update-banner-text'
  text.textContent = 'A new version is available — click to update'

  const update = document.createElement('button')
  update.type = 'button'
  update.className = 'update-banner-btn'
  update.textContent = 'Update'
  update.addEventListener('click', onUpdate)

  const dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.className = 'update-banner-dismiss'
  dismiss.setAttribute('aria-label', 'Dismiss')
  dismiss.textContent = '×'
  dismiss.addEventListener('click', () => banner.remove())

  banner.append(text, update, dismiss)
  document.body.prepend(banner)
}
