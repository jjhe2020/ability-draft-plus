import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { SCHEMA_SQL } from '../../../../src/core/database/schema'
import {
  importWindrunSnapshot,
  validateWindrunSnapshot,
} from '../../../../src/core/scraper/windrun-snapshot-import'

const payload = () => ({
  data: {
    patches: { overall: ['7.41f'] },
    _lastUpdated: '2026-10-15T08:06:11.955+0000',
    abilityStats: [
      {
        abilityId: 5359,
        winrate: 0.55,
        avgPickPosition: 2.4,
        pickRate: 0.999,
        numPicks: 100,
        wins: 55,
      },
      {
        abilityId: -70,
        winrate: 0.48,
        avgPickPosition: 21,
        pickRate: 0.8,
        numPicks: 100,
        wins: 48,
      },
    ],
  },
})
const source = {
  filename: 'abilities.json',
  sha256: 'a'.repeat(64),
  importedAt: '2026-10-15T09:00:00.000Z',
}

describe('Windrun overall snapshot import', () => {
  let SQL: SqlJsStatic
  beforeAll(async () => {
    SQL = await initSqlJs()
  })

  it('migrates old IDs/frequency, keeps unrelated stats and settings, and records the complete population', () => {
    const db = new SQL.Database()
    db.run(SCHEMA_SQL.replaceAll('draft_frequency REAL,', ''))
    // Mimic the old bundled ability table, which has no Windrun ID column.
    db.run('ALTER TABLE Abilities DROP COLUMN windrun_id')
    db.run(
      "INSERT INTO Heroes (hero_id,name,windrun_id,high_skill_winrate) VALUES (1,'ursa',70,0.6)",
    )
    db.run(
      "INSERT INTO Abilities (ability_id,name,hero_id,high_skill_winrate,hs_pick_rate,is_ultimate,ability_order,kills_shift) VALUES (2,'ursa_fury_swipes',1,0.7,3.1,0,3,0.12)",
    )
    db.run(
      'INSERT INTO AbilitySynergies (base_ability_id,synergy_ability_id,synergy_winrate) VALUES (2,2,0.8)',
    )
    db.run(
      'INSERT INTO PlayerAbilityStats (windrun_ability_id,wins,losses,winrate) VALUES (5359,30,20,0.6)',
    )
    db.run(
      "INSERT INTO Metadata (key,value) VALUES ('ability_priority','{\"formula\":\"my own rule\"}'),('language','zh-CN')",
    )
    db.run(
      "UPDATE Metadata SET value='2026-09-01T00:00:00Z' WHERE key='last_successful_scrape_date'",
    )

    const result = importWindrunSnapshot(
      db,
      validateWindrunSnapshot(payload()),
      source,
      new Map([[5359, 'ursa_fury_swipes']]),
    )

    expect(result).toMatchObject({ abilities: 1, heroes: 1 })
    expect(result.population).toEqual([
      { name: 'ursa_fury_swipes', winrate: 0.55, pickRate: 2.4, draftFrequency: 0.999 },
      { name: 'hero:ursa', winrate: 0.48, pickRate: 21, draftFrequency: 0.8 },
    ])
    expect(
      db.exec(
        'SELECT winrate,pick_rate,draft_frequency,windrun_id,high_skill_winrate,hs_pick_rate,is_ultimate,ability_order,kills_shift FROM Abilities',
      )[0].values[0],
    ).toEqual([0.55, 2.4, 0.999, 5359, 0.7, 3.1, 0, 3, 0.12])
    expect(
      db.exec('SELECT winrate,pick_rate,draft_frequency,high_skill_winrate FROM Heroes')[0]
        .values[0],
    ).toEqual([0.48, 21, 0.8, 0.6])
    expect(db.exec('SELECT synergy_winrate FROM AbilitySynergies')[0].values[0]).toEqual([0.8])
    expect(db.exec('SELECT wins,losses FROM PlayerAbilityStats')[0].values[0]).toEqual([30, 20])
    const metadata = Object.fromEntries(db.exec('SELECT key,value FROM Metadata')[0].values)
    expect(metadata.ability_priority).toBe('{"formula":"my own rule"}')
    expect(metadata.language).toBe('zh-CN')
    expect(metadata.last_successful_scrape_date).toBe('2026-09-01T00:00:00Z')
    expect(JSON.parse(String(metadata.windrun_priority_population))).toEqual(result.population)
    expect(JSON.parse(String(metadata.windrun_overall_snapshot))).toMatchObject({
      sourceSha256: source.sha256,
      sourceUpdatedAt: '2026-10-15T08:06:11.955Z',
      patches: ['7.41f'],
      populationCount: 2,
    })
    // A second import no longer needs a Valve map and does not duplicate rows.
    expect(
      importWindrunSnapshot(db, validateWindrunSnapshot(payload()), source).population,
    ).toEqual(result.population)
    expect(db.exec('SELECT COUNT(*) FROM Abilities')[0].values[0]).toEqual([1])
    db.close()
  })

  it('rejects unmapped entries before schema or data changes', () => {
    const db = new SQL.Database()
    db.run(
      'CREATE TABLE Heroes (hero_id INTEGER PRIMARY KEY,name TEXT,windrun_id INTEGER); CREATE TABLE Abilities (ability_id INTEGER PRIMARY KEY,name TEXT); CREATE TABLE Metadata (key TEXT PRIMARY KEY,value TEXT);',
    )
    const before = db.export()
    expect(() => importWindrunSnapshot(db, validateWindrunSnapshot(payload()), source)).toThrow(
      'Cannot map Windrun ability 5359',
    )
    expect(db.export()).toEqual(before)
    db.close()
  })

  it('rolls back statistics and schema together if a database write fails', () => {
    const db = new SQL.Database()
    db.run(`CREATE TABLE Heroes (hero_id INTEGER PRIMARY KEY,name TEXT,windrun_id INTEGER,winrate REAL,pick_rate REAL);
      CREATE TABLE Abilities (ability_id INTEGER PRIMARY KEY,name TEXT,winrate REAL,pick_rate REAL);
      INSERT INTO Heroes VALUES (1,'ursa',70,0.4,30);
      INSERT INTO Abilities VALUES (2,'ursa_fury_swipes',0.5,3);`)
    // A damaged DB without Metadata fails only after applying its stat updates.
    expect(() =>
      importWindrunSnapshot(
        db,
        validateWindrunSnapshot(payload()),
        source,
        new Map([[5359, 'ursa_fury_swipes']]),
      ),
    ).toThrow('no such table: Metadata')
    expect(db.exec('SELECT winrate,pick_rate FROM Abilities')[0].values[0]).toEqual([0.5, 3])
    expect(db.exec('SELECT winrate,pick_rate FROM Heroes')[0].values[0]).toEqual([0.4, 30])
    expect(db.exec('PRAGMA table_info(Abilities)')[0].values.map((row) => row[1])).not.toContain(
      'draft_frequency',
    )
    db.close()
  })

  it('rejects invalid numbers, duplicates, incomplete structures, and missing source time', () => {
    for (const bad of [null, {}, { data: { abilityStats: [] } }]) {
      expect(() => validateWindrunSnapshot(bad)).toThrow()
    }
    for (const [field, value] of [
      ['winrate', null],
      ['winrate', 55],
      ['winrate', Number.NaN],
      ['pickRate', -1],
      ['pickRate', 2],
      ['avgPickPosition', Infinity],
      ['wins', 101],
      ['numPicks', 0],
      ['abilityId', 0],
    ] as const) {
      const data = payload()
      Object.assign(data.data.abilityStats[0], { [field]: value })
      expect(() => validateWindrunSnapshot(data), field).toThrow()
    }
    const duplicate = payload()
    duplicate.data.abilityStats.push(duplicate.data.abilityStats[0])
    expect(() => validateWindrunSnapshot(duplicate)).toThrow('duplicate')
    const noDate = payload()
    noDate.data._lastUpdated = 'not a time'
    expect(() => validateWindrunSnapshot(noDate)).toThrow('_lastUpdated')
  })
})
