import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { file, electronApp } = vi.hoisted(() => ({
  file: { read: vi.fn(), exists: vi.fn().mockReturnValue(false) },
  electronApp: { isPackaged: true, getAppPath: () => '/mock/app' },
}))

vi.mock('electron', () => ({ app: electronApp }))
vi.mock('fs', () => ({ readFileSync: file.read, existsSync: file.exists }))
vi.mock('electron-log/main', () => ({
  default: { scope: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import { loadAutoUpdateEnabled } from '../../../../src/main/services/api-config'

describe('auto-update build configuration', () => {
  const previousResourcesPath = Object.getOwnPropertyDescriptor(process, 'resourcesPath')

  beforeAll(() => {
    Object.defineProperty(process, 'resourcesPath', {
      value: '/mock/resources',
      configurable: true,
    })
  })

  afterAll(() => {
    if (previousResourcesPath)
      Object.defineProperty(process, 'resourcesPath', previousResourcesPath)
    else Reflect.deleteProperty(process, 'resourcesPath')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    electronApp.isPackaged = true
    file.read.mockReturnValue('{}')
  })

  afterEach(() => vi.unstubAllEnvs())

  it.each([{}, { AUTO_UPDATE_ENABLED: false }, { AUTO_UPDATE_ENABLED: 'true' }])(
    'requires an explicit boolean in packaged configuration: %j',
    (data) => {
      file.read.mockReturnValue(JSON.stringify(data))
      vi.stubEnv('AUTO_UPDATE_ENABLED', 'true')
      expect(loadAutoUpdateEnabled()).toBe(false)
    },
  )

  it('enables updates when the packaged build explicitly opts in', () => {
    file.read.mockReturnValue('{"AUTO_UPDATE_ENABLED":true}')
    expect(loadAutoUpdateEnabled()).toBe(true)
  })

  it('safely disables updates if the packaged config is missing or malformed', () => {
    file.read.mockImplementation(() => {
      throw new Error('missing configuration')
    })
    expect(loadAutoUpdateEnabled()).toBe(false)
    file.read.mockReturnValue('{invalid')
    expect(loadAutoUpdateEnabled()).toBe(false)
  })

  it.each([undefined, 'false', '1', 'TRUE', 'true'])(
    'reads the explicit development opt-in %s',
    (value) => {
      electronApp.isPackaged = false
      vi.stubEnv('AUTO_UPDATE_ENABLED', value)
      expect(loadAutoUpdateEnabled()).toBe(value === 'true')
      expect(file.read).not.toHaveBeenCalled()
    },
  )
})
