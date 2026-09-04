// 构建脚本（Task 1 范围）：
//   ① tsc 编译 src/ → lib/host.js
//   ② 官方 client 发布产物不可变 re-ID → lib/client.js
//   ③ 产物断言
// Task 7 将在 tsc 之后、client re-ID 之前接入 cordis.patch.yml 生成步骤。
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)

// ① tsc 编译 host 半区。通过 Node 调用本地依赖的 tsc，避免 PATH 依赖。
const tscBin = require.resolve('typescript/bin/tsc')
execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.json'], { cwd: root, stdio: 'inherit' })

// 源文件为 src/index.ts（rootDir: src），tsc 产出 lib/index.js；
// 包契约的主入口是 lib/host.js，这里重命名归位（相对导入同目录，不受影响）。
const { renameSync } = await import('node:fs')
renameSync(join(root, 'lib', 'index.js'), join(root, 'lib', 'host.js'))

// 统计子串出现次数（不可重叠场景下 split 长度即次数）。
function countOccurrences(text, needle) {
  return text.split(needle).length - 1
}

// ② client 半区：官方发布产物已是 window.__ModuleLoader__.load({ id, factory })
//    最终 wrapper，不可 import / 再打包，只做精确 re-ID。
//    六个锚点串各恰好出现 1 次是替换安全性的前提，先断言再动手。
const CONNECTION_PACKAGE = '@deepseek-ai/dsh-client-connection'
const OFFICIAL_ID_LINE = `id: "${CONNECTION_PACKAGE}"`
const NEW_ID_LINE = 'id: "dsh-skip-browser-auth"'
const ANCHORS = [
  'window.__ModuleLoader__.load({', // wrapper 开头
  OFFICIAL_ID_LINE, // 注册 id（唯一替换点）
  'dsh-client-connection', // 包名仅出现于注册 id 一处
  'exports.apply = apply',
  'exports.inject = inject',
  'return module.exports',
]

const officialClientPath = require.resolve('@deepseek-ai/dsh-client-connection/client')
const officialClient = readFileSync(officialClientPath, 'utf8')
for (const anchor of ANCHORS) {
  const count = countOccurrences(officialClient, anchor)
  if (count !== 1) {
    throw new Error(`anchor appears ${count} times (expected exactly 1): ${JSON.stringify(anchor)}`)
  }
}

// 精确 re-ID：仅替换单处注册 id，其余字节不变。
let clientOutput = officialClient.replace(OFFICIAL_ID_LINE, NEW_ID_LINE)
if (countOccurrences(clientOutput, OFFICIAL_ID_LINE) !== 0) {
  throw new Error('original registration id still present after re-ID')
}
if (countOccurrences(clientOutput, NEW_ID_LINE) !== 1) {
  throw new Error('new registration id must appear exactly once after re-ID')
}

const libDir = join(root, 'lib')
mkdirSync(libDir, { recursive: true })
writeFileSync(join(libDir, 'client.js'), clientOutput)

// ③ 产物断言：client 以 wrapper 开头、含新 id；host 入口存在。
const writtenClient = readFileSync(join(libDir, 'client.js'), 'utf8')
if (!writtenClient.startsWith('window.__ModuleLoader__.load({')) {
  throw new Error('lib/client.js must start with the ModuleLoader wrapper')
}
if (!writtenClient.includes(NEW_ID_LINE)) {
  throw new Error('lib/client.js must contain the new registration id')
}
if (!existsSync(join(libDir, 'host.js'))) {
  throw new Error('lib/host.js missing after tsc build')
}

console.log('build: lib/host.js + lib/client.js written, assertions passed')
