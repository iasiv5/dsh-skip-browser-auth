// npm 扁平布局表驱动套件（dshm 部署形态）：循环全部 10 个白名单版本的
// manifest fallback 激活（探针 URL 无版本段 → 双锚点走 manifest 回退分支），
// 并移植旧 npm-flat.test.mjs 的两块独有内容：v1 深行为（token 303 root 语义、
// /api 无认证层、evil 403、固定警告、无 set-cookie）与 host 0.1.1-rc.2 混合
// 漂移 dormant 回归（2026-09-05 事故形态：probe rc.1 + runtime 0.1.1-rc.2，
// 官方行走默认 pinned modules，不引入 rc2 别名——rc2 真实包场景由
// rc2-dormant.test.mjs 覆盖）。断言面对账见实施计划附录 A。
import test from 'node:test'
import assert from 'node:assert/strict'
import { compose, rawRequest } from '../helpers/compose.mjs'
import { VERSION_FIXTURES, loadFixtureModules } from '../fixtures/registry.mjs'
import { GENERATION_CHECKLISTS } from '../helpers/generation-checklists.mjs'

const JSON_ENVELOPE = JSON.stringify({ type: 'client-request', rpcId: 'probe', method: 'session.list', payload: {} })
const OFFICIAL_401 = 'dsh web authentication required; reopen the URL printed by dsh web.\n'
const FIXED_WARNING = 'BrowserAuth has been skipped'

const BASE_ROWS = [
  { name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
  { id: 'frontend', name: '@deepseek-ai/dsh-host-frontend-static', config: { distIndex: '{{ROOT}}/dist/index.html' } },
  { id: 'connection', name: '@deepseek-ai/dsh-client-connection' },
]
// v1 深行为沿用旧 npm-flat.test.mjs 的行集（含 credentials-local）。
const ROWS_V1 = [
  { name: '@deepseek-ai/dsh-credentials-local', config: { path: '{{ROOT}}/.credentials.yaml', watch: false } },
  ...BASE_ROWS,
]

// ── 10 版本激活块 × 1 ───────────────────────────────────────────────────────
for (const entry of VERSION_FIXTURES) {
  const checklist = GENERATION_CHECKLISTS[entry.profileId]
  const isV1 = entry.profileId === 'legacy-web-v1'

  test(`${entry.version} npm flat manifest fallback activates ${entry.profileId}`, async (t) => {
    // v1 深行为需要捕获固定警告（逐字输出）。
    const warnings = []
    const originalWarn = console.warn
    if (isV1) console.warn = (message) => { warnings.push(message) }
    let composed
    try {
      const options = {
        layout: 'npm',
        probeVersion: entry.version,
        rows: isV1 ? ROWS_V1 : BASE_ROWS,
      }
      if (isV1) {
        options.webRuntime = { lanAddresses: [], trustedHosts: ['app.internal'] }
      } else if (checklist.service === 'webStartup') {
        options.webStartup = { trustedHosts: [] }
      } else {
        options.webRuntime = { lanAddresses: [], trustedHosts: [] }
      }
      if (entry.aliases !== null) {
        options.modules = await loadFixtureModules(entry)
      }
      composed = await compose(t, options)
    } finally {
      if (isV1) console.warn = originalWarn
    }
    const { context, port } = composed
    const entries = [...context.loader.entries()]
    const connection = entries.find((candidate) => candidate.options.id === 'connection')
    const trusted = entries.find((candidate) => candidate.options.id === checklist.trustedRowId)
    const otherTrusted = entries.find((candidate) =>
      candidate.options.id === (checklist.trustedRowId === 'trusted-connection' ? 'trusted-connection-021' : 'trusted-connection'))
    assert.equal(connection?.disabled, true)
    assert.equal(trusted?.disabled, false)
    assert.equal(otherTrusted?.disabled, true)
    if (isV1) {
      // 旧 v1 块还断言 fiber 形态（dormant 行无 fiber、active 行有 fiber）。
      assert.equal(connection?.fiber, undefined)
      assert.notEqual(trusted?.fiber, undefined)
    }

    const rootGet = await rawRequest(port, { path: '/' })
    assert.equal(rootGet.status, 200)
    assert.match(rootGet.body, checklist.indexMarker)

    if (isV1) {
      // v1 深行为（移植自旧 npm-flat.test.mjs L48-76）。
      assert.ok(rootGet.body.includes('shell'))
      assert.equal(rootGet.headers['set-cookie'], undefined)

      const tokenGet = await rawRequest(port, { path: '/?token=whatever' })
      assert.equal(tokenGet.status, 303)
      assert.equal(tokenGet.headers.location, '/')

      const api = await rawRequest(port, {
        path: '/api/session.list',
        method: 'POST',
        headers: { host: '127.0.0.1', 'content-type': 'application/json' },
        body: JSON_ENVELOPE,
      })
      assert.notEqual(api.status, 401)
      assert.notEqual(api.status, 403)

      const evil = await rawRequest(port, {
        path: '/api/session.list',
        method: 'POST',
        headers: { host: 'evil.example', 'content-type': 'application/json' },
        body: JSON_ENVELOPE,
      })
      assert.equal(evil.status, 403)

      assert.equal(warnings.some((warning) => String(warning).includes(FIXED_WARNING)), true)
    }
  })
}

// ── 0.1.1-rc.2 混合漂移 dormant 回归（原样移植，旧 npm-flat.test.mjs L79-113）──
test('npm flat layout, host 0.1.1-rc.2: probe false via manifest, plugin stays dormant', async (t) => {
  const warnings = []
  const originalWarn = console.warn
  console.warn = (message) => { warnings.push(message) }
  let composed
  try {
    composed = await compose(t, {
      layout: 'npm',
      probeVersion: '0.1.2-rc.1',
      runtimeVersion: '0.1.1-rc.2',
      webRuntime: { lanAddresses: [], trustedHosts: ['app.internal'] },
      rows: ROWS_V1,
    })
  } finally {
    console.warn = originalWarn
  }
  const { context, port } = composed

  // 官方行活跃、插件行 dormant。
  const entries = [...context.loader.entries()]
  const connection = entries.find((candidate) => candidate.options.id === 'connection')
  const trusted = entries.find((candidate) => candidate.options.id === 'trusted-connection')
  assert.equal(connection?.disabled, false)
  assert.notEqual(connection?.fiber, undefined)
  assert.equal(trusted?.disabled, true)
  assert.equal(trusted?.fiber, undefined)

  // 官方 BrowserAuth 照常：未认证 → 401 官方文案。
  const unauthenticated = await rawRequest(port, { path: '/' })
  assert.equal(unauthenticated.status, 401)
  assert.equal(unauthenticated.body, OFFICIAL_401)

  // 无固定警告。
  assert.equal(warnings.some((warning) => String(warning).includes(FIXED_WARNING)), false)
})
