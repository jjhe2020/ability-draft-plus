import { describe, expect, it } from 'vitest'
import type { EnrichedScanSlot, HeroModelDisplay } from '@shared/types'
import {
  modelPriorityRows,
  poolPriorityColor,
  standardPriorityRows,
  summarizePoolPriorities,
  ultimatePriorityRows,
  type PoolPriorityRow,
} from '../../../../src/renderer/overlay/src/pool-priority'

function slot(name: string | null, overrides: Partial<EnrichedScanSlot> = {}): EnrichedScanSlot {
  return {
    name,
    displayName: name === null ? '' : `中文-${name}`,
    confidence: 1,
    hero_order: 0,
    ability_order: 3,
    is_ultimate: true,
    coord: { x: 0, y: 0, width: 64, height: 64, hero_order: 0 },
    winrate: 0.5,
    pickRate: 20,
    formulaPriority: 20,
    consolidatedScore: 0.5,
    isGeneralTopTier: false,
    isSynergySuggestionForMySpot: false,
    isUltimateFromDb: true,
    highWinrateCombinations: [],
    lowWinrateCombinations: [],
    strongHeroSynergies: [],
    weakHeroSynergies: [],
    ...overrides,
  }
}

function model(heroOrder: number, overrides: Partial<HeroModelDisplay> = {}): HeroModelDisplay {
  return {
    heroOrder,
    heroName: `hero-${heroOrder}`,
    heroDisplayName: `英雄-${heroOrder}`,
    dbHeroId: heroOrder + 1,
    winrate: 0.5,
    pickRate: 20,
    formulaPriority: 20,
    consolidatedScore: 0.5,
    isGeneralTopTier: false,
    identificationConfidence: 1,
    strongAbilitySynergies: [],
    weakAbilitySynergies: [],
    ...overrides,
  }
}

function rows(...priorities: Array<number | null>): PoolPriorityRow[] {
  return priorities.map((priority, index) => ({
    key: String(index),
    name: String(index),
    priority,
    picked: false,
  }))
}

describe('match pool priority rows', () => {
  it('keeps drafted standard extremes in the color scale and excludes ultimates', () => {
    const normal = (name: string, priority: number) =>
      slot(name, { formulaPriority: priority, is_ultimate: false, isUltimateFromDb: false })
    const high = normal('standard-high', 40)
    const result = standardPriorityRows(
      {
        ultimates: [slot('ultimate', { formulaPriority: 999 })],
        standard: [normal('standard-middle', 20), high],
        selectedAbilities: [normal('standard-picked-low', -20), high, slot('ultimate')],
      },
      '未识别',
    )
    expect(result.map((row) => row.priority)).toEqual([-20, 20, 40])
    const summary = summarizePoolPriorities(result)
    expect(summary).toMatchObject({ min: -20, median: 20, max: 40 })
    expect(poolPriorityColor(20, summary)).toBe('#ffeb84')
    expect(poolPriorityColor(40, summary)).toBe('#f8696b')
  })

  it('replaces unknown placeholders when a previously unidentified pool ultimate is recognized after picking', () => {
    const known = Array.from({ length: 11 }, (_, i) => slot(`ultimate-${i}`, { hero_order: i }))
    const scan = {
      ultimates: [...known, slot(null, { hero_order: 11, isUnknown: true })],
      standard: [],
      selectedAbilities: [slot('newly-recognized', { formulaPriority: -5 })],
    }
    const result = ultimatePriorityRows(scan, '未识别', 12)
    expect(result).toHaveLength(12)
    expect(result[0]).toMatchObject({ key: 'newly-recognized', picked: true, priority: -5 })
    expect(result.some((row) => row.name === '未识别')).toBe(false)
    // Missing statistical inputs on a known entry must never be removed as an unknown.
    scan.ultimates[0] = slot('ultimate-0', { formulaPriority: null })
    expect(
      ultimatePriorityRows(scan, '未识别', 12).find((row) => row.key === 'ultimate-0'),
    ).toBeDefined()
  })

  it('rebuilds all twelve ultimates after rescan and deduplicates picked skills by internal name', () => {
    const remaining = Array.from({ length: 9 }, (_, index) =>
      slot(`ultimate-${index}`, { hero_order: index, formulaPriority: index }),
    )
    const picked = Array.from({ length: 3 }, (_, index) =>
      slot(`ultimate-${index + 9}`, { hero_order: index, formulaPriority: index + 9 }),
    )
    const result = ultimatePriorityRows(
      {
        ultimates: [...remaining, picked[0]],
        standard: [slot('standard', { is_ultimate: false, isUltimateFromDb: false })],
        selectedAbilities: [...picked, { ...picked[0], hero_order: 7 }],
      },
      '未识别',
    )

    expect(result).toHaveLength(12)
    expect(new Set(result.map((row) => row.key)).size).toBe(12)
    expect(result.map((row) => row.priority)).toEqual(Array.from({ length: 12 }, (_, i) => i))
    expect(result.filter((row) => row.picked).map((row) => row.key)).toEqual([
      'ultimate-9',
      'ultimate-10',
      'ultimate-11',
    ])
    expect(result[0].name).toBe('中文-ultimate-0')
  })

  it('ignores blank selected ultimate boxes and standard picks while retaining unknown pool positions', () => {
    const result = ultimatePriorityRows(
      {
        ultimates: [slot('known'), slot(null, { hero_order: 1, isUnknown: true })],
        standard: [],
        selectedAbilities: [
          slot(null, { hero_order: 2, isUnknown: true }),
          slot('', { hero_order: 3, isUnknown: true }),
          slot('standard', { is_ultimate: false, isUltimateFromDb: false }),
        ],
      },
      '未识别',
    )
    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({ name: '未识别', priority: null, picked: false })
  })

  it('accepts a database ultimate even when selected-box geometry says standard', () => {
    const result = ultimatePriorityRows(
      {
        ultimates: [],
        standard: [],
        selectedAbilities: [slot('ultimate', { is_ultimate: false, isUltimateFromDb: true })],
      },
      '未识别',
    )
    expect(result).toEqual([{ key: 'ultimate', name: '中文-ultimate', priority: 20, picked: true }])
  })

  it('sorts negative and zero positions numerically and places unavailable values last', () => {
    const result = ultimatePriorityRows(
      {
        ultimates: [
          slot('missing', { formulaPriority: undefined }),
          slot('late', { formulaPriority: 30 }),
          slot('zero', { formulaPriority: 0 }),
          slot('negative', { formulaPriority: -5 }),
          slot('invalid', { formulaPriority: Number.NaN }),
        ],
        standard: [],
        selectedAbilities: [],
      },
      '未识别',
    )
    expect(result.map((row) => row.key)).toEqual(['negative', 'zero', 'late', 'missing', 'invalid'])
    expect(result.map((row) => row.priority)).toEqual([-5, 0, 30, null, null])
  })

  it('retains every model including picked and unidentified entries without inventing priorities', () => {
    const result = modelPriorityRows([
      model(0, { formulaPriority: 0, isPicked: true }),
      model(1, { formulaPriority: -10 }),
      model(2, { dbHeroId: null, formulaPriority: -99, isPicked: true }),
      model(3, { formulaPriority: Number.POSITIVE_INFINITY }),
      model(4, { formulaPriority: undefined }),
    ])
    expect(result).toHaveLength(5)
    expect(result.map((row) => row.priority)).toEqual([-10, 0, null, null, null])
    expect(result.find((row) => row.key === 'model:0')).toMatchObject({
      name: '英雄-0',
      priority: 0,
      picked: true,
    })
    expect(result.find((row) => row.key === 'model:2')).toMatchObject({
      priority: null,
      picked: true,
    })
    expect(result.find((row) => row.key === 'model:1')?.picked).toBe(false)
  })
})

describe('match pool statistics', () => {
  it('uses population variance over the match pool and excludes missing values instead of treating them as zero', () => {
    expect(summarizePoolPriorities(rows(1, 3, null, Number.NaN))).toEqual({
      count: 2,
      missing: 2,
      mean: 2,
      variance: 1,
      std: 1,
      min: 1,
      median: 2,
      max: 3,
    })
  })

  it('summarizes empty and entirely unavailable pools without zero-valued statistics', () => {
    const empty = {
      count: 0,
      missing: 0,
      mean: null,
      variance: null,
      std: null,
      min: null,
      median: null,
      max: null,
    }
    expect(summarizePoolPriorities([])).toEqual(empty)
    expect(summarizePoolPriorities(rows(null, Number.NEGATIVE_INFINITY))).toEqual({
      ...empty,
      missing: 2,
    })
  })

  it('gives single and tied values zero variance and a valid median', () => {
    expect(summarizePoolPriorities(rows(-4))).toMatchObject({
      count: 1,
      mean: -4,
      variance: 0,
      std: 0,
      min: -4,
      median: -4,
      max: -4,
    })
    expect(summarizePoolPriorities(rows(7, 7, 7))).toMatchObject({
      count: 3,
      mean: 7,
      variance: 0,
      std: 0,
      median: 7,
    })
  })

  it('uses the sorted middle observation as the median for odd counts', () => {
    expect(summarizePoolPriorities(rows(40, -10, 0))).toMatchObject({
      min: -10,
      median: 0,
      max: 40,
      mean: 10,
    })
  })
})

describe('Excel green/yellow/red color scale', () => {
  it('colors the lowest, median and highest positions with the Excel palette', () => {
    const summary = summarizePoolPriorities(rows(-10, 0, 40))
    expect(poolPriorityColor(-10, summary)).toBe('#63be7b')
    expect(poolPriorityColor(0, summary)).toBe('#ffeb84')
    expect(poolPriorityColor(40, summary)).toBe('#f8696b')
  })

  it('interpolates around the actual median rather than the range midpoint and clamps extremes', () => {
    const summary = summarizePoolPriorities(rows(-10, 0, 40))
    expect(poolPriorityColor(-5, summary)).toBe('#b1d580')
    expect(poolPriorityColor(20, summary)).toBe('#fcaa78')
    expect(poolPriorityColor(-100, summary)).toBe('#63be7b')
    expect(poolPriorityColor(100, summary)).toBe('#f8696b')
  })

  it('keeps missing and invalid values transparent', () => {
    const summary = summarizePoolPriorities(rows(1, 3))
    expect(poolPriorityColor(null, summary)).toBe('transparent')
    expect(poolPriorityColor(Number.NaN, summary)).toBe('transparent')
    expect(poolPriorityColor(Number.POSITIVE_INFINITY, summary)).toBe('transparent')
    expect(poolPriorityColor(1, summarizePoolPriorities([]))).toBe('transparent')
  })

  it('uses neutral yellow when the entire pool is tied or contains one valid value', () => {
    expect(poolPriorityColor(7, summarizePoolPriorities(rows(7, 7, 7)))).toBe('#ffeb84')
    expect(poolPriorityColor(0, summarizePoolPriorities(rows(0, null)))).toBe('#ffeb84')
  })

  it('preserves the extreme colors when the median coincides with a repeated minimum or maximum', () => {
    const repeatedMinimum = summarizePoolPriorities(rows(1, 1, 5))
    expect(poolPriorityColor(1, repeatedMinimum)).toBe('#63be7b')
    expect(poolPriorityColor(5, repeatedMinimum)).toBe('#f8696b')
    const repeatedMaximum = summarizePoolPriorities(rows(1, 5, 5))
    expect(poolPriorityColor(1, repeatedMaximum)).toBe('#63be7b')
    expect(poolPriorityColor(5, repeatedMaximum)).toBe('#f8696b')
  })
})
