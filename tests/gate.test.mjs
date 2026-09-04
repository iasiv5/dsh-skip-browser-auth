// 门控探针与行绑定表达式的真值矩阵 + 真实路径断言（计划 Task 5 Step 1）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  CONNECTION_PACKAGE,
  GATE_VERSION,
  GATE_PROBE_EXPRESSION,
  GATE_ROW_ALLOWED_EXPRESSION,
  evaluateGate,
} from '../lib/gate.js'

const ENTRY_KEY = Symbol.for('cordis.entry')

// 与 vendor/loader/src/config/utils.ts 相同的求值语义：with(ctx) + eval。
function evaluateWith(ctx, expr) {
  return new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }')(ctx, expr)
}

// 构造探针 fake ctx：v2 形态 resolveSync(base, { specifier }) → { url }。
function probeCtx(url, { version = 'v2', throwOnResolve = false, withLoader = true } = {}) {
  if (!withLoader) return { baseUrl: 'file:///fake/base/' }
  return {
    baseUrl: 'file:///fake/base/',
    loader: {
      internal: {
        version,
        resolveSync: () => {
          if (throwOnResolve) throw new Error('resolve failed')
          return { url }
        },
      },
    },
  }
}

// 在真实临时目录写探针 fixture（计划指定布局），返回文件 url。
async function writeFixture(manifestVersion = GATE_VERSION, pathSegmentVersion = GATE_VERSION) {
  const tmp = await mkdtemp(join(tmpdir(), 'dsh-sba-gate-'))
  const dir = join(
    tmp,
    `@deepseek-ai+dsh-client-connection@${pathSegmentVersion}_t`,
    'node_modules', '@deepseek-ai', 'dsh-client-connection',
  )
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'package.json')
  await writeFile(file, JSON.stringify({ name: CONNECTION_PACKAGE, version: manifestVersion }))
  return { tmp, url: pathToFileURL(file).href }
}

// 构造行绑定 fake ctx：symbol entry 提供当前 entry，探针走真实 fixture url。
function rowCtx(official, fixtureUrl, { probeUrl, rootResolve } = {}) {
  const parent = { tree: { resolve: () => official } }
  official.parent = parent
  const ctx = {
    baseUrl: 'file:///fake/base/',
    [ENTRY_KEY]: { parent },
    loader: {
      internal: { version: 'v2', resolveSync: () => ({ url: probeUrl ?? fixtureUrl }) },
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
  assert.equal(GATE_VERSION, '0.1.2-rc.1')
})

test('probe accepts the whitelisted pnpm version segment (v2 form)', async (t) => {
  const { tmp, url } = await writeFixture()
  t.after(() => rm(tmp, { recursive: true, force: true }))
  assert.equal(evaluateWith(probeCtx(url), GATE_PROBE_EXPRESSION), true)
  assert.equal(evaluateGate(probeCtx(url)), true) // evaluateGate 求值同一探针
})

test('probe rejects non-whitelisted versions', async (t) => {
  const rc2 = await writeFixture(GATE_VERSION, '0.1.1-rc.2')
  const v9 = await writeFixture(GATE_VERSION, '9.9.9')
  t.after(() => { rm(rc2.tmp, { recursive: true, force: true }); rm(v9.tmp, { recursive: true, force: true }) })
  assert.equal(evaluateWith(probeCtx(rc2.url), GATE_PROBE_EXPRESSION), false)
  assert.equal(evaluateWith(probeCtx(v9.url), GATE_PROBE_EXPRESSION), false)
})

test('probe rejects an npm layout without a version segment', () => {
  const url = 'file:///repo/node_modules/@deepseek-ai/dsh-client-connection/package.json'
  assert.equal(evaluateWith(probeCtx(url), GATE_PROBE_EXPRESSION), false)
})

test('probe also works in the v1 resolveSync form', async (t) => {
  const { tmp, url } = await writeFixture()
  t.after(() => rm(tmp, { recursive: true, force: true }))
  assert.equal(evaluateWith(probeCtx(url, { version: 'v1' }), GATE_PROBE_EXPRESSION), true)
})

test('probe fails closed when loader/internal is missing, resolveSync throws, or url is not a string', () => {
  assert.equal(evaluateWith(probeCtx('whatever', { withLoader: false }), GATE_PROBE_EXPRESSION), false)
  assert.equal(evaluateWith({ baseUrl: 'file:///fake/base/', loader: {} }, GATE_PROBE_EXPRESSION), false)
  assert.equal(evaluateWith(probeCtx('whatever', { throwOnResolve: true }), GATE_PROBE_EXPRESSION), false)
  const badUrlCtx = probeCtx('whatever')
  badUrlCtx.loader.internal.resolveSync = () => ({ url: 42 })
  assert.equal(evaluateWith(badUrlCtx, GATE_PROBE_EXPRESSION), false)
})

test('row gate passes only for a same-group, name-matching, disabled official row with a true probe', async (t) => {
  const { tmp, url } = await writeFixture()
  t.after(() => rm(tmp, { recursive: true, force: true }))
  const ctx = rowCtx(officialRow(), url)
  assert.equal(evaluateWith(ctx, GATE_ROW_ALLOWED_EXPRESSION), true)
})

test('row gate fails when the official row is not disabled (even with a correct name)', async (t) => {
  const { tmp, url } = await writeFixture()
  t.after(() => rm(tmp, { recursive: true, force: true }))
  const ctx = rowCtx(officialRow({ disabled: false }), url)
  assert.equal(evaluateWith(ctx, GATE_ROW_ALLOWED_EXPRESSION), false)
})

test('row gate fails on a sibling name mismatch', async (t) => {
  const { tmp, url } = await writeFixture()
  t.after(() => rm(tmp, { recursive: true, force: true }))
  const ctx = rowCtx(officialRow({ options: { id: 'connection', name: '@deepseek-ai/dsh-client-connection-wrong' } }), url)
  assert.equal(evaluateWith(ctx, GATE_ROW_ALLOWED_EXPRESSION), false)
})

test('row gate fails when the sibling row does not exist (resolve throws)', async (t) => {
  const { tmp, url } = await writeFixture()
  t.after(() => rm(tmp, { recursive: true, force: true }))
  const parent = { tree: { resolve: () => { throw new Error('cannot resolve entry connection') } } }
  const ctx = {
    baseUrl: 'file:///fake/base/',
    [ENTRY_KEY]: { parent },
    loader: { internal: { version: 'v2', resolveSync: () => ({ url }) } },
  }
  assert.equal(evaluateWith(ctx, GATE_ROW_ALLOWED_EXPRESSION), false)
})

test('row gate fails for a same-name row in another group (official.parent !== self.parent)', async (t) => {
  const { tmp, url } = await writeFixture()
  t.after(() => rm(tmp, { recursive: true, force: true }))
  const official = officialRow()
  official.parent = { tree: { resolve: () => official } } // 官方行登记在另一个组
  const selfParent = { tree: { resolve: () => official } } // self 所在组解析到的却是那一行
  const ctx = {
    baseUrl: 'file:///fake/base/',
    [ENTRY_KEY]: { parent: selfParent },
    loader: { internal: { version: 'v2', resolveSync: () => ({ url }) } },
  }
  assert.equal(evaluateWith(ctx, GATE_ROW_ALLOWED_EXPRESSION), false)
})

test('row gate stays dormant when the probe is false even if a later layer forced disabled: true', async (t) => {
  const { tmp, url } = await writeFixture(GATE_VERSION, '9.9.9') // 路径段版本漂移 → 探针假
  t.after(() => rm(tmp, { recursive: true, force: true }))
  const ctx = rowCtx(officialRow({ disabled: true }), url, { probeUrl: undefined })
  ctx.loader.internal.resolveSync = () => ({ url })
  assert.equal(evaluateWith(ctx, GATE_ROW_ALLOWED_EXPRESSION), false)
})

test('row gate does not depend on the root Loader resolve', async (t) => {
  const { tmp, url } = await writeFixture()
  t.after(() => rm(tmp, { recursive: true, force: true }))
  // 根 Loader resolve 抛错（或不存在）时，symbol 路径仍完整判定。
  const okCtx = rowCtx(officialRow(), url, { rootResolve: 'throws' })
  assert.equal(evaluateWith(okCtx, GATE_ROW_ALLOWED_EXPRESSION), true)
  const dormantCtx = rowCtx(officialRow({ disabled: false }), url, { rootResolve: 'throws' })
  assert.equal(evaluateWith(dormantCtx, GATE_ROW_ALLOWED_EXPRESSION), false)
  const noRootResolveCtx = rowCtx(officialRow(), url)
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
