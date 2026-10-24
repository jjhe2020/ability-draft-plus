import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppStore } from '../../../../src/main/store/app-store'

const { updater, config, electronApp } = vi.hoisted(() => ({
  updater: {
    on: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue(null),
    downloadUpdate: vi.fn().mockResolvedValue([]),
    quitAndInstall: vi.fn(),
    logger: undefined,
    autoDownload: true,
    autoInstallOnAppQuit: false,
  },
  config: { enabled: false },
  electronApp: { isPackaged: true },
}))

vi.mock('electron', () => ({ app: electronApp }))
vi.mock('electron-updater', () => ({ autoUpdater: updater }))
vi.mock('../../../../src/main/services/api-config', () => ({
  loadAutoUpdateEnabled: () => config.enabled,
}))
vi.mock('electron-log/main', () => ({
  default: { scope: () => ({ info: vi.fn(), error: vi.fn() }) },
}))

import { createUpdateService } from '../../../../src/main/services/update-service'

describe('private distribution updates', () => {
  const setState = vi.fn()
  const store = { setState } as unknown as AppStore

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    config.enabled = false
    electronApp.isPackaged = true
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('does not register updater events or schedule network checks by default', async () => {
    const service = createUpdateService(store)
    service.startPeriodicChecks()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000)
    expect(updater.on).not.toHaveBeenCalled()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(setState).not.toHaveBeenCalled()
    service.stopPeriodicChecks()
  })

  it.each(['checkForUpdates', 'downloadUpdate', 'installUpdate'] as const)(
    '%s explains how to update without contacting GitHub or installing anything',
    (operation) => {
      const service = createUpdateService(store)
      service[operation]()
      expect(setState).toHaveBeenCalledWith({
        updateStatus: 'error',
        updateError: expect.stringContaining('请联系分享者获取新版安装包'),
        updateProgress: null,
        updateVersion: null,
      })
      expect(updater.checkForUpdates).not.toHaveBeenCalled()
      expect(updater.downloadUpdate).not.toHaveBeenCalled()
      expect(updater.quitAndInstall).not.toHaveBeenCalled()
    },
  )

  it('keeps periodic checks and manual actions available when explicitly enabled', async () => {
    config.enabled = true
    const service = createUpdateService(store)
    service.startPeriodicChecks()
    service.startPeriodicChecks()
    expect(vi.getTimerCount()).toBe(2)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000 - 30_000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
    service.checkForUpdates()
    service.downloadUpdate()
    service.installUpdate()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3)
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(updater.autoDownload).toBe(false)
    service.stopPeriodicChecks()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retains update availability notifications when enabled', () => {
    config.enabled = true
    createUpdateService(store)
    const available = updater.on.mock.calls.find(([event]) => event === 'update-available')?.[1]
    expect(available).toBeTypeOf('function')
    available({ version: '3.2.2' })
    expect(setState).toHaveBeenCalledWith({ updateStatus: 'available', updateVersion: '3.2.2' })
  })

  it('does not schedule checks for development builds even when enabled', () => {
    config.enabled = true
    electronApp.isPackaged = false
    const service = createUpdateService(store)
    service.startPeriodicChecks()
    expect(vi.getTimerCount()).toBe(0)
  })
})
