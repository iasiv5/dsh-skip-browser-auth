// 门控探针与行绑定表达式的真值矩阵 + 真实路径断言（计划 Task 5 Step 1；
// 2026-09-05 事故后探针改为双锚点：宿主 runtime 本体 + 官方 connection 包）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  CONNECTION_PACKAGE,
  GATE_RUNTIME_PACKAGE,
  GATE_VERSION,
  GATE_ANCHOR_PACKAGES,
  GATE_PROBE_EXPRESSION,
  GATE_ROW_ALLOWED_EXPRESSION,
  evaluateGate,
} from '../lib/gate.js'
import { writeGateFixtures, dispatchingResolveSync } from './helpers/gate-fixture.mjs'

const ENTRY_KEY = Symbol.for('cordis.entry')

// 与 vendor/loader/src/config/utils.ts 相同的求值语义：with(ctx) + eval。
function evaluateWith(ctx, expr) {
  return new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }')(ctx, expr)
}

// 构造探针 fake ctx：resolveSync 按 specifier 分发到各锚点 fixture。
function probeCtx(urls, { version = 'v2', throwOnResolve = false, withLoader = true } = {}) {
  if (!withLoader) return { baseUrl: 'file:///fake/base/' }
  return {
    baseUrl: 'file:///fake/base/',
    loader: {
      internal: {
        version,
        resolveSync: dispatchingResolveSync(urls, { throwOnResolve }),
      },
    },
  }
}

// 构造行绑定 fake ctx：symbol entry 提供当前 entry，探针走真实 fixture url。
function rowCtx(official, urls, { rootResolve } = {}) {
  const parent = { tree: { resolve: () => official } }
  official.parent = parent
  const ctx = {
    baseUrl: 'file:///fake/base/',
    [ENTRY_KEY]: { parent },
    loader: {
      internal: { version: 'v2', resolveSync: dispatchingResolveSync(urls) },
      ...(rootResolve === 'throws' ? { resolve: () => { throw new Error('root loader resolve must not be used') } } : {}),
    },
  }
  return ctx
}

function officialRow(overrides = {}) {
  return {
    options: { id: 'connection', name: CONNECTION_PACKAGE },
    disabled: true,
    ...overrides,
  }
}

test('gate constants have the pinned values', () => {
  assert.equal(CONNECTION_PACKAGE, '@deepseek-ai/dsh-client-connection')
  assert.equal(GATE_RUNTIME_PACKAGE, '@deepseek-ai/dsh')
  assert.equal(GATE_VERSION, '0.1.2-rc.1')
  // 锚点顺序：宿主 runtime 本体在前（版本段即宿主版本），被替换对象在后。
  assert.deepEqual([...GATE_ANCHOR_PACKAGES], ['@deepseek-ai/dsh', '@deepseek-ai/dsh-client-connection'])
})

test('probe accepts the whitelisted pnpm version segments on both anchors (v2 form)', async (t) => {
  const { urls } = await writeGateFixtures(t)
  assert.equal(evaluateWith(probeCtx(urls), GATE_PROBE_EXPRESSION), true)
  assert.equal(evaluateGate(probeCtx(urls)), true) // evaluateGate 求值同一探针
})

test('probe rejects a bundled rc.1 connection on a 0.1.1-rc.2 host (the 2026-09-05 incident)', async (t) => {
  // 事故形态：插件自带（或 profile 抬升）的 connection 副本是真实 0.1.2-rc.1，
  // 但宿主 runtime 本体是 0.1.1-rc.2。旧探针据此自我满足并禁用官方行；
  // 修复后 runtime 锚点必须否决。
  const { urls } = await writeGateFixtures(t, {
    runtimeVersion: '0.1.1-rc.2',
    connectionVersion: GATE_VERSION,
  })
  assert.equal(evaluateWith(probeCtx(urls), GATE_PROBE_EXPRESSION), false)
  assert.equal(evaluateGate(probeCtx(urls)), false)
})

test('probe rejects per-anchor version drift in either direction', async (t) => {
  const runtimeDrift = await writeGateFixtures(t, {
    runtimeVersion: '9.9.9',
    connectionVersion: GATE_VERSION,
  })
  const connectionDrift = await writeGateFixtures(t, {
    runtimeVersion: GATE_VERSION,
    connectionVersion: '0.1.1-rc.2',
  })
  const bothDrift = await writeGateFixtures(t, { runtimeVersion: '9.9.9', connectionVersion: '9.9.9' })
  assert.equal(evaluateWith(probeCtx(runtimeDrift.urls), GATE_PROBE_EXPRESSION), false)
  assert.equal(evaluateWith(probeCtx(connectionDrift.urls), GATE_PROBE_EXPRESSION), false)
  assert.equal(evaluateWith(probeCtx(bothDrift.urls), GATE_PROBE_EXPRESSION), false)
})

test('probe rejects manifest drift under a whitelisted path segment', async (t) => {
  const { urls } = await writeGateFixtures(t, {
    runtimeVersion: { segment: GATE_VERSION, manifest: '9.9.9' },
  })
  // 路径段全对、runtime manifest 漂移：探针（只读路径段）仍放行；
  // 该漂移由 apply 内 backstop 读 manifest 兜底（见 host-apply.test.mjs）。
  assert.equal(evaluateWith(probeCtx(urls), GATE_PROBE_EXPRESSION), true)
  const connectionManifestDrift = await writeGateFixtures(t, {
    connectionVersion: { segment: GATE_VERSION, manifest: '9.9.9' },
  })
  assert.equal(evaluateWith(probeCtx(connectionManifestDrift.urls), GATE_PROBE_EXPRESSION), true)
})

test('probe rejects an npm layout without a version segment', async (t) => {
  const urls = {
    [`${GATE_RUNTIME_PACKAGE}/package.json`]: 'file:///repo/node_modules/@deepseek-ai/dsh/package.json',
    [`${CONNECTION_PACKAGE}/package.json`]: 'file:///repo/node_modules/@deepseek-ai/dsh-client-connection/package.json',
  }
  assert.equal(evaluateWith(probeCtx(urls), GATE_PROBE_EXPRESSION), false)
})

test('probe also works in the v1 resolveSync form', async (t) => {
  const { urls } = await writeGateFixtures(t)
  assert.equal(evaluateWith(probeCtx(urls, { version: 'v1' }), GATE_PROBE_EXPRESSION), true)
})

test('probe fails closed when loader/internal is missing, resolveSync throws, or url is not a string', async (t) => {
  const { urls } = await writeGateFixtures(t)
  assert.equal(evaluateWith(probeCtx(urls, { withLoader: false }), GATE_PROBE_EXPRESSION), false)
  assert.equal(evaluateWith({ baseUrl: 'file:///fake/base/', loader: {} }, GATE_PROBE_EXPRESSION), false)
  assert.equal(evaluateWith(probeCtx(urls, { throwOnResolve: true }), GATE_PROBE_EXPRESSION), false)
  const badUrlCtx = probeCtx(urls)
  badUrlCtx.loader.internal.resolveSync = () => ({ url: 42 })
  assert.equal(evaluateWith(badUrlCtx, GATE_PROBE_EXPRESSION), false)
})

test('probe fails closed when any anchor does not resolve (missing runtime fallback)', async (t) => {
  const { urls } = await writeGateFixtures(t)
  // runtime 锚点解析不到（如过旧宿主无 fallback、或非 pnpm 布局）→ dormant。
  const connectionKey = `${CONNECTION_PACKAGE}/package.json`
  const withoutRuntime = { [connectionKey]: urls[connectionKey] }
  assert.equal(evaluateWith(probeCtx(withoutRuntime), GATE_PROBE_EXPRESSION), false)
  // connection 锚点解析不到同理。
  const runtimeKey = `${GATE_RUNTIME_PACKAGE}/package.json`
  const withoutConnection = { [runtimeKey]: urls[runtimeKey] }
  assert.equal(evaluateWith(probeCtx(withoutConnection), GATE_PROBE_EXPRESSION), false)
})

test('row gate passes only for a same-group, name-matching, disabled official row with a true probe', async (t) => {
  const { urls } = await writeGateFixtures(t)
  const ctx = rowCtx(officialRow(), urls)
  assert.equal(evaluateWith(ctx, GATE_ROW_ALLOWED_EXPRESSION), true)
})

test('row gate fails when the official row is not disabled (even with a correct name)', async (t) => {
  const { urls } = await writeGateFixtures(t)
  const ctx = rowCtx(officialRow({ disabled: false }), urls)
  assert.equal(evaluateWith(ctx, GATE_ROW_ALLOWED_EXPRESSION), false)
})

test('row gate fails on a sibling name mismatch', async (t) => {
  const { urls } = await writeGateFixtures(t)
  const ctx = rowCtx(officialRow({ options: { id: 'connection', name: '@deepseek-ai/dsh-client-connection-wrong' } }), urls)
  assert.equal(evaluateWith(ctx, GATE_ROW_ALLOWED_EXPRESSION), false)
})

test('row gate fails when the sibling row does not exist (resolve throws)', async (t) => {
  const { urls } = await writeGateFixtures(t)
  const parent = { tree: { resolve: () => { throw new Error('cannot resolve entry connection') } } }
  const ctx = {
    baseUrl: 'file:///fake/base/',
    [ENTRY_KEY]: { parent },
    loader: { internal: { version: 'v2', resolveSync: dispatchingResolveSync(urls) } },
  }
  assert.equal(evaluateWith(ctx, GATE_ROW_ALLOWED_EXPRESSION), false)
})

test('row gate fails for a same-name row in another group (official.parent !== self.parent)', async (t) => {
  const { urls } = await writeGateFixtures(t)
  const official = officialRow()
  official.parent = { tree: { resolve: () => official } } // 官方行登记在另一个组
  const selfParent = { tree: { resolve: () => official } } // self 所在组解析到的却是那一行
  const ctx = {
    baseUrl: 'file:///fake/base/',
    [ENTRY_KEY]: { parent: selfParent },
    loader: { internal: { version: 'v2', resolveSync: dispatchingResolveSync(urls) } },
  }
  assert.equal(evaluateWith(ctx, GATE_ROW_ALLOWED_EXPRESSION), false)
})

test('row gate stays dormant when the probe is false even if a later layer forced disabled: true', async (t) => {
  // 事故形态的组合期投影：connection 路径段/版本对、官方行被（后续层）强制
  // disabled，但宿主 runtime 是 0.1.1-rc.2 → 行绑定内嵌探针必须否决。
  const { urls } = await writeGateFixtures(t, {
    runtimeVersion: '0.1.1-rc.2',
    connectionVersion: GATE_VERSION,
  })
  const ctx = rowCtx(officialRow({ disabled: true }), urls)
  assert.equal(evaluateWith(ctx, GATE_ROW_ALLOWED_EXPRESSION), false)
})

test('row gate does not depend on the root Loader resolve', async (t) => {
  const { urls } = await writeGateFixtures(t)
  // 根 Loader resolve 抛错（或不存在）时，symbol 路径仍完整判定。
  const okCtx = rowCtx(officialRow(), urls, { rootResolve: 'throws' })
  assert.equal(evaluateWith(okCtx, GATE_ROW_ALLOWED_EXPRESSION), true)
  const dormantCtx = rowCtx(officialRow({ disabled: false }), urls, { rootResolve: 'throws' })
  assert.equal(evaluateWith(dormantCtx, GATE_ROW_ALLOWED_EXPRESSION), false)
  const noRootResolveCtx = rowCtx(officialRow(), urls)
  delete noRootResolveCtx.loader.resolve
  assert.equal(evaluateWith(noRootResolveCtx, GATE_ROW_ALLOWED_EXPRESSION), true)
})

test('real installed layout resolves through a pnpm version segment (pnpm-only; Task 11 covers the real machine)', (t) => {
  const require = createRequire(import.meta.url)
  let manifestUrl
  try {
    manifestUrl = require.resolve('@deepseek-ai/dsh-client-connection/package.json')
  } catch {
    t.skip('dependency not resolvable from the test workspace')
    return
  }
  if (!/@deepseek-ai\+dsh-client-connection@0\.1\.2-rc\.1_/.test(manifestUrl)) {
    t.skip(`non-pnpm layout: ${manifestUrl}`)
    return
  }
  assert.match(manifestUrl, /@deepseek-ai\+dsh-client-connection@0\.1\.2-rc\.1_/)
})

test('published manifest pollution invariant: the repo itself must not resolve @deepseek-ai/dsh', () => {
  // 探针第一锚点只可能来自 runtime fallback。若本仓库（devDependencies 之外）
  // 能解析到 @deepseek-ai/dsh，链接安装/开发环境就会重新引入自我满足风险。
  const require = createRequire(import.meta.url)
  let resolved = null
  try {
    resolved = require.resolve('@deepseek-ai/dsh/package.json')
  } catch {}
  assert.equal(resolved, null, `@deepseek-ai/dsh must not be resolvable from the plugin tree, got ${String(resolved)}`)
})
