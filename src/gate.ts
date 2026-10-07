/**
 * 版本探针与行绑定表达式的单一事实源（组合期激活判据）。
 *
 * 两个表达式都跑在 Loader 的 `!!js` 求值环境里（`with (ctx) + eval`，
 * 见 vendor/loader/src/config/utils.ts），失败一律落入 dormant（fail-closed）。
 * sibling 解析走 Symbol.for('cordis.entry') 当前 entry 所属子树，
 * 不依赖根 Loader 的 resolve——业务行位于 Include 子树，根上看不到。
 *
 * 探针解析基准（2026-09-05 事故修正）：锚定宿主 runtime 本体，而不是
 * connection 包自身。`ctx.baseUrl` 是 profile 目录，Node 解析自 profile
 * 向上走 node_modules；旧版插件把 connection 包声明进 dependencies，发布
 * 安装（profile `nodeLinker: hoisted`）把 0.1.2-rc.1 副本抬升进 profile
 * node_modules，遮蔽 `~/.dsh/profiles/node_modules/` 下
 * healProfilesModuleFallback 维护的 runtime fallback 符号链——探针随之
 * 「自我满足」，在不兼容宿主上误激活（正是本次事故）。因此：
 *  1. 第一锚点是 `@deepseek-ai/dsh/package.json`（runtime 应用包本体）。
 *     它只可能来自 runtime fallback，不可能被任何 profile 插件的依赖
 *     抬升污染；其版本即宿主 runtime 版本。
 *  2. 第二锚点仍是官方 connection 包（被替换对象本体）；双锚点必须同时
 *     命中同一个 active compatibility profile pair，任一解析失败、混合版本或版本漂移一律 dormant。
 * 配套必要条件：本插件的 dependencies 不得声明任何 `@deepseek-ai` 运行时
 * 包（connection 仅作 devDependency 供编译期类型与构建锚点），由
 * tests/manifest.test.mjs 作为不变量看护。
 *
 * 单锚点版本判定（2026-09-05 第二修正，npm 扁平布局）：
 *  1. pnpm store 路径段（快路径）：URL 含 `+包名@版本[_/]` 段即取段值。
 *     保留既有文档化行为——「段真、manifest 版本漂移」时探针仍放行，
 *     由 apply 内 backstop 读 manifest 兜底 fail loud。
 *  2. manifest 回退：URL 为 `file:` 且无版本段（npm 扁平布局，如 dshm
 *     安装）时，经 `process.getBuiltinModule('node:fs'/'node:url')` 同步读
 *     manifest 比对精确版本（Node ≥22.3，插件 engines 覆盖；`!!js` 求值
 *     环境无 require/模块导入，这是唯一受支持的同步内建模块获取方式）。
 * 两分支都拿不到精确版本 → dormant。任何异常一律 dormant（组合期绝不
 * fail loud；最后防线在 apply 内 backstop）。
 *
 * 宿主 profile 门控（2026-10-07，web-only / desktop 休眠）：表达式在版本对判定
 * 之前先解析 desktop 信号包（DESKTOP_HOST_PACKAGE）——解析出合法 {url: string}
 * ⇒ desktop，由白名单表条目的 hostProfiles: ['web'] 条件统一拒绝（休眠，
 * 策略单一来源 src/compatibility.ts）；抛错/返回空值/url 非字符串 ⇒ 视为包
 * 不存在（web 继续，组合测试 fake 与真实 v1 loader 契约即如此）；resolver
 * 缺失仍走原有 null 分支。检测异常的 fail-closed 兜底是版本对判定本身
 * （真异常时双锚点同样解析失败 ⇒ null）。Node 侧镜像见 detectHostProfile；
 * 语义与解冻条件记录于 docs/COMPATIBILITY.md §7。
 */

import {
  ACTIVE_COMPATIBILITY_PROFILE_IDS,
  GATE_PROFILE_TABLE,
  type HostProfile,
} from './compatibility.js'

export {
  ACTIVE_COMPATIBILITY_PROFILE_IDS,
  COMPATIBILITY_PROFILES,
  GATE_VERSION,
  GATE_VERSIONS,
  isActiveCompatibilityProfileId,
  resolveActiveCompatibilityProfile,
  resolveCompatibilityProfile,
} from './compatibility.js'
export type { HostProfile } from './compatibility.js'

export const CONNECTION_PACKAGE = '@deepseek-ai/dsh-client-connection'
/** 宿主 runtime 本体包：探针的第一锚点，版本即宿主 dsh 版本。 */
export const GATE_RUNTIME_PACKAGE = '@deepseek-ai/dsh'
/** 探针锚点（顺序即求值顺序）：宿主 runtime 本体在前，被替换对象在后。 */
export const GATE_ANCHOR_PACKAGES = [GATE_RUNTIME_PACKAGE, CONNECTION_PACKAGE] as const
/** desktop 宿主信号包：仅 desktop runtime 携带；解析出合法 URL 即判定 desktop（web-only 门控）。 */
export const DESKTOP_HOST_PACKAGE = '@deepseek-ai/dsh-desktop-host'

/**
 * 从已解析 URL 提取 pnpm store 版本段的正则源（`+name@VER_` / `+name@VER/`）。
 * 探针表达式内嵌的正则由此单一实现生成；仅匹配 pnpm 布局，非 pnpm 布局
 * 落入 manifest 回退分支。
 */
export function versionSegmentPatternSource(pkg: string): string {
  const shortName = pkg.slice(pkg.indexOf('/') + 1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return `[+]${shortName}@([^/_]+)[_/]`
}

/** 探针内嵌的锚点表：`[包名, 版本段正则源]` 对，全部由上方常量派生。 */
const GATE_ANCHOR_TABLE = GATE_ANCHOR_PACKAGES.map((pkg) => [pkg, versionSegmentPatternSource(pkg)])

// Profile probe：单行；生成 cordis.patch.yml 的 profile-aware disabled 表达式。
// 逐锚点解析 `锚点包/package.json`，返回完整 runtime/connection pair 对应的
// profile id；candidate profile 也可被识别，是否允许激活由下方 boolean probe
// 根据 profile status 决定。解析失败、未知 pair 或混合 pair 一律返回 null。
export const GATE_PROFILE_EXPRESSION = `(() => { try { const internal = ctx.loader && ctx.loader.internal; if (!internal || typeof internal.resolveSync !== 'function') return null; const desktopSpecifier = ${JSON.stringify(DESKTOP_HOST_PACKAGE)} + '/package.json'; let hostProfile; try { const desktopResolved = internal.version === 'v2' ? internal.resolveSync(ctx.baseUrl, { specifier: desktopSpecifier, attributes: {} }) : internal.resolveSync(desktopSpecifier, ctx.baseUrl, {}); const desktopUrl = desktopResolved === null || typeof desktopResolved !== 'object' ? undefined : desktopResolved.url; hostProfile = typeof desktopUrl === 'string' ? 'desktop' : 'web'; } catch (hostError) { hostProfile = 'web'; } const versionOfUrl = (url, patternSource) => { if (typeof url !== 'string') return null; const decoded = decodeURIComponent(url); const segmented = decoded.match(new RegExp(patternSource)); if (segmented !== null) return segmented[1]; if (decoded.slice(0, 5) === 'file:') { const processRef = globalThis.process; if (processRef === null || typeof processRef !== 'object' || typeof processRef.getBuiltinModule !== 'function') return null; const fsModule = processRef.getBuiltinModule('node:fs'); const urlModule = processRef.getBuiltinModule('node:url'); if (!fsModule || typeof fsModule.readFileSync !== 'function' || !urlModule || typeof urlModule.fileURLToPath !== 'function') return null; const manifest = JSON.parse(fsModule.readFileSync(urlModule.fileURLToPath(url), 'utf8')); return manifest !== null && typeof manifest === 'object' && typeof manifest.version === 'string' ? manifest.version : null; } return null; }; const anchors = ${JSON.stringify(GATE_ANCHOR_TABLE)}; const versions = []; for (const [anchorPackage, patternSource] of anchors) { const specifier = anchorPackage + '/package.json'; let url; try { url = internal.version === 'v2' ? internal.resolveSync(ctx.baseUrl, { specifier, attributes: {} }).url : internal.resolveSync(specifier, ctx.baseUrl, {}).url; } catch (gateError) { return null; } let anchorVersion; try { anchorVersion = versionOfUrl(url, patternSource); } catch (gateError) { return null; } if (anchorVersion === null) return null; versions.push(anchorVersion); } const profiles = ${JSON.stringify(GATE_PROFILE_TABLE)}; for (const profile of profiles) { if (profile.hostProfiles.includes(hostProfile) && profile.pairs.some((pair) => pair.runtime === versions[0] && pair.connection === versions[1])) return profile.id; } return null; } catch (gateError) { return null; } })()`
// Boolean activation probe: only active profiles disable the official row.
// A known candidate profile remains dormant until its host/client adapter is
// promoted, while the profile expression still exposes its exact pair id.
export const GATE_PROBE_EXPRESSION = `(() => { try { const profile = (${GATE_PROFILE_EXPRESSION}); return profile !== null && ${JSON.stringify(ACTIVE_COMPATIBILITY_PROFILE_IDS)}.includes(profile); } catch (gateError) { return false; } })()`
// 行绑定放行：自身探针为真 + 同组 sibling 存在且名字匹配且其 effective disabled 为真。
// sibling 必须从当前 entry（Symbol.for('cordis.entry')）所属子树解析，
// 根 Loader 的 resolve 看不到 Include 子树内的行。
export const GATE_ROW_ALLOWED_EXPRESSION = `(() => { try { const self = ctx[Symbol.for('cordis.entry')]; if (!self || !self.parent || !self.parent.tree) return false; const official = self.parent.tree.resolve('connection'); if (!official || official.parent !== self.parent) return false; if (official.options.id !== 'connection' || official.options.name !== '${CONNECTION_PACKAGE}') return false; const probeAllowed = (${GATE_PROBE_EXPRESSION}); if (probeAllowed !== true) return false; return official.disabled === true; } catch (gateError) { return false; } })()`

/**
 * Evaluate the activation probe against a loader context scope.
 * @param ctx - the `!!js` evaluation scope (same object the Loader passes).
 * @returns true only when both gate anchors resolve to one active compatibility profile pair.
 */
export function evaluateGate(ctx: object): boolean {
  // 与 vendor/loader/src/config/utils.ts 的 evaluate 同语义：with(ctx) + eval。
  return new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }')(ctx, GATE_PROBE_EXPRESSION) as boolean
}

/** backstop 侧宿主检测用的最小 resolver 结构视图（loader.internal 的同构子集）。 */
export interface GateResolverLike {
  readonly version?: unknown
  resolveSync(...args: unknown[]): { url?: unknown } | undefined
}

/**
 * Node 侧宿主形态检测（apply backstop 镜像）：与 GATE_PROFILE_EXPRESSION 内联检测
 * 同语义——解析 desktop 信号包得到合法 {url: string} ⇒ 'desktop'；抛错/空值/url
 * 非字符串 ⇒ 视为包不存在 ⇒ 'web'（fail-closed 兜底是后续版本对判定）。
 * 调用方需已确认 resolver 存在（assertGateBackstop 的 presence 检查先于此执行）。
 */
export function detectHostProfile(internal: GateResolverLike, baseUrl: string): HostProfile {
  const specifier = `${DESKTOP_HOST_PACKAGE}/package.json`
  try {
    const resolved = internal.version === 'v2'
      ? internal.resolveSync(baseUrl, { specifier, attributes: {} })
      : internal.resolveSync(specifier, baseUrl, {})
    const url = (resolved as { url?: unknown } | null | undefined)?.url
    return typeof url === 'string' ? 'desktop' : 'web'
  } catch {
    return 'web'
  }
}
