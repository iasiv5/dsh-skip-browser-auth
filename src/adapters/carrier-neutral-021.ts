import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { bridgeWithPeer } from '../bridge.js'
import type { HostAdapterInput, HostRuntime } from './types.js'
import type { RuntimeConnection } from '../connection-runtime.js'

/**
 * Host implementation for the 0.2.1 carrier-neutral connection contract.
 *
 * 相对 carrier-neutral-017（0.1.7–0.2.0 代际）的官方差异，均来自 0.2.1-rc.1
 * 官方 apply 的逐行对照（docs/COMPATIBILITY.md §5.8 审计 + §5.9 收编）：
 * 1. 共享 `/api` 路由的 bridge 调用把 admit() 产生的 Peer 透传给 fetch
 *    （`bridge(req, res, fetchHandler, admission.peer, maxRequestBodyBytes)`）
 *    ——Peer 最终成为 RPC handler 第 4 参，并把 exact Fetch route 门在
 *    owner-principal 上（非 owner ⇒ 403，官方 fetch handler 自带）；
 * 2. 新增 exact `/connect` 路由（`module.CONNECT_PATH`），handler 直接委托
 *    `connection.authorizeConnect(req, res)`（socket 连接协议通道）；
 * 3. `admit()` 语义升级（isTrusted → disposed → browserAuth.isAuthenticated ⇒
 *    browserPeer / token 台账 peer），但形状仍是 `{peer} | {rejection}`，
 *    Replacement 的消费方式不变——认证由 trusted-auth stub 承担（恒
 *    authenticated ⇒ 恒 browserPeer，principal 为 owner，与官方浏览器半区
 *    同一对象），fence 语义由 stub 与 service 共同保持；
 * 4. `register()` 仍是 owner-based 形状（sibling 无 webServer 的 405 语义
 *    不变），沿用 017 的 carrier 绑定包装。
 *
 * 代际 seam 守卫：`CONNECT_PATH` 导出 + `authorizeConnect` 方法是 0.2.1 特有
 * 面——更早代际的模块（含 0.1.7/0.2.0）在这里以确定性报错被拒绝（0.1.7 的
 * `admit()` 存在性已不足以区分代际）。
 */
export const HOST_ADAPTER_ID = 'carrier-neutral-021'

interface RegisterMethod {
  (owner: unknown, channel: string, handler: unknown): unknown
}

/** Minimal structural view of the 0.1.7+ `connection/request` waterfall seam. */
interface WaterfallContext {
  waterfall(
    name: 'connection/request',
    req: IncomingMessage,
    res: ServerResponse,
    next: () => Promise<void>,
  ): Promise<void>
}

export function createCarrierNeutral021Runtime(input: HostAdapterInput): HostRuntime {
  const connection = new input.module.HostConnectionService(input.ctx, input.trustedHosts, input.auth)
  const fetchHandler = connection.createSharedFetchHandler(input.module.API_PATH)
  // 代际守卫（fail loud 于 apply 前，绝不静默降级到错误代际的语义）：
  // - admit()：0.1.7 起的准入 seam（0.2.1 延续）；
  // - CONNECT_PATH + authorizeConnect：0.2.1 特有的 /connect 通道 seam；
  // - requestBodyMode：0.1.5 起的 body-mode 感知 handler。
  if (typeof connection.admit !== 'function') {
    throw new Error('@iasiv5/dsh-skip-browser-auth: carrier-neutral-021 profile requires the 0.2.1 admit() connection seam')
  }
  if (typeof connection.authorizeConnect !== 'function' || input.module.CONNECT_PATH === undefined) {
    throw new Error('@iasiv5/dsh-skip-browser-auth: carrier-neutral-021 profile requires the 0.2.1 /connect connection seam (CONNECT_PATH + authorizeConnect)')
  }
  if (typeof fetchHandler.requestBodyMode !== 'function') {
    throw new Error('@iasiv5/dsh-skip-browser-auth: carrier-neutral-021 profile requires a requestBodyMode-aware connection handler')
  }
  const waterfall = (input.ctx as Context as unknown as WaterfallContext).waterfall
  if (typeof waterfall !== 'function') {
    throw new Error('@iasiv5/dsh-skip-browser-auth: carrier-neutral-021 profile requires a waterfall-capable carrier context')
  }

  // 0.2.1 keeps the owner-based register() shape: the physical route mounts on
  // `owner.webServer`, while rpc.handle() readings often come from sibling
  // plugin contexts without webServer. Bind only this replacement instance's
  // registrations to the adapter's webServer-owning context (the 405 fix,
  // unchanged from the 017 adapter).
  const service = connection as unknown as { register?: RegisterMethod }
  const originalRegister = service.register
  if (typeof originalRegister !== 'function') {
    throw new Error('@iasiv5/dsh-skip-browser-auth: carrier-neutral-021 connection lacks its RPC register seam')
  }
  service.register = function registerWithCarrier(_owner, channel, handler) {
    return originalRegister.call(this, input.ctx, channel, handler)
  }

  const admitted = connection as unknown as RuntimeConnection & Required<Pick<RuntimeConnection, 'admit' | 'authorizeConnect'>>
  const connectPath = input.module.CONNECT_PATH as string
  const route: WebRoute = {
    kind: 'prefix',
    path: input.module.API_PATH,
    handler: async (req, res) => {
      const admission = admitted.admit(req)
      if ('rejection' in admission) {
        res.writeHead(admission.rejection)
        res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
      await waterfall.call(input.ctx, 'connection/request', req, res, () =>
        bridgeWithPeer(req, res, fetchHandler, admission.peer, input.maxRequestBodyBytes))
    },
  }
  // 官方 0.2.1 apply 的第二个注册（顺序照抄：/api 在前，/connect 在后）：
  // exact CONNECT_PATH 路由整体委托 authorizeConnect（ admission/栅栏语义在
  // service 内部，Replacement 不复刻其实现）。
  const connectRoute: WebRoute = {
    kind: 'exact',
    path: connectPath,
    handler: (req, res) => {
      admitted.authorizeConnect(req, res)
    },
  }
  return { connection, route, additionalRoutes: [connectRoute], fetchHandler, adapterId: HOST_ADAPTER_ID }
}
