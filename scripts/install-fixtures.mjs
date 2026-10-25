// 以别名安装真实组合测试 fixtures：--no-save --package-lock=false。
// fixture 只改变 node_modules；脚本用安装前后的文件快照证明 package.json/
// package-lock.json 未被临时安装改写。需要 npm 网络访问。
//
// 登记表驱动（2026-10-25 表驱动化，docs/COMPATIBILITY.md §5.0）：spec 清单 =
// tests/fixtures/registry.mjs 的 installSpecs()——全部白名单版本的别名三件 +
// 版本无关常量（rc2 事故回归组、apiproxy、scope/invariants peer pins、rc2 时代
// 传递依赖）。**单次全量安装**：npm 的 peer resolver 在只装较新别名时会移除
// 旧别名，一次装齐全代（承接旧 install-rc17-fixture 的注释语义）并消灭分步
// 安装间「--no-save 产物被后续步骤重整化清除」的问题类。peer 链与 hoisting
// 论证见各轮审计记录（docs/COMPATIBILITY.md §5.5–§5.11）。
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { installSpecs } from '../tests/fixtures/registry.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const trackedFiles = ['package.json', 'package-lock.json']
const before = new Map(trackedFiles.map((file) => [file, readFileSync(join(root, file), 'utf8')]))

const childEnv = { ...process.env }
for (const key of ['npm_config_allow_scripts', 'NPM_CONFIG_ALLOW_SCRIPTS']) delete childEnv[key]

// 跨平台 npm 调用：Windows 上 spawnSync 禁止直接起 .cmd（CVE-2024-27980，EINVAL），
// 改为 node <npm-cli.js> 直启（npm-cli.js 恒在 <node 目录>/node_modules/npm/bin/）。
function runNpm(args, opts) {
  if (process.platform === 'win32') {
    const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    return execFileSync(process.execPath, [npmCli, ...args], opts)
  }
  return execFileSync('npm', args, opts)
}

runNpm([
  'install',
  '--no-save',
  '--package-lock=false',
  '--ignore-scripts',
  '--force',
  ...installSpecs(),
], { cwd: root, stdio: 'inherit', env: childEnv })

for (const file of trackedFiles) {
  const after = readFileSync(join(root, file), 'utf8')
  if (after !== before.get(file)) throw new Error(`fixture install modified ${file}`)
}
console.log('fixtures installed; package.json and package-lock.json unchanged')
