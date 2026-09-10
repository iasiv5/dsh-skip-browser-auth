// 构建脚本：tsc 编译 src/ → lib/host.js；从 lib/gate.js 常量生成
// cordis.patch.yml；由 build-client-variants.mjs 生成 profile-aware lib/client.js。
// 固定流程：tsc → write-patch → 双代际 client dispatcher → 产物断言。
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)

// ① tsc 编译 host 半区。通过 Node 调用本地依赖的 tsc，避免 PATH 依赖。
const tscBin = require.resolve('typescript/bin/tsc')
execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.json'], { cwd: root, stdio: 'inherit' })

// ①.5 生成 cordis.patch.yml（Task 7 接入）：依赖 tsc 产出的 lib/gate.js 常量。
execFileSync(process.execPath, [join(root, 'scripts', 'write-patch.mjs')], { cwd: root, stdio: 'inherit' })

// 源文件为 src/index.ts（rootDir: src），tsc 产出 lib/index.js；
// 包契约的主入口是 lib/host.js，这里重命名归位（相对导入同目录，不受影响）。
const { renameSync } = await import('node:fs')
renameSync(join(root, 'lib', 'index.js'), join(root, 'lib', 'host.js'))

// 统计子串出现次数（不可重叠场景下 split 长度即次数）。
function countOccurrences(text, needle) {
  return text.split(needle).length - 1
}

// ② client 半区：分别封装官方 0.1.2 与 0.1.5 factory，由 profile global 显式选择。
execFileSync(process.execPath, [join(root, 'scripts', 'build-client-variants.mjs')], { cwd: root, stdio: 'inherit' })

// ③ 产物断言：client 以 wrapper 开头、含插件 id；host 入口存在。
const libDir = join(root, 'lib')
const writtenClient = readFileSync(join(libDir, 'client.js'), 'utf8')
if (!writtenClient.startsWith('window.__ModuleLoader__.load({')) {
  throw new Error('lib/client.js must start with the ModuleLoader wrapper')
}
if (countOccurrences(writtenClient, 'id: "@iasiv5/dsh-skip-browser-auth"') !== 1) {
  throw new Error('lib/client.js must contain exactly one plugin registration id')
}
if (!existsSync(join(libDir, 'host.js'))) {
  throw new Error('lib/host.js missing after tsc build')
}

console.log('build: lib/host.js + profile-aware lib/client.js written, assertions passed')
