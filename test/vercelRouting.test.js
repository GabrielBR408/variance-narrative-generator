import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const config = JSON.parse(
  await readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
)

function isBookHostRule(rule) {
  return rule.has?.some(
    (condition) =>
      condition.type === 'host' && condition.value === 'book.chiefeotool.com',
  )
}

test('private book host redirects the bare root before proxying nested paths', () => {
  const rootRedirectIndex = config.redirects.findIndex(
    (rule) =>
      rule.source === '/' &&
      isBookHostRule(rule) &&
      rule.destination === '/remote/' &&
      rule.permanent === false,
  )
  const pathIndex = config.rewrites.findIndex(
    (rule) =>
      rule.source === '/:path*' &&
      isBookHostRule(rule) &&
      rule.destination === 'https://promptbook.californialandguide.com/:path*',
  )
  const spaFallbackIndex = config.rewrites.findIndex(
    (rule) => rule.destination === '/index.html',
  )

  assert.ok(
    rootRedirectIndex >= 0,
    'missing temporary book-host redirect for the bare root',
  )
  assert.ok(pathIndex >= 0, 'missing book-host rewrite for nested paths')
  assert.ok(pathIndex < spaFallbackIndex)
})
