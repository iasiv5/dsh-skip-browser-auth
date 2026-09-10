/** Runtime connection module loader used by compatibility adapters. */

import type { Context } from '@deepseek-ai/cordis'
import { API_PATH as PINNED_API_PATH, HostConnectionService as PinnedHostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { CONNECTION_PACKAGE } from './gate.js'
import type { FetchHandler } from './bridge.js'

/** Minimal HostConnectionService surface consumed by this plugin. */
export interface RuntimeConnection {
  requestRejection(request: unknown): 401 | 403 | undefined
  createSharedFetchHandler(channel: string): FetchHandler
}

/** Runtime module shape shared by the 0.1.2 and 0.1.5 connection packages. */
export interface RuntimeConnectionModule {
  readonly HostConnectionService: new (
    ctx: Context,
    trustedHosts: readonly string[],
    browserAuth: unknown,
  ) => RuntimeConnection
  readonly API_PATH: string
}

/**
 * Product loader internal contract（2026-09-10 崩溃事故定案）：
 * `internal.import` 与 cordis-plugin-loader 同款三参签名 `(name, baseUrl, options)`，
 * 且方法依赖 `this`，必须以 `loader.internal` 为接收者 bound 调用。
 * 事实链：单参调用缺 baseUrl（第一晚，getOrCreateModuleJob 前抛 undefined）
 * → 三参但 detached 调用丢 `this`（第二晚，同款报错）→ `importer.call(loader.internal, …)`
 * bound 三参（最终正确）。任一环节缺失都会让宿主 apply fail-loud 进入崩溃循环。
 */
interface LoaderInternalLike {
  readonly import?: (name: string, baseUrl: string, options: object) => Promise<unknown>
}

interface LoaderLike {
  readonly internal?: LoaderInternalLike
}

function isRuntimeConnectionModule(value: unknown): value is RuntimeConnectionModule {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<RuntimeConnectionModule>
  return typeof candidate.HostConnectionService === 'function'
    && typeof candidate.API_PATH === 'string'
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Resolve the connection module from the active product loader.
 *
 * 产品组合必须消费宿主自己的 connection module 实例：有 loader 服务时
 * internal.import 缺失或调用失败都 fail loud——绝不静默回退到插件自带的
 * pinned dev 副本（那会重演 2026-09-05「探针自我满足」一类代际错配）。
 * pinned 副本只允许出现在完全没有 loader 服务的直接单元测试上下文。
 */
export async function loadRuntimeConnectionModule(ctx: Context): Promise<RuntimeConnectionModule> {
  const loader = (ctx.get as (name: string) => unknown)('loader') as LoaderLike | undefined
  if (loader !== undefined) {
    const importer = loader.internal?.import
    if (typeof importer !== 'function') {
      throw new Error('@iasiv5/dsh-skip-browser-auth: product loader is present but loader.internal.import is unavailable; refusing to fall back to the pinned dev copy')
    }
    const baseUrl = (ctx as { baseUrl?: unknown }).baseUrl
    if (typeof baseUrl !== 'string' || baseUrl === '') {
      throw new Error('@iasiv5/dsh-skip-browser-auth: loader.internal.import requires the plugin context baseUrl (profile directory URL); refusing to import without it')
    }
    let loaded: unknown
    try {
      // 必须以 loader.internal 为接收者调用（bound call）。把方法摘下来
      // detached 调用会丢失 this，Node 内部 ESM loader 在 getOrCreateModuleJob
      // 前即抛 "Cannot read properties of undefined"（2026-09-10 崩溃循环根因）。
      loaded = await importer.call(loader.internal, CONNECTION_PACKAGE, baseUrl, {})
    } catch (error) {
      throw new Error(`@iasiv5/dsh-skip-browser-auth: failed to import runtime module ${CONNECTION_PACKAGE} via loader.internal.import(name, baseUrl, options): ${describeError(error)}`)
    }
    if (!isRuntimeConnectionModule(loaded)) {
      throw new Error(`@iasiv5/dsh-skip-browser-auth: runtime module ${CONNECTION_PACKAGE} has an incompatible export shape`)
    }
    return loaded
  }
  return {
    HostConnectionService: PinnedHostConnectionService as unknown as RuntimeConnectionModule['HostConnectionService'],
    API_PATH: PINNED_API_PATH,
  }
}
