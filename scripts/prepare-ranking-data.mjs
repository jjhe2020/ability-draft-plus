/**
 * Build the standalone GGXGG ranking site's public data and local Valve icons.
 * Run from any directory: node scripts/prepare-ranking-data.mjs
 *
 * Import a downloaded Windrun response with --input <abilities.json>.
 * Without --input, prefer live Windrun, then the last imported response,
 * then the exact Excel snapshot checked in as a regression fixture.
 * Never replace missing statistics with estimates, and never remove hero or
 * unknown-static rows from the formula's normalization population.
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import initSqlJs from 'sql.js'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const site = join(root, 'sites', 'ggxgg-ranking')
const dist = join(site, 'dist')
const cache = join(site, 'source-data')
const output = join(dist, 'data')
const icons = join(dist, 'assets', 'icons')
const heroIcons = join(dist, 'assets', 'heroes')
const WINDRUN = 'https://api.windrun.io/api/v2/'
const VALVE_ABILITY_URL = 'https://www.dota2.com/datafeed/abilitylist?language=schinese'
const VALVE_HERO_URL = 'https://www.dota2.com/datafeed/herolist?language=schinese'
const ICON_BASE = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/abilities/'
const HERO_ICON_BASE = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/icons/'
const fetchedAt = new Date().toISOString()
const { values: options } = parseArgs({ options: { input: { type: 'string' } } })
for (const directory of [cache, output, icons, heroIcons]) await mkdir(directory, { recursive: true })

function validateAbilitiesResponse(response) {
  const rows = response?.data?.abilityStats
  if (!Array.isArray(rows) || !rows.length) throw new Error('Windrun returned no ability population')
  if (!Array.isArray(response.data.patches?.overall)
    || !response.data.patches.overall.length
    || response.data.patches.overall.some((patch) => typeof patch !== 'string' || !patch.trim())) {
    throw new Error('Invalid Windrun patches.overall metadata')
  }
  const ids = new Set()
  for (const row of rows) {
    if (!Number.isSafeInteger(row.abilityId) || row.abilityId === 0 || ids.has(row.abilityId)) {
      throw new Error(`Invalid or duplicate Windrun ability ID: ${row.abilityId}`)
    }
    ids.add(row.abilityId)
    if (![row.winrate, row.pickRate, row.avgPickPosition, row.numPicks].every(Number.isFinite)
      || row.winrate < 0 || row.winrate > 1 || row.pickRate < 0 || row.pickRate > 1
      || row.avgPickPosition < 0 || row.numPicks < 0) {
      throw new Error(`Invalid Windrun statistics for ability ${row.abilityId}`)
    }
    if (!Number.isSafeInteger(row.numPicks) || !Number.isSafeInteger(row.wins)
      || row.wins < 0 || row.wins > row.numPicks
      || (row.ignored != null && (!Number.isSafeInteger(row.ignored) || row.ignored < 0))) {
      throw new Error(`Invalid Windrun game counts for ability ${row.abilityId}`)
    }
  }
  const updated = response.data._lastUpdated
  if (updated != null && !Number.isFinite(new Date(updated).getTime())) {
    throw new Error('Invalid Windrun _lastUpdated timestamp')
  }
  return response
}

async function readImportedSnapshot(path, info) {
  const bytes = await readFile(path)
  const abilities = validateAbilitiesResponse(JSON.parse(bytes.toString('utf8')))
  const sourceSha256 = createHash('sha256').update(bytes).digest('hex')
  if (info?.sourceSha256 && info.sourceSha256 !== sourceSha256) {
    throw new Error('Saved Windrun import does not match its source checksum')
  }
  return { abilities, bytes, info: { ...info, sourceSha256 } }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${new URL(url).pathname}`)
  if (!(response.headers.get('content-type') ?? '').includes('json')) {
    throw new Error(`Expected JSON from ${new URL(url).pathname}`)
  }
  return response.json()
}

async function cachedValveFeed(url, filename) {
  const path = join(cache, filename)
  try {
    const data = await fetchJson(url)
    await writeFile(path, JSON.stringify(data))
    return data
  } catch (error) {
    try {
      const data = JSON.parse(await readFile(path, 'utf8'))
      console.log(`Valve feed unavailable; using saved public metadata: ${filename}`)
      return data
    } catch {
      throw error
    }
  }
}

// This is the app's exact formula engine, transpiled rather than reimplemented.
const engineSource = await readFile(join(root, 'src/shared/ability-priority.ts'), 'utf8')
const engineHash = createHash('sha256').update(engineSource).digest('hex')
const compiled = ts.transpileModule(engineSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  reportDiagnostics: true,
})
if (compiled.diagnostics?.some((item) => item.category === ts.DiagnosticCategory.Error)) {
  throw new Error('Cannot transpile the shared priority engine')
}
const enginePath = join(output, 'formula-engine.js')
await writeFile(enginePath, `// Generated from src/shared/ability-priority.ts; sha256 ${engineHash}\n${compiled.outputText}`)
const { calculateAbilityPriorities, DEFAULT_ABILITY_PRIORITY } = await import(
  `${pathToFileURL(enginePath).href}?build=${Date.now()}`
)
const catalog = JSON.parse(await readFile(join(root, 'src/shared/localization/dota-names.zh-CN.json'), 'utf8'))

// Public seed metadata is sufficient to join owner hero and ultimate flags.
// No personal app database or configuration is read or copied into this site.
const SQL = await initSqlJs()
const db = new SQL.Database(await readFile(join(root, 'resources/dota_ad_data.db')))
const seedResult = db.exec(`
  SELECT a.name, a.is_ultimate, h.name, h.display_name
  FROM Abilities a LEFT JOIN Heroes h ON a.hero_id = h.hero_id
`)[0]
const seedAbilities = new Map(seedResult.values.map(([name, isUltimate, heroName, heroEnglishName]) => [
  name, { isUltimate: Boolean(isUltimate), heroName, heroEnglishName },
]))
db.close()

let windrun
let fallbackReason
let imported
if (options.input) {
  imported = await readImportedSnapshot(resolve(options.input), {
    sourceFilename: basename(options.input), importedAt: fetchedAt,
  })
  // Rebuilding the same public snapshot must retain its original import date.
  try {
    const previous = JSON.parse(await readFile(join(cache, 'windrun-import-info.json'), 'utf8'))
    if (previous.sourceSha256 === imported.info.sourceSha256) {
      imported.info = { ...previous, sourceSha256: imported.info.sourceSha256 }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await writeFile(join(cache, 'windrun-abilities.json'), imported.bytes)
  await writeFile(join(cache, 'windrun-import-info.json'), `${JSON.stringify(imported.info, null, 2)}\n`)
} else try {
  const [abilities, staticAbilities, staticHeroes, patches] = await Promise.all([
    fetchJson(`${WINDRUN}abilities`),
    fetchJson(`${WINDRUN}static/abilities`),
    fetchJson(`${WINDRUN}static/heroes`),
    fetchJson(`${WINDRUN}static/patches`),
  ])
  validateAbilitiesResponse(abilities)
  if (!Array.isArray(staticAbilities.data) || !staticHeroes.data || !Array.isArray(patches.data)) {
    throw new Error('Windrun static metadata has an unexpected structure')
  }
  windrun = { abilities, staticAbilities, staticHeroes, patches }
  await writeFile(join(cache, 'windrun-snapshot.json'), JSON.stringify({ fetchedAt, ...windrun }))
} catch (error) {
  fallbackReason = error.message
  try {
    const info = JSON.parse(await readFile(join(cache, 'windrun-import-info.json'), 'utf8'))
    imported = await readImportedSnapshot(join(cache, 'windrun-abilities.json'), info)
    console.log(`Windrun unavailable (${fallbackReason}); using the last imported Windrun response.`)
  } catch (cacheError) {
    if (cacheError.code !== 'ENOENT') throw cacheError
    console.log(`Windrun unavailable (${fallbackReason}); using the exact Excel reference snapshot.`)
  }
}

const [valveAbilitiesResponse, valveHeroesResponse] = await Promise.all([
  cachedValveFeed(VALVE_ABILITY_URL, 'valve-abilities.zh-CN.json'),
  cachedValveFeed(VALVE_HERO_URL, 'valve-heroes.zh-CN.json'),
])
const valveAbilities = new Map(valveAbilitiesResponse.result.data.itemabilities.map((item) => [item.id, item]))
const valveHeroes = new Map(valveHeroesResponse.result.data.heroes.map((item) => [item.id, item]))
const valveHeroByFlatName = new Map([...valveHeroes.values()].map((item) => [
  item.name.replace(/^npc_dota_hero_/, '').replace(/_/g, ''), item,
]))
const staticAbilities = new Map((windrun?.staticAbilities.data ?? []).map((item) => [item.valveId, item]))
const staticHeroes = windrun?.staticHeroes.data ?? {}
const heroCandidates = [...valveHeroes.values()].sort((a, b) => b.name.length - a.name.length)
const reference = JSON.parse(await readFile(join(root, 'tests/fixtures/ggxgg-reference.json'), 'utf8'))
const response = imported?.abilities ?? windrun?.abilities
const rawRows = response
  ? response.data.abilityStats
  : reference.rows.map(([abilityId, winrate, avgPickPosition, pickRate]) => ({
      abilityId, winrate, avgPickPosition, pickRate, numPicks: null,
    }))

function getName(id) {
  return id < 0
    ? `hero:${id}`
    : staticAbilities.get(id)?.shortName ?? valveAbilities.get(id)?.name ?? `ability:${id}`
}
const population = rawRows.map((row) => ({
  name: getName(row.abilityId),
  winrate: row.winrate ?? null,
  pickRate: row.avgPickPosition ?? null,
  draftFrequency: row.pickRate ?? null,
}))
if (new Set(population.map((row) => row.name)).size !== population.length) {
  throw new Error('Duplicate population keys would make priorities ambiguous')
}
const result = calculateAbilityPriorities(population, DEFAULT_ABILITY_PRIORITY)
let maxReferenceDifference = null
if (!response) {
  maxReferenceDifference = Math.max(...reference.rows.map(([id, , , , expected]) =>
    Math.abs(result.priorities.get(getName(id)) - expected)))
  if (maxReferenceDifference > 1e-9) {
    throw new Error(`Excel formula regression: maximum difference ${maxReferenceDifference}`)
  }
}

const abilities = rawRows.filter((row) => row.abilityId > 0).map((row) => {
  const id = row.abilityId
  const staticAbility = staticAbilities.get(id)
  const valve = valveAbilities.get(id)
  const name = getName(id)
  const seed = seedAbilities.get(name)
  const staticHero = staticHeroes[String(staticAbility?.ownerHeroId ?? row.ownerHero)]
  const ownerFromName = heroCandidates.find((hero) => name.startsWith(`${hero.name.replace(/^npc_dota_hero_/, '')}_`))
  const valveHero = valveHeroes.get(staticAbility?.ownerHeroId ?? row.ownerHero)
    ?? valveHeroByFlatName.get((seed?.heroName ?? staticHero?.shortName ?? '').replace(/_/g, ''))
    ?? ownerFromName
  const heroName = valveHero?.name.replace(/^npc_dota_hero_/, '') ?? seed?.heroName ?? staticHero?.shortName ?? ''
  const englishName = staticAbility?.englishName ?? valve?.name_english_loc ?? catalog.abilities[name]?.en ?? name
  const displayName = catalog.abilities[name]?.['zh-CN']
    ?? catalog.abilities[name.replace(/_ad$/, '')]?.['zh-CN']
    ?? valve?.name_loc
    ?? `未收录技能 ${id}`
  const heroDisplayName = catalog.heroes[heroName]?.['zh-CN']
    ?? valveHero?.name_loc
    ?? '未知英雄'
  return {
    id, name, displayName, englishName, heroName, heroDisplayName,
    isHero: false,
    isUltimate: staticAbility?.isUltimate ?? seed?.isUltimate ?? false,
    icon: `./assets/icons/${name}.webp`,
    winrate: row.winrate ?? null,
    pickRate: row.avgPickPosition ?? null,
    draftFrequency: row.pickRate ?? null,
    numPicks: row.numPicks ?? null,
    priority: result.priorities.get(name) ?? null,
  }
}).sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity) || a.id - b.id)

// Windrun encodes hero models as negative ability IDs. Keep their population
// keys unchanged and display the same values used by the shared formula.
const heroes = rawRows.filter((row) => row.abilityId < 0).map((row) => {
  const id = row.abilityId
  const valveHero = valveHeroes.get(-id)
  if (!valveHero) throw new Error(`Missing official hero metadata for Windrun ID ${id}`)
  const heroName = valveHero.name.replace(/^npc_dota_hero_/, '')
  const name = getName(id)
  const displayName = catalog.heroes[heroName]?.['zh-CN'] ?? valveHero.name_loc
  if (!displayName || !/[\u3400-\u9fff]/.test(displayName)) {
    throw new Error(`Missing Chinese hero name for Windrun ID ${id}`)
  }
  return {
    id, name, heroName, displayName,
    englishName: valveHero.name_english_loc ?? catalog.heroes[heroName]?.en ?? heroName,
    heroDisplayName: displayName,
    isHero: true,
    isUltimate: false,
    icon: `./assets/heroes/${heroName}.webp`,
    winrate: row.winrate ?? null,
    pickRate: row.avgPickPosition ?? null,
    draftFrequency: row.pickRate ?? null,
    numPicks: row.numPicks ?? null,
    priority: result.priorities.get(name) ?? null,
  }
}).sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity) || a.id - b.id)

const failures = []
let completed = 0
async function downloadIcon(item) {
  const isHero = item.isHero === true
  const iconName = isHero ? item.heroName : item.name
  const target = join(isHero ? heroIcons : icons, `${iconName}.webp`)
  try {
    await access(target)
    const metadata = await sharp(target).metadata()
    if (metadata.width === 128 && metadata.height === 128 && metadata.format === 'webp') return
  } catch { /* Download or repair missing and invalid images. */ }
  const candidates = isHero ? [iconName] : [...new Set([iconName, iconName.replace(/_ad$/, '')])]
  let error
  for (const name of candidates) {
    try {
      const response = await fetch(`${isHero ? HERO_ICON_BASE : ICON_BASE}${name}.png`, { signal: AbortSignal.timeout(20_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      await sharp(bytes).resize(128, 128).webp({ quality: 88 }).toFile(target)
      return
    } catch (problem) { error = problem }
  }
  failures.push({ name: item.name, error: error?.message })
}
const queue = [...abilities, ...heroes]
await Promise.all(Array.from({ length: 12 }, async () => {
  while (queue.length) {
    const item = queue.shift()
    await downloadIcon(item)
    if (++completed % 100 === 0) console.log(`Verified local ability and hero icons: ${completed}/${abilities.length + heroes.length}`)
  }
}))
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2))
  throw new Error(`${failures.length} ability or hero icons could not be bundled`)
}

const patchValues = response?.data.patches?.overall ?? []
const patch = response ? patchValues.join(' / ') || windrun?.patches.data[0] || '未标注版本' : '7.41d'
const sourceUpdatedAt = response?.data._lastUpdated
  ? new Date(response.data._lastUpdated).toISOString() : null
const dataAsOf = sourceUpdatedAt
  ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(sourceUpdatedAt))
  : response ? null : '2026-07-04'
const meta = {
  patch,
  label: response ? `Windrun · ${patch}` : '参考表快照 · 7.41d / 0704',
  sourceLabel: imported ? 'Windrun · JSON 导入' : windrun ? 'Windrun API' : 'Excel 参考表 · Windrun 历史快照',
  sourceKind: imported ? 'windrun-import' : windrun ? 'windrun-live' : 'excel-reference',
  sourceNote: imported
    ? '统计来自你提供的 Windrun abilities.json；按完整技能与英雄模型总体重算，中文名称与图标来自 Valve。'
    : windrun
    ? '统计来自 Windrun 全量技能与英雄模型；中文名称与图标来自 Valve。'
    : 'Windrun API 当前未能读取，展示你提供的 Excel 中 7.41d / 0704 历史快照；不是当前版本实时排名。',
  sourceUrl: 'https://windrun.io/abilities',
  sourceApiUrl: `${WINDRUN}abilities`,
  localizationUrl: VALVE_ABILITY_URL,
  iconSourceUrl: ICON_BASE,
  heroIconSourceUrl: HERO_ICON_BASE,
  fetchedAt,
  sourceUpdatedAt,
  sourceFilename: imported?.info.sourceFilename ?? null,
  sourceSha256: imported?.info.sourceSha256 ?? null,
  importedAt: imported?.info.importedAt ?? null,
  dataAsOf,
  snapshot: response ? patch : reference.source.snapshot,
  abilityCount: abilities.length,
  heroCount: rawRows.filter((row) => row.abilityId < 0).length,
  heroModelCount: heroes.length,
  populationCount: population.length,
  validPopulationCount: result.count,
  formulaEngineSha256: engineHash,
  formulaSource: 'src/shared/ability-priority.ts',
  referenceWorkbook: response ? null : reference.source.workbook,
  referenceSheet: response ? null : reference.source.sheet,
  referenceMaxDifference: maxReferenceDifference,
  units: { winrate: 'fraction', pickRate: 'average-pick-position', draftFrequency: 'fraction' },
}
const dataset = { meta, defaultSettings: DEFAULT_ABILITY_PRIORITY, population, abilities, heroes }
await writeFile(join(output, 'ranking.json'), `${JSON.stringify(dataset)}\n`)
console.log(JSON.stringify({
  source: meta.sourceKind, patch, abilities: abilities.length, heroes: heroes.length,
  population: population.length, localIcons: completed,
  referenceMaxDifference: maxReferenceDifference,
  output: join(output, 'ranking.json'),
}, null, 2))
