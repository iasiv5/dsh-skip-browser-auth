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
 *     抬升污染；其版本段即宿主 runtime 版本。
 *  2. 第二锚点仍是官方 connection 包（被替换对象本体）；双锚点必须同时
 *     命中白名单版本，任一解析失败或版本漂移一律 dormant。
 * 配套必要条件：本插件的 dependencies 不得声明任何 `@deepseek-ai` 运行时
 * 包（connection 仅作 devDependency 供编译期类型与构建锚点），由
 * tests/manifest.test.mjs 作为不变量看护。
 */

export const CONNECTION_PACKAGE = '@deepseek-ai/dsh-client-connection'
/** 宿主 runtime 本体包：探针的第一锚点，版本段即宿主 dsh 版本。 */
export const GATE_RUNTIME_PACKAGE = '@deepseek-ai/dsh'
export const GATE_VERSION = '0.1.2-rc.1'
/** 探针锚点（顺序即求值顺序）：宿主 runtime 本体在前，被替换对象在后。 */
export const GATE_ANCHOR_PACKAGES = [GATE_RUNTIME_PACKAGE, CONNECTION_PACKAGE] as const

/**
 * 从已解析 URL 提取 pnpm store 版本段的正则源（`+name@VER_` / `+name@VER/`）。
 * 探针表达式内嵌的正则由此单一实现生成；仅匹配 pnpm 布局，非 pnpm 布局
 * （提取不到版本段）按不在白名单处理（fail-closed）。
 */
export function versionSegmentPatternSource(pkg: string): string {
  const shortName = pkg.slice(pkg.indexOf('/') + 1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return `[+]${shortName}@([^/_]+)[_/]`
}

/** 探针内嵌的锚点表：`[包名, 版本段正则源]` 对，全部由上方常量派生。 */
const GATE_ANCHOR_TABLE = GATE_ANCHOR_PACKAGES.map((pkg) => [pkg, versionSegmentPatternSource(pkg)])

// 版本探针：单行；生成 cordis.patch.yml 官方行 disabled（scripts/write-patch.mjs）。
// 逐锚点解析 `锚点包/package.json`，版本段全部等于 GATE_VERSION 才放行。
export const GATE_PROBE_EXPRESSION = `(() => { try { const internal = ctx.loader && ctx.loader.internal; if (!internal || typeof internal.resolveSync !== 'function') return false; const anchors = ${JSON.stringify(GATE_ANCHOR_TABLE)}; for (const [anchorPackage, patternSource] of anchors) { const specifier = anchorPackage + '/package.json'; let url; try { url = internal.version === 'v2' ? internal.resolveSync(ctx.baseUrl, { specifier, attributes: {} }).url : internal.resolveSync(specifier, ctx.baseUrl, {}).url; } catch (gateError) { return false; } if (typeof url !== 'string') return false; const match = decodeURIComponent(url).match(new RegExp(patternSource)); if (match === null || match[1] !== '${GATE_VERSION}') return false; } return true; } catch (gateError) { return false; } })()`
// 行绑定放行：自身探针为真 + 同组 sibling 存在且名字匹配且其 effective disabled 为真。
// sibling 必须从当前 entry（Symbol.for('cordis.entry')）所属子树解析，
// 根 Loader 的 resolve 看不到 Include 子树内的行。
export const GATE_ROW_ALLOWED_EXPRESSION = `(() => { try { const self = ctx[Symbol.for('cordis.entry')]; if (!self || !self.parent || !self.parent.tree) return false; const official = self.parent.tree.resolve('connection'); if (!official || official.parent !== self.parent) return false; if (official.options.id !== 'connection' || official.options.name !== '${CONNECTION_PACKAGE}') return false; const probeAllowed = (${GATE_PROBE_EXPRESSION}); if (probeAllowed !== true) return false; return official.disabled === true; } catch (gateError) { return false; } })()`

/**
 * Evaluate the activation probe against a loader context scope.
 * @param ctx - the `!!js` evaluation scope (same object the Loader passes).
 * @returns true only when every gate anchor resolves to exactly the whitelisted version.
 */
export function evaluateGate(ctx: object): boolean {
  // 与 vendor/loader/src/config/utils.ts 的 evaluate 同语义：with(ctx) + eval。
  return new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }')(ctx, GATE_PROBE_EXPRESSION) as boolean
}
