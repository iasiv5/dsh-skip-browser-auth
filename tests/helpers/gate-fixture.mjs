// 门控双锚点 fixture helper：在真实临时目录写出探针的两个锚点包
// （runtime 本体 @deepseek-ai/dsh + 官方 connection），并提供按 specifier
// 分发的 resolveSync fake。支持两种布局：
//  - pnpm（默认）：`<root>/@scope+name@SEG_h/node_modules/@scope/name/`，
//    路径段版本与 manifest 版本可分别控制（覆盖「路径真、manifest 假」漂移）；
//  - npm：`<root>/npm-flat/node_modules/@scope/name/`，URL 无版本段，
//    探针必须走 manifest 回退分支（dshm 部署形态）。
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { GATE_ANCHOR_PACKAGES } from '../../lib/gate.js'

async function writePackageFixture(root, pkg, { segmentVersion, manifestVersion, layout }) {
  const short = pkg.slice(pkg.indexOf('/') + 1)
  const dir = layout === 'npm'
    ? join(root, 'npm-flat', 'node_modules', '@deepseek-ai', short)
    : join(root, `@deepseek-ai+${short}@${segmentVersion}_t`, 'node_modules', '@deepseek-ai', short)
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'package.json')
  await writeFile(file, JSON.stringify({ name: pkg, version: manifestVersion }))
  return { tmp: root, url: pathToFileURL(file).href }
}

/**
 * 写出全部门控锚点的 fixture，返回 `t`-登记的清理句柄与按 specifier 索引的
 * url 表。
 * @param options 默认 `runtimeVersion = connectionVersion = GATE 版本`；
 *   每个 `*Version` 可再传 `{ segment, manifest }` 分别控制路径段与 manifest
 *   （segment 仅 pnpm 布局生效）；`layout: 'npm'` 切换 npm 扁平布局。
 */
export async function writeGateFixtures(t, {
  runtimeVersion,
  connectionVersion,
  layout = 'pnpm',
} = {}) {
  const tmp = await mkdtemp(join(tmpdir(), 'dsh-sba-gate-'))
  const normalize = (version, fallback) => {
    const base = version ?? fallback
    return typeof base === 'object'
      ? { segmentVersion: base.segment ?? fallback, manifestVersion: base.manifest ?? fallback }
      : { segmentVersion: base, manifestVersion: base }
  }
  const [runtime, connection] = await Promise.all([
    writePackageFixture(tmp, GATE_ANCHOR_PACKAGES[0], { ...normalize(runtimeVersion, '0.1.2-rc.1'), layout }),
    writePackageFixture(tmp, GATE_ANCHOR_PACKAGES[1], { ...normalize(connectionVersion, '0.1.2-rc.1'), layout }),
  ])
  const urls = {
    [`${GATE_ANCHOR_PACKAGES[0]}/package.json`]: runtime.url,
    [`${GATE_ANCHOR_PACKAGES[1]}/package.json`]: connection.url,
  }
  t.after(() => rm(tmp, { recursive: true, force: true }))
  return { tmp, urls }
}

/**
 * 按 specifier 分发的 resolveSync fake，同时兼容 v1 `(specifier, base, {})`
 * 与 v2 `(base, { specifier })` 两种调用形态（按实参形状区分）；未登记的
 * specifier 返回 null。
 */
export function dispatchingResolveSync(urls, { throwOnResolve = false } = {}) {
  return (...args) => {
    const [first, second] = args
    // v1：第一参即 specifier；v2：specifier 在请求对象里。
    const specifier = typeof first === 'string' && typeof second !== 'object'
      ? first
      : second?.specifier
    if (!(specifier in urls)) return null
    if (throwOnResolve) throw new Error('resolve failed')
    return { url: urls[specifier] }
  }
}
