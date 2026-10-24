import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function parseVersion(value) {
  if (!VERSION_PATTERN.test(value))
    throw new Error(`Expected a stable x.y.z version, received: ${value}`)
  const parts = value.split('.').map(Number)
  if (!parts.every(Number.isSafeInteger)) throw new Error(`Version is too large: ${value}`)
  return parts
}

function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return 0
}

/** Select a stable version using tags from this repository, never the upstream. */
export function selectReleaseVersion({ baseVersion, commit, tags, requestedTag }) {
  parseVersion(baseVersion)
  if (!commit) throw new Error('The source commit is required.')
  const stableTags = tags
    .filter(({ name }) => name.startsWith('v') && VERSION_PATTERN.test(name.slice(1)))
    .map((tag) => ({ ...tag, version: tag.name.slice(1) }))
    .sort((a, b) => compareVersions(b.version, a.version))

  if (requestedTag) {
    if (!requestedTag.startsWith('v')) throw new Error('Release tags must start with v.')
    const version = requestedTag.slice(1)
    parseVersion(version)
    const existing = stableTags.find(({ name }) => name === requestedTag)
    if (existing && existing.commit !== commit)
      throw new Error(`${requestedTag} belongs to another commit.`)
    return { version, tag: requestedTag }
  }

  // Reruns, manual dispatches, and a tag push for the same source commit reuse
  // its release rather than producing multiple versions of identical source.
  const sameCommit = stableTags.find((tag) => tag.commit === commit)
  if (sameCommit) return { version: sameCommit.version, tag: sameCommit.name }

  const highest = stableTags[0]?.version
  if (!highest || compareVersions(baseVersion, highest) > 0) {
    return { version: baseVersion, tag: `v${baseVersion}` }
  }

  const [major, minor, patch] = parseVersion(highest)
  if (!Number.isSafeInteger(patch + 1))
    throw new Error('The patch version cannot be incremented safely.')
  const version = `${major}.${minor}.${patch + 1}`
  return { version, tag: `v${version}` }
}

function main() {
  const baseVersion = JSON.parse(readFileSync('package.json', 'utf8')).version
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  // Dereference annotated tags so both annotated and lightweight tags match HEAD.
  const refs = execFileSync(
    'git',
    ['for-each-ref', '--format=%(refname:short)|%(objectname)|%(*objectname)', 'refs/tags/v*'],
    { encoding: 'utf8' },
  )
  const tags = refs
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name, object, peeled] = line.split('|')
      return { name, commit: peeled || object }
    })
  const requestedTag = process.env.GITHUB_REF?.startsWith('refs/tags/')
    ? process.env.GITHUB_REF.slice('refs/tags/'.length)
    : undefined
  const result = selectReleaseVersion({ baseVersion, commit, tags, requestedTag })
  console.log(`Release ${result.tag} from ${commit}`)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\ntag=${result.tag}\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
