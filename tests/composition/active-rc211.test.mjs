// 0.2.1-rc.1 carrier-neutral-v4 profile：使用真实 npm 0.2.1-rc.1 packages，验证
// 0.2.1 新代际的完整 active 链路（docs/COMPATIBILITY.md §5.8 审计 → §5.9 收编）——
// host/client 行状态、mount-preserving token 清理、admit() 准入（Peer 台账形态）、
// connection/request 瀑布、dedicated RPC 非 405、streaming Fetch route、新 /connect
// 交换端点与信任栅栏。
// 并断言跨代际混合（0.2.0-rc.2 runtime + 0.2.1-rc.1 connection 及反向）保持
// dormant：白名单匹配完整版本对，绝不按「相邻版本」放行混合版本。
import test from 'node:test'
import assert from 'node:assert/strict'
import { compose, rawRequest } from '../helpers/compose.mjs'

const Connection211 = await import('dsh-client-connection-rc211')
const Frontend211 = await import('frontend-static-rc211')
const WebServer211 = await import('webserver-rc211')
const Connection202 = await import('dsh-client-connection-rc202')
const Frontend202 = await import('frontend-static-rc202')
const WebServer202 = await import('webserver-rc202')

// v4 专属探针：记录 waterfall 可见性，并在 RPC handler 里捕获第 4 参 peer
// （0.2.1 起为 admit() 产生的 Peer 实例，principal 为 owner）。
const waterfallSeen = []
let rpcPeerId
const Rpc211Probe = {
  name: 'dsh-sba-rpc211-probe',
  inject: ['connection'],
  apply(ctx) {
    ctx.on('connection/request', async (req, res, next) => {
      waterfallSeen.push(req.url)
      await next()
    })
    const disposeRpc = ctx.connection.rpc.handle('/dsh-sba-rpc211-probe', async (endpoint, payload, _signal, peer) => {
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
    }, 'dsh-skip-browser-auth rc211 rpc/fetch probe')
  },
}

const ROWS = [
  { name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
  { id: 'frontend', name: '@deepseek-ai/dsh-host-frontend-static', config: { distIndex: '{{ROOT}}/dist/index.html' } },
  { id: 'connection', name: '@deepseek-ai/dsh-client-connection' },
  { id: 'rpc211-probe', name: 'dsh-sba-rpc211-probe' },
]

const JSON_ENVELOPE = JSON.stringify({
  type: 'client-request',
  rpcId: 'probe',
  method: 'hello',
  payload: { x: 1 },
})

test('0.2.1-rc.1 carrier-neutral-v4: active host, mount-preserving client marker, peer admission, waterfall, RPC, Fetch route and /connect', async (t) => {
  const { context, port, root } = await compose(t, {
    probeVersion: '0.2.1-rc.1',
    webStartup: { trustedHosts: ['app.internal'] },
    webRuntime: { lanAddresses: [], trustedHosts: ['app.internal'] },
    modules: {
      '@deepseek-ai/dsh-client-connection': Connection211,
      '@deepseek-ai/dsh-host-frontend-static': Frontend211,
      '@deepseek-ai/dsh-host-webserver': WebServer211,
      'dsh-sba-rpc211-probe': Rpc211Probe,
    },
    rows: ROWS,
  })

  const entries = [...context.loader.entries()]
  const connection = entries.find((entry) => entry.options.id === 'connection')
  // 两行拆分（§5.9）：0.2.1 宿主上仅 webStartup 行激活，webRuntime 行保持 disabled。
  const trusted = entries.find((entry) => entry.options.id === 'trusted-connection-021')
  const legacyRow = entries.find((entry) => entry.options.id === 'trusted-connection')
  assert.equal(connection?.disabled, true)
  assert.equal(trusted?.disabled, false)
  assert.equal(legacyRow?.disabled, true)

  const rootGet = await rawRequest(port, { path: '/' })
  assert.equal(rootGet.status, 200)
  assert.match(rootGet.body, /carrier-neutral-v4/)
  assert.match(rootGet.body, /__DSH_CONNECTION_RECOVERY__/)

  // mount-preserving：token 清理 303 指向目录相对 './'，而不是 0.1.5 的 '/'。
  const tokenGet = await rawRequest(port, { path: '/?token=whatever' })
  assert.equal(tokenGet.status, 303)
  assert.equal(tokenGet.headers.location, './')

  const rpc = await rawRequest(port, {
    path: '/dsh-sba-rpc211-probe/hello',
    method: 'POST',
    headers: { host: '127.0.0.1', 'content-type': 'application/json' },
    body: JSON_ENVELOPE,
  })
  assert.equal(rpc.status, 200)
  assert.deepEqual(JSON.parse(rpc.body).result, {
    ok: true,
    value: { endpoint: 'hello', payload: { x: 1 } },
  })
  // 0.2.1：RPC handler 第 4 参是 admit() 产生的 Peer 实例（principal owner）。
  assert.equal(typeof rpcPeerId, 'string')

  const streamed = await rawRequest(port, {
    path: '/api/dsh-sba-fetch-probe',
    method: 'POST',
    headers: { host: '127.0.0.1', 'content-type': 'text/plain' },
    body: 'stream-me',
  })
  assert.equal(streamed.status, 201)
  assert.equal(streamed.body, 'echo:stream-me')

  // 官方只在共享 /api route 上包裹 connection/request 瀑布；dedicated
  // RPC 通道的 route 不经过瀑布（与官方 register() 逐行一致）。因此这里断言：
  // exact Fetch route（走共享 /api）被 sibling 监听器看到，dedicated 通道看不到。
  assert.ok(waterfallSeen.includes('/api/dsh-sba-fetch-probe'))
  assert.ok(!waterfallSeen.includes('/dsh-sba-rpc211-probe/hello'))

  // /connect 交换端点（0.2.1 新增）：trusted 请求按官方成功形态 302 回 API mux，
  // stub 不铸造身份 cookie（trusted-network 无身份层）。
  const connect = await rawRequest(port, { path: '/connect?token=whatever&interactions=none' })
  assert.equal(connect.status, 302)
  assert.equal(connect.headers.location, './api/remote.mux')
  // interactions 声明违反客户端协议契约 ⇒ 400（官方校验语义逐字对齐）。
  const badInteractions = await rawRequest(port, { path: '/connect?interactions=sometimes' })
  assert.equal(badInteractions.status, 400)
  // evil host 在服务层 fence 即被拒（403，不达 stub）。
  const evilConnect = await rawRequest(port, { path: '/connect', headers: { host: 'evil.example' } })
  assert.equal(evilConnect.status, 403)

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

test('0.2.0-rc.2 runtime with 0.2.1-rc.1 connection stays dormant (cross-generation mix)', async (t) => {
  const { context } = await compose(t, {
    probeVersion: '0.2.1-rc.1',
    runtimeVersion: '0.2.0-rc.2',
    webStartup: { trustedHosts: [] },
    webRuntime: { lanAddresses: [], trustedHosts: [] },
    modules: {
      '@deepseek-ai/dsh-client-connection': Connection211,
      '@deepseek-ai/dsh-host-frontend-static': Frontend211,
      '@deepseek-ai/dsh-host-webserver': WebServer211,
      'dsh-sba-rpc211-probe': Rpc211Probe,
    },
    rows: ROWS,
  })
  const entries = [...context.loader.entries()]
  assert.equal(entries.find((entry) => entry.options.id === 'connection')?.disabled, false)
  assert.equal(entries.find((entry) => entry.options.id === 'trusted-connection-021')?.disabled, true)
  assert.equal(entries.find((entry) => entry.options.id === 'trusted-connection')?.disabled, true)
})

test('0.2.1-rc.1 runtime with 0.2.0-rc.2 connection stays dormant (cross-generation mix)', async (t) => {
  const { context } = await compose(t, {
    probeVersion: '0.2.0-rc.2',
    runtimeVersion: '0.2.1-rc.1',
    webStartup: { trustedHosts: [] },
    webRuntime: { lanAddresses: [], trustedHosts: [] },
    modules: {
      '@deepseek-ai/dsh-client-connection': Connection202,
      '@deepseek-ai/dsh-host-frontend-static': Frontend202,
      '@deepseek-ai/dsh-host-webserver': WebServer202,
      'dsh-sba-rpc211-probe': Rpc211Probe,
    },
    rows: ROWS,
  })
  const entries = [...context.loader.entries()]
  assert.equal(entries.find((entry) => entry.options.id === 'connection')?.disabled, false)
  assert.equal(entries.find((entry) => entry.options.id === 'trusted-connection-021')?.disabled, true)
  assert.equal(entries.find((entry) => entry.options.id === 'trusted-connection')?.disabled, true)
})
