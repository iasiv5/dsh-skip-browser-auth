// 表驱动代际组合套件：循环 fixture 登记表的 9 个别名版本（0.1.2-rc.1 由
// active.test.mjs 与 npm-flat-generations.test.mjs 覆盖，不进本循环），每版本
// 一个 active 全链路测试 + 全局序相邻对双向 dormant 测试（含 0.1.2-rc.1 ↔
// 0.1.5-rc.1 代际边界对）。代际差异（waterfall / peer / /connect / 行 id /
// marker / service 键）由 GENERATION_CHECKLISTS 与 profile 派生，token 清理
// 位置由 browserAuthSemantics 派生——不再逐版本拷贝文件（tests/structure.test.mjs
// 禁止 active-rcNXX 式文件回潮）。断言面对账见实施计划附录 A。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compose, rawRequest } from '../helpers/compose.mjs'
import { VERSION_FIXTURES, FIXTURE_ENTRIES, loadFixtureModules } from '../fixtures/registry.mjs'
import { GENERATION_CHECKLISTS } from '../helpers/generation-checklists.mjs'
import { COMPATIBILITY_PROFILES } from '../../lib/gate.js'

const JSON_ENVELOPE = JSON.stringify({
  type: 'client-request',
  rpcId: 'probe',
  method: 'hello',
  payload: { x: 1 },
})

const BASE_ROWS = [
  { name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
  { id: 'frontend', name: '@deepseek-ai/dsh-host-frontend-static', config: { distIndex: '{{ROOT}}/dist/index.html' } },
  { id: 'connection', name: '@deepseek-ai/dsh-client-connection' },
]

/**
 * 每测试独立的 rpc/fetch 探针：记录 connection/request 瀑布可见性（0.1.7+ 才
 * 存在该事件，旧代际注册了也永不触发）并在 RPC handler 捕获第 4 参 peer
 * （0.1.7+ OperatorPeer 语义；旧代际该参恒 undefined）。
 */
function makeProbe() {
  const state = { waterfallSeen: [], rpcPeerId: undefined }
  const name = 'dsh-sba-gen-probe'
  const plugin = {
    name,
    inject: ['connection'],
    apply(ctx) {
      ctx.on('connection/request', async (req, res, next) => {
        state.waterfallSeen.push(req.url)
        await next()
      })
      const disposeRpc = ctx.connection.rpc.handle('/dsh-sba-gen-probe', async (endpoint, payload, _signal, peer) => {
        state.rpcPeerId = peer?.id
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
      }, 'dsh-skip-browser-auth generation suite rpc/fetch probe')
    },
  }
  return { name, plugin, state }
}

function otherTrustedRowId(trustedRowId) {
  return trustedRowId === 'trusted-connection' ? 'trusted-connection-021' : 'trusted-connection'
}

// ── active 全链路（9 个别名版本 × 1）────────────────────────────────────────
for (const entry of FIXTURE_ENTRIES) {
  const checklist = GENERATION_CHECKLISTS[entry.profileId]
  const profile = COMPATIBILITY_PROFILES.find((candidate) => candidate.id === entry.profileId)
  const cleanLocation = profile.browserAuthSemantics === 'mount-preserving' ? './' : '/'
  // v4 走 webStartup（官方 0.2.1 行 inject webStartup；webRuntime 同传与旧套件
  // 同构）；≤v3 只传 webRuntime。
  const serviceOptions = checklist.service === 'webStartup'
    ? { webStartup: { trustedHosts: ['app.internal'] }, webRuntime: { lanAddresses: [], trustedHosts: ['app.internal'] } }
    : { webRuntime: { lanAddresses: [], trustedHosts: ['app.internal'] } }

  test(`${entry.version} ${entry.profileId}: active host, client marker, admission, RPC and Fetch route${checklist.connectRoute ? ', /connect' : ''}`, async (t) => {
    const probe = makeProbe()
    const modules = await loadFixtureModules(entry)
    modules[probe.name] = probe.plugin
    const { context, port, root } = await compose(t, {
      probeVersion: entry.version,
      ...serviceOptions,
      modules,
      rows: [...BASE_ROWS, { id: 'gen-probe', name: probe.name }],
    })

    // 行状态：官方行禁用；本代插件行活跃；另代插件行禁用（双行恒在 patch 中）。
    const entries = [...context.loader.entries()]
    assert.equal(entries.find((candidate) => candidate.options.id === 'connection')?.disabled, true)
    assert.equal(entries.find((candidate) => candidate.options.id === checklist.trustedRowId)?.disabled, false)
    assert.equal(entries.find((candidate) => candidate.options.id === otherTrustedRowId(checklist.trustedRowId))?.disabled, true)

    // 首页：200 + profile id marker（PROFILE_GLOBAL 注入）+ recovery global（v2+）。
    const rootGet = await rawRequest(port, { path: '/' })
    assert.equal(rootGet.status, 200)
    assert.match(rootGet.body, checklist.indexMarker)
    if (profile.requiresRecoveryGlobal) {
      assert.match(rootGet.body, /__DSH_CONNECTION_RECOVERY__/)
    }

    // token 清理 303：root 语义回 '/'（v1/v2），mount-preserving 回 './'（v3+）。
    const tokenGet = await rawRequest(port, { path: '/?token=whatever' })
    assert.equal(tokenGet.status, 303)
    assert.equal(tokenGet.headers.location, cleanLocation)

    // dedicated RPC：非 405、结果正确；peer 第 4 参仅 0.1.7+ 断言。
    const rpc = await rawRequest(port, {
      path: '/dsh-sba-gen-probe/hello',
      method: 'POST',
      headers: { host: '127.0.0.1', 'content-type': 'application/json' },
      body: JSON_ENVELOPE,
    })
    assert.equal(rpc.status, 200)
    assert.deepEqual(JSON.parse(rpc.body).result, {
      ok: true,
      value: { endpoint: 'hello', payload: { x: 1 } },
    })
    if (checklist.rpcPeer) {
      assert.equal(typeof probe.state.rpcPeerId, 'string')
    }

    // exact streaming Fetch route（0.1.5 起）。
    const streamed = await rawRequest(port, {
      path: '/api/dsh-sba-fetch-probe',
      method: 'POST',
      headers: { host: '127.0.0.1', 'content-type': 'text/plain' },
      body: 'stream-me',
    })
    assert.equal(streamed.status, 201)
    assert.equal(streamed.body, 'echo:stream-me')

    // connection/request 瀑布（0.1.7+）：共享 /api 通道可见、dedicated 不可见。
    if (checklist.waterfall) {
      assert.ok(probe.state.waterfallSeen.includes('/api/dsh-sba-fetch-probe'))
      assert.ok(!probe.state.waterfallSeen.includes('/dsh-sba-gen-probe/hello'))
    }

    // /connect 交换端点三态（0.2.1+）：成功 302 → ./api/remote.mux；interactions
    // 违例 400；evil host 403。
    if (checklist.connectRoute) {
      const connect = await rawRequest(port, { path: '/connect?token=whatever&interactions=none' })
      assert.equal(connect.status, 302)
      assert.equal(connect.headers.location, './api/remote.mux')
      const badInteractions = await rawRequest(port, { path: '/connect?interactions=sometimes' })
      assert.equal(badInteractions.status, 400)
      const evilConnect = await rawRequest(port, { path: '/connect', headers: { host: 'evil.example' } })
      assert.equal(evilConnect.status, 403)
    }

    // 信任栅栏：evil host 403，且瀑布计数不增（403 发生在 admit 阶段、瀑布之前）。
    const evil = await rawRequest(port, {
      path: '/api/dsh-sba-fetch-probe',
      method: 'POST',
      headers: { host: 'evil.example', 'content-type': 'text/plain' },
      body: 'evil',
    })
    assert.equal(evil.status, 403)
    if (checklist.waterfall) {
      assert.equal(probe.state.waterfallSeen.filter((url) => url === '/api/dsh-sba-fetch-probe').length, 1)
    }

    const indexBody = await readFile(`${root}/dist/index.html`, 'utf8')
    assert.ok(indexBody.includes('shell'))
  })
}

// ── 相邻对 dormant（全局序 9 对 × 双向 = 18）───────────────────────────────
// 白名单匹配完整版本对：任何相邻混合（含同代际跨 patch 与代际边界）都 dormant。
for (let i = 0; i + 1 < VERSION_FIXTURES.length; i++) {
  const pair = [VERSION_FIXTURES[i], VERSION_FIXTURES[i + 1]]
  for (const [runtimeSide, connectionSide] of [[pair[0], pair[1]], [pair[1], pair[0]]]) {
    test(`${runtimeSide.version} runtime with ${connectionSide.version} connection stays dormant (adjacent pair mix)`, async (t) => {
      // modules 跟随 connection 侧（probe 侧）；0.1.2-rc.1 侧省略 modules →
      // compose 默认 pinned rc.1 moduleMap。
      const modules = connectionSide.aliases === null ? undefined : await loadFixtureModules(connectionSide)
      const options = {
        probeVersion: connectionSide.version,
        runtimeVersion: runtimeSide.version,
        webRuntime: { lanAddresses: [], trustedHosts: [] },
        webStartup: { trustedHosts: [] },
        rows: BASE_ROWS,
      }
      if (modules !== undefined) options.modules = modules
      const { context } = await compose(t, options)
      const entries = [...context.loader.entries()]
      assert.equal(entries.find((candidate) => candidate.options.id === 'connection')?.disabled, false)
      assert.equal(entries.find((candidate) => candidate.options.id === 'trusted-connection')?.disabled, true)
      assert.equal(entries.find((candidate) => candidate.options.id === 'trusted-connection-021')?.disabled, true)
    })
  }
}
