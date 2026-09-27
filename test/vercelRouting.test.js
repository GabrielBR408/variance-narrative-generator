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

test('private book host rewrites both the bare root and nested paths', () => {
  const rootIndex = config.rewrites.findIndex(
    (rule) =>
      rule.source === '/' &&
      isBookHostRule(rule) &&
      rule.destination === 'https://promptbook.californialandguide.com/',
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

  assert.ok(rootIndex >= 0, 'missing book-host rewrite for the bare root')
  assert.ok(pathIndex >= 0, 'missing book-host rewrite for nested paths')
  assert.ok(rootIndex < spaFallbackIndex)
  assert.ok(pathIndex < spaFallbackIndex)
})
