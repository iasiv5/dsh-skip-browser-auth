/**
 * 版本探针与行绑定表达式的单一事实源（组合期激活判据）。
 *
 * 两个表达式都跑在 Loader 的 `!!js` 求值环境里（`with (ctx) + eval`，
 * 见 vendor/loader/src/config/utils.ts），失败一律落入 dormant（fail-closed）。
 * sibling 解析走 Symbol.for('cordis.entry') 当前 entry 所属子树，
 * 不依赖根 Loader 的 resolve——业务行位于 Include 子树，根上看不到。
 */

export const CONNECTION_PACKAGE = '@deepseek-ai/dsh-client-connection'
export const GATE_VERSION = '0.1.2-rc.1'
// 版本探针：单行；生成 cordis.patch.yml 官方行 disabled（scripts/write-patch.mjs）。
export const GATE_PROBE_EXPRESSION = `(() => { try { const internal = ctx.loader && ctx.loader.internal; if (!internal || typeof internal.resolveSync !== 'function') return false; let url; try { url = internal.version === 'v2' ? internal.resolveSync(ctx.baseUrl, { specifier: '${CONNECTION_PACKAGE}/package.json', attributes: {} }).url : internal.resolveSync('${CONNECTION_PACKAGE}/package.json', ctx.baseUrl, {}).url; } catch (gateError) { return false; } if (typeof url !== 'string') return false; const match = decodeURIComponent(url).match(/[+]dsh-client-connection@([^/_]+)[_/]/); return match !== null && match[1] === '${GATE_VERSION}'; } catch (gateError) { return false; } })()`
// 行绑定放行：自身探针为真 + 同组 sibling 存在且名字匹配且其 effective disabled 为真。
// sibling 必须从当前 entry（Symbol.for('cordis.entry')）所属子树解析，
// 根 Loader 的 resolve 看不到 Include 子树内的行。
export const GATE_ROW_ALLOWED_EXPRESSION = `(() => { try { const self = ctx[Symbol.for('cordis.entry')]; if (!self || !self.parent || !self.parent.tree) return false; const official = self.parent.tree.resolve('connection'); if (!official || official.parent !== self.parent) return false; if (official.options.id !== 'connection' || official.options.name !== '${CONNECTION_PACKAGE}') return false; const probeAllowed = (${GATE_PROBE_EXPRESSION}); if (probeAllowed !== true) return false; return official.disabled === true; } catch (gateError) { return false; } })()`

/**
 * Evaluate the activation probe against a loader context scope.
 * @param ctx - the `!!js` evaluation scope (same object the Loader passes).
 * @returns true only when the resolved connection package is exactly the whitelisted version.
 */
export function evaluateGate(ctx: object): boolean {
  // 与 vendor/loader/src/config/utils.ts 的 evaluate 同语义：with(ctx) + eval。
  return new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }')(ctx, GATE_PROBE_EXPRESSION) as boolean
}
