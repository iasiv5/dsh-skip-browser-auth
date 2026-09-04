// http bridge 行为矩阵（计划 Task 4 Step 1）：413 两条路径、JSON 透传、
// handler reject 传播、客户端断开 abort、背压 drain/close 双等待。
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { bridge, DEFAULT_MAX_REQUEST_BODY_BYTES } from '../lib/bridge.js'

// 假请求：EventEmitter + 预置 chunks 的异步迭代器 + destroy 记录。
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

// 假响应：记录 writeHead/write/end；write 返回值可编排（背压用）。
function fakeRes() {
  const res = new EventEmitter()
  res.writeHeadCalls = []
  res.writes = []
  res.ends = 0
  res.writableEnded = false
  res.writeReturn = true
  res.writeHead = (status, headers) => { res.writeHeadCalls.push({ status, headers }) }
  res.write = (chunk) => { res.writes.push(chunk); return res.writeReturn }
  res.end = () => { res.writableEnded = true; res.ends += 1 }
  return res
}

async function waitUntil(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitUntil timed out')
    await new Promise(resolve => setImmediate(resolve))
  }
}

test('default body cap is 300 MiB', () => {
  assert.equal(DEFAULT_MAX_REQUEST_BODY_BYTES, 300 * 1024 * 1024)
})

test('declared content-length over the limit gets 413 and destroys the request', async () => {
  const req = fakeReq({ headers: { 'content-length': '10' } })
  const res = fakeRes()
  await bridge(req, res, { fetch: async () => new Response('nope') }, 5)
  assert.equal(res.writeHeadCalls[0]?.status, 413)
  assert.equal(req.destroyed, true)
  assert.equal(res.ends, 1)
})

test('streamed body accumulating over the limit gets 413 and destroys the request', async () => {
  const req = fakeReq({ chunks: [Buffer.alloc(3), Buffer.alloc(4)] })
  const res = fakeRes()
  await bridge(req, res, { fetch: async () => new Response('nope') }, 5)
  assert.equal(res.writeHeadCalls[0]?.status, 413)
  assert.equal(req.destroyed, true)
})

test('a normal JSON POST delivers the full body and the response passes through', async () => {
  const req = fakeReq({
    method: 'POST',
    url: '/api/session.list',
    headers: { 'content-type': 'application/json' },
    chunks: [Buffer.from(JSON.stringify({ type: 'client-request', rpcId: 'p' }))],
  })
  const res = fakeRes()
  let received
  const handler = {
    fetch: async (request) => {
      received = await request.json()
      return new Response('ok', { status: 200, headers: { 'x-check': 'yes' } })
    },
  }
  await bridge(req, res, handler)
  assert.deepEqual(received, { type: 'client-request', rpcId: 'p' })
  assert.equal(res.writeHeadCalls[0]?.status, 200)
  assert.equal(res.writeHeadCalls[0]?.headers['x-check'], 'yes')
  assert.equal(Buffer.concat(res.writes.map(w => Buffer.isBuffer(w) ? w : Buffer.from(w))).toString(), 'ok')
  assert.equal(res.ends, 1)
})

test('a rejected handler promise propagates: bridge rejects without writing a status', async () => {
  const req = fakeReq({})
  const res = fakeRes()
  const handler = { fetch: async () => { throw new Error('boom') } }
  await assert.rejects(bridge(req, res, handler), /boom/)
  assert.equal(res.writeHeadCalls.length, 0)
})

test('client disconnect aborts the request signal the handler received', async () => {
  const req = fakeReq({})
  const res = fakeRes()
  let captured
  const handler = {
    fetch: (request) => new Promise((resolve) => {
      captured = request
      request.signal.addEventListener('abort', () => resolve(new Response('aborted', { status: 499 })))
    }),
  }
  const done = bridge(req, res, handler)
  await waitUntil(() => captured !== undefined)
  assert.equal(captured.signal.aborted, false)
  res.emit('close') // 未 writableEnded 的 close = 客户端断开
  await done
  assert.equal(captured.signal.aborted, true)
})

test('backpressure: a false write waits for drain, then finishes writing', async () => {
  const req = fakeReq({})
  const res = fakeRes()
  const body = new ReadableStream({
    start(controller) { controller.enqueue('a'); controller.enqueue('b'); controller.close() },
  })
  const handler = { fetch: async () => new Response(body) }
  res.writeReturn = false
  const done = bridge(req, res, handler)
  await waitUntil(() => res.writes.length === 1) // 首次写入返回 false，已进入等待
  assert.equal(res.writes.length, 1)
  res.writeReturn = true
  res.emit('drain')
  await done
  assert.equal(res.writes.length, 2)
  assert.equal(res.ends, 1)
})

test('backpressure: a close during the drain wait does not hang the bridge', async () => {
  const req = fakeReq({})
  const res = fakeRes()
  const body = new ReadableStream({
    start(controller) { controller.enqueue('a'); controller.enqueue('b'); controller.close() },
  })
  const handler = { fetch: async () => new Response(body) }
  res.writeReturn = false
  const done = bridge(req, res, handler)
  await waitUntil(() => res.writes.length === 1)
  res.writeReturn = true // 解除背压，避免下一笔写入再次等待
  res.emit('close') // 等待 drain 期间断开：close 也必须解除等待
  await done
  assert.equal(res.ends, 1)
})
