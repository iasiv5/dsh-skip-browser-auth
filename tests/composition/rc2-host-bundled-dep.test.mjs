// 2026-09-05 事故回归（端到端组合）：插件自带/被抬升的 0.1.2-rc.1 connection
// 副本 + 宿主 runtime 0.1.1-rc.2。事故中旧探针以 profile 目录为解析基准读到
// 插件自带副本，自我满足后禁用官方 connection 行，宿主 dsh-client-runtime 因
// 「no generation source is registered」拒绝启动、Web 全断。修复后探针以
// runtime 本体（@deepseek-ai/dsh）为第一锚点：本组合断言官方行不被禁用、
// 官方 BrowserAuth 完整工作、插件整体 dormant。
import test from 'node:test'
import assert from 'node:assert/strict'
import { compose, rawRequest } from '../helpers/compose.mjs'

const OFFICIAL_401 = 'dsh web authentication required; reopen the URL printed by dsh web.\n'

test('bundled rc.1 connection on a 0.1.1-rc.2 host: official row stays enabled, plugin stays dormant', async (t) => {
  // 捕获固定警告：dormant 组合全程不得输出。
  const warnings = []
  const originalWarn = console.warn
  console.warn = (msg) => { warnings.push(msg) }
  let composed
  try {
    composed = await compose(t, {
      probeVersion: '0.1.2-rc.1', // 「插件自带」的真实 rc.1 connection 副本
      runtimeVersion: '0.1.1-rc.2', // 宿主 runtime 本体
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

  // loader entries：官方行必须保持活跃（事故中它被错误禁用），插件行 dormant。
  const entries = [...context.loader.entries()]
  const connection = entries.find(e => e.options.id === 'connection')
  const trusted = entries.find(e => e.options.id === 'trusted-connection')
  assert.notEqual(connection, undefined)
  assert.notEqual(trusted, undefined)
  assert.equal(connection.disabled, false, 'official connection row must NOT be disabled on a 0.1.1-rc.2 host')
  assert.notEqual(connection.fiber, undefined)
  assert.equal(trusted.disabled, true)
  assert.equal(trusted.fiber, undefined)

  // 官方 BrowserAuth 完整：未认证 GET / → 401 官方文案（认证层未被跳过）。
  const unauthenticated = await rawRequest(port, { path: '/' })
  assert.equal(unauthenticated.status, 401)
  assert.equal(unauthenticated.body, OFFICIAL_401)

  // authenticatedUrl 换 cookie 后 → 200（官方 connection 行为分毫不变）。
  const launchUrl = context.connection.authenticatedUrl(`http://127.0.0.1:${String(port)}`)
  const exchange = await fetch(launchUrl, { redirect: 'manual' })
  assert.equal(exchange.status, 303)
  const setCookie = exchange.headers.get('set-cookie')
  if (setCookie === null) throw new Error('official connection did not set a cookie')
  const cookie = setCookie.split(';', 1)[0]
  const index = await rawRequest(port, { path: '/', headers: { cookie } })
  assert.equal(index.status, 200)
  assert.ok(index.body.includes('shell'))

  // 无固定警告输出（Replacement 未激活）。
  assert.equal(warnings.some(w => String(w).includes('BrowserAuth has been skipped')), false)
})
