// 以别名安装真实 0.1.5 组合测试产物：--no-save --package-lock=false。
// fixture 只改变 node_modules；脚本用安装前后的文件快照证明 package.json/
// package-lock.json 未被临时安装改写。需要 npm 网络访问。
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const trackedFiles = ['package.json', 'package-lock.json']
const before = new Map(trackedFiles.map((file) => [file, readFileSync(join(root, file), 'utf8')]))
const childEnv = { ...process.env }
for (const key of ['npm_config_allow_scripts', 'NPM_CONFIG_ALLOW_SCRIPTS']) delete childEnv[key]

execFileSync('npm', [
  'install',
  '--no-save',
  '--package-lock=false',
  '--ignore-scripts',
  '--force',
  // Keep both real generations in node_modules: npm's peer resolver otherwise
  // removes the older aliases when the second generation is installed alone.
  'dsh-client-connection-rc2@npm:@deepseek-ai/dsh-client-connection@0.1.1-rc.2',
  'frontend-static-rc2@npm:@deepseek-ai/dsh-host-frontend-static@0.1.1-rc.2',
  '@deepseek-ai/dsh-host-apiproxy@0.1.1-rc.2',
  'dsh-client-connection-rc15@npm:@deepseek-ai/dsh-client-connection@0.1.5-rc.1',
  'frontend-static-rc15@npm:@deepseek-ai/dsh-host-frontend-static@0.1.5-rc.1',
  'webserver-rc15@npm:@deepseek-ai/dsh-host-webserver@0.1.5-rc.1',
], { cwd: root, stdio: 'inherit', env: childEnv })

for (const file of trackedFiles) {
  const after = readFileSync(join(root, file), 'utf8')
  if (after !== before.get(file)) throw new Error(`rc15 fixture install modified ${file}`)
}
console.log('rc15 fixture installed; package.json and package-lock.json unchanged')
