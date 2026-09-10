// 发布清单不变量（2026-09-05 事故的防再发约束）：发布产物不得携带任何
// @deepseek-ai 运行时依赖。探针第一锚点是宿主 runtime 本体（@deepseek-ai/dsh），
// 只可能来自 runtime fallback；若插件把 @deepseek-ai 系包声明进 dependencies，
// profile 安装（nodeLinker: hoisted）会把副本抬升进 profile node_modules，
// 遮蔽 fallback 并可能重新制造探针「自我满足」。connection 仅允许作为
// devDependency（编译期类型 + build 锚点），且锚定白名单版本。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CONNECTION_PACKAGE, GATE_VERSIONS, GATE_RUNTIME_PACKAGE } from '../lib/gate.js'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('dependencies must not carry any @deepseek-ai runtime package', () => {
  const dependencies = manifest.dependencies ?? {}
  const offenders = Object.keys(dependencies).filter(name => name.startsWith('@deepseek-ai/'))
  assert.deepEqual(offenders, [], `move @deepseek-ai runtime packages to devDependencies: ${offenders.join(', ')}`)
})

test(`connection stays a devDependency pinned to one profile version`, () => {
  const devDependencies = manifest.devDependencies ?? {}
  assert.equal(GATE_VERSIONS.includes(devDependencies[CONNECTION_PACKAGE]), true)
  assert.equal(manifest.dependencies?.[CONNECTION_PACKAGE], undefined)
})

test('0.1.5 client build alias stays dev-only', () => {
  const devDependencies = manifest.devDependencies ?? {}
  assert.equal(devDependencies['dsh-client-connection-rc15'], 'npm:@deepseek-ai/dsh-client-connection@0.1.5-rc.1')
  assert.equal(manifest.dependencies?.['dsh-client-connection-rc15'], undefined)
})

test('gate anchors never collide with declared runtime dependencies', () => {
  const dependencies = manifest.dependencies ?? {}
  for (const anchor of [GATE_RUNTIME_PACKAGE, CONNECTION_PACKAGE]) {
    assert.equal(anchor in dependencies, false, `gate anchor ${anchor} must never be a runtime dependency`)
  }
})
