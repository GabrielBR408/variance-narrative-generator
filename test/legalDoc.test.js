// Legal page anchor/TOC tests — runs on Node's built-in runner (`node --test`).
// The section IDs are a cross-tool contract, not cosmetics: the Phase 1 Claude
// API disclosure links to /tos#5-2 and the Phase 2 privacy copy links to
// /privacy#7-2. Those two anchors are asserted against the real markdown so a
// reworded heading or a renumbered section can't silently break the deep links.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { sectionNumber, slugify, parseLegalDoc, buildToc, rehypeSectionIds } from '../src/lib/legalDoc.js'

const read = (name) =>
  readFileSync(fileURLToPath(new URL(`../src/content/${name}`, import.meta.url)), 'utf8')

const TOS = read('terms-of-service.md')
const PRIVACY = read('privacy-policy.md')

test('section numbers map N.M -> N-M', () => {
  assert.equal(sectionNumber('5.2 Claude API (VNG, Owner Report Generator Narratives, Inspector)'), '5-2')
  assert.equal(sectionNumber('7.2 ChiefEO Next'), '7-2')
  assert.equal(sectionNumber('12. ACCESSIBILITY'), '12')
  assert.equal(sectionNumber('Client-Side Tools (VNG)'), null)
})

test('unnumbered headings fall back to a text slug', () => {
  assert.equal(slugify('Server-Based Tools (ChiefEO Next, Inspector Feedback)'), 'server-based-tools-chiefeo-next-inspector-feedback')
})

test('preamble yields title, entity and both dates', () => {
  for (const [name, md] of [['ToS', TOS], ['Privacy', PRIVACY]]) {
    const doc = parseLegalDoc(md)
    assert.ok(doc.title, `${name} title`)
    assert.match(doc.entity, /Golden Real Estate Ventures and Exchanges LLC/, `${name} entity`)
    assert.ok(doc.effectiveDate, `${name} effective date`)
    assert.ok(doc.lastUpdated, `${name} last updated`)
    // The body keeps the legal text verbatim — only the preamble is peeled off.
    assert.ok(!doc.body.startsWith('#' + ' '), `${name} body starts after the H1`)
    assert.ok(doc.body.includes('## 1.'), `${name} body retains section 1`)
  }
})

test('a malformed document renders whole rather than losing text', () => {
  const doc = parseLegalDoc('Some legal text with no preamble.')
  assert.equal(doc.body, 'Some legal text with no preamble.')
})

test('table of contents covers the deep-linked sections', () => {
  const tosToc = buildToc(parseLegalDoc(TOS).body)
  const privacyToc = buildToc(parseLegalDoc(PRIVACY).body)

  assert.ok(tosToc.some((e) => e.id === '5'), 'ToS §5 in contents')
  assert.ok(tosToc.some((e) => e.id === '5-2' && e.depth === 1), 'ToS §5.2 nested in contents')
  assert.ok(privacyToc.some((e) => e.id === '7'), 'Privacy §7 in contents')
  assert.ok(privacyToc.some((e) => e.id === '7-2' && e.depth === 1), 'Privacy §7.2 nested in contents')

  // IDs are unique — duplicate anchors would make a deep link ambiguous.
  for (const toc of [tosToc, privacyToc]) {
    assert.equal(new Set(toc.map((e) => e.id)).size, toc.length)
  }
})

// Minimal hast stand-ins: the plugin only reads tagName/children/type.
const el = (tagName, children) => ({ type: 'element', tagName, properties: {}, children })
const txt = (value) => ({ type: 'text', value })

test('rehype plugin stamps IDs on headings and bold-led subsections', () => {
  const tree = {
    type: 'root',
    children: [
      el('h2', [txt('5. DATA SECURITY & THIRD-PARTY DISCLOSURE')]),
      el('h3', [txt('Client-Side Tools (VNG, Owner Report Generator, GL Down Driller)')]),
      el('p', [el('strong', [txt('5.2 Claude API (VNG, Owner Report Generator Narratives, Inspector)')])]),
      el('p', [el('strong', [txt('⚠️ IMPORTANT: Do not include in Claude API inputs:')])]),
      el('h3', [txt('7.2 ChiefEO Next')])
    ]
  }
  rehypeSectionIds()(tree)

  const ids = tree.children.map((n) => n.properties.id)
  assert.deepEqual(ids, [
    '5',
    'client-side-tools-vng-owner-report-generator-gl-down-driller',
    '5-2',
    undefined, // unnumbered emphasis is body copy, not a section
    '7-2'
  ])
})
