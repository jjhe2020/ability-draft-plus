import catalog from './dota-names.zh-CN.json'

// @DEV-GUIDE: Display-only Valve localization. Windrun/internal names and DB data
// remain untouched (icons, recognition, stats joins and Liquipedia need them).
// The bundled catalog works offline and includes legacy abilities. Refresh it
// with scripts/update-dota-localization.mjs when Dota adds or renames abilities.
type NameEntry = { en: string; 'zh-CN': string }
const abilities: Record<string, NameEntry> = catalog.abilities
const heroes: Record<string, NameEntry> = catalog.heroes

const englishAbilities = new Map(
  Object.values(abilities).map((entry) => [entry.en.toLowerCase(), entry['zh-CN']]),
)
const englishHeroes = new Map(
  Object.values(heroes).map((entry) => [entry.en.toLowerCase(), entry['zh-CN']]),
)
const flatHeroes = new Map(
  Object.entries(heroes).map(([name, entry]) => [name.replace(/_/g, ''), entry['zh-CN']]),
)

function isChinese(language: string): boolean {
  return /^zh(?:-|$)/i.test(language)
}

export function localizeAbilityName(
  name: string | null | undefined,
  displayName: string,
  language: string,
): string {
  if (!isChinese(language)) return displayName
  // Kez's Ability Draft variants share the same translated name as his base kit.
  const key = name?.replace(/_ad$/, '')
  const translated =
    (key ? abilities[key]?.['zh-CN'] : undefined) ?? englishAbilities.get(displayName.toLowerCase())
  if (translated) return translated
  return /[\u3400-\u9fff]/.test(displayName) ? displayName : '未收录技能'
}

export function localizeHeroName(
  name: string | null | undefined,
  displayName: string,
  language: string,
): string {
  if (!isChinese(language)) return displayName
  const key = name?.replace(/^npc_dota_hero_/, '')
  const translated =
    (key ? (heroes[key]?.['zh-CN'] ?? flatHeroes.get(key.replace(/_/g, ''))) : undefined) ??
    englishHeroes.get(displayName.toLowerCase())
  if (translated) return translated
  return /[\u3400-\u9fff]/.test(displayName) ? displayName : '未知英雄'
}

/** Legacy payloads carry only English display strings for some combinations. */
function localizeDisplayName(displayName: string, language: string): string {
  if (!isChinese(language)) return displayName
  return (
    englishAbilities.get(displayName.toLowerCase()) ??
    englishHeroes.get(displayName.toLowerCase()) ??
    (/^[\u3400-\u9fff]/.test(displayName)
      ? displayName
      : localizeAbilityName(displayName, displayName, language))
  )
}

const abilityDisplayFields = new Map([
  ['displayName', 'name'],
  ['abilityDisplayName', 'abilityName'],
  ['ability1DisplayName', 'ability1Name'],
  ['ability2DisplayName', 'ability2Name'],
])
const displayNameLists = new Set(['shardStackWith', 'scepterStackWith', 'pointSinkConflictWith'])
const tagNames: Record<string, string> = {
  good_with_rearm: '适合刷新',
}

/** Translate only known display fields, never player names, keys, IDs or stats.
 * Works for overlay, stream and picks DTOs including nested synergy/reason data;
 * clones only for Chinese, so changing language never mutates received state. */
export function localizeDotaDisplay<T>(value: T, language: string): T {
  if (!isChinese(language) || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((child) => localizeDotaDisplay(child, language)) as T
  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [field, child] of Object.entries(source)) {
    if (field === 'heroDisplayName' && typeof child === 'string') {
      result[field] = localizeHeroName(
        typeof source.heroName === 'string' ? source.heroName : undefined,
        child,
        language,
      )
    } else if (abilityDisplayFields.has(field) && typeof child === 'string') {
      const internalName = source[abilityDisplayFields.get(field)!]
      result[field] =
        field === 'displayName' && typeof source.npcName === 'string'
          ? localizeHeroName(source.npcName, child, language)
          : source.kind === 'tag'
            ? (tagNames[child] ?? '指定类型')
            : source.kind === 'model'
              ? localizeHeroName(undefined, child, language)
              : typeof internalName === 'string'
                ? localizeAbilityName(internalName, child, language)
                : localizeDisplayName(child, language)
    } else if (displayNameLists.has(field) && Array.isArray(child)) {
      result[field] = child.map((name) =>
        typeof name === 'string' ? localizeDisplayName(name, language) : name,
      )
    } else {
      result[field] = localizeDotaDisplay(child, language)
    }
  }
  return result as T
}
