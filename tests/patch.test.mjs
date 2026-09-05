// cordis.patch.yml 的结构断言与求值行为抽查（计划 Task 7 Step 1；
// 探针双锚点后 fixture 按 specifier 分发两个锚点包）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import {
  CONNECTION_PACKAGE,
  GATE_PROBE_EXPRESSION,
  GATE_ROW_ALLOWED_EXPRESSION,
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

test('row 2 inserts the plugin row with the negated row gate', () => {
  const [, row2] = patchList
  assert.equal(Array.isArray(row2.insert), true)
  assert.equal(row2.insert.length, 1)
  const inserted = row2.insert[0]
  assert.equal(inserted.id, 'trusted-connection')
  assert.equal(inserted.name, '@iasiv5/dsh-skip-browser-auth')
  assert.deepEqual(inserted.inject, ['webRuntime'])
  assert.deepEqual(inserted.disabled, { __jsExpr: `!(${GATE_ROW_ALLOWED_EXPRESSION})` })
  assert.deepEqual(inserted.config, { trustedHosts: { __jsExpr: 'ctx.webRuntime.trustedHosts' } })
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
