import { describe, expect, it } from 'vitest'
import {
  calculateAbilityPriorities,
  compilePriorityFormula,
  DEFAULT_ABILITY_PRIORITY,
  DEFAULT_PRIORITY_FORMULA,
  priorityToScore,
  sampleSummary,
  validateAbilityPrioritySettings,
  type PriorityRow,
} from '@shared/ability-priority'
import reference from '../../../fixtures/ggxgg-reference.json'

const referenceRows: PriorityRow[] = reference.rows.map(([id, winrate, avgPick, frequency]) => ({
  name: String(id),
  winrate,
  pickRate: avgPick,
  draftFrequency: frequency,
}))

const variables = {
  winWeight: -1,
  pickWeight: 10,
  winZ: 2,
  pickZ: -0.5,
  pickFrequency: 0.8,
  winrate: 0.6,
  avgPick: 10,
  winMean: 0.5,
  winStd: 0.05,
  pickMean: 25,
  pickStd: 12,
}

const rankingRows: PriorityRow[] = [
  { name: 'high-win', winrate: 0.7, pickRate: 40, draftFrequency: 1 },
  { name: 'early-pick', winrate: 0.4, pickRate: 5, draftFrequency: 1 },
  { name: 'middle', winrate: 0.5, pickRate: 25, draftFrequency: 1 },
]

const sortedNames = (priorities: Map<string, number>) =>
  [...priorities].sort(([, a], [, b]) => a - b).map(([name]) => name)

describe('ggxgg workbook parity', () => {
  it.each(['1e200 * winZ', '1e308'])('rejects aggregate overflow for %s', (formula) => {
    expect(() =>
      calculateAbilityPriorities(referenceRows, { ...DEFAULT_ABILITY_PRIORITY, formula }),
    ).toThrow('均值或标准差')
  })
  it('matches every cached formula result using the entire 631-row population', () => {
    expect(referenceRows).toHaveLength(631)
    expect(referenceRows.filter((row) => Number(row.name) < 0)).toHaveLength(127)
    expect(DEFAULT_ABILITY_PRIORITY.winWeight).toBe(reference.coefficients.winWeight)
    expect(DEFAULT_ABILITY_PRIORITY.pickWeight).toBe(reference.coefficients.pickWeight)

    const result = calculateAbilityPriorities(referenceRows, DEFAULT_ABILITY_PRIORITY)
    expect(result.count).toBe(631)
    expect(result.priorities.size).toBe(631)
    for (const [id, , , , expected] of reference.rows) {
      const actual = result.priorities.get(String(id))
      expect(actual, `missing priority for Windrun ID ${id}`).toBeDefined()
      expect(Math.abs(actual! - expected), `priority differs for Windrun ID ${id}`).toBeLessThan(
        1e-10,
      )
      expect(Number.isFinite(actual)).toBe(true)
    }
  })

  it('includes hero models in standardization instead of computing from abilities alone', () => {
    const all = calculateAbilityPriorities(referenceRows, DEFAULT_ABILITY_PRIORITY)
    const abilitiesOnly = calculateAbilityPriorities(
      referenceRows.filter((row) => Number(row.name) > 0),
      DEFAULT_ABILITY_PRIORITY,
    )
    expect(abilitiesOnly.count).toBe(504)
    expect(abilitiesOnly.priorities.get('7842')).not.toBeCloseTo(all.priorities.get('7842')!, 6)
  })
})

describe('editable priority rules', () => {
  it('uses both editable coefficients and the actual frequency multiplier', () => {
    const evaluate = compilePriorityFormula(DEFAULT_PRIORITY_FORMULA)
    expect(evaluate(variables)).toBe(-12)
    expect(evaluate({ ...variables, winWeight: -2, pickWeight: 3 })).toBeCloseTo(-17.2)
    expect(evaluate({ ...variables, pickFrequency: 0 })).toBe(-8)
  })

  it('changes ranking when coefficients favor winrate or average pick position', () => {
    const winOnly = calculateAbilityPriorities(rankingRows, {
      ...DEFAULT_ABILITY_PRIORITY,
      pickWeight: 0,
    })
    const pickOnly = calculateAbilityPriorities(rankingRows, {
      ...DEFAULT_ABILITY_PRIORITY,
      winWeight: 0,
    })
    expect(sortedNames(winOnly.priorities)).toEqual(['high-win', 'middle', 'early-pick'])
    expect(sortedNames(pickOnly.priorities)).toEqual(['early-pick', 'middle', 'high-win'])
  })

  it('allows a custom expression to change ranking while keeping average-pick units', () => {
    const byWinrate = calculateAbilityPriorities(rankingRows, {
      ...DEFAULT_ABILITY_PRIORITY,
      formula: '-winrate',
    })
    const byPick = calculateAbilityPriorities(rankingRows, {
      ...DEFAULT_ABILITY_PRIORITY,
      formula: 'avgPick',
    })
    expect(sortedNames(byWinrate.priorities)).toEqual(['high-win', 'middle', 'early-pick'])
    expect(sortedNames(byPick.priorities)).toEqual(['early-pick', 'middle', 'high-win'])
    expect(sampleSummary([...byWinrate.priorities.values()]).mean).toBeCloseTo(byWinrate.pick.mean)
    expect(sampleSummary([...byWinrate.priorities.values()]).std).toBeCloseTo(byWinrate.pick.std)
    for (const row of rankingRows)
      expect(byPick.priorities.get(row.name)).toBeCloseTo(row.pickRate!)
  })

  it('validates mode, finite coefficients, and formula syntax before accepting settings', () => {
    expect(validateAbilityPrioritySettings(DEFAULT_ABILITY_PRIORITY)).toEqual(
      DEFAULT_ABILITY_PRIORITY,
    )
    for (const value of [
      null,
      {},
      { ...DEFAULT_ABILITY_PRIORITY, mode: 'other' },
      { ...DEFAULT_ABILITY_PRIORITY, winWeight: NaN },
      { ...DEFAULT_ABILITY_PRIORITY, pickWeight: Infinity },
      { ...DEFAULT_ABILITY_PRIORITY, formula: 'unknownVariable' },
    ]) {
      expect(() => validateAbilityPrioritySettings(value)).toThrow()
    }
  })
})

describe('safe priority arithmetic', () => {
  it.each([
    ['2^3^2', 512],
    ['-2^2', -4],
    ['(-2)^2', 4],
    ['2^-2', 0.25],
    ['1 + 2 * 3', 7],
    ['=abs(-3) + SIGN(-2) + SQRT(9) + POWER(2,3)', 13],
    ['MIN(3, 1, 2) + MAX(3, 1, 2)', 4],
    ['.5 + 1e-2', 0.51],
  ])(
    'evaluates %s with arithmetic precedence and Excel-style exponentiation',
    (formula, expected) => {
      expect(compilePriorityFormula(formula)(variables)).toBeCloseTo(expected)
    },
  )

  it.each([
    'globalThis.process.exit()',
    'process.exit()',
    'Math.max(1,2)',
    'constructor',
    'constructor(1)',
    'toString(1)',
    '__proto__(1)',
    'eval(1)',
    'winZ; process.exit()',
    'winZ = 1',
    'winZ > 0 ? 1 : 2',
    'winZ[0]',
    '"winZ"',
    'otherWeight * winZ',
    'EXP(winZ)',
    'ABS()',
    'POWER(2)',
    'SIGN(1,2)',
    'winZ +',
    '(winZ',
    '',
    '=',
  ])('rejects JavaScript, unknown variables, or malformed syntax: %s', (formula) => {
    expect(() => compilePriorityFormula(formula)).toThrow()
  })

  it('bounds formula length, token count, nesting, and numeric literals', () => {
    for (const formula of [
      '1'.repeat(1001),
      Array(130).fill('1').join('+'),
      `${'('.repeat(40)}1${')'.repeat(40)}`,
      '1e999',
    ]) {
      expect(() => compilePriorityFormula(formula)).toThrow()
    }
  })

  it.each(['1 / 0', 'SQRT(-1)', 'POWER(10,1000)'])(
    'rejects non-finite evaluated results: %s',
    (formula) => {
      expect(() => compilePriorityFormula(formula)(variables)).toThrow()
      expect(() =>
        calculateAbilityPriorities(rankingRows, {
          ...DEFAULT_ABILITY_PRIORITY,
          formula,
        }),
      ).toThrow()
    },
  )
})

describe('priority population and degenerate inputs', () => {
  it('uses sample standard deviation as Excel STDEV does', () => {
    expect(sampleSummary([1, 2, 3])).toEqual({ mean: 2, std: 1 })
    expect(sampleSummary([4])).toEqual({ mean: 4, std: 0 })
    expect(sampleSummary([])).toEqual({ mean: 0, std: 0 })
  })

  it('excludes unknown frequency instead of substituting zero and accepts real zero frequency', () => {
    const rows: PriorityRow[] = [
      ...rankingRows,
      { name: 'missing-frequency', winrate: 0.99, pickRate: 1 },
      { name: 'null-frequency', winrate: 0.99, pickRate: 1, draftFrequency: null },
      { name: 'zero-frequency', winrate: 0.6, pickRate: 20, draftFrequency: 0 },
    ]
    const result = calculateAbilityPriorities(rows, DEFAULT_ABILITY_PRIORITY)
    const withoutMissing = calculateAbilityPriorities(
      rows.filter((row) => row.draftFrequency != null),
      DEFAULT_ABILITY_PRIORITY,
    )
    expect(result.count).toBe(4)
    expect(result.priorities.has('missing-frequency')).toBe(false)
    expect(result.priorities.has('null-frequency')).toBe(false)
    expect(Number.isFinite(result.priorities.get('zero-frequency'))).toBe(true)
    expect(result).toEqual(withoutMissing)
  })

  it('excludes unavailable and invalid source stats so they cannot poison the population', () => {
    const valid = rankingRows[0]
    const invalid: PriorityRow[] = [
      { ...valid, name: 'null-win', winrate: null },
      { ...valid, name: 'nan-win', winrate: NaN },
      { ...valid, name: 'infinite-win', winrate: Infinity },
      { ...valid, name: 'out-of-range-win', winrate: 1.1 },
      { ...valid, name: 'null-pick', pickRate: null },
      { ...valid, name: 'infinite-pick', pickRate: Infinity },
      { ...valid, name: 'nan-frequency', draftFrequency: NaN },
      { ...valid, name: 'negative-frequency', draftFrequency: -0.1 },
      { ...valid, name: 'out-of-range-frequency', draftFrequency: 1.1 },
    ]
    const result = calculateAbilityPriorities(
      [...rankingRows, ...invalid],
      DEFAULT_ABILITY_PRIORITY,
    )
    expect(result).toEqual(calculateAbilityPriorities(rankingRows, DEFAULT_ABILITY_PRIORITY))
  })

  it('returns finite ties at mean pick position when the entire population has zero variance', () => {
    const result = calculateAbilityPriorities(
      [
        { name: 'a', winrate: 0.5, pickRate: 12, draftFrequency: 1 },
        { name: 'b', winrate: 0.5, pickRate: 12, draftFrequency: 1 },
      ],
      DEFAULT_ABILITY_PRIORITY,
    )
    expect(result.win.std).toBe(0)
    expect(result.pick.std).toBe(0)
    expect([...result.priorities.values()]).toEqual([12, 12])
  })

  it('returns mean-pick ties for a constant formula without producing NaN', () => {
    const result = calculateAbilityPriorities(rankingRows, {
      ...DEFAULT_ABILITY_PRIORITY,
      formula: '0',
    })
    expect(result.raw.std).toBe(0)
    expect([...result.priorities.values()]).toEqual(rankingRows.map(() => result.pick.mean))
    expect([...result.priorities.values()].every(Number.isFinite)).toBe(true)
  })

  it('handles empty and single-row populations without producing NaN', () => {
    const empty = calculateAbilityPriorities([], DEFAULT_ABILITY_PRIORITY)
    expect(empty.count).toBe(0)
    expect(empty.priorities.size).toBe(0)
    expect(empty.win).toEqual({ mean: 0, std: 0 })
    expect(empty.pick).toEqual({ mean: 0, std: 0 })
    const single = calculateAbilityPriorities([rankingRows[0]], DEFAULT_ABILITY_PRIORITY)
    expect(single.priorities.get('high-win')).toBe(40)
  })

  it('converts lower priorities to higher finite bounded UI scores', () => {
    const priorities = [-20, 1, 25.5, 50, 100]
    const scores = priorities.map(priorityToScore)
    expect(scores.every((score) => Number.isFinite(score) && score > 0 && score < 1)).toBe(true)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    expect(priorityToScore(null)).toBe(0)
    expect(priorityToScore(25.5)).toBe(0.5)
  })
})
