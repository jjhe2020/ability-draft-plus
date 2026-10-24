import {
  test as base,
  expect,
  _electron as electron,
  type ElectronApplication,
} from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const test = base.extend<{ isolatedApp: ElectronApplication }>({
  // Playwright requires destructuring here, even without browser fixture dependencies.
  // eslint-disable-next-line no-empty-pattern
  isolatedApp: async ({}, use) => {
    const profile = await mkdtemp(join(tmpdir(), 'ability-draft-plus-smoke-'))
    const entry = join(profile, 'entry.cjs')
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    let app: ElectronApplication | undefined
    try {
      await writeFile(
        entry,
        [
          "const { app, BrowserWindow } = require('electron');",
          `app.setPath('userData', ${JSON.stringify(profile)});`,
          'BrowserWindow.prototype.show = function () {};',
          'BrowserWindow.prototype.showInactive = function () {};',
          `require(${JSON.stringify(resolve(__dirname, '../../out/main/index.js'))});`,
        ].join('\n'),
      )
      app = await electron.launch({ args: [entry], env })
      await use(app)
    } finally {
      await app?.close()
      await rm(profile, { recursive: true, force: true })
    }
  },
})

async function getAvailablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not allocate a test port')
  const port = address.port
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  return port
}

test('app launches and shows control panel', async ({ isolatedApp: app }) => {
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  const title = await window.title()
  expect(title).toContain('Ability Draft Plus')
})

test('stream server serves the board and SSE endpoint', async ({ isolatedApp: app }) => {
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  // The user's real app may already own the default stream port.
  const port = await getAvailablePort()
  const origin = `http://127.0.0.1:${port}`

  // Start the stream server through the same IPC surface the Streaming page uses
  const startResult = await window.evaluate(async (port) => {
    const api = (
      window as unknown as {
        electronApi: {
          invoke: (channel: string, args?: unknown) => Promise<unknown>
        }
      }
    ).electronApi
    return api.invoke('stream:start', { port })
  }, port)
  expect(startResult).toMatchObject({ success: true })

  // The board SPA is served from out/renderer
  const pageResponse = await fetch(`${origin}/stream`)
  expect(pageResponse.status).toBe(200)
  const html = await pageResponse.text()
  expect(html).toContain('Stream Board')

  // SSE endpoint pushes a versioned state envelope on connect
  const sseResponse = await fetch(`${origin}/events`, {
    headers: { Accept: 'text/event-stream' },
  })
  expect(sseResponse.status).toBe(200)
  expect(sseResponse.headers.get('content-type')).toContain('text/event-stream')
  const reader = sseResponse.body?.getReader()
  expect(reader).toBeDefined()
  const { value } = await reader!.read()
  const firstChunk = new TextDecoder().decode(value)
  expect(firstChunk).toContain('"type":"state"')
  expect(firstChunk).toContain('"phase":"waiting"')
  await reader!.cancel()
})
