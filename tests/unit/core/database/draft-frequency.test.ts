import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAbilityRepository } from '@core/database/repositories/ability-repository'
import { createHeroRepository } from '@core/database/repositories/hero-repository'
import { createTestDb, type TestDb } from './test-helpers'

describe('Windrun draft frequency persistence', () => {
  let testDb: TestDb

  beforeEach(async () => {
    testDb = await createTestDb()
  })

  afterEach(() => {
    testDb.close()
  })

  it('stores and updates frequency separately from position for heroes and abilities', () => {
    const heroRepo = createHeroRepository(testDb.db)
    const abilityRepo = createAbilityRepository(testDb.db)
    const hero = {
      name: 'ursa',
      displayName: 'Ursa',
      winrate: 0.52,
      highSkillWinrate: 0.55,
      pickRate: 4.5,
      draftFrequency: 0.95,
      hsPickRate: 4.0,
      windrunId: 70,
    }
    const ability = {
      name: 'ursa_fury_swipes',
      displayName: 'Fury Swipes',
      heroName: 'ursa',
      winrate: 0.55,
      highSkillWinrate: 0.6,
      pickRate: 2.6,
      draftFrequency: 0.99,
      hsPickRate: 2.2,
      windrunId: 5359,
    }
    const heroIds = heroRepo.upsertHeroes([hero])
    abilityRepo.upsertAbilities([ability], heroIds)
    const heroId = heroIds.get('ursa')!

    expect(heroRepo.getAll()[0]).toMatchObject({ pickRate: 4.5, draftFrequency: 0.95 })
    expect(heroRepo.getById(heroId)).toMatchObject({ pickRate: 4.5, draftFrequency: 0.95 })
    expect(abilityRepo.getDetails([ability.name]).get(ability.name)).toMatchObject({
      pickRate: 2.6,
      draftFrequency: 0.99,
    })
    expect(abilityRepo.getByHeroId(heroId)[0].draftFrequency).toBe(0.99)

    heroRepo.upsertHeroes([{ ...hero, draftFrequency: 0.85 }])
    abilityRepo.upsertAbilities([{ ...ability, draftFrequency: 0.9 }], heroIds)
    expect(heroRepo.getAll()[0].draftFrequency).toBe(0.85)
    expect(abilityRepo.getAll()[0]).toMatchObject({ pickRate: 2.6, draftFrequency: 0.9 })
  })

  it('keeps frequency unknown for legacy inserts that do not provide it', () => {
    const heroRepo = createHeroRepository(testDb.db)
    const abilityRepo = createAbilityRepository(testDb.db)
    const heroIds = heroRepo.upsertHeroes([
      {
        name: 'ursa',
        displayName: 'Ursa',
        winrate: 0.52,
        highSkillWinrate: null,
        pickRate: 4.5,
        hsPickRate: null,
        windrunId: 70,
      },
    ])
    abilityRepo.upsertAbilities(
      [
        {
          name: 'ursa_fury_swipes',
          displayName: 'Fury Swipes',
          heroName: 'ursa',
          winrate: 0.55,
          highSkillWinrate: null,
          pickRate: 2.6,
          hsPickRate: null,
        },
      ],
      heroIds,
    )
    expect(heroRepo.getAll()[0].draftFrequency).toBeNull()
    expect(abilityRepo.getAll()[0].draftFrequency).toBeNull()
  })
})
