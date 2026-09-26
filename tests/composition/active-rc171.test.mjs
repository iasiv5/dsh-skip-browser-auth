// 0.1.7-rc.1 carrier-neutral-v3 profile：使用真实 npm 0.1.7-rc.1 packages，验证
// rc.1 加入 v3 代际后的完整 active 链路（docs/COMPATIBILITY.md §5.5）——
// host/client 行状态、mount-preserving token 清理、admit()/OperatorPeer 准入、
// connection/request 瀑布、dedicated RPC 非 405、streaming Fetch route 与信任栅栏。
// 并断言同代际跨 patch 混合（rc.1 runtime + rc.2 connection 及反向）与跨代际
// 混合保持 dormant。
import test from 'node:test'
import assert from 'node:assert/strict'
import { compose, rawRequest } from '../helpers/compose.mjs'

const Connection171 = await import('dsh-client-connection-rc171')
const Frontend171 = await import('frontend-static-rc171')
const WebServer171 = await import('webserver-rc171')
const Connection17 = await import('dsh-client-connection-rc17')
const Frontend17 = await import('frontend-static-rc17')
const WebServer17 = await import('webserver-rc17')

// v3 专属探针：记录 waterfall 可见性，并在 RPC handler 里捕获第 4 参 peer
// （0.1.7 OperatorPeer 准入语义；0.1.5 及更早的 handler 没有该参数）。
const waterfallSeen = []
let rpcPeerId
const Rpc17Probe = {
  name: 'dsh-sba-rpc17-probe',
  inject: ['connection'],
  apply(ctx) {
    ctx.on('connection/request', async (req, res, next) => {
      waterfallSeen.push(req.url)
      await next()
    })
    const disposeRpc = ctx.connection.rpc.handle('/dsh-sba-rpc17-probe', async (endpoint, payload, _signal, peer) => {
      rpcPeerId = peer?.id
      return { ok: true, value: { endpoint, payload } }
    })
    const disposeFetch = ctx.connection.fetch.register({
      path: '/api/dsh-sba-fetch-probe',
      methods: ['POST'],
      requestBody: 'streaming',
      fetch: async (request) => new Response(`echo:${await request.text()}`, { status: 201 }),
    })
    ctx.effect(() => async () => {
      await disposeRpc()
      await disposeFetch()
    }, 'dsh-skip-browser-auth rc17 rpc/fetch probe')
  },
}

const ROWS = [
  { name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
  { id: 'frontend', name: '@deepseek-ai/dsh-host-frontend-static', config: { distIndex: '{{ROOT}}/dist/index.html' } },
  { id: 'connection', name: '@deepseek-ai/dsh-client-connection' },
  { id: 'rpc17-probe', name: 'dsh-sba-rpc17-probe' },
]

const JSON_ENVELOPE = JSON.stringify({
  type: 'client-request',
  rpcId: 'probe',
  method: 'hello',
  payload: { x: 1 },
})

test('0.1.7-rc.1 carrier-neutral-v3: active host, mount-preserving client marker, peer admission, waterfall, RPC and Fetch route', async (t) => {
  const { context, port, root } = await compose(t, {
    probeVersion: '0.1.7-rc.1',
    webRuntime: { lanAddresses: [], trustedHosts: ['app.internal'] },
    modules: {
      '@deepseek-ai/dsh-client-connection': Connection171,
      '@deepseek-ai/dsh-host-frontend-static': Frontend171,
      '@deepseek-ai/dsh-host-webserver': WebServer171,
      'dsh-sba-rpc17-probe': Rpc17Probe,
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
  assert.match(rootGet.body, /carrier-neutral-v3/)
  assert.match(rootGet.body, /__DSH_CONNECTION_RECOVERY__/)

  // mount-preserving：token 清理 303 指向目录相对 './'，而不是 0.1.5 的 '/'。
  const tokenGet = await rawRequest(port, { path: '/?token=whatever' })
  assert.equal(tokenGet.status, 303)
  assert.equal(tokenGet.headers.location, './')

  const rpc = await rawRequest(port, {
    path: '/dsh-sba-rpc17-probe/hello',
    method: 'POST',
    headers: { host: '127.0.0.1', 'content-type': 'application/json' },
    body: JSON_ENVELOPE,
  })
  assert.equal(rpc.status, 200)
  assert.deepEqual(JSON.parse(rpc.body).result, {
    ok: true,
    value: { endpoint: 'hello', payload: { x: 1 } },
  })
  // admit() 把 OperatorPeer 传给 RPC handler 第 4 参（0.1.7 准入语义）。
  assert.equal(typeof rpcPeerId, 'string')

  const streamed = await rawRequest(port, {
    path: '/api/dsh-sba-fetch-probe',
    method: 'POST',
    headers: { host: '127.0.0.1', 'content-type': 'text/plain' },
    body: 'stream-me',
  })
  assert.equal(streamed.status, 201)
  assert.equal(streamed.body, 'echo:stream-me')

  // 官方 0.1.7 只在共享 /api route 上包裹 connection/request 瀑布；dedicated
  // RPC 通道的 route 不经过瀑布（与官方 register() 逐行一致）。因此这里断言：
  // exact Fetch route（走共享 /api）被 sibling 监听器看到，dedicated 通道看不到。
  assert.ok(waterfallSeen.includes('/api/dsh-sba-fetch-probe'))
  assert.ok(!waterfallSeen.includes('/dsh-sba-rpc17-probe/hello'))

  const evil = await rawRequest(port, {
    path: '/api/dsh-sba-fetch-probe',
    method: 'POST',
    headers: { host: 'evil.example', 'content-type': 'text/plain' },
    body: 'evil',
  })
  assert.equal(evil.status, 403)
  // 403 拒绝发生在 admit 阶段、瀑布之前：evil 请求不得让瀑布计数增加。
  assert.equal(waterfallSeen.filter((url) => url === '/api/dsh-sba-fetch-probe').length, 1)

  const indexBody = await import('node:fs/promises').then(({ readFile }) => readFile(`${root}/dist/index.html`, 'utf8'))
  assert.ok(indexBody.includes('shell'))
})

test('0.1.7-rc.1 runtime with 0.1.7-rc.2 connection stays dormant (same-generation cross-patch mix)', async (t) => {
  const { context } = await compose(t, {
    probeVersion: '0.1.7-rc.2',
    runtimeVersion: '0.1.7-rc.1',
    webRuntime: { lanAddresses: [], trustedHosts: [] },
    modules: {
      '@deepseek-ai/dsh-client-connection': Connection17,
      '@deepseek-ai/dsh-host-frontend-static': Frontend17,
      '@deepseek-ai/dsh-host-webserver': WebServer17,
      'dsh-sba-rpc17-probe': Rpc17Probe,
    },
    rows: ROWS,
  })
  const entries = [...context.loader.entries()]
  assert.equal(entries.find((entry) => entry.options.id === 'connection')?.disabled, false)
  assert.equal(entries.find((entry) => entry.options.id === 'trusted-connection')?.disabled, true)
})

test('0.1.7-rc.2 runtime with 0.1.7-rc.1 connection stays dormant (same-generation cross-patch mix)', async (t) => {
  const { context } = await compose(t, {
    probeVersion: '0.1.7-rc.1',
    runtimeVersion: '0.1.7-rc.2',
    webRuntime: { lanAddresses: [], trustedHosts: [] },
    modules: {
      '@deepseek-ai/dsh-client-connection': Connection171,
      '@deepseek-ai/dsh-host-frontend-static': Frontend171,
      '@deepseek-ai/dsh-host-webserver': WebServer171,
      'dsh-sba-rpc17-probe': Rpc17Probe,
    },
    rows: ROWS,
  })
  const entries = [...context.loader.entries()]
  assert.equal(entries.find((entry) => entry.options.id === 'connection')?.disabled, false)
  assert.equal(entries.find((entry) => entry.options.id === 'trusted-connection')?.disabled, true)
})

test('0.1.7-rc.1 runtime with 0.1.5-rc.2 connection stays dormant (cross-generation mix)', async (t) => {
  const Connection152 = await import('dsh-client-connection-rc152')
  const Frontend152 = await import('frontend-static-rc152')
  const WebServer152 = await import('webserver-rc152')
  const { context } = await compose(t, {
    probeVersion: '0.1.5-rc.2',
    runtimeVersion: '0.1.7-rc.1',
    webRuntime: { lanAddresses: [], trustedHosts: [] },
    modules: {
      '@deepseek-ai/dsh-client-connection': Connection152,
      '@deepseek-ai/dsh-host-frontend-static': Frontend152,
      '@deepseek-ai/dsh-host-webserver': WebServer152,
      'dsh-sba-rpc17-probe': Rpc17Probe,
    },
    rows: ROWS,
  })
  const entries = [...context.loader.entries()]
  assert.equal(entries.find((entry) => entry.options.id === 'connection')?.disabled, false)
  assert.equal(entries.find((entry) => entry.options.id === 'trusted-connection')?.disabled, true)
})
