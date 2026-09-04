// 以别名安装 rc.2 dormant 组合所需产物：--no-save --package-lock=false
// 保证不改动 package.json 与 package-lock.json。需要 npm 网络访问。
//
// 与计划原命令的两处本机现实适配（npm 11.19 + user 级 allow-scripts 策略），
// 均不改变脚本本质（别名安装 rc.2 产物且不动 manifest/lockfile）：
// ① --ignore-scripts：project-scoped 安装拒绝 user 级 allow-scripts 配置
//   （EALLOWSCRIPTS）；rc.2 产物为纯 JS，无需安装脚本。
// ② --force 取代 --legacy-peer-deps：connection-rc.2 的 peer 要求
//   dsh-host-webserver ^0.1.1-rc.2，与根项目 rc.1 精确版本 ERESOLVE 冲突；
//   且 legacy 模式跳过 peer 安装会使 apiproxy → dsh-agent 的静态导入链
//   因缺 dsh-scope 等 rc.2 peer 而断裂。--force 让 npm 把冲突 peer 嵌套安置，
//   导入链完整可加载（组合中 webserver 行由测试显式映射 rc.1 模块，不消费该嵌套副本）。
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// npm run 会把父 npm 的配置以 npm_config_* 环境变量注入子进程；其中的
// allow-scripts 会被子 npm 视为「CLI 传入的 --allow-scripts」并按
// project-scoped 安装策略直接拒绝（EALLOWSCRIPTS）。只删除这一个确证冲突键
// （两种大小写形态），其余 npm_config_*（registry、proxy、CA、userconfig 等）
// 原样保留，避免破坏 CI/企业环境注入的配置。
const childEnv = { ...process.env }
for (const key of ['npm_config_allow_scripts', 'NPM_CONFIG_ALLOW_SCRIPTS']) {
  delete childEnv[key]
}

execFileSync('npm', [
  'install',
  '--no-save',
  '--package-lock=false',
  '--ignore-scripts',
  '--force',
  'dsh-client-connection-rc2@npm:@deepseek-ai/dsh-client-connection@0.1.1-rc.2',
  'frontend-static-rc2@npm:@deepseek-ai/dsh-host-frontend-static@0.1.1-rc.2',
  '@deepseek-ai/dsh-host-apiproxy@0.1.1-rc.2',
], { cwd: root, stdio: 'inherit', env: childEnv })

// 证明 fixture 安装未改动依赖清单与 lockfile；失败即整体失败。
execFileSync('git', ['diff', '--exit-code', 'package.json', 'package-lock.json'], { cwd: root, stdio: 'inherit' })
console.log('rc2 fixture installed; package.json and package-lock.json unchanged')
