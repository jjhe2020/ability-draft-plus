import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  localizeAbilityName,
  localizeHeroName,
  localizeDotaDisplay,
} from '../../../src/shared/localization/dota-names'

describe('Chinese Dota display names', () => {
  it('covers every ability the shipped recognition model can identify', () => {
    const classes = JSON.parse(
      readFileSync(join(__dirname, '../../../resources/model/class_names.json'), 'utf8'),
    ) as string[] | Record<string, string>
    for (const name of Object.values(classes)) {
      const translated = localizeAbilityName(name, name, 'zh-CN')
      expect(translated, name).toMatch(/[\u3400-\u9fff]/)
      expect(translated, name).not.toBe('未收录技能')
    }
  })

  it('uses internal names for renamed skills and Ability Draft aliases', () => {
    expect(
      localizeAbilityName('dragon_knight_wyrms_wrath', 'Old Windrun display name', 'zh-CN'),
    ).toBe('飞龙之怒')
    expect(localizeAbilityName('kez_falcon_rush_ad', 'Falcon Rush', 'zh-CN')).toBe(
      localizeAbilityName('kez_falcon_rush', 'Falcon Rush', 'zh-CN'),
    )
    expect(localizeHeroName('crystalmaiden', 'Crystal Maiden', 'zh-CN')).toBe('水晶室女')
    expect(localizeHeroName('npc_dota_hero_nevermore', 'Shadow Fiend', 'zh-CN')).toBe('影魔')
  })

  it('localizes nested legacy combinations and dependency names without changing recognition or player data', () => {
    const payload = {
      scanData: {
        standard: [
          {
            name: 'lina_light_strike_array',
            displayName: 'Light Strike Array',
            winrate: 0.6,
            highWinrateCombinations: [
              {
                ability1Name: 'lina_light_strike_array',
                ability1DisplayName: 'Light Strike Array',
                ability2DisplayName: 'Blink',
                synergyWinrate: 0.7,
                suggestedThird: { name: 'luna_lucent_beam', displayName: 'Lucent Beam' },
              },
            ],
            shardStackWith: ['Blink'],
            unmetRequirement: { kind: 'ability', displayName: 'Lucent Beam' },
          },
        ],
      },
      heroModels: [{ heroName: 'sandking', heroDisplayName: 'Sand King' }],
      players: [
        {
          playerName: 'Light Strike Array',
          model: { npcName: 'sand_king', displayName: 'Sand King' },
        },
      ],
    }
    const result = localizeDotaDisplay(payload, 'zh-CN')
    const ability = result.scanData.standard[0]
    expect(ability.displayName).toBe('光击阵')
    expect(ability.name).toBe('lina_light_strike_array')
    expect(ability.winrate).toBe(0.6)
    expect(ability.highWinrateCombinations[0].ability2DisplayName).toBe('闪烁')
    expect(ability.highWinrateCombinations[0].suggestedThird.displayName).toBe('月光')
    expect(ability.unmetRequirement.displayName).toBe('月光')
    expect(ability.shardStackWith).toEqual(['闪烁'])
    expect(result.heroModels[0].heroDisplayName).toBe('沙王')
    expect(result.players[0].model.displayName).toBe('沙王')
    expect(result.players[0].playerName).toBe('Light Strike Array')
    expect(payload.scanData.standard[0].displayName).toBe('Light Strike Array')
    expect(localizeDotaDisplay(payload, 'en')).toBe(payload)
  })

  it('retains Chinese display names and gives unknown new entries a Chinese fallback', () => {
    expect(localizeAbilityName('new_patch_ability', 'Future Ability', 'zh-CN')).toBe('未收录技能')
    expect(localizeAbilityName('new_patch_ability', '新技能', 'zh-CN')).toBe('新技能')
    expect(localizeHeroName('new_hero', 'Future Hero', 'zh-CN')).toBe('未知英雄')
    expect(localizeAbilityName('antimage_blink', 'Blink', 'en')).toBe('Blink')
  })
})
