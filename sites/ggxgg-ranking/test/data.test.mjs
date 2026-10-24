import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import {
  DEFAULT_ABILITY_PRIORITY,
  calculateAbilityPriorities,
} from '../dist/data/formula-engine.js'
import { rankEntries, selectEntries } from '../dist/data/ranking-model.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const data = JSON.parse(await readFile(resolve(root, 'dist/data/ranking.json'), 'utf8'))
const allDisplayedRows = () => [...data.abilities, ...data.heroes]

async function assertBundledWebp(icon, directory, name) {
  assert.match(icon, new RegExp(`^\\./assets/${directory}/[a-z0-9_]+\\.webp$`))
  const file = resolve(root, 'dist', icon)
  assert.ok((await stat(file)).size > 50, name)
  const bytes = await readFile(file)
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF', name)
  assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP', name)
}

test('display rows have usable Chinese names, real statistics and bundled icons', async () => {
  assert.ok(data.abilities.length > 400)
  assert.equal(data.population.length, data.meta.populationCount)
  assert.equal(data.abilities.length, data.meta.abilityCount)
  assert.equal(new Set(data.abilities.map((row) => row.id)).size, data.abilities.length)
  for (const row of data.abilities) {
    assert.match(row.displayName, /[\u3400-\u9fff]/)
    assert.doesNotMatch(row.displayName, /未收录技能/)
    assert.ok(row.winrate >= 0 && row.winrate <= 1)
    assert.ok(row.draftFrequency >= 0 && row.draftFrequency <= 1)
    assert.ok(Number.isFinite(row.priority))
    assert.match(row.icon, /^(?:\.\/)?assets\/icons\/[a-z0-9_]+\.(?:png|svg|webp)$/)
    const file = resolve(root, 'dist', row.icon)
    assert.ok((await stat(file)).size > 50, row.name)
    if (file.endsWith('.png')) {
      const bytes = await readFile(file)
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', row.name)
    } else if (file.endsWith('.webp')) {
      const bytes = await readFile(file)
      assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF', row.name)
      assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP', row.name)
    }
  }
})

test('hero models map every negative Windrun ID once, with Chinese names and bundled portraits', async () => {
  assert.ok(Array.isArray(data.heroes))
  assert.equal(data.heroes.length, data.meta.heroCount)
  assert.equal(
    data.heroes.length,
    data.population.filter((row) => row.name.startsWith('hero:')).length,
  )
  assert.equal(data.abilities.length + data.heroes.length, data.population.length)
  assert.equal(new Set(data.heroes.map((row) => row.id)).size, data.heroes.length)
  assert.equal(new Set(allDisplayedRows().map((row) => row.name)).size, data.population.length)
  const valve = JSON.parse(
    await readFile(resolve(root, 'source-data/valve-heroes.zh-CN.json'), 'utf8'),
  )
  const valveHeroes = new Map(valve.result.data.heroes.map((row) => [row.id, row]))
  const population = new Map(data.population.map((row) => [row.name, row]))
  for (const row of data.heroes) {
    assert.ok(Number.isSafeInteger(row.id) && row.id < 0)
    assert.equal(row.name, `hero:${row.id}`)
    assert.equal(row.isHero, true)
    assert.match(row.displayName, /[\u3400-\u9fff]/)
    assert.doesNotMatch(row.displayName, /未知|未收录/)
    assert.ok(valveHeroes.has(-row.id), row.name)
    assert.equal(row.heroName, valveHeroes.get(-row.id).name.replace(/^npc_dota_hero_/, ''))
    const normalized = population.get(row.name)
    assert.ok(normalized, row.name)
    assert.equal(row.winrate, normalized.winrate)
    assert.equal(row.pickRate, normalized.pickRate)
    assert.equal(row.draftFrequency, normalized.draftFrequency)
    assert.ok(row.numPicks === null || (Number.isInteger(row.numPicks) && row.numPicks >= 0))
    assert.ok(Number.isFinite(row.priority), row.name)
    assert.equal(row.icon, `./assets/heroes/${row.heroName}.webp`)
    await assertBundledWebp(row.icon, 'heroes', row.name)
  }
})

test('imported Windrun response is preserved exactly and all rows reach the ranking population', async () => {
  if (data.meta.sourceKind !== 'windrun-import') return
  const bytes = await readFile(resolve(root, 'source-data/windrun-abilities.json'))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), data.meta.sourceSha256)
  const source = JSON.parse(bytes.toString('utf8')).data
  assert.equal(data.meta.patch, source.patches.overall.join(' / '))
  assert.equal(data.meta.sourceUpdatedAt, new Date(source._lastUpdated).toISOString())
  assert.equal(data.population.length, source.abilityStats.length)
  assert.equal(data.meta.heroCount, source.abilityStats.filter((row) => row.abilityId < 0).length)
  const abilities = new Map(data.abilities.map((row) => [row.id, row]))
  const heroes = new Map(data.heroes.map((row) => [row.id, row]))
  const population = new Map(data.population.map((row) => [row.name, row]))
  for (const raw of source.abilityStats) {
    const row = raw.abilityId > 0 ? abilities.get(raw.abilityId) : heroes.get(raw.abilityId)
    assert.ok(row, String(raw.abilityId))
    const normalized = population.get(row.name)
    assert.ok(normalized, String(raw.abilityId))
    assert.equal(normalized.winrate, raw.winrate)
    assert.equal(normalized.pickRate, raw.avgPickPosition)
    assert.equal(normalized.draftFrequency, raw.pickRate)
    assert.equal(row.winrate, raw.winrate)
    assert.equal(row.pickRate, raw.avgPickPosition)
    assert.equal(row.draftFrequency, raw.pickRate)
    assert.equal(row.numPicks, raw.numPicks)
  }
})

test('website rankings use the full population and the same formula as the desktop app', () => {
  const result = calculateAbilityPriorities(data.population, DEFAULT_ABILITY_PRIORITY)
  assert.ok(data.population.some((row) => row.name.startsWith('hero:')))
  assert.equal(result.count, data.population.length)
  for (const row of allDisplayedRows()) {
    assert.ok(Math.abs(result.priorities.get(row.name) - row.priority) < 1e-9, row.name)
  }
  if (data.meta.dataAsOf === '2026-07-04') {
    assert.equal(data.population.length, 631)
    for (const [id, expected] of [
      [7842, -19.4461790362961],
      [5025, -8.32616288863724],
      [5186, 30.8368476808692],
    ]) {
      assert.ok(Math.abs(data.abilities.find((row) => row.id === id).priority - expected) < 1e-9)
    }
  }
})

test('adding models to the total pool preserves the relative order of all 513 skills', () => {
  if (data.meta.sourceSha256 !== '5b0c588831c0e5f2f7aff9e0304c44ff3c67871136647864fcbca811bbd35606')
    return
  assert.equal(data.abilities.length, 513)
  assert.equal(data.heroes.length, 127)
  assert.equal(data.population.length, 640)
  const order = createHash('sha256')
    .update(JSON.stringify(data.abilities.map((row) => row.id)))
    .digest('hex')
  assert.equal(order, '33a0e0e2239cd28fc74f91e203d4fb2e81e4f88a96c622993cf71ebd8aaab533')
  const result = calculateAbilityPriorities(data.population, DEFAULT_ABILITY_PRIORITY)
  const mixed = rankEntries(allDisplayedRows(), result.priorities)
  assert.deepEqual(
    selectEntries(mixed, { type: 'skills' }).map((row) => row.id),
    data.abilities.map((row) => row.id),
  )
})

test('the default draft pool ranks skills and hero models together', () => {
  const priorities = calculateAbilityPriorities(
    data.population,
    DEFAULT_ABILITY_PRIORITY,
  ).priorities
  const before = JSON.stringify(allDisplayedRows())
  const ranked = rankEntries(allDisplayedRows(), priorities)
  assert.equal(ranked.length, data.population.length)
  assert.deepEqual(
    ranked.map((row) => row.rank),
    ranked.map((_, index) => index + 1),
  )
  assert.equal(JSON.stringify(allDisplayedRows()), before)
  if (
    data.meta.sourceSha256 === '5b0c588831c0e5f2f7aff9e0304c44ff3c67871136647864fcbca811bbd35606'
  ) {
    assert.deepEqual(
      ranked.slice(0, 5).map((row) => row.id),
      [5025, 5651, -25, 5290, 5250],
    )
    assert.deepEqual(
      selectEntries(ranked, { type: 'heroes' })
        .slice(0, 5)
        .map((row) => [row.id, row.rank]),
      [
        [-25, 3],
        [-11, 17],
        [-76, 18],
        [-6, 21],
        [-60, 52],
      ],
    )
    for (const [type, count] of [
      ['all', 640],
      ['skills', 513],
      ['normal', 391],
      ['ultimate', 122],
      ['heroes', 127],
    ]) {
      assert.equal(selectEntries(ranked, { type }).length, count, type)
    }
  }
})

test('type filters, text search, hero filters and column sorting preserve overall ranks', () => {
  const priorities = calculateAbilityPriorities(
    data.population,
    DEFAULT_ABILITY_PRIORITY,
  ).priorities
  const ranked = rankEntries(allDisplayedRows(), priorities)
  const ranks = new Map(ranked.map((row) => [row.name, row.rank]))
  for (const [type, accepts] of [
    ['heroes', (row) => row.isHero],
    ['skills', (row) => !row.isHero],
    ['normal', (row) => !row.isHero && !row.isUltimate],
    ['ultimate', (row) => !row.isHero && row.isUltimate],
  ]) {
    const selected = selectEntries(ranked, { type })
    assert.ok(selected.length > 0)
    assert.equal(selected.length, ranked.filter(accepts).length)
    assert.ok(selected.every(accepts))
    assert.ok(selected.every((row) => row.rank === ranks.get(row.name)))
  }
  for (const options of [
    { query: '莉娜' },
    { query: 'arctic' },
    { hero: 'lina' },
    { type: 'heroes', sort: 'winrate', direction: 'desc' },
    { type: 'normal', sort: 'pickRate', direction: 'desc' },
  ]) {
    const selected = selectEntries(ranked, options)
    assert.ok(selected.length > 0, JSON.stringify(options))
    assert.ok(selected.every((row) => row.rank === ranks.get(row.name)))
    if (options.hero) assert.ok(selected.every((row) => row.heroName === options.hero))
    if (options.sort)
      assert.ok(
        selected.every(
          (row, index) => index === 0 || selected[index - 1][options.sort] >= row[options.sort],
        ),
      )
  }
})

test('changing formula changes ranking without modifying source statistics', () => {
  const before = JSON.stringify(data.population)
  const first = calculateAbilityPriorities(data.population, {
    ...DEFAULT_ABILITY_PRIORITY,
    formula: 'winrate',
  }).priorities
  const second = calculateAbilityPriorities(data.population, {
    ...DEFAULT_ABILITY_PRIORITY,
    formula: '-winrate',
  }).priorities
  const firstRanked = rankEntries(allDisplayedRows(), first)
  const secondRanked = rankEntries(allDisplayedRows(), second)
  for (const type of ['all', 'skills', 'heroes']) {
    const firstView = selectEntries(firstRanked, { type })
    const secondView = selectEntries(secondRanked, { type })
    assert.notEqual(firstView[0].name, secondView[0].name)
    assert.ok(firstView.every((row) => row.priority === first.get(row.name)))
    assert.ok(secondView.every((row) => row.priority === second.get(row.name)))
    assert.ok(
      firstView.every(
        (row) => row.rank === firstRanked.findIndex((entry) => entry.name === row.name) + 1,
      ),
    )
  }
  assert.equal(JSON.stringify(data.population), before)
})

test('custom hero priorities retain the full skill-and-model normalization population', () => {
  const config = { ...DEFAULT_ABILITY_PRIORITY, formula: 'winrate' }
  const full = calculateAbilityPriorities(data.population, config)
  const heroPopulation = data.population.filter((row) => row.name.startsWith('hero:'))
  const heroesOnly = calculateAbilityPriorities(heroPopulation, config)
  assert.equal(full.count, data.meta.populationCount)
  assert.equal(heroesOnly.count, data.heroes.length)
  assert.ok(data.heroes.every((row) => Number.isFinite(full.priorities.get(row.name))))
  assert.ok(
    data.heroes.some(
      (row) => Math.abs(full.priorities.get(row.name) - heroesOnly.priorities.get(row.name)) > 1e-6,
    ),
  )
})
