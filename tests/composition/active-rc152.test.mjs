// 0.1.5-rc.2 carrier-neutral profile：使用真实 npm 0.1.5-rc.2 packages（rc.1 的
// 重发布：代码逐字节一致、manifest 版本 bump），验证 rc.2 版本对加入
// carrier-neutral-v2 代际后 host/client、dedicated RPC、streaming Fetch route
// 与 trusted-network surface 全链路不变。
import test from 'node:test'
import assert from 'node:assert/strict'
import { compose, rawRequest } from '../helpers/compose.mjs'

const Connection152 = await import('dsh-client-connection-rc152')
const Frontend152 = await import('frontend-static-rc152')
const WebServer152 = await import('webserver-rc152')
const RpcProbe = await import('../fixtures/rpc-probe.mjs')

const ROWS = [
  { name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
  { id: 'frontend', name: '@deepseek-ai/dsh-host-frontend-static', config: { distIndex: '{{ROOT}}/dist/index.html' } },
  { id: 'connection', name: '@deepseek-ai/dsh-client-connection' },
  { id: 'rpc-probe', name: 'dsh-skip-browser-auth-rpc-probe' },
]

const JSON_ENVELOPE = JSON.stringify({
  type: 'client-request',
  rpcId: 'probe',
  method: 'hello',
  payload: { x: 1 },
})

test('0.1.5-rc.2 carrier-neutral profile: active host, client marker, RPC and streaming Fetch route', async (t) => {
  const { context, port, root } = await compose(t, {
    probeVersion: '0.1.5-rc.2',
    webRuntime: { lanAddresses: [], trustedHosts: ['app.internal'] },
    modules: {
      '@deepseek-ai/dsh-client-connection': Connection152,
      '@deepseek-ai/dsh-host-frontend-static': Frontend152,
      '@deepseek-ai/dsh-host-webserver': WebServer152,
      'dsh-skip-browser-auth-rpc-probe': RpcProbe,
    },
    rows: ROWS,
  })

  const entries = [...context.loader.entries()]
  const connection = entries.find((entry) => entry.options.id === 'connection')
  const trusted = entries.find((entry) => entry.options.id === 'trusted-connection')
  assert.equal(connection?.disabled, true)
  assert.equal(trusted?.disabled, false)

  const rootGet = await rawRequest(port, { path: '/' })
  assert.equal(rootGet.status, 200)
  assert.match(rootGet.body, /carrier-neutral-v2/)
  assert.match(rootGet.body, /__DSH_CONNECTION_RECOVERY__/)

  const tokenGet = await rawRequest(port, { path: '/?token=whatever' })
  assert.equal(tokenGet.status, 303)
  assert.equal(tokenGet.headers.location, '/')

  const rpc = await rawRequest(port, {
    path: '/dsh-sba-rpc-probe/hello',
    method: 'POST',
    headers: { host: '127.0.0.1', 'content-type': 'application/json' },
    body: JSON_ENVELOPE,
  })
  assert.equal(rpc.status, 200)
  assert.deepEqual(JSON.parse(rpc.body).result, {
    ok: true,
    value: { endpoint: 'hello', payload: { x: 1 } },
  })

  const streamed = await rawRequest(port, {
    path: '/api/dsh-sba-fetch-probe',
    method: 'POST',
    headers: { host: '127.0.0.1', 'content-type': 'text/plain' },
    body: 'stream-me',
  })
  assert.equal(streamed.status, 201)
  assert.equal(streamed.body, 'echo:stream-me')

  const evil = await rawRequest(port, {
    path: '/dsh-sba-rpc-probe/hello',
    method: 'POST',
    headers: { host: 'evil.example', 'content-type': 'application/json' },
    body: JSON_ENVELOPE,
  })
  assert.equal(evil.status, 403)

  const indexBody = await import('node:fs/promises').then(({ readFile }) => readFile(`${root}/dist/index.html`, 'utf8'))
  assert.ok(indexBody.includes('shell'))
})

test('0.1.5-rc.1 runtime anchored with rc.2 connection stays dormant (cross-patch mix)', async (t) => {
  const { context } = await compose(t, {
    probeVersion: '0.1.5-rc.2',
    runtimeVersion: '0.1.5-rc.1',
    webRuntime: { lanAddresses: [], trustedHosts: [] },
    modules: {
      '@deepseek-ai/dsh-client-connection': Connection152,
      '@deepseek-ai/dsh-host-frontend-static': Frontend152,
      '@deepseek-ai/dsh-host-webserver': WebServer152,
      'dsh-skip-browser-auth-rpc-probe': RpcProbe,
    },
    rows: ROWS,
  })
  const entries = [...context.loader.entries()]
  assert.equal(entries.find((entry) => entry.options.id === 'connection')?.disabled, false)
  assert.equal(entries.find((entry) => entry.options.id === 'trusted-connection')?.disabled, true)
})
