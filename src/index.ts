/**
 * @iasiv5/dsh-skip-browser-auth host half：trusted-network Connection Replacement。
 *
 * 兼容性按 profile 分代：0.1.2 使用 legacy-web adapter，0.1.5 使用
 * carrier-neutral adapter。公共 apply 只负责 profile/backstop、信任配置、
 * 生命周期和固定 warning；版本差异藏在 adapter 与 runtime connection loader。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Activates the webServer Context and index-inject event merges used below.
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import {
  CONNECTION_PACKAGE,
  GATE_ANCHOR_PACKAGES,
  GATE_VERSIONS,
  isActiveCompatibilityProfileId,
  resolveActiveCompatibilityProfile,
} from './gate.js'
import { COMPATIBILITY_PROFILES, type CompatibilityProfile } from './compatibility.js'
import { loadRuntimeConnectionModule } from './connection-runtime.js'
import { createLegacyWebRuntime } from './adapters/legacy-web.js'
import { createCarrierNeutralRuntime } from './adapters/carrier-neutral.js'
import type { HostRuntime } from './adapters/types.js'
import { assertTrustedAuthority } from './trust-fence.js'
import { createTrustedAuth } from './trusted-auth.js'
import { DEFAULT_MAX_REQUEST_BODY_BYTES } from './bridge.js'

/** Stable Cordis plugin name. */
export const name = '@iasiv5/dsh-skip-browser-auth'

/** The replacement owns a web carrier so dedicated RPC channels have a route owner. */
export const inject = ['webServer']

/** 启动警告固定文案（全局约束：Replacement 激活时逐字输出）。 */
const SKIP_WARNING = '@iasiv5/dsh-skip-browser-auth: BrowserAuth has been skipped. DSH Web is using the trusted-network behavior; this plugin does not verify any upstream proxy.'

/** Headroom for RPC JSON fields around aggregate base64 image payloads. */
const REQUEST_ENVELOPE_HEADROOM_BYTES = 1024 * 1024
const PROFILE_GLOBAL = '__DSH_SKIP_BROWSER_AUTH_PROFILE__'
const RECOVERY_GLOBAL = '__DSH_CONNECTION_RECOVERY__'
const WHITELIST_TEXT = `[${GATE_VERSIONS.map((version) => `'${version}'`).join(', ')}]`

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

function profileById(value: unknown): CompatibilityProfile | undefined {
  if (!isActiveCompatibilityProfileId(value)) return undefined
  return COMPATIBILITY_PROFILES.find((profile) => profile.id === value && profile.status === 'active')
}

function directProfile(requestedProfile: unknown): CompatibilityProfile {
  if (requestedProfile !== undefined) {
    const requested = profileById(requestedProfile)
    if (requested !== undefined) return requested
    throw new Error(`@iasiv5/dsh-skip-browser-auth: compatibility profile ${String(requestedProfile)} is not active; refusing to run`)
  }
  const legacy = profileById('legacy-web-v1')
  if (legacy === undefined) {
    throw new Error('@iasiv5/dsh-skip-browser-auth: no active compatibility profile is available for direct context')
  }
  return legacy
}

/**
 * apply 内 backstop（最后防线，fail loud）：版本 pair 读取全部门控锚点的
 * manifest，并解析到 active compatibility profile；绑定断言确认当前 entry
 * 子树内的官方 connection 行确实被本插件禁用、同组同名且无活跃 fiber。
 *
 * 产品组合中 loader / internal / current 任一缺失都意味着最后防线无法执行，
 * 必须在创建 Connection 服务与注册 /api 之前 fail loud。没有 loader 与 entry
 * 的直接单元测试上下文才跳过本 backstop。
 */
function assertGateBackstop(ctx: Context, requestedProfile?: string): CompatibilityProfile | undefined {
  const loader = (ctx.get as (name: string) => unknown)('loader') as { internal?: LoaderInternalLike } | undefined
  const current = (ctx as { fiber?: { entry?: FiberEntryLike } }).fiber?.entry
  if (loader === undefined && current === undefined) return undefined
  if (loader === undefined) {
    throw new Error('@iasiv5/dsh-skip-browser-auth: gate backstop unavailable: loader service is missing')
  }
  if (loader.internal === undefined) {
    throw new Error('@iasiv5/dsh-skip-browser-auth: gate backstop unavailable: loader internal resolver is missing')
  }
  if (current === undefined) {
    throw new Error('@iasiv5/dsh-skip-browser-auth: gate backstop unavailable: current loader entry is missing')
  }

  const baseUrl = (ctx as { baseUrl?: string }).baseUrl ?? ''
  const internal = loader.internal
  const versions: string[] = []
  for (const anchorPackage of GATE_ANCHOR_PACKAGES) {
    const specifier = `${anchorPackage}/package.json`
    const resolved = internal.version === 'v2'
      ? internal.resolveSync(baseUrl, { specifier, attributes: {} })
      : internal.resolveSync(specifier, baseUrl, {})
    const manifestUrl = resolved?.url
    if (typeof manifestUrl !== 'string') {
      throw new Error(`@iasiv5/dsh-skip-browser-auth: gate anchor ${anchorPackage} did not resolve; whitelist is ${WHITELIST_TEXT}; disable or uninstall the plugin`)
    }
    const manifest = JSON.parse(readFileSync(fileURLToPath(manifestUrl), 'utf8')) as { version?: unknown }
    if (typeof manifest.version !== 'string') {
      throw new Error(`@iasiv5/dsh-skip-browser-auth: gate anchor ${anchorPackage} manifest has no version, whitelist is ${WHITELIST_TEXT}; disable or uninstall the plugin`)
    }
    versions.push(manifest.version)
  }

  const profile = resolveActiveCompatibilityProfile(versions[0], versions[1])
  if (profile === undefined) {
    throw new Error(`@iasiv5/dsh-skip-browser-auth: gate anchors ${GATE_ANCHOR_PACKAGES[0]}=${String(versions[0])}, ${GATE_ANCHOR_PACKAGES[1]}=${String(versions[1])} do not resolve to one active compatibility profile; whitelist is ${WHITELIST_TEXT}; disable or uninstall the plugin`)
  }
  if (requestedProfile !== undefined && requestedProfile !== profile.id) {
    throw new Error(`@iasiv5/dsh-skip-browser-auth: compatibility profile mismatch: patch selected ${String(requestedProfile)}, anchors selected ${profile.id}; refusing to run`)
  }

  const official = current.parent.tree.resolve('connection')
  if (official.parent !== current.parent
    || official.options?.id !== 'connection'
    || official.options?.name !== CONNECTION_PACKAGE
    || official.disabled !== true
    || official.fiber !== undefined) {
    throw new Error('@iasiv5/dsh-skip-browser-auth: gate binding violated; refusing to run')
  }
  return profile
}

function installBrowserGlobals(ctx: Context, profile: CompatibilityProfile): void {
  ctx.inject(['webServer'], (webCtx) => {
    const carrier = webCtx as unknown as {
      on?: (event: 'webserver/index-inject', listener: (table: IndexInjection[]) => void) => unknown
    }
    if (typeof carrier.on !== 'function') return
    carrier.on('webserver/index-inject', (table) => {
      table.push({ kind: 'global', name: PROFILE_GLOBAL, value: profile.id })
      if (profile.requiresRecoveryGlobal) {
        table.push({ kind: 'global', name: RECOVERY_GLOBAL, value: {} })
      }
    })
  })
}

/** Plugin config: deployment authorities plus the selected compatibility profile. */
export interface TrustedConnectionConfig {
  /** Exact non-loopback authorities accepted by the request trust fence. */
  trustedHosts?: string[]
  /** Maximum buffered JSON body for buffered routes. Default: 300 MiB. */
  maxRequestBodyBytes?: number
  /** Internal patch-selected profile id; direct tests default to the legacy profile. */
  compatibilityProfile?: string
}

export const Config: z<TrustedConnectionConfig> = z.object({
  trustedHosts: z.array(String).default([]),
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
  compatibilityProfile: z.string().default('legacy-web-v1'),
})

function createHostRuntime(profile: CompatibilityProfile, input: Parameters<typeof createLegacyWebRuntime>[0]): HostRuntime {
  switch (profile.hostAdapter) {
    case 'legacy-web':
      return createLegacyWebRuntime(input)
    case 'carrier-neutral':
      return createCarrierNeutralRuntime(input)
    default:
      throw new Error('@iasiv5/dsh-skip-browser-auth: unsupported host adapter')
  }
}

/**
 * Mounts the trusted-network Connection replacement under the profile's Web
 * carrier. Every request passes the Host/Origin browser-trust fence; no
 * identity layer exists beyond it.
 */
export async function apply(ctx: Context, config?: TrustedConnectionConfig): Promise<void> {
  const trustedHosts = config?.trustedHosts ?? []
  const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  assertImageBodyCapacity(ctx, maxRequestBodyBytes)

  const profile = assertGateBackstop(ctx, config?.compatibilityProfile) ?? directProfile(config?.compatibilityProfile)
  const module = await loadRuntimeConnectionModule(ctx)
  const auth = createTrustedAuth(trustedHosts)
  const runtime = createHostRuntime(profile, {
    ctx,
    module,
    trustedHosts,
    auth,
    maxRequestBodyBytes,
    profileId: profile.id,
  })

  ctx.effect(() => ctx.webServer.register(runtime.route), `@iasiv5/dsh-skip-browser-auth: ${runtime.adapterId} ${runtime.route.path} route`)
  installBrowserGlobals(ctx, profile)
  ctx.inject(['attachments'], (attachmentCtx) => {
    assertImageBodyCapacity(attachmentCtx, maxRequestBodyBytes)
  })
  console.warn(SKIP_WARNING)
}
