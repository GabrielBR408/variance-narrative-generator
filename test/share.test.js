// Hub share helper tests — runs on Node's built-in runner (`node --test`);
// no DOM, no extra deps. Injects fake navigator/location objects to exercise
// each branch of shareHub's decision tree:
//   • native navigator.share success            -> 'shared'
//   • native share cancelled (AbortError)        -> 'cancelled' (swallowed)
//   • native share other error -> clipboard copy -> 'copied'
//   • no share, clipboard copy succeeds          -> 'copied'
//   • clipboard write rejects                    -> 'unavailable'
//   • neither API present                        -> 'unavailable' (no throw)
//   • payload carries branded title/text + href

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { shareHub, SHARE_TITLE, SHARE_TEXT } from '../src/lib/share.js'

const loc = { href: 'https://chiefeotool.com/' }

test('uses native share sheet when available', async () => {
  let seen = null
  const nav = { share: async (p) => { seen = p } }
  const result = await shareHub(nav, loc)
  assert.equal(result, 'shared')
  assert.deepEqual(seen, {
    title: SHARE_TITLE,
    text: SHARE_TEXT,
    url: 'https://chiefeotool.com/'
  })
})

test('swallows a user-cancelled share (AbortError)', async () => {
  const nav = {
    share: async () => {
      const err = new Error('cancelled')
      err.name = 'AbortError'
      throw err
    },
    // Clipboard present but must NOT be used on a deliberate cancel.
    clipboard: { writeText: async () => { throw new Error('should not run') } }
  }
  const result = await shareHub(nav, loc)
  assert.equal(result, 'cancelled')
})

test('falls back to clipboard when share throws a non-abort error', async () => {
  let copied = null
  const nav = {
    share: async () => {
      const err = new Error('blocked')
      err.name = 'NotAllowedError'
      throw err
    },
    clipboard: { writeText: async (u) => { copied = u } }
  }
  const result = await shareHub(nav, loc)
  assert.equal(result, 'copied')
  assert.equal(copied, 'https://chiefeotool.com/')
})

test('copies to clipboard when share is unsupported', async () => {
  let copied = null
  const nav = { clipboard: { writeText: async (u) => { copied = u } } }
  const result = await shareHub(nav, loc)
  assert.equal(result, 'copied')
  assert.equal(copied, 'https://chiefeotool.com/')
})

test('reports unavailable when clipboard write rejects', async () => {
  const nav = { clipboard: { writeText: async () => { throw new Error('denied') } } }
  const result = await shareHub(nav, loc)
  assert.equal(result, 'unavailable')
})

test('degrades gracefully with neither API present', async () => {
  const result = await shareHub({}, loc)
  assert.equal(result, 'unavailable')
})

test('does not throw when navigator is missing entirely', async () => {
  const result = await shareHub(null, loc)
  assert.equal(result, 'unavailable')
})
