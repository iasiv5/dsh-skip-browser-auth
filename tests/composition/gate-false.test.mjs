// gate-false 组合（探针假、官方 rc.1 活跃）：门控假分支的 wiring 测试——
// 官方 BrowserAuth 路径照常工作，Replacement 保持 dormant，无固定警告。
// 定位说明：本用例的 probe fixture 是 9.9.9 版本段，不冒充真实 rc.2 兼容测试。
import test from 'node:test'
import assert from 'node:assert/strict'
import { compose, rawRequest } from '../helpers/compose.mjs'

const JSON_ENVELOPE = JSON.stringify({ type: 'client-request', rpcId: 'probe', method: 'session.list', payload: {} })
const OFFICIAL_401 = 'dsh web authentication required; reopen the URL printed by dsh web.\n'

test('gate-false: official rc.1 BrowserAuth works and the plugin stays dormant', async (t) => {
  // 捕获固定警告：dormant 组合全程不得输出。
  const warnings = []
  const originalWarn = console.warn
  console.warn = (msg) => { warnings.push(msg) }
  let composed
  try {
    composed = await compose(t, {
      probeVersion: '9.9.9',
      webRuntime: { lanAddresses: [], trustedHosts: ['app.internal'] },
      rows: [
        { name: '@deepseek-ai/dsh-credentials-local', config: { path: '{{ROOT}}/.credentials.yaml', watch: false } },
        { name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
        { id: 'frontend', name: '@deepseek-ai/dsh-host-frontend-static', config: { distIndex: '{{ROOT}}/dist/index.html' } },
        { id: 'connection', name: '@deepseek-ai/dsh-client-connection' },
      ],
    })
  } finally {
    console.warn = originalWarn
  }
  const { context, port } = composed

  // 官方 BrowserAuth 活跃：未认证 GET / → 401 官方文案
  const unauthenticated = await rawRequest(port, { path: '/' })
  assert.equal(unauthenticated.status, 401)
  assert.equal(unauthenticated.body, OFFICIAL_401)

  // authenticatedUrl 换 cookie 后 → 200
  const launchUrl = context.connection.authenticatedUrl(`http://127.0.0.1:${String(port)}`)
  const exchange = await fetch(launchUrl, { redirect: 'manual' })
  assert.equal(exchange.status, 303)
  const setCookie = exchange.headers.get('set-cookie')
  if (setCookie === null) throw new Error('official connection did not set a cookie')
  const cookie = setCookie.split(';', 1)[0]
  const index = await rawRequest(port, { path: '/', headers: { cookie } })
  assert.equal(index.status, 200)
  assert.ok(index.body.includes('shell'))

  // 带 cookie 的 /api 请求 → 404（官方认证通过、无 api-gateway）。
  // Host 保持默认（127.0.0.1:port，与换取 cookie 的 authority 一致）。
  const api = await rawRequest(port, {
    path: '/api/session.list',
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON_ENVELOPE,
  })
  assert.equal(api.status, 404)
  assert.equal(api.body, 'not found')

  // loader entries：官方行活跃，插件行 dormant
  const entries = [...context.loader.entries()]
  const connection = entries.find(e => e.options.id === 'connection')
  const trusted = entries.find(e => e.options.id === 'trusted-connection')
  assert.notEqual(connection, undefined)
  assert.notEqual(trusted, undefined)
  assert.equal(connection.disabled, false)
  assert.notEqual(connection.fiber, undefined)
  assert.equal(trusted.disabled, true)
  assert.equal(trusted.fiber, undefined)

  // 无固定警告输出
  assert.equal(warnings.some(w => String(w).includes('BrowserAuth has been skipped')), false)
})
