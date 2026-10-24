import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, dirname, basename } from 'node:path'
import initSqlJs from 'sql.js'

test('Chinese skill names and editable formula persist through real Electron IPC', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ability-draft-plus-priority-'))
  const SQL = await initSqlJs()
  const db = new SQL.Database(await readFile(resolve('resources/dota_ad_data.db')))
  const population = [
    { name: 'earthshaker_aftershock', winrate: 0.589, pickRate: 5.25, draftFrequency: 0.99 },
    { name: 'pugna_nether_blast', winrate: 0.466, pickRate: 26.02, draftFrequency: 0.9 },
    { name: 'lina_dragon_slave', winrate: 0.51, pickRate: 15, draftFrequency: 0.92 },
    { name: 'hero:lina', winrate: 0.5, pickRate: 20, draftFrequency: 1 },
  ]
  db.run('INSERT OR REPLACE INTO Metadata(key,value) VALUES (?,?)', ['language', 'zh-CN'])
  db.run('INSERT OR REPLACE INTO Metadata(key,value) VALUES (?,?)', [
    'windrun_priority_population',
    JSON.stringify(population),
  ])
  await writeFile(join(profile, 'dota_ad_data.db'), db.export())
  db.close()
  // Keep verification windows hidden and the user's real profile untouched.
  const entry = join(profile, 'entry.cjs')
  await writeFile(
    entry,
    [
      "const { app, BrowserWindow } = require('electron');",
      `app.setPath('userData', ${JSON.stringify(profile)});`,
      'BrowserWindow.prototype.show = function () {};',
      'BrowserWindow.prototype.showInactive = function () {};',
      `require(${JSON.stringify(resolve('out/main/index.js'))});`,
    ].join('\n'),
  )
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    app = await electron.launch({ args: [entry], env })
    const page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 1200))
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const card = page.locator('[data-slot="card"]').filter({ hasText: '单技能选位规则' })
    await expect(card).toBeVisible()
    await expect(card.getByText('余震', { exact: true })).toBeVisible()
    await expect(card.getByText('幽冥爆轰', { exact: true })).toBeVisible()
    await expect(card.getByText('龙破斩', { exact: true })).toBeVisible()
    await expect(card.getByText('Aftershock', { exact: true })).toHaveCount(0)
    await card.getByLabel('胜率系数', { exact: true }).fill('-2')
    await card.getByRole('button', { name: '保存规则', exact: true }).click()
    await expect(card.getByText('已保存；重新识别后应用新规则。', { exact: true })).toBeVisible()
    const stored = await page.evaluate(() => window.electronApi.invoke('settings:get'))
    expect(stored.abilityPriority.winWeight).toBe(-2)
    expect(stored.abilityPriority.pickWeight).toBe(10)
    await card.scrollIntoViewIfNeeded()
    await card.screenshot({ path: resolve('test-results/chinese-priority-ui.png') })
    await app.close()
    app = undefined
    app = await electron.launch({ args: [entry], env })
    const reopened = await app.firstWindow()
    await reopened.getByRole('button', { name: '设置', exact: true }).click()
    await expect(reopened.getByLabel('胜率系数', { exact: true })).toHaveValue('-2')
    await reopened.getByRole('button', { name: '技能', exact: true }).click()
    await expect(reopened.getByRole('columnheader', { name: '技能', exact: true })).toBeVisible()
    await expect(reopened.getByRole('columnheader', { name: 'Hero', exact: true })).toHaveCount(0)
  } finally {
    await app?.close()
    // Only remove this test's verified temporary directory.
    if (
      dirname(profile) === tmpdir() &&
      basename(profile).startsWith('ability-draft-plus-priority-')
    ) {
      await rm(profile, { recursive: true, force: true })
    }
  }
})
