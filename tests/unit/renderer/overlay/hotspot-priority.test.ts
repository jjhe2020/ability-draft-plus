// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { EnrichedScanSlot, HeroModelDisplay, SlotCoordinate } from '@shared/types'
import { AbilityHotspot } from '../../../../src/renderer/overlay/src/components/AbilityHotspot'
import { HeroModelHotspot } from '../../../../src/renderer/overlay/src/components/HeroModelHotspot'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { value: string }) => (options ? `公式选位：${options.value}` : key),
  }),
}))

const coord: SlotCoordinate = { x: 100, y: 100, width: 48, height: 48, hero_order: 0 }

function ability(overrides: Partial<EnrichedScanSlot> = {}): EnrichedScanSlot {
  return {
    name: 'axe_culling_blade',
    displayName: '淘汰之刃',
    confidence: 1,
    hero_order: 0,
    ability_order: 3,
    is_ultimate: true,
    coord,
    winrate: 0.5,
    pickRate: 22,
    consolidatedScore: 0.7,
    formulaPriority: -3.145,
    isGeneralTopTier: true,
    isSynergySuggestionForMySpot: false,
    isUltimateFromDb: true,
    highWinrateCombinations: [],
    lowWinrateCombinations: [],
    strongHeroSynergies: [],
    weakHeroSynergies: [],
    ...overrides,
  }
}

function model(overrides: Partial<HeroModelDisplay> = {}): HeroModelDisplay {
  return {
    heroOrder: 0,
    heroName: 'npc_dota_hero_axe',
    heroDisplayName: '斧王',
    dbHeroId: 1,
    winrate: 0.5,
    pickRate: 20,
    consolidatedScore: 0.7,
    formulaPriority: 0,
    isGeneralTopTier: true,
    identificationConfidence: 1,
    strongAbilitySynergies: [],
    weakAbilitySynergies: [],
    ...overrides,
  }
}

function renderAbility(slot: EnrichedScanSlot, isSelectedAbility = false, priorityColor?: string) {
  const onHover = vi.fn()
  const onLeave = vi.fn()
  const view = render(
    createElement(AbilityHotspot, {
      slot,
      scaleFactor: 1,
      isSelectedAbility,
      isMySpotHero: false,
      priorityColor,
      onHover,
      onLeave,
    }),
  )
  return { ...view, onHover, onLeave }
}

afterEach(cleanup)

describe('GGXGG numbers inside draft hotspots', () => {
  const priorityColors = [
    ['#63be7b', 'rgb(99, 190, 123)'],
    ['#ffeb84', 'rgb(255, 235, 132)'],
    ['#f8696b', 'rgb(248, 105, 107)'],
  ] as const

  it.each(priorityColors)(
    'colors a finite skill priority with the supplied %s',
    (priorityColor, expectedColor) => {
      renderAbility(ability(), false, priorityColor)
      expect(screen.getByLabelText('公式选位：-3.15').style.color).toBe(expectedColor)
      expect(screen.getByLabelText('淘汰之刃').className).toContain('shimmer-green')
    },
  )

  it.each(priorityColors)(
    'colors a finite model priority with the supplied %s',
    (priorityColor, expectedColor) => {
      render(
        createElement(HeroModelHotspot, {
          model: model(),
          coord,
          scaleFactor: 1,
          isMyModel: false,
          priorityColor,
          onHover: vi.fn(),
          onLeave: vi.fn(),
        }),
      )
      expect(screen.getByLabelText('公式选位：0.00').style.color).toBe(expectedColor)
      expect(screen.getByLabelText('斧王').className).toContain('shimmer-gold')
    },
  )

  it.each([true, false])(
    'shows ultimate=%s priority before hovering and keeps tooltip events',
    (isUltimate) => {
      const slot = ability({ is_ultimate: isUltimate, isUltimateFromDb: isUltimate })
      const { onHover, onLeave } = renderAbility(slot)
      expect(screen.getByLabelText('公式选位：-3.15').textContent).toBe('-3.15')
      const hotspot = screen.getByLabelText('淘汰之刃')
      expect(hotspot.className).toContain('shimmer-green')
      expect(onHover).not.toHaveBeenCalled()
      fireEvent.mouseEnter(hotspot)
      expect(onHover.mock.calls[0][0]).toBe(slot)
      fireEvent.mouseLeave(hotspot)
      expect(onLeave).toHaveBeenCalledOnce()
    },
  )

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY])(
    'does not turn missing or invalid priority %s into zero',
    (priority) => {
      const { unmount } = renderAbility(ability({ formulaPriority: priority }), false, '#63be7b')
      const skillBadge = screen.getByLabelText('tooltip.formulaPriorityMissing')
      expect(skillBadge.textContent).toBe('—')
      expect(skillBadge.style.color).toBe('')
      expect(skillBadge.className).toContain('formula-priority-badge-missing')
      expect(screen.queryByText('0.00')).toBeNull()
      unmount()
      render(
        createElement(HeroModelHotspot, {
          model: model({ formulaPriority: priority }),
          coord,
          scaleFactor: 1,
          isMyModel: false,
          priorityColor: '#63be7b',
          onHover: vi.fn(),
          onLeave: vi.fn(),
        }),
      )
      const modelBadge = screen.getByLabelText('tooltip.formulaPriorityMissing')
      expect(modelBadge.textContent).toBe('—')
      expect(modelBadge.style.color).toBe('')
      expect(modelBadge.className).toContain('formula-priority-badge-missing')
      expect(screen.queryByText('0.00')).toBeNull()
    },
  )

  it('leaves unidentified and already selected skill boxes unobscured', () => {
    const { unmount } = renderAbility(ability({ isUnknown: true }))
    expect(screen.queryByText('-3.15')).toBeNull()
    unmount()
    renderAbility(ability(), true, '#63be7b')
    expect(screen.queryByText('-3.15')).toBeNull()
  })

  it('supports payloads without formula calculations', () => {
    renderAbility(ability({ formulaPriority: undefined }), false, '#63be7b')
    expect(screen.queryByText('—')).toBeNull()
    expect(screen.queryByText('-3.15')).toBeNull()
  })

  it('shrinks long negative values within the frame while retaining their complete accessible value', () => {
    renderAbility(ability({ formulaPriority: -123456.78 }))
    const badge = screen.getByLabelText('公式选位：-123456.78')
    expect(badge.textContent).toBe('-123456.78')
    expect(badge.style.fontSize).toBe('8px')
  })

  it('shows the model priority including a valid zero and preserves model highlighting', () => {
    const onHover = vi.fn()
    const hero = model({ isPicked: true })
    render(
      createElement(HeroModelHotspot, {
        model: hero,
        coord,
        scaleFactor: 1,
        isMyModel: true,
        onHover,
        onLeave: vi.fn(),
      }),
    )
    expect(screen.getByLabelText('公式选位：0.00').textContent).toBe('0.00')
    const hotspot = screen.getByLabelText('斧王')
    expect(hotspot.className).toContain('is-my-model')
    expect(onHover).not.toHaveBeenCalled()
    fireEvent.mouseEnter(hotspot)
    expect(onHover.mock.calls[0][0]).toBe(hero)
  })
})
