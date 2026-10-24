// Refresh display-only names from Valve's official Dota 2 data feed.
// Statistics continue to come from Windrun; this catalog never changes IDs or stats.
import { writeFile } from 'node:fs/promises'

const root = new URL('../src/shared/localization/', import.meta.url)
const fetchData = async (endpoint, key) => {
  const url = `https://www.dota2.com/datafeed/${endpoint}?language=schinese`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}`)
  const payload = await response.json()
  const rows = payload.result?.data?.[key]
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${endpoint}: empty response`)
  return rows
}

const [abilities, heroes] = await Promise.all([
  fetchData('abilitylist', 'itemabilities'),
  fetchData('herolist', 'heroes'),
])
const catalog = { abilities: {}, heroes: {} }
for (const row of abilities) {
  if (row.name.startsWith('item_') || row.name.startsWith('special_bonus_')) continue
  if (!row.name_loc || !/[\u3400-\u9fff]/.test(row.name_loc)) continue
  catalog.abilities[row.name] = { en: row.name_english_loc, 'zh-CN': row.name_loc }
}
for (const row of heroes) {
  const name = row.name.replace(/^npc_dota_hero_/, '')
  catalog.heroes[name] = { en: row.name_english_loc, 'zh-CN': row.name_loc }
}
for (const section of ['abilities', 'heroes']) {
  catalog[section] = Object.fromEntries(
    Object.entries(catalog[section]).sort(([a], [b]) => a.localeCompare(b)),
  )
}
await writeFile(
  new URL('dota-names.zh-CN.json', root),
  `${JSON.stringify(catalog, null, 2)}\n`,
  'utf8',
)
console.log(
  `Updated ${Object.keys(catalog.abilities).length} abilities and ${heroes.length} heroes from Valve`,
)
