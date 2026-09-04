// active 组合：rc.1 + 门控真 → Replacement 激活，trusted-network 行为全量断言。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compose, rawRequest } from '../helpers/compose.mjs'

const JSON_ENVELOPE = JSON.stringify({ type: 'client-request', rpcId: 'probe', method: 'session.list', payload: {} })

test('active: Replacement serves trusted-network behavior with the official row dormant', async (t) => {
  const { context, port, root } = await compose(t, {
    probeVersion: '0.1.2-rc.1',
    webRuntime: { lanAddresses: [], trustedHosts: ['app.internal'] },
    rows: [
      { name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
      { id: 'frontend', name: '@deepseek-ai/dsh-host-frontend-static', config: { distIndex: '{{ROOT}}/dist/index.html' } },
      { id: 'connection', name: '@deepseek-ai/dsh-client-connection' },
    ],
  })

  // 首页：无 cookie/token → 200 shell，且不种任何 cookie
  const rootGet = await rawRequest(port, { path: '/' })
  assert.equal(rootGet.status, 200)
  assert.match(rootGet.headers['content-type'] ?? '', /text\/html/)
  assert.ok(rootGet.body.includes('shell'), `index body: ${rootGet.body}`)
  assert.equal(rootGet.headers['set-cookie'], undefined)

  // 首页 fence：受信 Host 放行，未列 Host 拒绝
  assert.equal((await rawRequest(port, { path: '/', headers: { host: 'app.internal' } })).status, 200)
  assert.equal((await rawRequest(port, { path: '/', headers: { host: 'other.internal' } })).status, 403)

  // token 清理：GET /?token → 303 干净 /
  const tokenGet = await rawRequest(port, { path: '/?token=whatever' })
  assert.equal(tokenGet.status, 303)
  assert.equal(tokenGet.headers.location, '/')

  // /api fence + bridge：loopback 可达 handler（无 api-gateway → 404），无 set-cookie
  const api = await rawRequest(port, {
    path: '/api/session.list',
    method: 'POST',
    headers: { host: '127.0.0.1', 'content-type': 'application/json' },
    body: JSON_ENVELOPE,
  })
  assert.equal(api.status, 404)
  assert.equal(api.body, 'not found')
  assert.equal(api.headers['set-cookie'], undefined)

  // /api fence：未列 Host → 403 forbidden
  const evil = await rawRequest(port, {
    path: '/api/session.list',
    method: 'POST',
    headers: { host: 'evil.example', 'content-type': 'application/json' },
    body: JSON_ENVELOPE,
  })
  assert.equal(evil.status, 403)
  assert.equal(evil.body, 'forbidden')

  // 静态资源照常
  assert.equal((await rawRequest(port, { path: '/app.js' })).status, 200)

  // loader entries：官方行 dormant（禁用、无 fiber），插件行活跃
  const entries = [...context.loader.entries()]
  const connection = entries.find(e => e.options.id === 'connection')
  const trusted = entries.find(e => e.options.id === 'trusted-connection')
  assert.notEqual(connection, undefined)
  assert.notEqual(trusted, undefined)
  assert.equal(connection.disabled, true)
  assert.equal(connection.fiber, undefined)
  assert.equal(trusted.disabled, false)
  assert.notEqual(trusted.fiber, undefined)

  // 临时 credentials 文件无 browser-session 记录（BrowserAuth 从未运行）
  const credPath = join(root, '.credentials.yaml')
  const credContent = existsSync(credPath) ? readFileSync(credPath, 'utf8') : ''
  assert.equal(credContent.includes('browser-session'), false)
})

test('active: disposing the composition tears down the served surface', async (t) => {
  const { port, dispose } = await compose(t, {
    probeVersion: '0.1.2-rc.1',
    webRuntime: { lanAddresses: [], trustedHosts: ['app.internal'] },
    rows: [
      { name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
      { id: 'frontend', name: '@deepseek-ai/dsh-host-frontend-static', config: { distIndex: '{{ROOT}}/dist/index.html' } },
      { id: 'connection', name: '@deepseek-ai/dsh-client-connection' },
    ],
  })

  // dispose 前路由可达
  const before = await rawRequest(port, { path: '/' })
  assert.equal(before.status, 200)

  // dispose 后监听已撤销：连接被拒绝（webserver 与 Replacement 同 fiber 生命周期）
  await dispose()
  await new Promise(resolve => setTimeout(resolve, 100))
  await assert.rejects(rawRequest(port, { path: '/' }))
})
