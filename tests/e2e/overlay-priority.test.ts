import { test, expect, _electron as electron, type Page } from '@playwright/test'
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, dirname, basename } from 'node:path'
import { scaleCoordinates } from '../../src/core/resolution/scaling-engine'
import type {
  EnrichedScanSlot,
  HeroModelDisplay,
  OverlayDataPayload,
  ResolutionLayout,
} from '../../src/shared/types'

const ULTIMATES = [
  'abaddon_borrowed_time',
  'axe_culling_blade',
  'bane_fiends_grip',
  'beastmaster_primal_roar',
  'bloodseeker_rupture',
  'crystal_maiden_freezing_field',
  'earthshaker_echo_slam',
  'enigma_black_hole',
  'faceless_void_chronosphere',
  'lina_laguna_blade',
  'lion_finger_of_death',
  'tidehunter_ravage',
]
const HEROES = [
  'abaddon',
  'axe',
  'bane',
  'beastmaster',
  'bloodseeker',
  'crystal_maiden',
  'earthshaker',
  'enigma',
  'faceless_void',
  'lina',
  'lion',
  'tidehunter',
]
const PRIORITIES = [-5, 0, 5, 10, 15, 20, 20, 25, 30, 35, 40, 45]
const STANDARD = [
  {
    name: 'earthshaker_aftershock',
    displayName: '余震',
    priority: -50,
    color: 'rgb(99, 190, 123)',
  },
  { name: 'pugna_nether_blast', displayName: '幽冥爆轰', priority: 0, color: 'rgb(255, 235, 132)' },
  { name: 'lina_dragon_slave', displayName: '龙破斩', priority: 50, color: 'rgb(248, 105, 107)' },
]

async function makePayload(resolution = '1920x1080'): Promise<OverlayDataPayload> {
  const layouts = JSON.parse(
    await readFile(resolve('resources/config/layout_coordinates.json'), 'utf8'),
  )
  const layout =
    resolution === '5120x2160'
      ? scaleCoordinates(layouts.resolutions['3440x1440'], 5120, 2160, 3440, 1440)
      : (layouts.resolutions[resolution] as ResolutionLayout)
  const names = JSON.parse(
    await readFile(resolve('src/shared/localization/dota-names.zh-CN.json'), 'utf8'),
  )
  const ultimates: EnrichedScanSlot[] = ULTIMATES.map((name, i) => ({
    name,
    displayName: names.abilities[name].en,
    confidence: 0.99,
    hero_order: layout.ultimate_slots_coords[i].hero_order,
    ability_order: 3,
    is_ultimate: true,
    coord: layout.ultimate_slots_coords[i],
    winrate: 0.5,
    pickRate: 25,
    consolidatedScore: 0.5,
    formulaPriority: PRIORITIES[i],
    isGeneralTopTier: i < 2,
    isSynergySuggestionForMySpot: false,
    isUltimateFromDb: true,
    highWinrateCombinations: [],
    lowWinrateCombinations: [],
    strongHeroSynergies: [],
    weakHeroSynergies: [],
  }))
  const heroModels: HeroModelDisplay[] = HEROES.map((heroName, i) => ({
    heroOrder: layout.models_coords![i].hero_order,
    heroName,
    heroDisplayName: names.heroes[heroName].en,
    dbHeroId: i + 1,
    winrate: 0.5,
    pickRate: 25,
    consolidatedScore: 0.5,
    formulaPriority: PRIORITIES[i],
    isGeneralTopTier: i < 2,
    identificationConfidence: 0.99,
    strongAbilitySynergies: [],
    weakAbilitySynergies: [],
  }))
  // A different numeric range proves that standard abilities use their own scale.
  const standard: EnrichedScanSlot[] = STANDARD.map((ability, i) => ({
    ...ultimates[i],
    name: ability.name,
    displayName: names.abilities[ability.name].en,
    hero_order: layout.standard_slots_coords[i].hero_order,
    ability_order: layout.standard_slots_coords[i].ability_order ?? 0,
    coord: layout.standard_slots_coords[i],
    is_ultimate: false,
    isUltimateFromDb: false,
    formulaPriority: ability.priority,
    isGeneralTopTier: false,
  }))
  return {
    initialSetup: false,
    scanData: { ultimates, standard, selectedAbilities: [] },
    targetResolution: resolution,
    scaleFactor: 1,
    opCombinations: [],
    trapCombinations: [],
    heroSynergies: [],
    heroTraps: [],
    heroModels,
    heroesForMySpotUI: [],
    selectedHeroForDraftingDbId: null,
    selectedSpotHeroOrder: null,
    selectedModelHeroOrder: null,
    heroesCoords: [],
    heroesParams: layout.heroes_params,
    modelsCoords: layout.models_coords!,
  }
}

async function checkHeatmap(page: Page): Promise<void> {
  for (const name of ['本场终极技能', '本场英雄模型']) {
    const table = page.getByRole('table', { name, exact: true })
    await expect(table.locator('tbody tr')).toHaveCount(12)
    await expect(table.locator('tbody tr[data-priority="-5"] .pool-priority-value')).toHaveCSS(
      'background-color',
      'rgb(99, 190, 123)',
    )
    await expect(
      table.locator('tbody tr[data-priority="20"] .pool-priority-value').first(),
    ).toHaveCSS('background-color', 'rgb(255, 235, 132)')
    await expect(table.locator('tbody tr[data-priority="45"] .pool-priority-value')).toHaveCSS(
      'background-color',
      'rgb(248, 105, 107)',
    )
  }
}

async function checkBadgeColors(page: Page): Promise<Record<string, string>> {
  const colors: Record<string, string> = {}
  for (const [title, selector] of [
    ['本场终极技能', '.ability-hotspot'],
    ['本场英雄模型', '.hero-model-hotspot'],
  ]) {
    const rows = page.getByRole('table', { name: title, exact: true }).locator('tbody tr')
    for (const row of await rows.all()) {
      const name = (await row.locator('th span').first().innerText()).trim()
      const badge = page
        .locator(selector)
        .and(page.getByLabel(name, { exact: true }))
        .locator('.formula-priority-badge')
      // Already picked abilities have no pool badge, while their table row remains.
      if ((await badge.count()) === 0 && (await row.innerText()).includes('已选')) continue
      await expect(badge).toHaveCount(1)
      const value = row.locator('.pool-priority-value')
      const color = await value.evaluate((cell) => getComputedStyle(cell).backgroundColor)
      await expect(badge).toHaveCSS('color', color)
      await expect(badge).toHaveText((await value.innerText()).trim())
      colors[`${title}:${name}`] = color
    }
  }
  for (const ability of STANDARD) {
    const badge = page
      .locator('.ability-hotspot')
      .and(page.getByLabel(ability.displayName, { exact: true }))
      .locator('.formula-priority-badge')
    await expect(badge).toHaveText(ability.priority.toFixed(2))
    await expect(badge).toHaveCSS('color', ability.color)
    colors[`standard:${ability.name}`] = await badge.evaluate(
      (element) => getComputedStyle(element).color,
    )
  }
  return colors
}

async function checkCompletePanels(page: Page): Promise<void> {
  for (const panel of await page.locator('.pool-priority-panel').all()) {
    for (const target of [
      panel.locator('tbody tr').last(),
      panel.locator('.pool-priority-stats'),
    ]) {
      const clippedBy = await target.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        const clipped: string[] = []
        if (bounds.top < -1 || bounds.bottom > innerHeight + 1) clipped.push('viewport')
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) continue
          const outer = parent.getBoundingClientRect()
          const top = outer.top + parent.clientTop
          if (bounds.top < top - 1 || bounds.bottom > top + parent.clientHeight + 1) {
            clipped.push(parent.className || parent.tagName)
          }
        }
        return clipped
      })
      expect(clippedBy, 'Each table last row and statistics must fit without scrolling').toEqual([])
    }
  }
}

test('overlay shows full match GGXGG distributions and numbers without hovering', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ability-draft-plus-overlay-priority-'))
  const entry = join(profile, 'entry.cjs')
  // A real preload + bridge with no game capture, model worker or user database.
  await writeFile(
    entry,
    [
      "const { app, BrowserWindow, ipcMain } = require('electron');",
      "const { createRequire } = require('node:module');",
      `const requireProject = createRequire(${JSON.stringify(resolve('package.json'))});`,
      "const { createStore } = requireProject('zustand/vanilla');",
      "const { createZustandBridge } = requireProject('@zubridge/electron/main');",
      `app.setPath('userData', ${JSON.stringify(profile)});`,
      "ipcMain.handle('overlay:getInitialData', () => null);",
      "ipcMain.on('overlay:setMouseIgnore', () => {});",
      'app.whenReady().then(async () => {',
      "  const store = createStore(() => ({ language: 'zh-CN', overlayOpacity: 1, overlayAnchor: 'right', activeResolution: '1920x1080', activeResolutionSource: 'preset' }));",
      '  globalThis.overlayPriorityTestStore = store;',
      '  const bridge = createZustandBridge(store, { handlers: {} });',
      `  const win = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true, frame: false, webPreferences: { preload: ${JSON.stringify(resolve('out/preload/overlay.js'))}, contextIsolation: true, sandbox: false, nodeIntegration: false, backgroundThrottling: false } });`,
      '  bridge.subscribe([win]);',
      `  await win.loadFile(${JSON.stringify(resolve('out/renderer/overlay/index.html'))});`,
      '});',
    ].join('\n'),
  )
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [entry], env })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('toolbar', { name: '覆盖层控件' })).toBeVisible()
    // A screenshot-only mock game surface makes the transparent overlay inspectable.
    // These backgrounds are deliberately generic and never enter production code.
    await page.addStyleTag({
      content: `
      body { background: radial-gradient(ellipse at 50% 40%, #233343, #101820) !important; }
      .ability-hotspot { background: linear-gradient(140deg, #526f6c, #21343b); }
      .hero-model-hotspot { background: linear-gradient(140deg, #596172, #293348); }
      .ability-hotspot::before, .hero-model-hotspot::before {
        position: absolute; inset: 0; display: grid; place-items: center;
        color: #d1dadc; font-size: 9px; pointer-events: none;
      }
      .ability-hotspot::before { content: '技能'; }
      .hero-model-hotspot::before { content: '模型'; }
    `,
    })
    await page.evaluate(() => {
      const note = document.createElement('p')
      note.textContent = 'GGXGG 选位显示 · 测试数据示例'
      note.style.cssText =
        'position:fixed;top:45px;left:35%;color:#b9c6d1;font-size:18px;pointer-events:none'
      note.setAttribute('aria-hidden', 'true')
      document.body.prepend(note)
    })
    const payload = await makePayload()
    const sendPayload = async (data: OverlayDataPayload): Promise<void> => {
      await app!.evaluate(({ BrowserWindow }, value) => {
        BrowserWindow.getAllWindows()[0].webContents.send('overlay:data', value)
      }, data)
    }
    await sendPayload(payload)
    await checkHeatmap(page)
    const initialBadgeColors = await checkBadgeColors(page)
    await expect(page.locator('.pool-priority-table tbody tr')).toHaveCount(24)
    await expect(
      page
        .getByRole('table', { name: '本场终极技能', exact: true })
        .getByText('回光返照', { exact: true }),
    ).toBeVisible()
    await expect(
      page
        .getByRole('table', { name: '本场英雄模型', exact: true })
        .getByText('亚巴顿', { exact: true }),
    ).toBeVisible()
    await expect(page.locator('.pool-priority-panels')).not.toContainText('Borrowed Time')
    await expect(page.locator('.overlay-tooltip')).toHaveCount(0)
    await expect(page.locator('.formula-priority-badge')).toHaveCount(27)
    await expect(page.locator('.ability-hotspot .formula-priority-badge').first()).toHaveText(
      '-5.00',
    )
    await expect(page.locator('.hero-model-hotspot .formula-priority-badge').first()).toHaveText(
      '-5.00',
    )
    await expect(page.locator('.ability-hotspot .formula-priority-badge').first()).toBeVisible()
    await expect(page.locator('.hero-model-hotspot .formula-priority-badge').first()).toBeVisible()
    await expect(page.locator('.pool-priority-panels')).toContainText('方差')
    await expect(page.locator('.pool-priority-panels')).toContainText('229.17')

    await mkdir(resolve('test-results'), { recursive: true })
    await page.screenshot({ path: resolve('test-results/overlay-priority-initial.png') })

    // Selecting an ultimate changes remaining tiles but retains its full-match row.
    const rescan: OverlayDataPayload = {
      ...payload,
      scanData: {
        ...payload.scanData!,
        ultimates: payload.scanData!.ultimates.slice(1),
        selectedAbilities: [
          {
            ...payload.scanData!.ultimates[0],
            coord: { x: 300, y: 350, width: 40, height: 40, hero_order: 0 },
          },
        ],
      },
      heroModels: payload.heroModels.map((model, i) => ({ ...model, isPicked: i === 0 })),
    }
    await sendPayload(rescan)
    await checkHeatmap(page)
    const rescannedBadgeColors = await checkBadgeColors(page)
    for (const [name, color] of Object.entries(rescannedBadgeColors)) {
      expect(color, `Rescanning must preserve the full-match scale for ${name}`).toBe(
        initialBadgeColors[name],
      )
    }
    const pickedUltimate = page
      .getByRole('table', { name: '本场终极技能', exact: true })
      .locator('tbody tr')
      .filter({ hasText: '回光返照' })
    await expect(pickedUltimate).toContainText('已选')
    await expect(
      page
        .getByRole('table', { name: '本场英雄模型', exact: true })
        .locator('tbody tr')
        .filter({ hasText: '亚巴顿' }),
    ).toContainText('已选')
    await expect(page.locator('.formula-priority-badge')).toHaveCount(26)
    await page.screenshot({ path: resolve('test-results/overlay-priority-rescan.png') })

    // Both tables can be collapsed and reopened independently.
    for (const panel of await page.locator('.pool-priority-panel').all()) {
      await panel.locator('summary').click()
      await expect(panel.locator('table')).toBeHidden()
      await panel.locator('summary').click()
      await expect(panel.locator('table')).toBeVisible()
    }

    // Overlay captures must hide every filled label and the separate table panel.
    await page.locator('.overlay-root').evaluate((root) => root.classList.add('capture-mode'))
    await expect(page.locator('.pool-priority-panels')).toBeHidden()
    for (const badge of await page.locator('.formula-priority-badge').all()) {
      await expect(badge).toBeHidden()
    }
    await page.locator('.overlay-root').evaluate((root) => root.classList.remove('capture-mode'))
    await expect(page.locator('.pool-priority-panels')).toBeVisible()

    // Simulate physical 1920px coordinates on a 150% desktop (1280 CSS pixels).
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1280, 720),
    )
    await sendPayload({ ...payload, scaleFactor: 1.5 })
    await checkHeatmap(page)
    await checkBadgeColors(page)
    const firstHotspot = await page.locator('.ability-hotspot').first().boundingBox()
    expect(firstHotspot).not.toBeNull()
    expect(firstHotspot!.x).toBeCloseTo(payload.scanData!.ultimates[0].coord.x / 1.5, 0)
    expect(firstHotspot!.width).toBeCloseTo(payload.scanData!.ultimates[0].coord.width / 1.5, 0)
    const panelBounds = await page.locator('.pool-priority-panels').boundingBox()
    expect(panelBounds).not.toBeNull()
    expect(panelBounds!.x).toBeGreaterThanOrEqual(0)
    expect(panelBounds!.x + panelBounds!.width).toBeLessThanOrEqual(1280)
    expect(panelBounds!.y + panelBounds!.height).toBeLessThanOrEqual(720)
    await checkCompletePanels(page)
    for (const selector of ['.ability-hotspot', '.hero-model-hotspot']) {
      const badge = page.locator(`${selector} .formula-priority-badge`).first()
      await expect(badge).toHaveText('-5.00')
      const metrics = await badge.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        fontSize: getComputedStyle(element).fontSize,
        frameWidth: element.parentElement!.getBoundingClientRect().width,
      }))
      expect(
        metrics.scrollWidth,
        `${selector} badge must show the complete value: ${JSON.stringify(metrics)}`,
      ).toBeLessThanOrEqual(metrics.clientWidth)
    }
    await page.screenshot({ path: resolve('test-results/overlay-priority-150-percent.png') })

    // Check the actual 1366x768 preset as well as the logical-pixel DPI scenario.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(1366, 768),
    )
    const smallPayload = await makePayload('1366x768')
    await sendPayload(smallPayload)
    await checkHeatmap(page)
    await checkBadgeColors(page)
    const smallHotspot = await page.locator('.ability-hotspot').first().boundingBox()
    expect(smallHotspot!.x).toBeCloseTo(smallPayload.scanData!.ultimates[0].coord.x, 0)
    const smallPanelBounds = await page.locator('.pool-priority-panels').boundingBox()
    expect(smallPanelBounds!.y + smallPanelBounds!.height).toBeLessThanOrEqual(768)
    expect(smallPanelBounds!.x + smallPanelBounds!.width).toBeLessThanOrEqual(1366)
    await checkCompletePanels(page)
    for (const panel of await page.locator('.pool-priority-panel').all()) {
      await panel.locator('summary').click()
      await expect(panel.locator('table')).toBeHidden()
      await panel.locator('summary').click()
      await expect(panel.locator('table')).toBeVisible()
    }
    await page.screenshot({ path: resolve('test-results/overlay-priority-1366.png') })

    // The live 5120x2160 desktop uses 150% DPI and the 3440x1440 auto-scale base.
    // Keep this regression isolated in the hidden test process, away from Dota.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(3413, 1440)
      const store = (
        globalThis as unknown as {
          overlayPriorityTestStore: {
            setState: (value: { activeResolution: string; activeResolutionSource: string }) => void
          }
        }
      ).overlayPriorityTestStore
      store.setState({ activeResolution: '5120x2160', activeResolutionSource: 'auto-scaled' })
    })
    const ultraWidePayload = { ...(await makePayload('5120x2160')), scaleFactor: 1.5 }
    await sendPayload(ultraWidePayload)
    await checkHeatmap(page)
    await checkBadgeColors(page)
    await expect(page.locator('.pool-priority-table tbody tr')).toHaveCount(24)
    await expect(page.locator('.formula-priority-badge')).toHaveCount(27)
    await checkCompletePanels(page)
    await expect(page.locator('.resolution-badge')).toContainText('5120x2160')
    const ultraWideFirstSlot = ultraWidePayload.scanData!.ultimates[0].coord
    const ultraWideFirstFrame = await page.locator('.ability-hotspot').first().boundingBox()
    expect(ultraWideFirstFrame!.x).toBeCloseTo(ultraWideFirstSlot.x / 1.5, 0)
    expect(ultraWideFirstFrame!.y).toBeCloseTo(ultraWideFirstSlot.y / 1.5, 0)
    expect(ultraWideFirstFrame!.width).toBeCloseTo(ultraWideFirstSlot.width / 1.5, 0)
    expect(ultraWideFirstFrame!.height).toBeCloseTo(ultraWideFirstSlot.height / 1.5, 0)

    const badgeIssues = await page.locator('.formula-priority-badge').evaluateAll((badges) =>
      badges.flatMap((badge) => {
        const frame = badge.closest('.ability-hotspot, .hero-model-hotspot')!
        const label = badge as HTMLElement
        const inner = label.getBoundingClientRect()
        const outer = frame.getBoundingClientRect()
        const issues: string[] = []
        if (label.scrollWidth > label.clientWidth) issues.push('text clipped')
        if (
          inner.left < outer.left - 0.5 ||
          inner.right > outer.right + 0.5 ||
          inner.top < outer.top - 0.5 ||
          inner.bottom > outer.bottom + 0.5
        )
          issues.push('outside icon frame')
        if (
          inner.left < 0 ||
          inner.right > innerWidth ||
          inner.top < 0 ||
          inner.bottom > innerHeight
        )
          issues.push('outside viewport')
        return issues.map((issue) => ({
          name: frame.getAttribute('aria-label'),
          value: label.textContent,
          issue,
          clientWidth: label.clientWidth,
          scrollWidth: label.scrollWidth,
          font: getComputedStyle(label).fontSize,
        }))
      }),
    )
    expect(badgeIssues, 'Ultra-wide badges must fit their actual icon frames in full').toEqual([])

    const layouts = JSON.parse(
      await readFile(resolve('resources/config/layout_coordinates.json'), 'utf8'),
    )
    const scaledLayout = scaleCoordinates(layouts.resolutions['3440x1440'], 5120, 2160, 3440, 1440)
    const ultraWidePanel = (await page.locator('.pool-priority-panels').boundingBox())!
    expect(ultraWidePanel.x).toBeGreaterThanOrEqual(0)
    expect(ultraWidePanel.x + ultraWidePanel.width).toBeLessThanOrEqual(3413)
    const intersectingFrames = [
      ...scaledLayout.ultimate_slots_coords,
      ...scaledLayout.standard_slots_coords,
      ...scaledLayout.models_coords!,
    ].filter(
      (coord) =>
        coord.x / 1.5 < ultraWidePanel.x + ultraWidePanel.width &&
        (coord.x + coord.width) / 1.5 > ultraWidePanel.x &&
        coord.y / 1.5 < ultraWidePanel.y + ultraWidePanel.height &&
        (coord.y + coord.height) / 1.5 > ultraWidePanel.y,
    )
    expect(
      intersectingFrames,
      'Distribution tables must not cover any of the 48 pool or 12 model frames',
    ).toEqual([])
    await page.screenshot({ path: resolve('test-results/overlay-priority-5120.png') })
  } finally {
    await app?.close()
    // Delete only this test's resolved, known-prefix temporary profile.
    if (
      dirname(profile) === tmpdir() &&
      basename(profile).startsWith('ability-draft-plus-overlay-priority-')
    ) {
      await rm(profile, { recursive: true, force: true })
    }
  }
})
