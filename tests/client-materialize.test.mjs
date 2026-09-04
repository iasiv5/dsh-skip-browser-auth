// 真实 factory materialization（计划 Task 8 Step 1）：单次注册、新 id、
// stub require 只放行基线集合、factory 执行返回正确的插件命名空间。
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

// 浏览器 ModuleLoader 基线模块集合：factory 只允许向这些 specifier 要模块。
const BASELINE_MODULES = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react-dom/client',
]
const baseline = new Set(BASELINE_MODULES)

const registrations = []
globalThis.window = { __ModuleLoader__: { load: (reg) => registrations.push(reg) } }
// CJS 形态的 wrapper 无顶层副作用之外的语句；动态 import 以副作用完成注册，
// 不依赖 require(ESM) 的跨版本行为差异。
await import('../lib/client.js')

const nodeRequire = createRequire(import.meta.url)
const stubRequire = (specifier) => {
  if (!baseline.has(specifier)) throw new Error(`unsatisfied require: ${specifier}`)
  return nodeRequire(specifier)
}

test('the bundle registers exactly once under the re-ID', () => {
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].id, 'dsh-skip-browser-auth')
})

test('factory materializes with only baseline requires and returns the plugin namespace', () => {
  const factory = registrations[0].factory
  const { inject, apply } = factory(stubRequire)
  assert.equal(Array.isArray(inject), true)
  assert.equal(inject.length, 0)
  assert.equal(typeof apply, 'function')
})
