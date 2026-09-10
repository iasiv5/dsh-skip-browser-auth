// 0.1.5 npm flat layout：真实 manifest fallback 仍选择 carrier-neutral profile。
import test from 'node:test'
import assert from 'node:assert/strict'
import { compose, rawRequest } from '../helpers/compose.mjs'

const Connection15 = await import('dsh-client-connection-rc15')
const Frontend15 = await import('frontend-static-rc15')
const WebServer15 = await import('webserver-rc15')

const ROWS = [
  { name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
  { id: 'frontend', name: '@deepseek-ai/dsh-host-frontend-static', config: { distIndex: '{{ROOT}}/dist/index.html' } },
  { id: 'connection', name: '@deepseek-ai/dsh-client-connection' },
]

test('0.1.5 npm flat manifest fallback activates carrier-neutral profile', async (t) => {
  const { context, port } = await compose(t, {
    layout: 'npm',
    probeVersion: '0.1.5-rc.1',
    webRuntime: { lanAddresses: [], trustedHosts: [] },
    modules: {
      '@deepseek-ai/dsh-client-connection': Connection15,
      '@deepseek-ai/dsh-host-frontend-static': Frontend15,
      '@deepseek-ai/dsh-host-webserver': WebServer15,
    },
    rows: ROWS,
  })
  const entries = [...context.loader.entries()]
  assert.equal(entries.find((entry) => entry.options.id === 'connection')?.disabled, true)
  assert.equal(entries.find((entry) => entry.options.id === 'trusted-connection')?.disabled, false)
  const rootGet = await rawRequest(port, { path: '/' })
  assert.equal(rootGet.status, 200)
  assert.match(rootGet.body, /carrier-neutral-v2/)
})
