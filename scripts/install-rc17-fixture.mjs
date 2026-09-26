// 以别名安装真实 0.1.7 组合测试产物：--no-save --package-lock=false。
// fixture 只改变 node_modules；脚本用安装前后的文件快照证明 package.json/
// package-lock.json 未被临时安装改写。需要 npm 网络访问。
//
// 与 rc15 fixture 的差异：0.1.7 connection 的 peer 是 cordis ~4.0.4 +
// dsh-scope 0.1.7-rc.2（其自身再 peer dsh-invariants）。根项目 devDependencies
// 已 pin cordis 4.0.4，因此 connection/webserver 的 cordis peer 由根满足并
// 去重为单一实例；dsh-scope/dsh-invariants 按 --force 嵌套安置在别名包之下，
// 由模块自身的 node 解析命中。
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
  // Keep every real generation in node_modules: npm's peer resolver otherwise
  // removes the older aliases when a newer generation is installed alone.
  'dsh-client-connection-rc2@npm:@deepseek-ai/dsh-client-connection@0.1.1-rc.2',
  'frontend-static-rc2@npm:@deepseek-ai/dsh-host-frontend-static@0.1.1-rc.2',
  '@deepseek-ai/dsh-host-apiproxy@0.1.1-rc.2',
  'dsh-client-connection-rc15@npm:@deepseek-ai/dsh-client-connection@0.1.5-rc.1',
  'frontend-static-rc15@npm:@deepseek-ai/dsh-host-frontend-static@0.1.5-rc.1',
  'webserver-rc15@npm:@deepseek-ai/dsh-host-webserver@0.1.5-rc.1',
  'dsh-client-connection-rc152@npm:@deepseek-ai/dsh-client-connection@0.1.5-rc.2',
  'frontend-static-rc152@npm:@deepseek-ai/dsh-host-frontend-static@0.1.5-rc.2',
  'webserver-rc152@npm:@deepseek-ai/dsh-host-webserver@0.1.5-rc.2',
  'dsh-client-connection-rc17@npm:@deepseek-ai/dsh-client-connection@0.1.7-rc.2',
  'frontend-static-rc17@npm:@deepseek-ai/dsh-host-frontend-static@0.1.7-rc.2',
  'webserver-rc17@npm:@deepseek-ai/dsh-host-webserver@0.1.7-rc.2',
  // rc.1 joined the 0.1.7 generation (docs/COMPATIBILITY.md §5.5): real rc.1
  // packages under *-rc171 aliases let the composition suite exercise the
  // second v3 pair and the same-generation cross-patch dormant negatives.
  'dsh-client-connection-rc171@npm:@deepseek-ai/dsh-client-connection@0.1.7-rc.1',
  'frontend-static-rc171@npm:@deepseek-ai/dsh-host-frontend-static@0.1.7-rc.1',
  'webserver-rc171@npm:@deepseek-ai/dsh-host-webserver@0.1.7-rc.1',
  // 0.1.7 connection 的 peer 链（repo .npmrc legacy-peer-deps=true 后 npm 不再
  // 自动安装 peer，必须显式列出）：connection → peer dsh-scope → peer
  // dsh-invariants。取 rc.2 锚点版本；rc171 别名 peer 请求 0.1.7-rc.1，
  // 两版代码逐字节一致（§5.5），共享同一份 scope 运行时无行为差异。
  '@deepseek-ai/dsh-scope@0.1.7-rc.2',
  '@deepseek-ai/dsh-invariants@0.1.7-rc.2',
  // rc2 脚本补齐的 apiproxy 0.1.1-rc.2 未声明传递依赖；本脚本是 test:all 的
  // 最后一步，重列一份防止前序脚本的 --no-save 安装在本步被重整化清除。
  '@deepseek-ai/dsh-timeout@0.1.1-rc.2',
  '@deepseek-ai/dsh-storage-domain@0.1.1-rc.2',
  '@deepseek-ai/dsh-storage@0.1.1-rc.2',
  '@deepseek-ai/dsh-agent-presets@0.1.1-rc.2',
], { cwd: root, stdio: 'inherit', env: childEnv })

for (const file of trackedFiles) {
  const after = readFileSync(join(root, file), 'utf8')
  if (after !== before.get(file)) throw new Error(`rc17 fixture install modified ${file}`)
}
console.log('rc17 fixture installed; package.json and package-lock.json unchanged')
