// 真实 rc.2 dormant 组合：真实 0.1.1-rc.2 官方产物活跃，插件保持 dormant，
// 行为与 rc.2 无 BrowserAuth 的官方基线一致（前后对照的组合期版本）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { compose, rawRequest } from '../helpers/compose.mjs'

const JSON_ENVELOPE = JSON.stringify({ type: 'client-request', rpcId: 'probe', method: 'session.list', payload: {} })

test('real rc.2 dormant: official rc.2 active, plugin dormant, baseline behavior unchanged', async (t) => {
  // fixture 依赖检查：别名安装缺失时明确指引，不静默跳过。
  let rc2Connection
  let rc2Frontend
  try {
    ;[rc2Connection, rc2Frontend] = await Promise.all([
      import('dsh-client-connection-rc2'),
      import('frontend-static-rc2'),
    ])
  } catch {
    t.fail('先运行 npm run test:rc2-fixture')
    return
  }

  // 捕获固定警告：dormant 组合全程不得输出。
  const warnings = []
  const originalWarn = console.warn
  console.warn = (msg) => { warnings.push(msg) }
  let composed
  try {
    composed = await compose(t, {
      probeVersion: '0.1.1-rc.2',
      rows: [
        { name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
        { id: 'frontend', name: '@deepseek-ai/dsh-host-frontend-static', config: { distIndex: '{{ROOT}}/dist/index.html' } },
        { id: 'connection', name: '@deepseek-ai/dsh-client-connection' },
      ],
      modules: {
        '@deepseek-ai/dsh-client-connection': rc2Connection,
        '@deepseek-ai/dsh-host-frontend-static': rc2Frontend,
      },
    })
  } finally {
    console.warn = originalWarn
  }
  const { context, port } = composed

  // loader entries：官方行活跃（rc.2 无 BrowserAuth 层），插件行 dormant
  const entries = [...context.loader.entries()]
  const connection = entries.find(e => e.options.id === 'connection')
  const trusted = entries.find(e => e.options.id === 'trusted-connection')
  assert.notEqual(connection, undefined)
  assert.notEqual(trusted, undefined)
  assert.equal(connection.disabled, false)
  assert.notEqual(connection.fiber, undefined)
  assert.equal(trusted.disabled, true)
  assert.equal(trusted.fiber, undefined)

  // 官方基线：GET / → 200（rc.2 无 BrowserAuth）
  const rootGet = await rawRequest(port, { path: '/' })
  assert.equal(rootGet.status, 200)
  assert.ok(rootGet.body.includes('shell'))

  // /api：loopback POST → 非 401/403（无认证层；apiproxy 未挂载时 404 'not found'）
  const api = await rawRequest(port, {
    path: '/api/session.list',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON_ENVELOPE,
  })
  assert.notEqual(api.status, 401)
  assert.notEqual(api.status, 403)
  assert.equal(api.status, 404)
  assert.equal(api.body, 'not found')

  // 全程无 set-cookie、无固定警告
  assert.equal(rootGet.headers['set-cookie'], undefined)
  assert.equal(api.headers['set-cookie'], undefined)
  assert.equal(warnings.some(w => String(w).includes('BrowserAuth has been skipped')), false)
})
