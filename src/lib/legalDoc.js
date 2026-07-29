// --- Legal document helpers (ToS / Privacy Policy) -------------------------
// The legal text lives verbatim in src/content/*.md and is rendered as-is —
// nothing here rewrites, reorders, or summarises the wording. These helpers
// only do three mechanical things:
//
//   1. peel the document preamble (title, entity, Effective/Last Updated) off
//      the front so the page can show the dates in its own header block,
//   2. build a table of contents from the section numbers, and
//   3. stamp anchor IDs onto the rendered sections.
//
// (3) is the part other features depend on: the Phase 1 Claude API disclosure
// links to /tos#5-2 and the Phase 2 privacy copy links to /privacy#7-2, so the
// mapping "section N.M → id=N-M" is a contract, not a detail. Heading text like
// "5.2 Claude API (…)" would never auto-slug to "5-2", so the IDs are derived
// from the section number explicitly.
//
// The two documents number their subsections differently, and both forms are
// handled: the Privacy Policy uses markdown headings ("### 7.2 ChiefEO Next"),
// the ToS uses bold paragraphs ("**5.2 Claude API …**") under an unnumbered
// heading. Anything without a leading section number falls back to a text slug.

// "5.2 Claude API (VNG…)" → "5-2" · "12. ACCESSIBILITY" → "12" · else null.
export function sectionNumber(text) {
  const m = /^(\d+(?:\.\d+)*)[.)]?(?:\s|$)/.exec(String(text || '').trim())
  return m ? m[1].replace(/\./g, '-') : null
}

// Fallback for unnumbered headings ("Client-Side Tools (VNG, …)").
export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Split off the preamble block that precedes the first `---` rule: the H1, the
// operating-entity line, and the Effective/Last Updated dates. If a document
// ever lands without that shape, everything falls back to rendering the whole
// file — the legal text is never dropped.
export function parseLegalDoc(markdown) {
  const source = String(markdown || '').replace(/\r\n/g, '\n')
  const split = /\n-{3,}\n/.exec(source)
  const head = split ? source.slice(0, split.index) : source
  const body = split ? source.slice(split.index + split[0].length) : source

  const title = (/^#\s+(.+)$/m.exec(head) || [])[1] || ''
  const effectiveDate = (/\*\*Effective Date:\*\*\s*(.+?)\s*$/m.exec(head) || [])[1] || ''
  const lastUpdated = (/\*\*Last Updated:\*\*\s*(.+?)\s*$/m.exec(head) || [])[1] || ''
  // The entity line, minus its bold markers: "ChiefEO (operated by …)".
  const entity = (/^\*\*(.+?)\*\*\s*(\(.*\))\s*$/m.exec(head) || []).slice(1, 3).join(' ').trim()

  return {
    title,
    entity,
    effectiveDate,
    lastUpdated,
    // Only peel the preamble when it actually parsed as one; otherwise render
    // the document untouched.
    body: title ? body.trimStart() : source
  }
}

// Table of contents built from the same numbering the anchors use, so every
// entry is guaranteed to land on a real ID. Top-level sections are `## N. …`;
// subsections are either `### N.M …` (Privacy) or `**N.M …**` (ToS). Unnumbered
// headings are skipped here — they still get slug IDs, they just don't clutter
// the contents list.
export function buildToc(body) {
  const entries = []
  const seen = new Set()

  for (const raw of String(body || '').split('\n')) {
    const line = raw.trim()
    let text = null
    let depth = 0

    const heading = /^(#{2,3})\s+(.+?)\s*$/.exec(line)
    const boldSub = /^\*\*(\d+(?:\.\d+)+[^*]*?)\*\*$/.exec(line)

    if (heading) {
      text = heading[2]
      depth = heading[1].length - 2
    } else if (boldSub) {
      text = boldSub[1]
      depth = 1
    }
    if (!text) continue

    const id = sectionNumber(text)
    if (!id || seen.has(id)) continue
    seen.add(id)
    // A numbered subsection is always nested, even if it came in as a heading.
    entries.push({ id, label: text, depth: id.includes('-') ? 1 : depth })
  }

  return entries
}

// --- rehype plugin: stamp section IDs onto the rendered tree ---------------
// Runs on the hast tree so it sees the same nodes react-markdown renders.
// Headings get a numbered ID (or a slug); bold-led paragraphs get one only when
// the bold run opens with a section number.
function textOf(node) {
  if (!node) return ''
  if (node.type === 'text') return node.value
  if (!Array.isArray(node.children)) return ''
  return node.children.map(textOf).join('')
}

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

export function rehypeSectionIds() {
  return (tree) => {
    const used = new Set()

    const assign = (node, id) => {
      if (!id || used.has(id)) return
      used.add(id)
      node.properties = { ...(node.properties || {}), id }
    }

    const walk = (node) => {
      if (node.type === 'element') {
        if (HEADINGS.has(node.tagName)) {
          const text = textOf(node)
          assign(node, sectionNumber(text) || slugify(text))
        } else if (node.tagName === 'p') {
          const first = (node.children || []).find((c) => c.type === 'element' || (c.type === 'text' && c.value.trim()))
          if (first && first.type === 'element' && first.tagName === 'strong') {
            assign(node, sectionNumber(textOf(first)))
          }
        }
      }
      if (Array.isArray(node.children)) node.children.forEach(walk)
    }

    walk(tree)
  }
}
