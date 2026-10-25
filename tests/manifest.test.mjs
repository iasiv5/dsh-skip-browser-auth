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
import { VERSION_FIXTURES, PROFILE_BUILD_ALIASES } from './fixtures/registry.mjs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('DSH host requirement matches the oldest supported runtime line', () => {
  assert.equal(manifest.dsh?.engines?.dsh, '>=0.1.2-rc.1')
})

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

// 逐版本 fixture 别名守卫（registry 循环版，2026-10-25 表驱动化；取代旧
// rc171/rc20/rc202/rc211/rc212/rc213 六块——rc171 旧块只守单别名，现按 Q8
// 归一为三件全守）：fixture 三件只允许以 --no-save 安装进 node_modules，
// 绝不进入 dependencies（防 profile 抬升遮蔽 runtime fallback）或
// devDependencies（防出现第二个构建锚点）。
test('per-version fixture aliases stay fixture-only (never runtime deps or build anchors)', () => {
  const dependencies = manifest.dependencies ?? {}
  const devDependencies = manifest.devDependencies ?? {}
  // rc15/rc17 别名双重身份：既是 fixture 别名又是所在代际的构建锚（同名同
  // spec 合法驻留 devDeps，精确 spec 由下一测试守）；其余 fixture 别名一律
  // 不得出现在任何依赖清单。
  const buildAnchors = new Set(Object.values(PROFILE_BUILD_ALIASES).map((anchor) => anchor.alias))
  for (const entry of VERSION_FIXTURES) {
    if (entry.aliases === null) continue
    for (const alias of Object.values(entry.aliases)) {
      assert.equal(dependencies[alias], undefined, `${alias} must not be a runtime dependency`)
      if (buildAnchors.has(alias)) continue
      assert.equal(devDependencies[alias], undefined, `${alias} must not be a build anchor devDependency`)
    }
  }
})

// 每代际唯一构建锚（registry PROFILE_BUILD_ALIASES 循环版；含旧 rc211 块中的
// rc21 正向 pin）：精确 devDep spec，绝不进 dependencies。
test('client build anchors stay dev-only with exact specs (one per generation)', () => {
  const dependencies = manifest.dependencies ?? {}
  const devDependencies = manifest.devDependencies ?? {}
  for (const [profileId, anchor] of Object.entries(PROFILE_BUILD_ALIASES)) {
    assert.equal(devDependencies[anchor.alias], anchor.spec, `${profileId} build anchor ${anchor.alias} must pin ${anchor.spec}`)
    assert.equal(dependencies[anchor.alias], undefined)
  }
})

test('gate anchors never collide with declared runtime dependencies', () => {
  const dependencies = manifest.dependencies ?? {}
  for (const anchor of [GATE_RUNTIME_PACKAGE, CONNECTION_PACKAGE]) {
    assert.equal(anchor in dependencies, false, `gate anchor ${anchor} must never be a runtime dependency`)
  }
})

test('pinned connection copy loads lazily (no static @deepseek-ai import reaches lib)', () => {
  // 审计修复 2026-09-28：lib/connection-runtime.js 曾在顶层静态 import pinned
  // 0.1.2 副本——产品环境随插件加载即求值旧模块图，且绑定随安装布局漂移
  // （dev 树内嵌遮蔽命中 pinned，净装经 hoist 命中宿主）。不变量：静态 import
  // 不得出现在 lib 产物；无 loader 回退分支只能经动态 import() 在调用点解析。
  const source = readFileSync(new URL('../lib/connection-runtime.js', import.meta.url), 'utf8')
  assert.equal(
    /from\s*['"]@deepseek-ai\/dsh-client-connection['"]/.test(source),
    false,
    'lib/connection-runtime.js must not statically import the pinned dev copy',
  )
  assert.equal(
    /import\(\s*['"]@deepseek-ai\/dsh-client-connection['"]\s*\)/.test(source),
    true,
    'no-loader fallback must reach the pinned copy via dynamic import() only',
  )
})

test('desktop-host signal stays out of dependencies (stub fixtures only)', () => {
  // web-only 门控（2026-10-07）的 desktop 信号包只允许以测试桩包形式存在；
  // 若进入 dependencies/devDependencies，hoisted 抬升会在 web 机上污染宿主检测
  // （gate.ts 头注记载的同类抬升遮蔽机制）。
  const dependencies = manifest.dependencies ?? {}
  const devDependencies = manifest.devDependencies ?? {}
  assert.equal(dependencies['@deepseek-ai/dsh-desktop-host'], undefined)
  assert.equal(devDependencies['@deepseek-ai/dsh-desktop-host'], undefined)
})
