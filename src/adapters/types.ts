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
  readonly route: WebRoute
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
