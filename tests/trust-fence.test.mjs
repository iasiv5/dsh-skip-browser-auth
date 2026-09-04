// 移植自官方 packages/client/connection/tests/api-request-trust.host.spec.ts
// 的用例矩阵（vitest → node:test），行为断言保持一致。
import test from 'node:test'
import assert from 'node:assert/strict'
import { isTrustedApiRequest, assertTrustedAuthority } from '../lib/trust-fence.js'

function request(headers) {
  return { headers }
}

test('markerless requests are held to the Host fence — a plain-HTTP browser read carries no markers', () => {
  // 纯 HTTP 下浏览器读请求（图片、导航）不带 Origin / Fetch-Metadata，
  // 与 curl 不可区分：不允许任何 marker 捷径，Host fence 必须兜底。
  assert.equal(isTrustedApiRequest(request({ host: '127.0.0.1:3080' }), []), true)
  assert.equal(isTrustedApiRequest(request({ host: '192.168.1.5:3080' }), ['192.168.1.5']), true)
  assert.equal(isTrustedApiRequest(request({ host: '192.168.1.5:3080' }), []), false)
  assert.equal(isTrustedApiRequest(request({ host: 'harness.example' }), []), false)
  assert.equal(isTrustedApiRequest(request({}), []), false)
})

test('loopback Hosts accepted in every spelling, with and without ports', () => {
  for (const host of ['localhost', 'localhost:3080', '127.0.0.1', '127.0.0.1:3080', '127.8.9.10:80', '[::1]', '[::1]:3080', 'LOCALHOST:3080']) {
    assert.equal(isTrustedApiRequest(request({ host, origin: `http://${host}` }), []), true, host)
  }
})

test('rebound Host refused: the attacker domain names the socket it did not expect', () => {
  assert.equal(isTrustedApiRequest(request({
    host: 'evil.example:3080',
    origin: 'http://evil.example:3080',
    'sec-fetch-site': 'same-origin',
  }), []), false)
})

test('declared public authority: exact on host:port entries, any port on port-less entries', () => {
  const headers = { host: 'harness.internal:3080', origin: 'http://harness.internal:3080' }
  assert.equal(isTrustedApiRequest(request(headers), ['harness.internal:3080']), true)
  assert.equal(isTrustedApiRequest(request(headers), ['harness.internal']), true)
  assert.equal(isTrustedApiRequest(request(headers), ['harness.internal:9999']), false)
  assert.equal(isTrustedApiRequest(request(headers), []), false)
})

test('Host, Origin, and trusted entries matched through WHATWG normalization (case, default port)', () => {
  assert.equal(isTrustedApiRequest(request({ host: 'Harness.INTERNAL:3080', origin: 'http://harness.internal:3080' }), ['harness.internal:3080']), true)
  assert.equal(isTrustedApiRequest(request({ host: 'harness.internal', origin: 'http://harness.internal' }), ['HARNESS.internal:80']), true)
  // 无法解析的 entry 永不匹配，也不污染列表其余部分。
  assert.equal(isTrustedApiRequest(request({ host: 'harness.internal', origin: 'http://harness.internal' }), ['bad entry', 'harness.internal']), true)
  assert.equal(isTrustedApiRequest(request({ host: 'harness.internal', origin: 'http://harness.internal' }), ['bad entry']), false)
})

test('cross-origin browser markers refused even on a loopback Host', () => {
  // Origin 存在且不同源 → 通过预检规则的跨站请求仍拒绝。
  assert.equal(isTrustedApiRequest(request({ host: '127.0.0.1:3080', origin: 'http://evil.example' }), []), false)
  // 显式 cross-site 标签 → 无论 Origin 一律拒绝。
  assert.equal(isTrustedApiRequest(request({ host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' }), []), false)
  // 不透明 origin（沙箱 iframe、file: 页面）解析不出 authority。
  assert.equal(isTrustedApiRequest(request({ host: '127.0.0.1:3080', origin: 'null' }), []), false)
})

test('same-origin browser request accepted, with or without an Origin header', () => {
  assert.equal(isTrustedApiRequest(request({
    host: 'localhost:3080',
    origin: 'http://localhost:3080',
    'sec-fetch-site': 'same-origin',
  }), []), true)
  // 无 Origin 的浏览器形态（同源 GET）仍带 sec-fetch-site。
  assert.equal(isTrustedApiRequest(request({ host: 'localhost:3080', 'sec-fetch-site': 'same-origin' }), []), true)
})

test('Fetch Headers are read while absent browser markers stay absent', () => {
  assert.equal(isTrustedApiRequest({ headers: new Headers({ host: '127.0.0.1:3080' }) }, []), true)
  assert.equal(isTrustedApiRequest({
    headers: new Headers({ host: '127.0.0.1:3080', origin: 'http://evil.example' }),
  }, []), false)
})

test('stray whitespace never broadens an exact-port entry to every port', () => {
  // 载入期断言之下的纵深防御：显式端口的判定读解析后的 URL，
  // 被裁剪的 `host:port ` entry 仍保持精确匹配。
  const trusted = ['harness.internal:3080 ']
  assert.equal(isTrustedApiRequest(request({ host: 'harness.internal:9999', origin: 'http://harness.internal:9999' }), trusted), false)
  assert.equal(isTrustedApiRequest(request({ host: 'harness.internal:3080', origin: 'http://harness.internal:3080' }), trusted), true)
})

test('malformed or untrusted authorities refused on browser requests', () => {
  const markers = { 'sec-fetch-site': 'same-origin' }
  assert.equal(isTrustedApiRequest(request({ ...markers }), []), false)
  assert.equal(isTrustedApiRequest(request({ ...markers, host: '' }), []), false)
  assert.equal(isTrustedApiRequest(request({ ...markers, host: 'bad host' }), []), false)
  assert.equal(isTrustedApiRequest(request({ ...markers, host: '127.0.0.999' }), []), false)
  assert.equal(isTrustedApiRequest(request({ ...markers, host: '128.0.0.1' }), []), false)
})

test('assertTrustedAuthority accepts bare authorities and throws on anything more', () => {
  for (const entry of ['harness.internal', 'harness.internal:3080', 'HARNESS.internal:80', '10.0.0.9', '[::1]:3080']) {
    assert.doesNotThrow(() => assertTrustedAuthority(entry), entry)
  }
  // WHATWG 解析会从这些形态里悄悄读出主机名；配置边界必须拒绝，
  // 而不是授权前缀、或等请求 403 时才暴露。
  for (const entry of ['harness.internal/path', 'harness.internal/', 'user@harness.internal', 'harness.internal?x', 'harness.internal#f', 'harness.internal\\path', 'bad entry', '']) {
    assert.throws(() => assertTrustedAuthority(entry), /not a bare host\[:port\] authority/, entry)
  }
  // WHATWG 会静默裁剪这些；entry 必须直接失败。
  for (const entry of ['harness.internal:3080 ', ' harness.internal', 'harness.internal:30\t80']) {
    assert.throws(() => assertTrustedAuthority(entry), /not a bare host\[:port\] authority/, entry)
  }
  // WHATWG 解析会静默改写这些——悬挂冒号或零填充端口会把精确端口
  // 授权扩大到所有端口，非规范主机拼写无法按原样读回。
  for (const entry of ['harness.internal:', '[::1]:', 'harness.internal:0080', '0x7f.0.0.1', '[0:0:0:0:0:0:0:1]']) {
    assert.throws(() => assertTrustedAuthority(entry), /not a bare host\[:port\] authority/, entry)
  }
})
