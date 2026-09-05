// host 半区 apply 的行为矩阵（计划 Task 6 Step 1）：路由注册、拒绝/放行、
// 固定警告、配置校验、image capacity、backstop 负向与跳过。
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { apply, inject, Config } from '../lib/host.js'
import { CONNECTION_PACKAGE, GATE_RUNTIME_PACKAGE } from '../lib/gate.js'
import { writeGateFixtures, dispatchingResolveSync } from './helpers/gate-fixture.mjs'

const FIXED_WARNING = '@iasiv5/dsh-skip-browser-auth: BrowserAuth has been skipped. DSH Web is using the trusted-network behavior; this plugin does not verify any upstream proxy.'

test('plugin injects only webServer and exports a Config schema', () => {
  assert.deepEqual(inject, ['webServer'])
  assert.equal(typeof Config, 'function')
})

// 假请求：EventEmitter + 预置 chunks 的异步迭代器。
function fakeReq({ headers = {}, url = '/', method = 'GET', chunks = [] } = {}) {
  const req = new EventEmitter()
  req.headers = headers
  req.url = url
  req.method = method
  req.destroyed = false
  req.destroy = () => { req.destroyed = true }
  req[Symbol.asyncIterator] = async function* () {
    for (const chunk of chunks) yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
  }
  return req
}

// 假响应：记录 writeHead/write/end。
function fakeRes() {
  const res = new EventEmitter()
  res.writeHeadCalls = []
  res.writes = []
  res.ends = []
  res.writableEnded = false
  res.writeHead = (status, headers) => { res.writeHeadCalls.push({ status, headers: headers ?? null }) }
  res.write = (chunk) => { res.writes.push(chunk); return true }
  res.end = (body) => { res.writableEnded = true; res.ends.push(body) }
  return res
}

function resBody(res) {
  return Buffer.concat(res.writes.map(w => Buffer.isBuffer(w) ? w : Buffer.from(w))).toString()
    + res.ends.filter(b => typeof b === 'string').join('')
}

// 组装一个装好 webServer fake 的上下文，返回 [ctx, routes]。
function makeContext() {
  const ctx = new Context()
  const routes = []
  ctx.provide('webServer', { register: (route) => { routes.push(route); return async () => {} } })
  return { ctx, routes }
}

// fakeLoader：resolveSync 按 specifier 分发到双锚点 fixture。
function fakeLoader(urls, options = {}) {
  return { internal: { version: 'v2', resolveSync: dispatchingResolveSync(urls, options) } }
}

// 构造绑定完好的 fakeSelf/官方行（同组、名字正确、disabled、无活跃 fiber）。
function fakeSelfWithRow(rowOverrides = {}) {
  const row = {
    options: { id: 'connection', name: CONNECTION_PACKAGE },
    disabled: true,
    fiber: undefined,
    ...rowOverrides,
  }
  const self = { parent: { tree: { resolve: () => row } } }
  row.parent = self.parent
  return { self, row }
}

test('apply registers exactly one /api prefix route', async () => {
  const { ctx, routes } = makeContext()
  await apply(ctx, { trustedHosts: [] })
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/api')
})

test('evil Host JSON POST is short-circuited with 403 forbidden', async () => {
  const { ctx, routes } = makeContext()
  await apply(ctx, { trustedHosts: [] })
  const res = fakeRes()
  await routes[0].handler(fakeReq({
    method: 'POST',
    url: '/api/session.list',
    headers: { host: 'evil.example', 'content-type': 'application/json' },
  }), res)
  assert.equal(res.writeHeadCalls[0]?.status, 403)
  assert.equal(resBody(res), 'forbidden')
})

test('loopback JSON POST reaches the handler: 404 not found and no set-cookie', async () => {
  const { ctx, routes } = makeContext()
  await apply(ctx, { trustedHosts: [] })
  const res = fakeRes()
  await routes[0].handler(fakeReq({
    method: 'POST',
    url: '/api/session.list',
    headers: { host: '127.0.0.1:3080', 'content-type': 'application/json' },
    chunks: [Buffer.from(JSON.stringify({ type: 'client-request', rpcId: 'probe', method: 'session.list', payload: {} }))],
  }), res)
  assert.equal(res.writeHeadCalls[0]?.status, 404)
  assert.equal(resBody(res), 'not found')
  const allHeaders = res.writeHeadCalls.flatMap(c => c.headers ? Object.keys(c.headers) : [])
  assert.equal(allHeaders.includes('set-cookie'), false)
})

test('apply emits the fixed startup warning verbatim', async () => {
  const { ctx } = makeContext()
  const warnings = []
  const original = console.warn
  console.warn = (msg) => { warnings.push(msg) }
  try {
    await apply(ctx, { trustedHosts: [] })
  } finally {
    console.warn = original
  }
  assert.ok(warnings.includes(FIXED_WARNING), `warnings were: ${JSON.stringify(warnings)}`)
})

test('a trustedHosts entry that is not a bare authority fails the load loudly', async () => {
  const { ctx } = makeContext()
  await assert.rejects(apply(ctx, { trustedHosts: ['bad entry'] }), /not a bare host\[:port\] authority/)
})

test('insufficient image body capacity rejects with must be at least', async () => {
  const { ctx } = makeContext()
  ctx.provide('attachments', { imageLimits: { maxMessageImageBytes: 400 * 1024 * 1024 } })
  await assert.rejects(apply(ctx, {}), /must be at least/)
})

test('backstop negative A: path segment passes but connection manifest drifts — whitelist fail loud', async (t) => {
  const { urls } = await writeGateFixtures(t, { connectionVersion: { segment: '0.1.2-rc.1', manifest: '9.9.9' } })
  const { ctx } = makeContext()
  const { self } = fakeSelfWithRow()
  ctx.provide('loader', fakeLoader(urls))
  ctx.fiber = { entry: self }
  await assert.rejects(apply(ctx, {}), /whitelist/)
  await assert.rejects(apply(ctx, {}), /dsh-client-connection/)
})

test('backstop negative A2: path segment passes but runtime manifest drifts — whitelist fail loud', async (t) => {
  // 事故形态的 backstop 投影：connection manifest 是真实 rc.1，宿主 runtime
  // 本体 manifest 是 rc.2 —— 白名单断言必须 fail loud。
  const { urls } = await writeGateFixtures(t, { runtimeVersion: { segment: '0.1.2-rc.1', manifest: '0.1.1-rc.2' } })
  const { ctx } = makeContext()
  const { self } = fakeSelfWithRow()
  ctx.provide('loader', fakeLoader(urls))
  ctx.fiber = { entry: self }
  await assert.rejects(apply(ctx, {}), /whitelist/)
  await assert.rejects(apply(ctx, {}), /@deepseek-ai\/dsh /)
})

test('backstop negative A3: a gate anchor does not resolve — fail loud before any route', async (t) => {
  const { urls } = await writeGateFixtures(t)
  const { ctx } = makeContext()
  const { self } = fakeSelfWithRow()
  // runtime 锚点解析不到（fallback 缺失）→ 显式 fail loud。
  ctx.provide('loader', fakeLoader({ [CONNECTION_PACKAGE]: urls[CONNECTION_PACKAGE] }))
  ctx.fiber = { entry: self }
  await assert.rejects(apply(ctx, {}), /gate anchor @deepseek-ai\/dsh did not resolve; whitelist/)
})

test('backstop negative B: correct manifest but official row not disabled — gate binding', async (t) => {
  const { urls } = await writeGateFixtures(t)
  const { ctx } = makeContext()
  const { self } = fakeSelfWithRow({ disabled: false })
  ctx.provide('loader', fakeLoader(urls))
  ctx.fiber = { entry: self }
  await assert.rejects(apply(ctx, {}), /gate binding/)
})

test('backstop negative B: official row name mismatch — gate binding', async (t) => {
  const { urls } = await writeGateFixtures(t)
  const { ctx } = makeContext()
  const { self } = fakeSelfWithRow({ options: { id: 'connection', name: '@deepseek-ai/dsh-client-connection-wrong' } })
  ctx.provide('loader', fakeLoader(urls))
  ctx.fiber = { entry: self }
  await assert.rejects(apply(ctx, {}), /gate binding/)
})

test('missing loader service and fiber entry skips the backstop', async () => {
  const { ctx, routes } = makeContext()
  await apply(ctx, { trustedHosts: [] }) // 无 loader、无 fiber entry：不抛
  assert.equal(routes.length, 1)
})

test('backstop negative: loader present but internal resolver missing fails loud', async () => {
  const { ctx, routes } = makeContext()
  const { self } = fakeSelfWithRow()
  ctx.provide('loader', {}) // loader 服务在，internal 解析器缺失
  ctx.fiber = { entry: self }
  await assert.rejects(apply(ctx, {}), /gate backstop unavailable: loader internal resolver is missing/)
  assert.equal(routes.length, 0) // 失败必须发生在注册 /api 之前
})

test('backstop negative: loader present but current entry missing fails loud', async (t) => {
  const { ctx, routes } = makeContext()
  const { urls } = await writeGateFixtures(t)
  ctx.provide('loader', fakeLoader(urls))
  // 未设置 ctx.fiber：产品上下文缺当前 entry 绑定
  await assert.rejects(apply(ctx, {}), /gate backstop unavailable: current loader entry is missing/)
  assert.equal(routes.length, 0)
})

test('backstop failure fires before service creation, route registration, and warning', async () => {
  const { ctx, routes } = makeContext()
  const { self } = fakeSelfWithRow()
  ctx.provide('loader', {}) // internal 缺失
  ctx.fiber = { entry: self }
  const warnings = []
  const original = console.warn
  console.warn = (msg) => { warnings.push(msg) }
  try {
    await assert.rejects(apply(ctx, {}), /gate backstop unavailable/)
  } finally {
    console.warn = original
  }
  assert.equal(routes.length, 0)
  assert.equal(warnings.length, 0)
})
