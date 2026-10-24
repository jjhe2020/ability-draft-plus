import assert from 'node:assert/strict'
import test from 'node:test'
import { selectReleaseVersion } from './release-version.mjs'

const select = (changes = {}) =>
  selectReleaseVersion({ baseVersion: '3.2.1', commit: 'new', tags: [], ...changes })

test('the first private release uses the package base version', () => {
  assert.deepEqual(select(), { version: '3.2.1', tag: 'v3.2.1' })
})

test('a later commit increments the highest used patch numerically', () => {
  assert.deepEqual(
    select({
      tags: [
        { name: 'v3.2.9', commit: 'old' },
        { name: 'v3.2.10', commit: 'older' },
      ],
    }),
    { version: '3.2.11', tag: 'v3.2.11' },
  )
})

test('a newer explicit base version starts a new version series', () => {
  assert.equal(
    select({ baseVersion: '3.3.0', tags: [{ name: 'v3.2.5', commit: 'old' }] }).version,
    '3.3.0',
  )
})

test('rerunning the same source commit reuses its tag', () => {
  assert.deepEqual(
    select({
      tags: [
        { name: 'v3.2.2', commit: 'new' },
        { name: 'v3.2.3', commit: 'later' },
      ],
    }),
    { version: '3.2.2', tag: 'v3.2.2' },
  )
})

test('a stable tag push supplies the actual packaged version', () => {
  assert.equal(
    select({ requestedTag: 'v4.0.0', tags: [{ name: 'v4.0.0', commit: 'new' }] }).version,
    '4.0.0',
  )
})

test('a tag from another commit cannot be reused', () => {
  assert.throws(
    () => select({ requestedTag: 'v3.2.2', tags: [{ name: 'v3.2.2', commit: 'old' }] }),
    /another commit/,
  )
})

test('unrelated and prerelease tags do not consume stable versions', () => {
  assert.equal(
    select({
      tags: [
        { name: 'test', commit: 'old' },
        { name: 'v9.0.0-beta.1', commit: 'old' },
      ],
    }).version,
    '3.2.1',
  )
})

test('invalid and unsafe versions fail before a release is allocated', () => {
  for (const baseVersion of ['3.2', '03.2.1', '3.2.1-beta', '3.2.9007199254740992']) {
    assert.throws(() => select({ baseVersion }))
  }
  assert.throws(() => select({ requestedTag: 'vlatest' }))
  assert.throws(() => select({ requestedTag: '3.2.2' }))
  assert.throws(() => select({ commit: '' }))
  assert.throws(() => select({ tags: [{ name: 'v3.2.9007199254740991', commit: 'old' }] }))
})
