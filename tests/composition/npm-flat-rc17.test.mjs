// 0.1.7 npm flat layout：真实 manifest fallback 仍选择 carrier-neutral-v3。
// 覆盖 dshm（npm 语义安装）形态下 0.1.7-rc.2 的双锚点激活路径。
import test from 'node:test'
import assert from 'node:assert/strict'
import { compose, rawRequest } from '../helpers/compose.mjs'

const Connection17 = await import('dsh-client-connection-rc17')
const Frontend17 = await import('frontend-static-rc17')
const WebServer17 = await import('webserver-rc17')

const ROWS = [
  { name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
  { id: 'frontend', name: '@deepseek-ai/dsh-host-frontend-static', config: { distIndex: '{{ROOT}}/dist/index.html' } },
  { id: 'connection', name: '@deepseek-ai/dsh-client-connection' },
]

test('0.1.7 npm flat manifest fallback activates carrier-neutral-v3', async (t) => {
  const { context, port } = await compose(t, {
    layout: 'npm',
    probeVersion: '0.1.7-rc.2',
    webRuntime: { lanAddresses: [], trustedHosts: [] },
    modules: {
      '@deepseek-ai/dsh-client-connection': Connection17,
      '@deepseek-ai/dsh-host-frontend-static': Frontend17,
      '@deepseek-ai/dsh-host-webserver': WebServer17,
    },
    rows: ROWS,
  })
  const entries = [...context.loader.entries()]
  assert.equal(entries.find((entry) => entry.options.id === 'connection')?.disabled, true)
  assert.equal(entries.find((entry) => entry.options.id === 'trusted-connection')?.disabled, false)
  const rootGet = await rawRequest(port, { path: '/' })
  assert.equal(rootGet.status, 200)
  assert.match(rootGet.body, /carrier-neutral-v3/)
})
