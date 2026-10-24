import type { Database, SqlValue } from 'sql.js'
import type { PriorityRow } from '@shared/ability-priority'

interface SnapshotStat {
  abilityId: number
  numPicks: number
  avgPickPosition: number
  wins: number
  winrate: number
  pickRate: number
}

export interface WindrunSnapshot {
  stats: SnapshotStat[]
  patches: string[]
  updatedAt: string
}

export interface SnapshotImportSource {
  filename: string
  sha256: string
  importedAt: string
}

export function validateWindrunSnapshot(input: unknown): WindrunSnapshot {
  const data = (input as { data?: Record<string, unknown> } | null)?.data
  if (!data || !Array.isArray(data.abilityStats) || data.abilityStats.length === 0) {
    throw new Error('Expected a non-empty Windrun data.abilityStats array')
  }
  const ids = new Set<number>()
  for (const row of data.abilityStats) {
    if (
      !row ||
      !Number.isSafeInteger(row.abilityId) ||
      row.abilityId === 0 ||
      ids.has(row.abilityId) ||
      !Number.isSafeInteger(row.numPicks) ||
      row.numPicks <= 0 ||
      !Number.isSafeInteger(row.wins) ||
      row.wins < 0 ||
      row.wins > row.numPicks ||
      !Number.isFinite(row.avgPickPosition) ||
      row.avgPickPosition < 0 ||
      !Number.isFinite(row.winrate) ||
      row.winrate < 0 ||
      row.winrate > 1 ||
      !Number.isFinite(row.pickRate) ||
      row.pickRate < 0 ||
      row.pickRate > 1
    ) {
      throw new Error(`Invalid or duplicate Windrun statistic: ${row?.abilityId}`)
    }
    ids.add(row.abilityId)
  }
  const patches = (data.patches as { overall?: unknown } | undefined)?.overall
  if (
    !Array.isArray(patches) ||
    !patches.length ||
    !patches.every((p) => typeof p === 'string' && p)
  ) {
    throw new Error('Expected data.patches.overall patch names')
  }
  if (typeof data._lastUpdated !== 'string' || !Number.isFinite(Date.parse(data._lastUpdated))) {
    throw new Error('Expected a valid Windrun data._lastUpdated timestamp')
  }
  return {
    stats: data.abilityStats as SnapshotStat[],
    patches,
    updatedAt: new Date(data._lastUpdated).toISOString(),
  }
}

function rows(db: Database, sql: string): Record<string, SqlValue>[] {
  const result = db.exec(sql)[0]
  return result
    ? result.values.map((values) =>
        Object.fromEntries(result.columns.map((key, index) => [key, values[index]])),
      )
    : []
}

/** Refresh overall statistics only; keep user settings and unrelated data intact. */
export function importWindrunSnapshot(
  db: Database,
  snapshot: WindrunSnapshot,
  source: SnapshotImportSource,
  abilityNames: ReadonlyMap<number, string> = new Map(),
): { abilities: number; heroes: number; population: PriorityRow[] } {
  const abilityColumns = new Set(rows(db, 'PRAGMA table_info(Abilities)').map((r) => r.name))
  const heroColumns = new Set(rows(db, 'PRAGMA table_info(Heroes)').map((r) => r.name))
  const abilities = rows(
    db,
    `SELECT ability_id, name${abilityColumns.has('windrun_id') ? ', windrun_id' : ''} FROM Abilities`,
  )
  const heroes = rows(
    db,
    `SELECT hero_id, name${heroColumns.has('windrun_id') ? ', windrun_id' : ''} FROM Heroes`,
  )
  const abilityByName = new Map(abilities.map((r) => [r.name, r]))
  const abilityById = new Map(
    abilities.filter((r) => typeof r.windrun_id === 'number').map((r) => [r.windrun_id, r]),
  )
  const heroById = new Map(
    heroes.filter((r) => typeof r.windrun_id === 'number').map((r) => [r.windrun_id, r]),
  )

  // Resolve the entire input before any write. A partial import would distort
  // the normalization population and silently drop valid Windrun entries.
  const resolved = snapshot.stats.map((stat) => {
    const hero = stat.abilityId < 0
    const row = hero
      ? heroById.get(-stat.abilityId)
      : (abilityById.get(stat.abilityId) ??
        abilityByName.get(abilityNames.get(stat.abilityId) ?? ''))
    if (!row)
      throw new Error(
        `Cannot map Windrun ${hero ? 'hero' : 'ability'} ${stat.abilityId}; update static metadata first`,
      )
    return { stat, hero, row }
  })
  const population = resolved.map(({ stat, hero, row }) => ({
    name: hero ? `hero:${row.name}` : String(row.name),
    winrate: stat.winrate,
    pickRate: stat.avgPickPosition,
    draftFrequency: stat.pickRate,
  }))
  if (new Set(population.map((row) => row.name)).size !== population.length) {
    throw new Error('Multiple Windrun IDs resolve to the same database entry')
  }
  const abilityCount = resolved.filter((r) => !r.hero).length
  const heroCount = resolved.length - abilityCount
  db.run('BEGIN TRANSACTION')
  try {
    // Old bundled databases do not yet have these nullable columns. The app's
    // usual schema migration handles all other columns when it next starts.
    for (const [table, columns] of [
      ['Abilities', abilityColumns],
      ['Heroes', heroColumns],
    ] as const) {
      if (!columns.has('windrun_id')) db.run(`ALTER TABLE ${table} ADD COLUMN windrun_id INTEGER`)
      if (!columns.has('draft_frequency'))
        db.run(`ALTER TABLE ${table} ADD COLUMN draft_frequency REAL`)
    }
    for (const { stat, hero, row } of resolved) {
      db.run(
        `UPDATE ${hero ? 'Heroes' : 'Abilities'} SET winrate = ?, pick_rate = ?, draft_frequency = ?, windrun_id = ? WHERE ${hero ? 'hero_id' : 'ability_id'} = ?`,
        [
          stat.winrate,
          stat.avgPickPosition,
          stat.pickRate,
          Math.abs(stat.abilityId),
          row[hero ? 'hero_id' : 'ability_id'],
        ],
      )
    }
    const setMetadata = (key: string, value: string): void => {
      db.run(
        'INSERT INTO Metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, value],
      )
    }
    setMetadata('windrun_priority_population', JSON.stringify(population))
    setMetadata(
      'windrun_overall_snapshot',
      JSON.stringify({
        sourceKind: 'windrun-import',
        sourceFilename: source.filename,
        sourceSha256: source.sha256,
        sourceUpdatedAt: snapshot.updatedAt,
        importedAt: source.importedAt,
        patches: snapshot.patches,
        abilityCount,
        heroCount,
        populationCount: population.length,
      }),
    )
    // last_successful_scrape_date describes the full scrape (including
    // combinations/high-skill data), so importing overall data must not change it.
    db.run('COMMIT')
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
  return { abilities: abilityCount, heroes: heroCount, population }
}
