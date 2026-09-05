// 组合测试 helper：真实 Loader + Include + 真实官方产物，端到端组合四条路径。
// 手法参照 RC1/packages/host/frontend-static/tests/frontend-static.spec.ts；
// patch 走产品同款路径：仓库 cordis.patch.yml 解析后经 Include 的
// config.patches 交给 applyEntryPatches 应用。
import http from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import yaml from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import * as FrontendStatic from '@deepseek-ai/dsh-host-frontend-static'
import { CONNECTION_PACKAGE, GATE_RUNTIME_PACKAGE } from '../../lib/gate.js'

// 照抄 vendor/include/src/index.ts 的 JsExpr 定义（predicate 内联同一逻辑）。
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data) => typeof data === 'string',
  construct: (data) => ({ __jsExpr: data }),
  predicate: (data) => data instanceof Object && '__jsExpr' in data,
  represent: (data) => data['__jsExpr'],
})
const schema = yaml.JSON_SCHEMA.extend(JsExpr)

/**
 * Host 头可控的原始 HTTP 请求（默认 fetch 无法覆盖 Host）。
 * @returns status、headers 与响应体文本。
 */
export function rawRequest(port, { path, method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString(),
      }))
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

/**
 * Boot 一份真实组合：webserver + 行清单 + 仓库自门控 patch + 探针 fixture。
 * @param t - node:test 上下文；compose 登记 dispose + 临时目录清理。
 * @param options.rows - 行清单（对象数组）；字符串值中的 {{ROOT}} 替换为临时根目录。
 * @param options.modules - 行名 → 模块（命名空间或返回模块的异步函数）；覆盖默认映射。
 * @param options.probeVersion - 探针 connection 锚点 fixture 路径段版本（真实目录段）。
 * @param options.manifestVersion - 探针 connection 锚点 fixture manifest 版本（默认同 probeVersion）。
 * @param options.runtimeVersion - 探针 runtime 锚点（@deepseek-ai/dsh）fixture 版本，
 *   默认同 probeVersion；显式传宿主版本可模拟「插件自带 rc.1 connection + 宿主 rc.2」事故。
 * @param options.extraPatches - 追加在本插件 patch 之后的覆盖层（模拟后续 patch 层）。
 * @param options.webRuntime - 提供给 `ctx.webRuntime` 的服务值。
 * @returns context、服务端口与临时根目录。
 */
export async function compose(t, { rows, modules = {}, probeVersion, manifestVersion, runtimeVersion, extraPatches = [], webRuntime } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sba-compose-'))

  // 真实探针 fixture：<root>/gate-fixture/<pnpm 风格路径段>/node_modules/.../package.json。
  // 双锚点：connection（被替换对象）+ 宿主 runtime 本体（@deepseek-ai/dsh）。
  async function writeAnchorFixture(pkg, segmentVersion, manifestOverride) {
    const short = pkg.slice(pkg.indexOf('/') + 1)
    const fixtureDir = join(
      root,
      'gate-fixture',
      `@deepseek-ai+${short}@${segmentVersion}_fixture`,
      'node_modules', '@deepseek-ai', short,
    )
    await mkdir(fixtureDir, { recursive: true })
    const fixtureFile = join(fixtureDir, 'package.json')
    await writeFile(fixtureFile, JSON.stringify({ name: pkg, version: manifestOverride ?? segmentVersion }))
    return pathToFileURL(fixtureFile).href
  }
  const connectionUrl = await writeAnchorFixture(CONNECTION_PACKAGE, probeVersion, manifestVersion)
  const runtimeUrl = await writeAnchorFixture(GATE_RUNTIME_PACKAGE, runtimeVersion ?? probeVersion)
  const fixtureUrls = {
    [`${CONNECTION_PACKAGE}/package.json`]: connectionUrl,
    [`${GATE_RUNTIME_PACKAGE}/package.json`]: runtimeUrl,
  }

  // dist fixture：index.html 含 'shell' 标记，另有 /app.js 静态资源。
  const dist = join(root, 'dist')
  await mkdir(dist)
  await writeFile(join(dist, 'index.html'), '<head></head><body>shell</body>')
  await writeFile(join(dist, 'app.js'), 'export {}')

  // 行清单 yml：{{ROOT}} 占位替换为临时根目录。
  const configPath = join(root, 'cordis.rows.yml')
  await writeFile(configPath, yaml.dump(JSON.parse(JSON.stringify(rows).replaceAll('{{ROOT}}', root))))

  // patchList：仓库 cordis.patch.yml（!!js 解析为 __jsExpr 节点）+ extraPatches。
  const repoPatch = yaml.load(await readFile(new URL('../../cordis.patch.yml', import.meta.url), 'utf8'), { schema })
  const patchList = [...repoPatch, ...extraPatches]

  // 行名 → 模块映射：默认覆盖 rc.1 生态与本插件 host 入口；调用方条目优先。
  const hostModule = await import('../../lib/host.js')
  const moduleMap = new Map([
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@deepseek-ai/dsh-host-frontend-static', FrontendStatic],
    ['@deepseek-ai/dsh-client-connection', Connection],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentials],
    ['@iasiv5/dsh-skip-browser-auth', hostModule],
    ...Object.entries(modules),
  ])

  const context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  // 幂等 dispose：用例内显式调用与 teardown 兜底共用同一次执行。
  // dispose 失败必须让测试失败（生命周期清理是该插件的重要正确性属性），
  // 但临时目录始终清理。
  let disposed = false
  const dispose = async () => {
    if (disposed) return
    disposed = true
    await context.fiber?.dispose()
  }
  t.after(async () => {
    try {
      await dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  context.provide('webRuntime', webRuntime ?? { lanAddresses: [], trustedHosts: [] })
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const repoRequire = createRequire(import.meta.url)
  context.loader.internal = {
    version: 'v2',
    async import(specifier) {
      const target = moduleMap.get(specifier)
      if (target === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
      // 异步 getter（箭头函数，无 prototype）当场求值；类插件等其余值原样交给 Loader。
      return typeof target === 'function' && !target.prototype ? target() : target
    },
    // v2 形态 resolveSync(parentURL, { specifier }) → { url }；探针的双锚点
    // specifier 指向真实 fixture 文件，其余 specifier 尝试以仓库为锚点真实解析。
    resolveSync(base, request) {
      const specifier = typeof request === 'string' ? request : request.specifier
      if (specifier in fixtureUrls) return { url: fixtureUrls[specifier] }
      try {
        return { url: pathToFileURL(repoRequire.resolve(specifier)).href }
      } catch {
        return null
      }
    },
  }
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href, patches: patchList },
  })
  await context.loader.await()
  return { context, port: context.webServer.port, root, dispose }
}
