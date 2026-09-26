import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { bridge } from '../bridge.js'
import type { HostAdapterInput, HostRuntime } from './types.js'
import type { RuntimeConnection } from '../connection-runtime.js'

/**
 * Host implementation for the 0.1.7 carrier-neutral connection contract.
 *
 * 与 carrier-neutral（0.1.5）的三处代际差异，均来自官方 0.1.7 apply 的逐行
 * 对照（docs/COMPATIBILITY.md §5.4）：
 * 1. `/api` 准入走新的 `admit()`（OperatorPeer 语义），不再直调
 *    `requestRejection()`；
 * 2. bridge 由 `webCtx.waterfall('connection/request', req, res, next)` 包裹，
 *    监听该瀑布的插件才能继续看到每个连接请求；
 * 3. BrowserAuth 消费是 mount-preserving（见 trusted-auth 的
 *    `mount-preserving` 语义，由 profile 选择，本 adapter 不重复实现）。
 */
export const HOST_ADAPTER_ID = 'carrier-neutral-017'

interface RegisterMethod {
  (owner: unknown, channel: string, handler: unknown): unknown
}

/** Minimal structural view of the 0.1.7 `connection/request` waterfall seam. */
interface WaterfallContext {
  waterfall(
    name: 'connection/request',
    req: IncomingMessage,
    res: ServerResponse,
    next: () => Promise<void>,
  ): Promise<void>
}

export function createCarrierNeutral017Runtime(input: HostAdapterInput): HostRuntime {
  const connection = new input.module.HostConnectionService(input.ctx, input.trustedHosts, input.auth)
  const fetchHandler = connection.createSharedFetchHandler(input.module.API_PATH)
  // admit() 是 0.1.7 代际的定义性契约，先于 requestBodyMode 检查：更早代际的
  // 模块（如 pinned 0.1.2）在这里以确定性的报错信息被拒绝。
  if (typeof connection.admit !== 'function') {
    throw new Error('@iasiv5/dsh-skip-browser-auth: carrier-neutral-017 profile requires the 0.1.7 admit() connection seam')
  }
  if (typeof fetchHandler.requestBodyMode !== 'function') {
    throw new Error('@iasiv5/dsh-skip-browser-auth: carrier-neutral-017 profile requires a requestBodyMode-aware connection handler')
  }
  const waterfall = (input.ctx as Context as unknown as WaterfallContext).waterfall
  if (typeof waterfall !== 'function') {
    throw new Error('@iasiv5/dsh-skip-browser-auth: carrier-neutral-017 profile requires a waterfall-capable carrier context')
  }

  // 0.1.7 keeps the 0.1.5 register() shape: the physical route mounts on
  // `owner.webServer`, while rpc.handle() readings often come from sibling
  // plugin contexts without webServer. Bind only this replacement instance's
  // registrations to the adapter's webServer-owning context (the 405 fix).
  const service = connection as unknown as { register?: RegisterMethod }
  const originalRegister = service.register
  if (typeof originalRegister !== 'function') {
    throw new Error('@iasiv5/dsh-skip-browser-auth: carrier-neutral-017 connection lacks its RPC register seam')
  }
  service.register = function registerWithCarrier(_owner, channel, handler) {
    return originalRegister.call(this, input.ctx, channel, handler)
  }

  const admitted = connection as unknown as RuntimeConnection & Required<Pick<RuntimeConnection, 'admit'>>
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
        bridge(req, res, fetchHandler, input.maxRequestBodyBytes))
    },
  }
  return { connection, route, fetchHandler, adapterId: HOST_ADAPTER_ID }
}
