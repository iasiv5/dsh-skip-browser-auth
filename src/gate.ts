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
 * 宿主 profile 门控（2026-10-07，web-only / desktop 休眠；2026-10-08 0.3.8 信号修订）。
 * 设计公理（0.3.6 desktop 事故后的 default-deny）：**激活需要正向 web 证明，
 * 休眠不需要理由**——伤害不对称已被实证（误激活 desktop ⇒ 宿主不可启动；
 * 误休眠 web ⇒ 回到 token 输入，可一分钟定位）。
 * 表达式在版本对判定之前先做宿主形态判别，desktop 否决两条 + web 证明一条：
 *  ① desktop 信号包（DESKTOP_HOST_PACKAGE）自 ctx.baseUrl 可解析且得合法
 *    {url: string}——app.asar 内置形态的判别；
 *  ② 宿主进程 process.argv 含 `dsh-desktop-host`——desktop 宿主以
 *    `[execPath, dsh-desktop-host/lib/index.js, <dsh>, <profileDir>, …]` 启动
 *    （Electron under ELECTRON_RUN_AS_NODE），与 DSH 官方 dsh-plugin-manager
 *    的 isPackagedDesktopArgv 同款判别：launcher 事实独立于 profile 布局，
 *    不可被依赖抬升污染；
 *  ②′ desktop 槽位判别：ctx.baseUrl 目录基名 === 'desktop'——desktop 客户端
 *    恒以 profiles/desktop 槽位启动 loader（官方 desktopProfileDirFromArgv 按
 *    profiles 树定位），构造性事实、与进程树形状无关。0.3.8 的事态（宿主以
 *    纯 node 子进程跑 loader，argv/execPath 双双落空）由本信号兜底；
 *  ③ web 正向证明：宿主二进制 process.execPath 基名（大小写归一）∈
 *    {node, node.exe, nodejs, nodejs.exe}——Windows/macOS/Linux 的 web 全形态
 *    （systemd/docker/nvm/fnm/volta/mise/直接 node）经解释器 exec 后 execPath
 *    恒为 node 系二进制；desktop 宿主（Electron run-as-node）恒非 node 系。
 *    非 node 系二进制 ⇒ 非 web ⇒ 休眠（unknown-variant 兜底）。
 * 三者关系：任一 desktop 信号命中，或 web 证明不成立 ⇒ desktop（休眠）。
 * 判 desktop ⇒ 由白名单表条目的 hostProfiles: ['web'] 条件统一拒绝（休眠，
 * 策略单一来源 src/compatibility.ts）；全否 ⇒ web 继续；resolver 缺失仍走
 * 原有 null 分支。检测异常的 fail-closed 兜底是版本对判定本身（真异常时
 * 双锚点同样解析失败 ⇒ null）。
 * 信号修订缘由（2026-10-07 desktop 事故）：desktop profile 为 hoisted 物化布局，
 * dsh-desktop-host 只在 app.asar 内、自 ctx.baseUrl 不可达 ⇒ 0.3.6 仅凭信号①
 * 误判 web ⇒ 版本对命中 v3 ⇒ Replacement 在 desktop 激活 ⇒ "Desktop Host
 * authentication failed" 崩溃循环（0.3.6 已从 desktop 撤出；事故记录
 * docs/COMPATIBILITY.md §7.4/§7.6）。Node 侧镜像见 detectHostProfile；
 * 语义、事故记录与解冻条件见 docs/COMPATIBILITY.md §7。
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
/** desktop 宿主信号包：仅在 app.asar 内置形态存在（profile 布局下常不可达，见 0.3.8 事故记录）；可解析即判定 desktop。 */
export const DESKTOP_HOST_PACKAGE = '@deepseek-ai/dsh-desktop-host'
/** desktop 宿主 argv 判别子串：desktop 宿主入口脚本为 `dsh-desktop-host/lib/index.js`（官方 isPackagedDesktopArgv 同款）。 */
export const DESKTOP_HOST_ARGV_MARKER = 'dsh-desktop-host'
/** desktop 安装槽位名：desktop 客户端恒以 profiles/desktop 槽位启动 loader（官方 desktopProfileDirFromArgv 契约）。 */
export const DESKTOP_HOST_SLOT_NAME = 'desktop'

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
export const GATE_PROFILE_EXPRESSION = `(() => { try { const internal = ctx.loader && ctx.loader.internal; if (!internal || typeof internal.resolveSync !== 'function') return null; const desktopSpecifier = ${JSON.stringify(DESKTOP_HOST_PACKAGE)} + '/package.json'; let hostProfile = 'web'; let hostProcess = null; try { if (typeof process === 'object' && process !== null) hostProcess = process; } catch (sigError0) { } let slot = ''; let desktopBySlot = false; try { const decodedBase = decodeURIComponent(typeof ctx.baseUrl === 'string' ? ctx.baseUrl : ''); const trimmedBase = decodedBase.endsWith('/') ? decodedBase.slice(0, -1) : decodedBase; slot = trimmedBase.slice(trimmedBase.lastIndexOf('/') + 1).toLowerCase(); desktopBySlot = slot === ${JSON.stringify(DESKTOP_HOST_SLOT_NAME)}; } catch (sigError1) { } let desktopByArgv = false; try { if (hostProcess !== null && typeof hostProcess === 'object' && Array.isArray(hostProcess.argv)) desktopByArgv = hostProcess.argv.some((arg) => typeof arg === 'string' && arg.indexOf(${JSON.stringify(DESKTOP_HOST_ARGV_MARKER)}) !== -1); } catch (sigError2) { } let webByBinary = false; try { if (hostProcess !== null && typeof hostProcess === 'object' && typeof hostProcess.execPath === 'string') { const execBase = hostProcess.execPath.slice(Math.max(hostProcess.execPath.lastIndexOf('/'), hostProcess.execPath.lastIndexOf('\\\\')) + 1).toLowerCase(); webByBinary = execBase === 'node' || execBase === 'node.exe' || execBase === 'nodejs' || execBase === 'nodejs.exe'; } } catch (sigError3) { } let desktopByPackage = false; try { const desktopResolved = internal.version === 'v2' ? internal.resolveSync(ctx.baseUrl, { specifier: desktopSpecifier, attributes: {} }) : internal.resolveSync(desktopSpecifier, ctx.baseUrl, {}); const desktopUrl = desktopResolved === null || typeof desktopResolved !== 'object' ? undefined : desktopResolved.url; desktopByPackage = typeof desktopUrl === 'string'; } catch (sigError4) { } hostProfile = desktopByArgv || desktopBySlot || desktopByPackage || !webByBinary ? 'desktop' : 'web'; const versionOfUrl = (url, patternSource) => { if (typeof url !== 'string') return null; const decoded = decodeURIComponent(url); const segmented = decoded.match(new RegExp(patternSource)); if (segmented !== null) return segmented[1]; if (decoded.slice(0, 5) === 'file:') { const processRef = globalThis.process; if (processRef === null || typeof processRef !== 'object' || typeof processRef.getBuiltinModule !== 'function') return null; const fsModule = processRef.getBuiltinModule('node:fs'); const urlModule = processRef.getBuiltinModule('node:url'); if (!fsModule || typeof fsModule.readFileSync !== 'function' || !urlModule || typeof urlModule.fileURLToPath !== 'function') return null; const manifest = JSON.parse(fsModule.readFileSync(urlModule.fileURLToPath(url), 'utf8')); return manifest !== null && typeof manifest === 'object' && typeof manifest.version === 'string' ? manifest.version : null; } return null; }; const anchors = ${JSON.stringify(GATE_ANCHOR_TABLE)}; const versions = []; for (const [anchorPackage, patternSource] of anchors) { const specifier = anchorPackage + '/package.json'; let url; try { url = internal.version === 'v2' ? internal.resolveSync(ctx.baseUrl, { specifier, attributes: {} }).url : internal.resolveSync(specifier, ctx.baseUrl, {}).url; } catch (gateError) { return null; } let anchorVersion; try { anchorVersion = versionOfUrl(url, patternSource); } catch (gateError) { return null; } if (anchorVersion === null) return null; versions.push(anchorVersion); } const profiles = ${JSON.stringify(GATE_PROFILE_TABLE)}; for (const profile of profiles) { if (profile.hostProfiles.includes(hostProfile) && profile.pairs.some((pair) => pair.runtime === versions[0] && pair.connection === versions[1])) return profile.id; } return null; } catch (gateError) { return null; } })()`
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
 * Node 侧宿主形态检测（apply backstop 镜像 + apply 前置判别共用）：与
 * GATE_PROFILE_EXPRESSION 内联检测同语义，desktop 信号取或——① desktop 信号包自
 * baseUrl 解析出合法 {url: string}（抛错/空值/url 非字符串视为不可达，继续②）；
 * ② 宿主进程 process.argv 含 `dsh-desktop-host`（与官方 isPackagedDesktopArgv
 * 同款）。两信号皆否 ⇒ 'web'（fail-closed 兜底是后续版本对判定）。
 * resolver 允许为 undefined（0.3.12 起 apply 在 presence 检查之前先调用本函数做
 * 前置判别）：信号① 对 undefined 的访问在自身 try/catch 内消化，其余信号不依赖
 * resolver——undefined 一律按「信号①不可达」处理，语义不变。
 */
export function detectHostProfile(internal: GateResolverLike | undefined, baseUrl: string): HostProfile {
  const specifier = `${DESKTOP_HOST_PACKAGE}/package.json`
  // resolver 缺省 ⇒ 信号①按「不可达」处理（与原 try/catch 消化 TypeError 等价）。
  if (internal !== undefined) {
    try {
      const resolved = internal.version === 'v2'
        ? internal.resolveSync(baseUrl, { specifier, attributes: {} })
        : internal.resolveSync(specifier, baseUrl, {})
      const url = (resolved as { url?: unknown } | null | undefined)?.url
      if (typeof url === 'string') return 'desktop'
    } catch {
      // 信号包不可达/解析异常 ⇒ 落到宿主进程 argv 判别
    }
  }
  let slot = ''
  try {
    const trimmedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
    const slotIndex = Math.max(trimmedBase.lastIndexOf('/'), trimmedBase.lastIndexOf('\\'))
    slot = trimmedBase.slice(slotIndex + 1).toLowerCase()
  } catch {
    slot = ''
  }
  if (slot === 'desktop') return 'desktop'
  const hostProcess = (globalThis as { process?: { argv?: unknown; execPath?: unknown } }).process
  if (hostProcess !== undefined && hostProcess !== null && Array.isArray(hostProcess.argv)) {
    const desktopByArgv = (hostProcess.argv as unknown[]).some(
      (arg) => typeof arg === 'string' && (arg as string).includes(DESKTOP_HOST_ARGV_MARKER),
    )
    if (desktopByArgv) return 'desktop'
    const execPath = typeof hostProcess.execPath === 'string' ? hostProcess.execPath : ''
    const execBase = execPath.slice(Math.max(execPath.lastIndexOf('/'), execPath.lastIndexOf('\\')) + 1).toLowerCase()
    const webByBinary = execBase === 'node' || execBase === 'node.exe' || execBase === 'nodejs' || execBase === 'nodejs.exe'
    if (!webByBinary) return 'desktop'
  }
  return 'web'
}
