import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { bridge, type FetchHandler } from '../bridge.js'
import type { RuntimeConnection, RuntimeConnectionModule } from '../connection-runtime.js'

export interface HostAdapterInput {
  readonly ctx: Context
  readonly module: RuntimeConnectionModule
  readonly trustedHosts: readonly string[]
  readonly auth: unknown
  readonly maxRequestBodyBytes: number
  readonly profileId: string
}

export interface HostRuntime {
  readonly connection: RuntimeConnection
  /** The primary carrier route (the shared `/api` prefix in every generation). */
  readonly route: WebRoute
  /**
   * Generation-specific extra routes registered after the primary one, in
   * official apply() order. 0.2.1 (carrier-neutral-021) adds the exact
   * `/connect` channel; earlier generations leave this empty.
   */
  readonly additionalRoutes?: readonly WebRoute[]
  readonly fetchHandler: FetchHandler
  readonly adapterId: string
}

/** Construct the common trusted /api carrier route for one compatibility adapter. */
export function createHostRuntime(input: HostAdapterInput, adapterId: string): HostRuntime {
  const connection = new input.module.HostConnectionService(input.ctx, input.trustedHosts, input.auth)
  const fetchHandler = connection.createSharedFetchHandler(input.module.API_PATH)
  const route: WebRoute = {
    kind: 'prefix',
    path: input.module.API_PATH,
    handler: async (req, res) => {
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined) {
        res.writeHead(rejection)
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
      await bridge(req, res, fetchHandler, input.maxRequestBodyBytes)
    },
  }
  return { connection, route, fetchHandler, adapterId }
}
