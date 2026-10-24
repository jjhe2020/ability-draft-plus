import type { EnrichedScanSlot, HeroModelDisplay, OverlayDataPayload } from '@shared/types'

export interface PoolPriorityRow {
  key: string
  name: string
  priority: number | null
  picked: boolean
}

export interface PoolPrioritySummary {
  count: number
  missing: number
  mean: number | null
  variance: number | null
  std: number | null
  min: number | null
  median: number | null
  max: number | null
}

function finitePriority(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function sortRows(rows: PoolPriorityRow[]): PoolPriorityRow[] {
  return rows.sort((a, b) => {
    if (a.priority === null) return b.priority === null ? 0 : 1
    if (b.priority === null) return -1
    return a.priority - b.priority
  })
}

/** Rescans remove drafted abilities from the pool; keep them in the match distribution. */
export function ultimatePriorityRows(
  scan: NonNullable<OverlayDataPayload['scanData']>,
  unknownName: string,
  poolSize?: number,
): PoolPriorityRow[] {
  return abilityPriorityRows(
    scan.ultimates,
    scan.selectedAbilities.filter((slot) => slot.isUltimateFromDb || slot.is_ultimate),
    unknownName,
    poolSize,
  )
}

/** Normal abilities use their own match distribution, with drafted entries retained. */
export function standardPriorityRows(
  scan: NonNullable<OverlayDataPayload['scanData']>,
  unknownName: string,
  poolSize?: number,
): PoolPriorityRow[] {
  return abilityPriorityRows(
    scan.standard,
    scan.selectedAbilities.filter((slot) => !slot.isUltimateFromDb && !slot.is_ultimate),
    unknownName,
    poolSize,
  )
}

function abilityPriorityRows(
  pool: EnrichedScanSlot[],
  selected: EnrichedScanSlot[],
  unknownName: string,
  poolSize?: number,
): PoolPriorityRow[] {
  const rows = new Map<string, PoolPriorityRow>()
  const unknownKeys = new Set<string>()
  const add = (slot: EnrichedScanSlot, picked: boolean) => {
    const key = slot.name ?? `unknown:${slot.hero_order}:${slot.ability_order}`
    if (slot.isUnknown || !slot.name) unknownKeys.add(key)
    else unknownKeys.delete(key)
    rows.set(key, {
      key,
      name: slot.isUnknown || !slot.name ? unknownName : slot.displayName,
      priority: slot.isUnknown || !slot.name ? null : finitePriority(slot.formulaPriority),
      picked,
    })
  }
  for (const slot of pool) add(slot, false)
  for (const slot of selected) {
    // A blank selected box is not evidence of an additional pool entry.
    if (slot.name) add(slot, true)
  }
  // An initially unidentified ability can later be recognized in a picked box.
  // Replace excess unknown placeholders using the layout's original pool size,
  // rather than counting the same entry twice and growing the match pool.
  if (poolSize !== undefined && poolSize > 0) {
    let excess = rows.size - poolSize
    for (const key of unknownKeys) {
      if (excess <= 0) break
      rows.delete(key)
      excess--
    }
  }
  return sortRows([...rows.values()])
}

export function modelPriorityRows(models: HeroModelDisplay[]): PoolPriorityRow[] {
  return sortRows(
    models.map((model) => ({
      key: `model:${model.heroOrder}`,
      name: model.heroDisplayName,
      priority: model.dbHeroId === null ? null : finitePriority(model.formulaPriority),
      picked: model.isPicked ?? false,
    })),
  )
}

export function summarizePoolPriorities(rows: PoolPriorityRow[]): PoolPrioritySummary {
  const values = rows
    .map((row) => row.priority)
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .sort((a, b) => a - b)
  const count = values.length
  if (count === 0) {
    return {
      count: 0,
      missing: rows.length,
      mean: null,
      variance: null,
      std: null,
      min: null,
      median: null,
      max: null,
    }
  }
  const mean = values.reduce((sum, value) => sum + value / count, 0)
  // This is the entire observed match pool, so use population variance (divide by N).
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2 / count, 0)
  const middle = Math.floor(count / 2)
  return {
    count,
    missing: rows.length - count,
    mean,
    variance,
    std: Math.sqrt(variance),
    min: values[0],
    median: count % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
    max: values[count - 1],
  }
}

const GREEN = [99, 190, 123]
const YELLOW = [255, 235, 132]
const RED = [248, 105, 107]

/** Excel green/yellow/red scale: lowest, 50th percentile, highest, within each table. */
export function poolPriorityColor(value: number | null, summary: PoolPrioritySummary): string {
  const { min, median, max } = summary
  if (
    value === null ||
    !Number.isFinite(value) ||
    min === null ||
    median === null ||
    max === null
  ) {
    return 'transparent'
  }
  if (min === max) return '#ffeb84'
  if (value <= min) return '#63be7b'
  if (value >= max) return '#f8696b'
  const lower = value <= median
  const from = lower ? GREEN : YELLOW
  const to = lower ? YELLOW : RED
  const start = lower ? min : median
  const end = lower ? median : max
  const ratio = end === start ? 0 : Math.max(0, Math.min(1, (value - start) / (end - start)))
  return `#${from
    .map((channel, i) =>
      Math.round(channel + (to[i] - channel) * ratio)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}
