// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ABILITY_PRIORITY, type PriorityRow } from '@shared/ability-priority'
import type { AbilityDetail, Hero } from '@shared/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.error ? `${key}: ${options.error}` : key,
    i18n: { language: 'en' },
  }),
}))
vi.mock('../../../src/renderer/control-panel/src/components/ui/card', () => ({
  Card: (props: Record<string, unknown>) => createElement('div', props),
  CardContent: (props: Record<string, unknown>) => createElement('div', props),
  CardDescription: (props: Record<string, unknown>) => createElement('div', props),
  CardHeader: (props: Record<string, unknown>) => createElement('div', props),
  CardTitle: (props: Record<string, unknown>) => createElement('div', props),
}))
vi.mock('../../../src/renderer/control-panel/src/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) => createElement('input', props),
}))
vi.mock('../../../src/renderer/control-panel/src/components/ui/button', () => ({
  Button: (props: Record<string, unknown>) => createElement('button', props),
}))

import { AbilityPriorityCard } from '../../../src/renderer/control-panel/src/components/settings/ability-priority-card'

const abilities: AbilityDetail[] = [
  {
    abilityId: 1, name: 'earthshaker_aftershock', displayName: 'Aftershock', heroId: 1,
    winrate: 0.6, highSkillWinrate: null, pickRate: 20, hsPickRate: null,
    draftFrequency: 1, isUltimate: false, abilityOrder: 3,
  },
  {
    abilityId: 2, name: 'weaver_shukuchi', displayName: 'Shukuchi', heroId: 2,
    winrate: 0.4, highSkillWinrate: null, pickRate: 20, hsPickRate: null,
    draftFrequency: 1, isUltimate: false, abilityOrder: 2,
  },
]
const heroes: Hero[] = [{
  heroId: 1, name: 'npc_dota_hero_axe', displayName: 'Axe', winrate: 0.99,
  highSkillWinrate: null, pickRate: 1000, hsPickRate: null, draftFrequency: 1, windrunId: 2,
}]
const population: PriorityRow[] = [
  ...abilities,
  { name: 'hero:npc_dota_hero_axe', winrate: 0.5, pickRate: 30, draftFrequency: 1 },
]

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'abilityPriority.save' }) as HTMLButtonElement
}

describe('AbilityPriorityCard', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'electronApi', {
      configurable: true,
      value: {
        invoke: vi.fn((channel: string) => Promise.resolve(
          channel === 'ability:getAll' ? abilities :
            channel === 'ability:getPriorityPopulation' ? population : heroes,
        )),
      },
    })
  })
  afterEach(cleanup)

  it('reorders a live preview and uses the complete patch snapshot instead of stale DB heroes', async () => {
    render(createElement(AbilityPriorityCard, { currentValue: DEFAULT_ABILITY_PRIORITY, onSave: vi.fn() }))
    await screen.findByText('Aftershock')
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')[1].textContent).toContain('Aftershock')

    fireEvent.change(screen.getByLabelText('abilityPriority.formula'), { target: { value: 'winZ' } })
    const rows = within(table).getAllByRole('row')
    expect(rows[1].textContent).toContain('Shukuchi')
    expect(rows[1].textContent).toContain('17.56')
    expect(rows[2].textContent).toContain('Aftershock')
    expect(rows[2].textContent).toContain('29.11')
    expect(saveButton().disabled).toBe(false)
  })

  it('rejects runtime failures in every snapshot row, including heroes outside the displayed list', async () => {
    const onSave = vi.fn()
    render(createElement(AbilityPriorityCard, { currentValue: DEFAULT_ABILITY_PRIORITY, onSave }))
    await screen.findByText('Aftershock')
    // Both displayed abilities are finite; the hero row has winrate=0.5.
    fireEvent.change(screen.getByLabelText('abilityPriority.formula'), {
      target: { value: '1 / (winrate - 0.5)' },
    })
    expect(screen.getByRole('alert').textContent).toContain('非有限值')
    expect(saveButton().disabled).toBe(true)
    fireEvent.click(saveButton())
    expect(onSave).not.toHaveBeenCalled()
  })

  it('keeps edits after a save failure, allows retry, and clears dirty state only after success', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('write failed')).mockResolvedValueOnce(undefined)
    render(createElement(AbilityPriorityCard, { currentValue: DEFAULT_ABILITY_PRIORITY, onSave }))
    await screen.findByText('Aftershock')
    fireEvent.change(screen.getByLabelText('abilityPriority.formula'), { target: { value: 'winZ' } })
    fireEvent.click(saveButton())
    expect((await screen.findByRole('alert')).textContent).toContain('write failed')
    expect((screen.getByLabelText('abilityPriority.formula') as HTMLTextAreaElement).value).toBe('winZ')
    expect(saveButton().disabled).toBe(false)

    fireEvent.click(saveButton())
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('abilityPriority.saved'))
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenLastCalledWith('abilityPriority', { ...DEFAULT_ABILITY_PRIORITY, formula: 'winZ' })
    expect(saveButton().disabled).toBe(true)
  })

  it('exposes missing-frequency data and keeps the legacy mode available without a custom preview', async () => {
    vi.mocked(window.electronApi.invoke).mockImplementation((channel) => Promise.resolve(
      channel === 'ability:getAll' ? abilities.map((ability) => ({ ...ability, draftFrequency: null })) :
        channel === 'ability:getPriorityPopulation' ? null : [],
    ) as never)
    render(createElement(AbilityPriorityCard, { currentValue: DEFAULT_ABILITY_PRIORITY, onSave: vi.fn() }))
    await screen.findByText('abilityPriority.missingData')
    fireEvent.change(screen.getByLabelText('abilityPriority.formula'), { target: { value: 'winZ' } })
    expect(saveButton().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('abilityPriority.mode'), { target: { value: 'standard' } })
    expect(saveButton().disabled).toBe(false)
  })
})
