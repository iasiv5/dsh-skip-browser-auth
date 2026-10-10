// 用户层 pin 覆盖场景（2026-10-11 Windows desktop 实录，docs/COMPATIBILITY.md §7.8）：
// dsh-m 插件开关 / `dsh plugin add` enable 通道按行 id 向用户 patch 层写
// `- id: trusted-connection  disabled: false`，在本插件 patch 之后应用 ⇒ 组合期
// !!js 门控表达式被常量覆盖 ⇒ 行强制 active、apply 被调。
// 0.3.11 及以前：backstop fail loud（desktop profile not supported）⇒ DSH Desktop
// 每次开关任意插件触发热重载都弹报错。
// 0.3.12 起：apply 最前置宿主判别 ⇒ 静默休眠 no-op——官方 connection 照常活跃、
// 无替换路由、无 SKIP_WARNING、一行 dormant 通知、组合零错误。
import test from 'node:test'
import assert from 'node:assert/strict'
import { compose, rawRequest } from '../helpers/compose.mjs'

test('desktop + user-layer pin forcing the replacement row active stays a silent dormant no-op', async (t) => {
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

  // 捕获 console.warn：dormant 必须静默（无 SKIP_WARNING），仅一行 dormant 通知。
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
      // 用户 patch 层的 pin（dsh-m 开关 / enable 通道写法，逐字复刻 2026-10-11 实录）：
      // 追加在本插件 patch 之后，按行 id 覆盖 disabled 表达式为常量 false。
      extraPatches: [{ id: 'trusted-connection', disabled: false }],
    })
  } finally {
    console.warn = originalWarn
  }
  const { context, port } = composed

  // 行状态：官方行活跃（有 fiber）；插件行被 pin 成 disabled:false 且 apply 完整
  // 跑完（fiber 存在）——0.3.11 同场景 apply fail loud、行启动失败。
  const entries = [...context.loader.entries()]
  const connection = entries.find((entry) => entry.options.id === 'connection')
  const trusted = entries.find((entry) => entry.options.id === 'trusted-connection')
  assert.notEqual(connection, undefined)
  assert.notEqual(trusted, undefined)
  assert.equal(connection.disabled, false)
  assert.notEqual(connection.fiber, undefined)
  assert.equal(trusted.disabled, false)
  assert.notEqual(trusted.fiber, undefined)

  // 官方基线不变（实测 2026-10-07，rc202 最小 fixture 休眠/官方态）：`/` 404 空体。
  // 插件若在 desktop 激活，`/` 会变 200（carrier-neutral-v3 全局注入），此断言必败。
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

  // 全程无 set-cookie、无固定警告、恰好一行 dormant 通知。
  assert.equal(rootGet.headers['set-cookie'], undefined)
  assert.equal(pluginProbe.headers['set-cookie'], undefined)
  assert.equal(warnings.some((w) => String(w).includes('BrowserAuth has been skipped')), false)
  assert.equal(warnings.filter((w) => String(w).includes('desktop host detected')).length, 1)
})
