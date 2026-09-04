// trusted-network stub 认证对象的行为矩阵（计划 Task 3 Step 1）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTrustedAuth } from '../lib/trusted-auth.js'

// 记录 writeHead/end 调用的假响应对象。
function fakeRes() {
  const calls = { writeHead: [], ended: false, body: undefined }
  return {
    calls,
    writeHead(status, headers) { calls.writeHead.push({ status, headers }) },
    end(body) { calls.ended = true; calls.body = body },
  }
}

function req(headers, { method = 'GET', url = '/' } = {}) {
  return { headers, method, url }
}

const auth = createTrustedAuth(['app.internal', 'lan.host:8443'])

test('untrusted Host is refused with 403 and the caller may not serve', () => {
  const res = fakeRes()
  assert.equal(auth.authorizeIndex(req({ host: 'evil.example' }), res), false)
  assert.equal(res.calls.writeHead[0]?.status, 403)
  assert.equal(res.calls.ended, true)
})

test('trusted Hosts are admitted: bare host and exact host:port, wrong port refused', () => {
  assert.equal(auth.authorizeIndex(req({ host: 'app.internal' }), fakeRes()), true)
  assert.equal(auth.authorizeIndex(req({ host: 'lan.host:8443' }), fakeRes()), true)
  const res = fakeRes()
  assert.equal(auth.authorizeIndex(req({ host: 'lan.host:9999' }), res), false)
  assert.equal(res.calls.writeHead[0]?.status, 403)
})

test('browser cross-site markers are refused even under a trusted Host', () => {
  const crossSite = fakeRes()
  assert.equal(auth.authorizeIndex(req({ host: 'app.internal', 'sec-fetch-site': 'cross-site' }), crossSite), false)
  assert.equal(crossSite.calls.writeHead[0]?.status, 403)

  const originMismatch = fakeRes()
  assert.equal(auth.authorizeIndex(req({ host: 'app.internal', origin: 'http://evil.example' }), originMismatch), false)
  assert.equal(originMismatch.calls.writeHead[0]?.status, 403)

  const nullOrigin = fakeRes()
  assert.equal(auth.authorizeIndex(req({ host: 'app.internal', origin: 'null' }), nullOrigin), false)
  assert.equal(nullOrigin.calls.writeHead[0]?.status, 403)
})

test('a token on GET / is cleaned up with a 303 to clean /', () => {
  const res = fakeRes()
  assert.equal(auth.authorizeIndex(req({ host: 'app.internal' }, { method: 'GET', url: '/?token=x' }), res), false)
  assert.equal(res.calls.writeHead[0]?.status, 303)
  assert.equal(res.calls.writeHead[0]?.headers['location'], '/')
  assert.equal(res.calls.writeHead[0]?.headers['cache-control'], 'no-store')
  assert.equal(res.calls.writeHead[0]?.headers['referrer-policy'], 'no-referrer')
  assert.equal(res.calls.ended, true)
})

test('trusted requests without a token cleanup shape are served: GET /, other paths, other methods', () => {
  assert.equal(auth.authorizeIndex(req({ host: 'app.internal' }, { method: 'GET', url: '/' }), fakeRes()), true)
  assert.equal(auth.authorizeIndex(req({ host: 'app.internal' }, { method: 'GET', url: '/index.html?token=x' }), fakeRes()), true)
  assert.equal(auth.authorizeIndex(req({ host: 'app.internal' }, { method: 'POST', url: '/?token=x' }), fakeRes()), true)
})

test('isAuthenticated is always true', () => {
  assert.equal(auth.isAuthenticated(req({ host: 'evil.example' })), true)
  assert.equal(auth.isAuthenticated(req({})), true)
  assert.equal(auth.isAuthenticated({ headers: new Headers({ host: 'app.internal' }) }), true)
})

test('authenticatedUrl strips search and hash and pins the root path', () => {
  assert.equal(auth.authenticatedUrl('http://127.0.0.1:3080/?token=x#frag'), 'http://127.0.0.1:3080/')
})
