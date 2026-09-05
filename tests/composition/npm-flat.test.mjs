// npm 扁平布局端到端组合（dshm 部署形态）：探针 fixture 为扁平 node_modules
// （URL 无版本段），探针必须走 manifest 回退分支。rc.1 → Replacement 激活；
// 宿主 rc.2 → dormant。这是 B 机（0.1.2-rc.1 + dshm 安装 v0.1.1 永远 dormant）
// 问题的组合期回归。
import test from 'node:test'
import assert from 'node:assert/strict'
import { compose, rawRequest } from '../helpers/compose.mjs'

const JSON_ENVELOPE = JSON.stringify({ type: 'client-request', rpcId: 'probe', method: 'session.list', payload: {} })
const OFFICIAL_401 = 'dsh web authentication required; reopen the URL printed by dsh web.\n'
const FIXED_WARNING = 'BrowserAuth has been skipped'

const ROWS = [
  { name: '@deepseek-ai/dsh-credentials-local', config: { path: '{{ROOT}}/.credentials.yaml', watch: false } },
  { name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
  { id: 'frontend', name: '@deepseek-ai/dsh-host-frontend-static', config: { distIndex: '{{ROOT}}/dist/index.html' } },
  { id: 'connection', name: '@deepseek-ai/dsh-client-connection' },
]

test('npm flat layout, rc.1 manifests: Replacement activates (manifest fallback branch)', async (t) => {
  const warnings = []
  const originalWarn = console.warn
  console.warn = (msg) => { warnings.push(msg) }
  let composed
  try {
    composed = await compose(t, {
      layout: 'npm',
      probeVersion: '0.1.2-rc.1',
      webRuntime: { lanAddresses: [], trustedHosts: ['app.internal'] },
      rows: ROWS,
    })
  } finally {
    console.warn = originalWarn
  }
  const { context, port } = composed

  // loader entries：官方行 dormant，插件行活跃（npm 布局下首次可激活）。
  const entries = [...context.loader.entries()]
  const connection = entries.find(e => e.options.id === 'connection')
  const trusted = entries.find(e => e.options.id === 'trusted-connection')
  assert.notEqual(connection, undefined)
  assert.notEqual(trusted, undefined)
  assert.equal(connection.disabled, true)
  assert.equal(connection.fiber, undefined)
  assert.equal(trusted.disabled, false)
  assert.notEqual(trusted.fiber, undefined)

  // 行为：无 token/cookie → 200；token 清理 303；/api 无认证层且 fence 生效。
  const rootGet = await rawRequest(port, { path: '/' })
  assert.equal(rootGet.status, 200)
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

  // 固定警告逐项出现（激活的行为证据）。
  assert.equal(warnings.some(w => String(w).includes(FIXED_WARNING)), true)
})

test('npm flat layout, host rc.2: probe false via manifest, plugin stays dormant', async (t) => {
  const warnings = []
  const originalWarn = console.warn
  console.warn = (msg) => { warnings.push(msg) }
  let composed
  try {
    composed = await compose(t, {
      layout: 'npm',
      probeVersion: '0.1.2-rc.1',
      runtimeVersion: '0.1.1-rc.2',
      webRuntime: { lanAddresses: [], trustedHosts: ['app.internal'] },
      rows: ROWS,
    })
  } finally {
    console.warn = originalWarn
  }
  const { context, port } = composed

  // 官方行活跃、插件行 dormant。
  const entries = [...context.loader.entries()]
  const connection = entries.find(e => e.options.id === 'connection')
  const trusted = entries.find(e => e.options.id === 'trusted-connection')
  assert.equal(connection.disabled, false)
  assert.notEqual(connection.fiber, undefined)
  assert.equal(trusted.disabled, true)
  assert.equal(trusted.fiber, undefined)

  // 官方 BrowserAuth 照常：未认证 → 401 官方文案。
  const unauthenticated = await rawRequest(port, { path: '/' })
  assert.equal(unauthenticated.status, 401)
  assert.equal(unauthenticated.body, OFFICIAL_401)

  // 无固定警告。
  assert.equal(warnings.some(w => String(w).includes(FIXED_WARNING)), false)
})
