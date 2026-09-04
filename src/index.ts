/**
 * @iasiv5/dsh-skip-browser-auth host half：trusted-network Connection Replacement。
 *
 * 复用官方导出的 HostConnectionService（对认证的全部依赖只有
 * isAuthenticated / authorizeIndex / authenticatedUrl 三个方法，由
 * trusted-auth 的 stub 提供），复刻官方 apply 的 /api 前缀路由、
 * 请求体上限与 image capacity 断言语义，并在启动时输出固定警告。
 * apply 内 backstop 是最后防线：版本白名单（读官方 manifest）与
 * 门控绑定状态（同组官方行确被禁用且无活跃 fiber）任一不满足即
 * fail loud 拒绝运行。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Activates the webServer Context merge used below.
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { HostConnectionService, API_PATH } from '@deepseek-ai/dsh-client-connection'
import { assertTrustedAuthority } from './trust-fence.js'
import { createTrustedAuth } from './trusted-auth.js'
import { bridge, DEFAULT_MAX_REQUEST_BODY_BYTES } from './bridge.js'
import { CONNECTION_PACKAGE, GATE_VERSION } from './gate.js'

/** Stable Cordis plugin name. */
export const name = '@iasiv5/dsh-skip-browser-auth'

/** Services required before providing the replacement Connection. */
export const inject = ['webServer']

/** 启动警告固定文案（全局约束：Replacement 激活时逐字输出）。 */
const SKIP_WARNING = '@iasiv5/dsh-skip-browser-auth: BrowserAuth has been skipped. DSH Web is using the trusted-network behavior; this plugin does not verify any upstream proxy.'

/** Headroom for RPC JSON fields around aggregate base64 image payloads. */
const REQUEST_ENVELOPE_HEADROOM_BYTES = 1024 * 1024

function assertImageBodyCapacity(ctx: Context, maxRequestBodyBytes: number): void {
  const attachments = (ctx.get as (name: string) => unknown)('attachments') as
    | { imageLimits: { maxMessageImageBytes: number } }
    | undefined
  if (attachments === undefined) return
  const requiredImageBodyBytes = Math.ceil(
    attachments.imageLimits.maxMessageImageBytes * 4 / 3,
  ) + REQUEST_ENVELOPE_HEADROOM_BYTES
  if (maxRequestBodyBytes < requiredImageBodyBytes) {
    throw new Error(
      `@iasiv5/dsh-skip-browser-auth maxRequestBodyBytes (${String(maxRequestBodyBytes)}) must be at least `
      + `${String(requiredImageBodyBytes)} for the configured aggregate image limit`,
    )
  }
}

/** Official row as observed through the current entry's subtree. */
interface OfficialRowLike {
  readonly parent: unknown
  readonly options?: { readonly id?: unknown, readonly name?: unknown } | undefined
  readonly disabled: unknown
  readonly fiber?: unknown
}

/** Minimal structural view of the current fiber entry (Symbol.for('cordis.entry') target). */
interface FiberEntryLike {
  readonly parent: { readonly tree: { resolve(id: string): OfficialRowLike } }
}

/** Minimal structural view of the loader service's internal resolver. */
interface LoaderInternalLike {
  readonly version?: unknown
  resolveSync(...args: unknown[]): { url?: unknown } | undefined
}

/**
 * apply 内 backstop（最后防线，fail loud）：版本白名单断言读取官方 manifest
 * 本体（组合期探针只读 pnpm 路径段，会被「路径真、manifest 假」的漂移骗过）；
 * 绑定断言确认当前 entry 子树内的官方 connection 行确实被本插件禁用、
 * 同组同名且无活跃 fiber。
 *
 * 跳过 seam 仅限「完全没有 Loader、也没有 Loader entry」的直接单元测试调用；
 * 产品组合中 loader / internal / current 任一缺失都意味着最后防线无法执行，
 * 必须在创建 Connection 服务与注册 /api 之前 fail loud——否则后续 patch 层
 * 强制启用或组合回归把 Replacement 误送进 apply 时将无人拦截。
 */
function assertGateBackstop(ctx: Context): void {
  const loader = (ctx.get as (name: string) => unknown)('loader') as { internal?: LoaderInternalLike } | undefined
  const current = (ctx as { fiber?: { entry?: FiberEntryLike } }).fiber?.entry
  if (loader === undefined && current === undefined) return
  if (loader === undefined) {
    throw new Error('@iasiv5/dsh-skip-browser-auth: gate backstop unavailable: loader service is missing')
  }
  if (loader.internal === undefined) {
    throw new Error('@iasiv5/dsh-skip-browser-auth: gate backstop unavailable: loader internal resolver is missing')
  }
  if (current === undefined) {
    throw new Error('@iasiv5/dsh-skip-browser-auth: gate backstop unavailable: current loader entry is missing')
  }

  // (a) 版本断言：与官方 row 同一解析锚点（loader.internal），读 manifest 比对白名单。
  const baseUrl = (ctx as { baseUrl?: string }).baseUrl ?? ''
  const specifier = `${CONNECTION_PACKAGE}/package.json`
  const internal = loader.internal
  const resolved = internal.version === 'v2'
    ? internal.resolveSync(baseUrl, { specifier, attributes: {} })
    : internal.resolveSync(specifier, baseUrl, {})
  const manifest = JSON.parse(readFileSync(fileURLToPath(resolved?.url as string), 'utf8')) as { version?: unknown }
  if (manifest.version !== GATE_VERSION) {
    throw new Error(`@iasiv5/dsh-skip-browser-auth: official connection manifest is ${String(manifest.version)}, whitelist is ['0.1.2-rc.1']; disable or uninstall the plugin`)
  }

  // (b) 绑定断言：官方行被禁用是 Replacement 放行的前提，且不得有活跃 fiber。
  const official = current.parent.tree.resolve('connection')
  if (official.parent !== current.parent
    || official.options?.id !== 'connection'
    || official.options?.name !== CONNECTION_PACKAGE
    || official.disabled !== true
    || official.fiber !== undefined) {
    throw new Error('@iasiv5/dsh-skip-browser-auth: gate binding violated; refusing to run')
  }
}

/** Plugin config: the deployment's non-loopback serving authorities. */
export interface TrustedConnectionConfig {
  /**
   * Authorities this deployment serves beyond loopback: exact `host:port`, or
   * port-less `host` matching any port. The /api trust fence refuses any
   * request whose Host is neither loopback nor listed here; the Web runtime's
   * `trustedHosts` are consumed through the bundle patch automatically. An
   * entry that is not a bare, canonical authority fails plugin load.
   */
  trustedHosts?: string[]
  /** Maximum buffered JSON body for every `/api` request. Default: 300 MiB. */
  maxRequestBodyBytes?: number
}

export const Config: z<TrustedConnectionConfig> = z.object({
  trustedHosts: z.array(String).default([]),
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
})

/**
 * Mounts the trusted-network Connection replacement under the browser
 * transport prefix. Every request on the prefix passes the Host/Origin
 * browser-trust fence; no identity layer exists beyond it.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin config (schema defaults applied).
 */
export async function apply(ctx: Context, config?: TrustedConnectionConfig): Promise<void> {
  // The Loader resolves schema defaults; hand-built test contexts may pass none.
  const trustedHosts = config?.trustedHosts ?? []
  const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  // Config boundary: a malformed entry fails the load loudly here rather than
  // silently authorizing its hostname prefix at request time.
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  assertImageBodyCapacity(ctx, maxRequestBodyBytes)
  assertGateBackstop(ctx)
  // 官方未导出 BrowserAuth 类型，用构造器参数位取回；stub 只需满足
  // HostConnectionService 实际消费的三个方法。
  const auth = createTrustedAuth(trustedHosts) as unknown as ConstructorParameters<typeof HostConnectionService>[2]
  const connection = new HostConnectionService(ctx, trustedHosts, auth)
  const fetchHandler = connection.createSharedFetchHandler(API_PATH)
  const route: WebRoute = {
    kind: 'prefix',
    path: API_PATH,
    handler: async (req, res) => {
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined) {
        res.writeHead(rejection)
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
      await bridge(req, res, fetchHandler, maxRequestBodyBytes)
    },
  }
  ctx.effect(() => ctx.webServer.register(route), '@iasiv5/dsh-skip-browser-auth: /api route')
  ctx.inject(['attachments'], (attachmentCtx) => {
    assertImageBodyCapacity(attachmentCtx, maxRequestBodyBytes)
  })
  // 固定文案启动警告（全局约束）：Replacement 已激活、无上游代理校验。
  console.warn(SKIP_WARNING)
}
