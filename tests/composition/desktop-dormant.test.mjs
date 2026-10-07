// desktop 宿主组合基线（2026-10-07 web-only 门控，docs/COMPATIBILITY.md §7）：
// desktop-host 桩包在场 + 真实 0.2.0-rc.2 pair（恰好命中 carrier-neutral-v3 白名单）
// ⇒ 必须整体休眠——这正是 2026-10-07 Windows desktop 实机的处境：版本全对，但设计上
// desktop 一律 dormant（与未知版本对行为完全一致，安静无横幅）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { compose, rawRequest } from '../helpers/compose.mjs'

test('desktop host profile forces full dormancy even when the version pair is whitelisted', async (t) => {
  // fixture 依赖检查：别名安装缺失时明确指引，不静默跳过。
  let Connection202
  let Frontend202
  let WebServer202
  try {
    ;[Connection202, Frontend202, WebServer202] = await Promise.all([
      import('dsh-client-connection-rc202'),
      import('frontend-static-rc202'),
      import('webserver-rc202'),
    ])
  } catch {
    assert.fail('先运行 npm run test:rc17-fixture（提供 rc202 系别名包）')
    return
  }

  // 捕获固定警告：dormant 组合全程不得输出。
  const warnings = []
  const originalWarn = console.warn
  console.warn = (msg) => { warnings.push(msg) }
  let composed
  try {
    composed = await compose(t, {
      probeVersion: '0.2.0-rc.2',
      desktopHost: true,
      rows: [
        { name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
        { id: 'frontend', name: '@deepseek-ai/dsh-host-frontend-static', config: { distIndex: '{{ROOT}}/dist/index.html' } },
        { id: 'connection', name: '@deepseek-ai/dsh-client-connection' },
      ],
      modules: {
        '@deepseek-ai/dsh-client-connection': Connection202,
        '@deepseek-ai/dsh-host-frontend-static': Frontend202,
        '@deepseek-ai/dsh-host-webserver': WebServer202,
      },
    })
  } finally {
    console.warn = originalWarn
  }
  const { context, port } = composed

  // 行状态：官方行活跃（有 fiber）、插件行 disabled 且无 fiber —— 插件 apply 从未运行，
  // 其 /api route 因此在因果上不可能注册（trusted 行 disabled ⇒ apply 不执行）。
  const entries = [...context.loader.entries()]
  const connection = entries.find((entry) => entry.options.id === 'connection')
  const trusted = entries.find((entry) => entry.options.id === 'trusted-connection')
  assert.notEqual(connection, undefined)
  assert.notEqual(trusted, undefined)
  assert.equal(connection.disabled, false)
  assert.notEqual(connection.fiber, undefined)
  assert.equal(trusted.disabled, true)
  assert.equal(trusted.fiber, undefined)

  // 官方基线（实测 2026-10-07，rc202 最小 fixture 休眠态）：`/`、`/?token=x`、
  // `/index.html`、`/api/*` 全部 404 空体、无 set-cookie——0.2.0 代际官方
  // frontend-static 走 registerFallback + connection.authorizeIndex(BrowserAuth)，
  // 无凭据最小环境下不服务索引；webserver 默认 404 空体（0.1.1-rc.2 代际才是
  // 'not found' 文本体，见 rc2-dormant）。插件若误激活，`/` 会变 200
  // （carrier-neutral-v3 全局注入）、探针路径变 201，以下断言必然失败——
  // 即休眠与官方基线的判定证据。
  const rootGet = await rawRequest(port, { path: '/' })
  assert.equal(rootGet.status, 404)
  assert.equal(rootGet.body, '')

  // 插件专属路径（仅插件会注册该 exact Fetch route）：官方基线 404 空体。
  const pluginProbe = await rawRequest(port, {
    path: '/api/dsh-sba-fetch-probe',
    method: 'POST',
    headers: { host: '127.0.0.1', 'content-type': 'text/plain' },
    body: 'stream-me',
  })
  assert.equal(pluginProbe.status, 404)
  assert.equal(pluginProbe.body, '')

  // 全程无 set-cookie、无固定警告。
  assert.equal(rootGet.headers['set-cookie'], undefined)
  assert.equal(pluginProbe.headers['set-cookie'], undefined)
  assert.equal(warnings.some((w) => String(w).includes('BrowserAuth has been skipped')), false)
})
