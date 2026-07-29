import React from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import chiefeoLogo from '../assets/chiefeo-logo.png'
import Footer from './Footer.jsx'
import { parseLegalDoc, buildToc, rehypeSectionIds } from '../lib/legalDoc.js'

// Shared shell for the two legal pages (/tos, /privacy). The markdown is
// rendered verbatim — no summarising, no re-wording — with the preamble hoisted
// into the header so the Effective / Last Updated dates sit above the fold.
//
// Hash handling: this is a plain-pathname SPA with no router, so a deep link
// like /tos#5-2 lands on a document that does not exist yet when the browser
// makes its own scroll attempt. The effect below takes that over — it re-pins
// the target while the page settles, and again on every hashchange (TOC
// clicks).

const REMARK_PLUGINS = [remarkGfm]
const REHYPE_PLUGINS = [rehypeSectionIds]

// Leaves the targeted section a little clear of the top edge, matching the
// scroll-margin-top the stylesheet gives legal sections.
const HASH_OFFSET = 24
// How long a deep link keeps re-pinning itself after mount. These documents are
// tens of screens long, so landing even slightly early — before webfonts, the
// logo, or a late reflow settle — puts the reader nowhere near the section they
// followed a link to. Re-pinning is idempotent (the position is recomputed from
// the element's absolute offset each time), so it converges rather than stacks.
const HASH_SETTLE_MS = 3000
const HASH_TICK_MS = 150

function scrollToHash(hash, behavior = 'auto') {
  const id = decodeURIComponent(String(hash || '').replace(/^#/, ''))
  if (!id) return
  const el = document.getElementById(id)
  if (!el) return
  const offset = el.getBoundingClientRect().top + window.scrollY
  window.scrollTo({ top: Math.max(0, offset - HASH_OFFSET), behavior })
}

export default function LegalDocument({ markdown }) {
  const doc = React.useMemo(() => parseLegalDoc(markdown), [markdown])
  const toc = React.useMemo(() => buildToc(doc.body), [doc.body])

  React.useEffect(() => {
    if (!window.location.hash) return undefined

    // The browser restores the previous scroll position on a reload/back — for
    // a deep link that restoration lands *after* our scroll and undoes it, so
    // the hash target wins while this page is mounted.
    const priorRestoration = history.scrollRestoration
    try {
      history.scrollRestoration = 'manual'
    } catch {
      // Not supported / blocked — the retry loop below is the fallback.
    }

    let settling = true
    let timer = 0
    let ticker = 0
    const pin = () => {
      if (settling) scrollToHash(window.location.hash)
    }

    // Anything that can move the target under us re-pins it: a reflow (fonts,
    // images, a viewport change), the document finishing load, or the tab
    // becoming visible after being opened in the background. A deliberate
    // scroll from the user ends the window immediately — this must never fight
    // them — and so does the settle timeout.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(pin) : null
    const stop = () => {
      settling = false
      clearTimeout(timer)
      clearInterval(ticker)
      if (observer) observer.disconnect()
      window.removeEventListener('load', pin)
      document.removeEventListener('visibilitychange', pin)
      for (const evt of ['wheel', 'touchstart', 'keydown']) window.removeEventListener(evt, stop)
    }

    const frame = requestAnimationFrame(pin)
    // The observer and the animation frame are both driven by rendering, which
    // is suspended in a background tab; this plain timer is what keeps a deep
    // link honest when the page loads without ever being painted.
    ticker = setInterval(pin, HASH_TICK_MS)
    timer = setTimeout(stop, HASH_SETTLE_MS)
    if (observer) observer.observe(document.documentElement)
    window.addEventListener('load', pin)
    document.addEventListener('visibilitychange', pin)
    for (const evt of ['wheel', 'touchstart', 'keydown']) {
      window.addEventListener(evt, stop, { passive: true, once: true })
    }

    // TOC clicks land here — the target already exists, so a single smooth
    // scroll is enough, and it also re-opens the settle window's replacement.
    const onHashChange = () => {
      stop()
      scrollToHash(window.location.hash, 'smooth')
    }
    window.addEventListener('hashchange', onHashChange)

    return () => {
      cancelAnimationFrame(frame)
      stop()
      try {
        history.scrollRestoration = priorRestoration
      } catch {
        /* see above */
      }
      window.removeEventListener('hashchange', onHashChange)
    }
  }, [doc.body])

  return (
    <main className="page legal-page">
      <a className="back-to-hub" href="/">&larr; ChiefEO Tools</a>
      <img className="brand-logo" src={chiefeoLogo} alt="ChiefEO" />

      <header className="legal-head">
        <h1 className="legal-title">{doc.title}</h1>
        {doc.entity && <p className="legal-entity">{doc.entity}</p>}
        <dl className="legal-dates">
          {doc.effectiveDate && (
            <div className="legal-date">
              <dt>Effective Date</dt>
              <dd>{doc.effectiveDate}</dd>
            </div>
          )}
          {doc.lastUpdated && (
            <div className="legal-date">
              <dt>Last Updated</dt>
              <dd>{doc.lastUpdated}</dd>
            </div>
          )}
        </dl>
      </header>

      {toc.length > 0 && (
        <nav className="legal-toc" aria-label="Table of contents">
          <h2 className="legal-toc-title">Table of Contents</h2>
          <ol className="legal-toc-list">
            {toc.map((item) => (
              <li
                key={item.id}
                className={item.depth > 0 ? 'legal-toc-item legal-toc-item--sub' : 'legal-toc-item'}
              >
                <a href={`#${item.id}`}>{item.label}</a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <article className="legal-body">
        <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>
          {doc.body}
        </Markdown>
      </article>

      <Footer />
    </main>
  )
}
