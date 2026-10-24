import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import initSqlJs from 'sql.js'

const paths = vi.hoisted(() => ({ directory: '' }))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => paths.directory,
    getPath: () => paths.directory,
  },
}))

vi.mock('electron-log/main', () => ({
  default: {
    scope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}))

import {
  createDatabaseService,
  type DatabaseService,
} from '../../../../src/main/services/database-service'
import { SCHEMA_SQL } from '../../../../src/core/database/schema'
import { DB_FILE_NAME } from '../../../../src/shared/constants/database'

describe('DatabaseService.reload', () => {
  let service: DatabaseService

  beforeEach(async () => {
    paths.directory = mkdtempSync(join(tmpdir(), 'ability-draft-plus-reload-'))
    service = createDatabaseService()
    await service.initialize()
  })

  afterEach(() => {
    service.close()
    const databasePath = join(paths.directory, DB_FILE_NAME)
    if (existsSync(databasePath)) unlinkSync(databasePath)
    rmdirSync(paths.directory)
  })

  it('starts a fresh bundled installation in Chinese and preserves an existing user language', async () => {
    service.close()
    unlinkSync(join(paths.directory, DB_FILE_NAME))
    const resources = join(paths.directory, 'resources')
    mkdirSync(resources)
    const SQL = await initSqlJs()
    const seed = new SQL.Database()
    seed.run(SCHEMA_SQL)
    seed.run("INSERT INTO Metadata (key, value) VALUES ('language', 'en')")
    const seedPath = join(resources, DB_FILE_NAME)
    writeFileSync(seedPath, seed.export())
    seed.close()
    try {
      service = createDatabaseService()
      await service.initialize()
      expect(service.isFirstRun()).toBe(true)
      expect(service.metadata.getSettings().language).toBe('zh-CN')
      service.metadata.setSettings({ language: 'en' })
      service.close()
      service = createDatabaseService()
      await service.initialize()
      expect(service.isFirstRun()).toBe(false)
      expect(service.metadata.getSettings().language).toBe('en')
    } finally {
      unlinkSync(seedPath)
      rmdirSync(resources)
    }
  })

  it('migrates a pre-frequency backup before recreating repositories and preserves data', async () => {
    const SQL = await initSqlJs()
    const oldDatabase = new SQL.Database()
    // A 3.2 backup has the current tables but predates the new frequency columns.
    oldDatabase.run(SCHEMA_SQL.replaceAll('draft_frequency REAL,', ''))
    oldDatabase.run(`INSERT INTO Heroes (name, display_name, winrate, pick_rate, windrun_id)
      VALUES ('ursa', 'Ursa', 0.52, 4.5, 70)`)
    oldDatabase.run(`INSERT INTO Abilities (name, display_name, hero_id, winrate, pick_rate)
      VALUES ('ursa_fury_swipes', 'Fury Swipes', 1, 0.55, 2.6)`)
    const backup = oldDatabase.export()
    oldDatabase.close()

    service.reload(backup)

    expect(service.heroes.getAll()).toHaveLength(1)
    expect(service.heroes.getById(1)).toMatchObject({
      name: 'ursa',
      winrate: 0.52,
      pickRate: 4.5,
      draftFrequency: null,
    })
    expect(service.abilities.getAll()[0]).toMatchObject({
      name: 'ursa_fury_swipes',
      winrate: 0.55,
      pickRate: 2.6,
      draftFrequency: null,
    })

    service.persist()
    service.close()
    service = createDatabaseService()
    await service.initialize()
    expect(
      service.abilities.getDetails(['ursa_fury_swipes']).get('ursa_fury_swipes'),
    ).toMatchObject({ draftFrequency: null, pickRate: 2.6 })
  })

  it('creates tables and migrates a much older backup through the same reload path', async () => {
    const SQL = await initSqlJs()
    const oldDatabase = new SQL.Database()
    oldDatabase.run(`CREATE TABLE Heroes (
      hero_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
      display_name TEXT, winrate REAL, windrun_id INTEGER);
      CREATE TABLE Abilities (
      ability_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL,
      display_name TEXT, hero_id INTEGER, winrate REAL);
      INSERT INTO Heroes (name, winrate) VALUES ('ursa', 0.52);
      INSERT INTO Abilities (name, hero_id, winrate) VALUES ('ursa_fury_swipes', 1, 0.55);`)
    const backup = oldDatabase.export()
    oldDatabase.close()

    service.reload(backup)

    expect(service.heroes.getAll()[0]).toMatchObject({ name: 'ursa', draftFrequency: null })
    expect(service.abilities.getAll()[0]).toMatchObject({
      name: 'ursa_fury_swipes',
      draftFrequency: null,
      highSkillWinrate: null,
      pickRate: null,
    })
    expect(service.metadata.getSettings().abilityPriority.mode).toBe('custom')
    expect(service.playerStats.getAbilityStatsByName().size).toBe(0)
  })
})
