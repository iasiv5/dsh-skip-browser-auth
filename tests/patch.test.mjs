// cordis.patch.yml 的结构断言与求值行为抽查（计划 Task 7 Step 1；
// 探针双锚点后 fixture 按 specifier 分发两个锚点包）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import {
  CONNECTION_PACKAGE,
  GATE_PROFILE_EXPRESSION,
  GATE_PROBE_EXPRESSION,
  GATE_ROW_ALLOWED_EXPRESSION,
  GATE_ROW_ALLOWED_EXPRESSION_V4,
} from '../lib/gate.js'
import { writeGateFixtures, dispatchingResolveSync } from './helpers/gate-fixture.mjs'

const ENTRY_KEY = Symbol.for('cordis.entry')

// 照抄 vendor/include/src/index.ts 第 9–23 行的 JsExpr 定义（predicate 内联同一逻辑）。
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
  predicate: (data) => data instanceof Object && '__jsExpr' in data,
  represent: (data) => data['__jsExpr'],
})
const schema = yaml.JSON_SCHEMA.extend(JsExpr)

// 与 vendor/loader/src/config/utils.ts 相同的求值语义：with(ctx) + eval。
function evaluateWith(ctx, expr) {
  return new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }')(ctx, expr)
}

function activeRowCtx(official, urls) {
  const parent = { tree: { resolve: () => official } }
  official.parent = parent
  return {
    baseUrl: 'file:///fake/base/',
    [ENTRY_KEY]: { parent },
    webRuntime: { trustedHosts: ['app.internal'] },
    loader: { internal: { version: 'v2', resolveSync: dispatchingResolveSync(urls) } },
  }
}

const patchPath = new URL('../cordis.patch.yml', import.meta.url)

test('repository contains a generated cordis.patch.yml', () => {
  assert.equal(existsSync(patchPath), true, 'cordis.patch.yml must exist; run npm run build')
})

const patchList = yaml.load(readFileSync(patchPath, 'utf8'), { schema })

test('patch list has exactly two rows', () => {
  assert.equal(Array.isArray(patchList), true)
  assert.equal(patchList.length, 2)
})

test('row 1 patches the official connection row with the probe expression and nothing else', () => {
  const [row1] = patchList
  assert.deepEqual(Object.keys(row1).sort(), ['disabled', 'id', 'name'])
  assert.equal(row1.id, 'connection')
  assert.equal(row1.name, CONNECTION_PACKAGE)
  assert.deepEqual(row1.disabled, { __jsExpr: GATE_PROBE_EXPRESSION })
})

test('row 2 inserts two generation-partitioned plugin rows with negated row gates', () => {
  const [, row2] = patchList
  assert.equal(Array.isArray(row2.insert), true)
  // §5.9：≤0.2.0 行（webRuntime）+ 0.2.1+ 行（webStartup），id 集合互斥。
  assert.equal(row2.insert.length, 2)
  const [legacyRow, v4Row] = row2.insert
  assert.equal(legacyRow.id, 'trusted-connection')
  assert.equal(legacyRow.name, '@iasiv5/dsh-skip-browser-auth')
  assert.deepEqual(legacyRow.inject, ['webRuntime'])
  assert.deepEqual(legacyRow.disabled, { __jsExpr: `!(${GATE_ROW_ALLOWED_EXPRESSION})` })
  assert.deepEqual(legacyRow.config, {
    trustedHosts: { __jsExpr: 'ctx.webRuntime.trustedHosts' },
    compatibilityProfile: { __jsExpr: GATE_PROFILE_EXPRESSION },
  })
  assert.equal(v4Row.id, 'trusted-connection-021')
  assert.equal(v4Row.name, '@iasiv5/dsh-skip-browser-auth')
  assert.deepEqual(v4Row.inject, ['webStartup'])
  assert.deepEqual(v4Row.disabled, { __jsExpr: `!(${GATE_ROW_ALLOWED_EXPRESSION_V4})` })
  assert.deepEqual(v4Row.config, {
    trustedHosts: { __jsExpr: 'ctx.webStartup.trustedHosts' },
    compatibilityProfile: { __jsExpr: GATE_PROFILE_EXPRESSION },
  })
})

test('generation partition: on a 0.2.1 pair only the webStartup row activates (and vice versa)', async (t) => {
  const v4 = await writeGateFixtures(t, {
    runtimeVersion: '0.2.1-rc.1',
    connectionVersion: '0.2.1-rc.1',
  })
  const official = { options: { id: 'connection', name: CONNECTION_PACKAGE }, disabled: true }
  const v4Ctx = activeRowCtx(official, v4.urls)
  // 官方行被 v4 探针禁用；legacy 行绑定拒绝、v4 行绑定放行、config 读 webStartup。
  assert.equal(evaluateWith(v4Ctx, patchList[0].disabled.__jsExpr), true)
  assert.equal(evaluateWith(v4Ctx, patchList[1].insert[0].disabled.__jsExpr), true)
  assert.equal(evaluateWith(v4Ctx, patchList[1].insert[1].disabled.__jsExpr), false)
  assert.equal(evaluateWith(v4Ctx, patchList[1].insert[1].config.compatibilityProfile.__jsExpr), 'carrier-neutral-v4')

  const v3 = await writeGateFixtures(t, {
    runtimeVersion: '0.2.0-rc.2',
    connectionVersion: '0.2.0-rc.2',
  })
  const v3Ctx = activeRowCtx(official, v3.urls)
  assert.equal(evaluateWith(v3Ctx, patchList[1].insert[0].disabled.__jsExpr), false)
  assert.equal(evaluateWith(v3Ctx, patchList[1].insert[1].disabled.__jsExpr), true)
})

test('active composition: the two rows evaluate exclusively (official disabled, plugin enabled)', async (t) => {
  const { urls } = await writeGateFixtures(t)
  const official = {
    options: { id: 'connection', name: CONNECTION_PACKAGE },
    disabled: true,
  }
  const ctx = activeRowCtx(official, urls)
  assert.equal(evaluateWith(ctx, patchList[0].disabled.__jsExpr), true)
  assert.equal(evaluateWith(ctx, patchList[1].insert[0].disabled.__jsExpr), false)
  assert.equal(evaluateWith(ctx, patchList[1].insert[0].config.compatibilityProfile.__jsExpr), 'legacy-web-v1')
})

test('patch probe identifies and activates the rc15 profile', async (t) => {
  const { urls } = await writeGateFixtures(t, {
    runtimeVersion: '0.1.5-rc.1',
    connectionVersion: '0.1.5-rc.1',
  })
  const official = {
    options: { id: 'connection', name: CONNECTION_PACKAGE },
    disabled: true,
  }
  const ctx = activeRowCtx(official, urls)
  assert.equal(evaluateWith(ctx, GATE_PROFILE_EXPRESSION), 'carrier-neutral-v2')
  assert.equal(evaluateWith(ctx, patchList[0].disabled.__jsExpr), true)
  assert.equal(evaluateWith(ctx, patchList[1].insert[0].disabled.__jsExpr), false)
  assert.equal(evaluateWith(ctx, patchList[1].insert[0].config.compatibilityProfile.__jsExpr), 'carrier-neutral-v2')
})

test('plugin row stays dormant when the official row is not disabled or its name drifts', async (t) => {
  const { urls } = await writeGateFixtures(t)
  const notDisabled = { options: { id: 'connection', name: CONNECTION_PACKAGE }, disabled: false }
  const ctxA = activeRowCtx(notDisabled, urls)
  assert.equal(evaluateWith(ctxA, patchList[1].insert[0].disabled.__jsExpr), true)

  const wrongName = { options: { id: 'connection', name: '@deepseek-ai/dsh-client-connection-wrong' }, disabled: true }
  const ctxB = activeRowCtx(wrongName, urls)
  assert.equal(evaluateWith(ctxB, patchList[1].insert[0].disabled.__jsExpr), true)
})

test('bundled-connection-on-old-host composition keeps both rows dormant (2026-09-05 incident)', async (t) => {
  // 官方行 disabled 绑定的是探针：connection 锚点虽是真实 rc.1 副本，
  // runtime 锚点为 rc.2 时官方行必须保持 enabled、插入行保持 disabled。
  const { urls } = await writeGateFixtures(t, {
    runtimeVersion: '0.1.1-rc.2',
    connectionVersion: '0.1.2-rc.1',
  })
  const official = {
    options: { id: 'connection', name: CONNECTION_PACKAGE },
    disabled: true, // 后续层强制 disabled 也一样
  }
  const ctx = activeRowCtx(official, urls)
  assert.equal(evaluateWith(ctx, patchList[0].disabled.__jsExpr), false)
  assert.equal(evaluateWith(ctx, patchList[1].insert[0].disabled.__jsExpr), true)
})

test('generated patch embeds the desktop-host gate in all three expressions', () => {
  // 官方行 disabled、insert 行 config.compatibilityProfile、insert 行 disabled 三处
  // 内嵌链都必须携带 desktop 门控（单点源常量的传播断言）。
  const raw = readFileSync(patchPath, 'utf8')
  const occurrences = raw.split('@deepseek-ai/dsh-desktop-host').length - 1
  assert.ok(occurrences >= 3, `expected the desktop-host specifier in all three expressions, got ${occurrences}`)
})

test('patch expressions stay dormant when the desktop host package is present', async (t) => {
  // 2026-10-07 web-only 门控：desktop 信号在场 ⇒ 探针假、profile null、插入行 disabled
  // （disabled = !(行绑定)，desktop ⇒ 行绑定 false ⇒ true，与组合断言 trusted.disabled === true 同向）。
  const { urls } = await writeGateFixtures(t, { desktopHost: true })
  const official = {
    options: { id: 'connection', name: CONNECTION_PACKAGE },
    disabled: true,
  }
  const ctx = activeRowCtx(official, urls)
  assert.equal(evaluateWith(ctx, patchList[0].disabled.__jsExpr), false)
  assert.equal(evaluateWith(ctx, patchList[1].insert[0].config.compatibilityProfile.__jsExpr), null)
  assert.equal(evaluateWith(ctx, patchList[1].insert[0].disabled.__jsExpr), true)
})

test('patch expressions stay dormant under desktop launcher argv (package unreachable)', async (t) => {
  // 0.3.8：desktop-host 包不可达 + 宿主 argv 携带 launcher ⇒ 三处内嵌表达式全部休眠。
  const { urls } = await writeGateFixtures(t)
  const official = {
    options: { id: 'connection', name: CONNECTION_PACKAGE },
    disabled: true,
  }
  const ctx = activeRowCtx(official, urls)
  ctx.process = {
    execPath: 'C:\\Program Files\\nodejs\\node.exe',
    argv: ['C:\\app\\DeepSeek Harness.exe', 'C:\\x\\@deepseek-ai\\dsh-desktop-host\\lib\\index.js'],
  }
  assert.equal(evaluateWith(ctx, patchList[0].disabled.__jsExpr), false)
  assert.equal(evaluateWith(ctx, patchList[1].insert[0].config.compatibilityProfile.__jsExpr), null)
  assert.equal(evaluateWith(ctx, patchList[1].insert[0].disabled.__jsExpr), true)
})
