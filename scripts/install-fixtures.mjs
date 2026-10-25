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
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { FIXTURE_ENTRIES, LEGACY_FIXTURE_SPECS, installSpecs } from '../tests/fixtures/registry.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// --check：零安装在场探针——逐条验 installSpecs() 对应的 node_modules 别名目录
// 是否在场，缺则列名 exit 1（内容级守卫；目录级 `test -d node_modules` 抓不住
// 「node_modules 在场但缺某代际」的形态）。装/升前先跑一次，缺了再实装。
const checkOnly = process.argv.includes('--check')

function expectedFixtureDirs() {
  const dirs = []
  for (const entry of FIXTURE_ENTRIES) {
    dirs.push(entry.aliases.connection, entry.aliases.frontendStatic, entry.aliases.webServer)
  }
  for (const spec of LEGACY_FIXTURE_SPECS) {
    // 别名形态 `alias@npm:pkg@ver` 取别名段；直装形态 `pkg@ver` 去掉末段版本。
    dirs.push(spec.includes('@npm:') ? spec.split('@npm:')[0] : spec.slice(0, spec.lastIndexOf('@')))
  }
  return dirs
}

if (checkOnly) {
  const dirs = expectedFixtureDirs()
  const missing = dirs.filter((dir) => !existsSync(join(root, 'node_modules', ...dir.split('/'))))
  if (missing.length > 0) {
    console.error(`missing fixture dirs (${missing.length}/${dirs.length}):\n  ${missing.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`all ${dirs.length} fixture dirs present`)
  process.exit(0)
}

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
