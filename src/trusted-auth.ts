/**
 * Trusted-network replacement for the official BrowserAuth stub.
 *
 * 官方 HostConnectionService 对认证的全部依赖（0.2.1 起）只有四个方法：
 * isAuthenticated / authorizeIndex / authenticatedUrl / authorizeConnect。
 * 本模块以 trusted-network 语义提供四方法 stub：请求信任栅栏（Host/Origin/
 * Fetch Metadata/trustedHosts）承担全部访问判定，身份层不存在。
 * 首页 fence 与 /api fence 消费同一个 trustedHosts 列表。
 */

import { isTrustedApiRequest } from './trust-fence.js'
import type { ConnectionTrustRequest } from './trust-fence.js'
import type { BrowserAuthSemantics } from './compatibility.js'

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
  /**
   * 0.2.1 `/connect` exchange (carrier-neutral-021 only). The official stub
   * mints an operator cookie and 302s to the API mux; trusted-network mode has
   * no identity to mint, so the stub validates the client protocol contract
   * (interactions declaration) and reproduces the official success redirect
   * without a cookie or an operator record — every subsequent /api request is
   * admitted as the owner-principal browserPeer regardless.
   */
  authorizeConnect(req: ConnectionIndexRequest, res: ConnectionIndexResponse, secure?: boolean, publish?: (interactions: string) => unknown): void
}

const TOKEN_QUERY = 'token'

/**
 * Create the three-method stub consumed by the official HostConnectionService.
 * @param trustedHosts - non-loopback authorities this deployment serves: exact `host:port`, or port-less `host` matching any port.
 * @param semantics - the host generation's BrowserAuth URL contract: `root`
 * (0.1.2/0.1.5, app at `/`) or `mount-preserving` (0.1.7, app may mount at a
 * sub-path). Selected by the compatibility profile, never guessed.
 * @returns authentication owner with trusted-network semantics for all three methods.
 */
export function createTrustedAuth(
  trustedHosts: readonly string[],
  semantics: BrowserAuthSemantics = 'root',
): TrustedAuth {
  // mount-preserving：官方 0.1.7 的清理重定向目标是目录相对 `./`，
  // 应用可以挂在子路径上；root：官方 0.1.2/0.1.5 一律回到 `/`。
  const cleanLocation = semantics === 'mount-preserving' ? './' : '/'
  return {
    // 请求已通过 /api 侧的 requestRejection/admit 信任栅栏；此处恒真，
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
          'location': cleanLocation,
          'referrer-policy': 'no-referrer',
        })
        res.end()
        return false
      }
      return true
    },

    // 无身份层：返回干净的应用 URL，不附加任何 token。
    // root：官方 0.1.2/0.1.5 语义，重写到应用根 `/`；
    // mount-preserving：官方 0.1.7 语义，保留调用方的 mount，仅去掉 query/hash。
    authenticatedUrl(baseUrl: string): string {
      const url = new URL(baseUrl)
      if (semantics !== 'mount-preserving') url.pathname = '/'
      url.search = ''
      url.hash = ''
      return url.href
    },

    // 0.2.1 /connect 交换（trusted-network 语义）：
    // - interactions 声明校验逐字对齐官方（客户端协议契约，400 兜底）；
    // - 官方成功路径 = mint operator cookie + 302 ./api/remote.mux；本 stub
    //   省略 cookie 与 operator 记录（无身份可铸造；publish 不调用，避免
    //   生成无 cookie 引用的孤儿 operator 台账），其余响应形态逐字对齐。
    //   后续 /api 请求由 admit() 恒准为 owner-principal browserPeer，mux
    //   连接不依赖该 cookie。
    // - 服务层已在 authorizeConnect 入口做过 isTrusted（evil host ⇒ 403，
    //   不达本 stub）；身份/token 校验路径在本模式恒通过（isAuthenticated
    //   恒真），token 缺失不再 401。
    authorizeConnect(req: ConnectionIndexRequest, res: ConnectionIndexResponse, _secure?: boolean, _publish?: (interactions: string) => unknown): void {
      const url = new URL(req.url ?? '/', 'http://dsh.invalid')
      const declarations = url.searchParams.getAll('interactions')
      const interactions = declarations[0] ?? 'none'
      if (declarations.length > 1 || (interactions !== 'answer' && interactions !== 'none')) {
        res.writeHead(400, {
          'cache-control': 'no-store',
          'content-type': 'text/plain; charset=utf-8',
        })
        res.end('interactions must be declared once as answer or none\n')
        return
      }
      res.writeHead(302, {
        'cache-control': 'no-store',
        'location': './api/remote.mux',
        'referrer-policy': 'no-referrer',
      })
      res.end()
    },
  }
}
