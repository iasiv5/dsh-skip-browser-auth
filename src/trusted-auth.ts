/**
 * Trusted-network replacement for the official BrowserAuth stub.
 *
 * 官方 HostConnectionService 对认证的全部依赖只有三个方法：
 * isAuthenticated / authorizeIndex / authenticatedUrl。本模块以
 * trusted-network 语义提供三方法 stub：请求信任栅栏（Host/Origin/
 * Fetch Metadata/trustedHosts）承担全部访问判定，身份层不存在。
 * 首页 fence 与 /api fence 消费同一个 trustedHosts 列表。
 */

import { isTrustedApiRequest } from './trust-fence.js'
import type { ConnectionTrustRequest } from './trust-fence.js'

/** Root/index request facts used by the browser-token exchange. */
export interface ConnectionIndexRequest extends ConnectionTrustRequest {
  readonly method?: string | undefined
  readonly url?: string | undefined
}

/** Root/index response operations owned by the browser-token exchange. */
export interface ConnectionIndexResponse {
  writeHead(status: number, headers?: Readonly<Record<string, string>>): unknown
  end(body?: string): unknown
}

export interface TrustedAuth {
  /** The trust fence already decided admission; no identity layer exists. */
  isAuthenticated(request: ConnectionTrustRequest): boolean
  /** Enforce the trust fence on the index request, then clean a root token. */
  authorizeIndex(req: ConnectionIndexRequest, res: ConnectionIndexResponse): boolean
  /** Return the clean application URL; nothing is appended without auth. */
  authenticatedUrl(baseUrl: string): string
}

const TOKEN_QUERY = 'token'

/**
 * Create the three-method stub consumed by the official HostConnectionService.
 * @param trustedHosts - non-loopback authorities this deployment serves: exact `host:port`, or port-less `host` matching any port.
 * @returns authentication owner with trusted-network semantics for all three methods.
 */
export function createTrustedAuth(trustedHosts: readonly string[]): TrustedAuth {
  return {
    // 请求已通过 /api 侧的 requestRejection 信任栅栏；此处恒真，
    // 使官方 service 不再叠加 401 身份层。
    isAuthenticated(_request: ConnectionTrustRequest): boolean {
      return true
    },

    // 首页请求先过与 /api 相同的信任栅栏（不可信 → 403）；
    // 可信的 GET / 带 token 时以 303 清理 URL（无身份层，无需交换 cookie），
    // 其余可信请求直接放行交付 index.html。
    authorizeIndex(req: ConnectionIndexRequest, res: ConnectionIndexResponse): boolean {
      if (!isTrustedApiRequest(req, trustedHosts)) {
        res.writeHead(403, {
          'cache-control': 'no-store',
          'content-type': 'text/plain; charset=utf-8',
        })
        res.end(req.method === 'HEAD' ? undefined : 'forbidden\n')
        return false
      }
      const url = new URL(req.url ?? '/', 'http://dsh.invalid')
      if (url.searchParams.has(TOKEN_QUERY) && req.method === 'GET' && url.pathname === '/') {
        res.writeHead(303, {
          'cache-control': 'no-store',
          'location': '/',
          'referrer-policy': 'no-referrer',
        })
        res.end()
        return false
      }
      return true
    },

    // 无身份层：返回干净的应用根 URL，不附加任何 token。
    authenticatedUrl(baseUrl: string): string {
      const url = new URL(baseUrl)
      url.pathname = '/'
      url.search = ''
      url.hash = ''
      return url.href
    },
  }
}
