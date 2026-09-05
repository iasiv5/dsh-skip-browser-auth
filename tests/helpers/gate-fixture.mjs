// 门控双锚点 fixture helper：在真实临时目录按 pnpm store 布局写出探针的
// 两个锚点包（runtime 本体 @deepseek-ai/dsh + 官方 connection），并提供按
// specifier 分发的 resolveSync fake。路径段版本与 manifest 版本可分别控制
// （覆盖「路径真、manifest 假」漂移）；默认两者一致。
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { GATE_ANCHOR_PACKAGES } from '../../lib/gate.js'

/**
 * Write one pnpm-style package fixture: `<root>/@scope+name@SEG_h/node_modules/@scope/name/package.json`.
 */
async function writePackageFixture(root, pkg, { segmentVersion, manifestVersion }) {
  const short = pkg.slice(pkg.indexOf('/') + 1)
  const dir = join(root, `@deepseek-ai+${short}@${segmentVersion}_t`, 'node_modules', '@deepseek-ai', short)
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'package.json')
  await writeFile(file, JSON.stringify({ name: pkg, version: manifestVersion }))
  return { tmp: root, url: pathToFileURL(file).href }
}

/**
 * 写出全部门控锚点的 fixture，返回 `t`-登记的清理句柄与按包名索引的 url 表。
 * @param options 默认 `runtimeVersion = connectionVersion = GATE 版本`；
 *   每个 `*Version` 可再传 `{ segment, manifest }` 分别控制路径段与 manifest。
 */
export async function writeGateFixtures(t, {
  runtimeVersion,
  connectionVersion,
} = {}) {
  const tmp = await mkdtemp(join(tmpdir(), 'dsh-sba-gate-'))
  const normalize = (version, fallback) => {
    const base = version ?? fallback
    return typeof base === 'object'
      ? { segment: base.segment ?? fallback, manifest: base.manifest ?? fallback }
      : { segment: base, manifest: base }
  }
  const [runtime, connection] = await Promise.all([
    writePackageFixture(tmp, GATE_ANCHOR_PACKAGES[0], normalize(runtimeVersion, '0.1.2-rc.1')),
    writePackageFixture(tmp, GATE_ANCHOR_PACKAGES[1], normalize(connectionVersion, '0.1.2-rc.1')),
  ])
  const urls = {
    [GATE_ANCHOR_PACKAGES[0]]: runtime.url,
    [GATE_ANCHOR_PACKAGES[1]]: connection.url,
  }
  t.after(() => rm(tmp, { recursive: true, force: true }))
  return { tmp, urls }
}

/**
 * 按 specifier 分发的 resolveSync fake，同时兼容 v1 `(specifier, base, {})`
 * 与 v2 `(base, { specifier })` 两种调用形态；未登记的 specifier 返回 null。
 */
export function dispatchingResolveSync(urls, { throwOnResolve = false } = {}) {
  return (base, request) => {
    const specifier = typeof request === 'string' ? request : request.specifier
    if (!(specifier in urls)) return null
    if (throwOnResolve) throw new Error('resolve failed')
    return { url: urls[specifier] }
  }
}
