/**
 * @iasiv5/dsh-skip-browser-auth host half：trusted-network Connection Replacement。
 *
 * 兼容性按 profile 分代：0.1.2 使用 legacy-web adapter，0.1.5 使用
 * carrier-neutral adapter，0.1.7 使用 carrier-neutral-017 adapter。公共 apply
 * 只负责 profile/backstop、信任配置、生命周期和固定 warning；版本差异藏在
 * adapter 与 runtime connection loader。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Activates the webServer Context and index-inject event merges used below.
import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import {
  CONNECTION_PACKAGE,
  DESKTOP_HOST_PACKAGE,
  detectHostProfile,
  GATE_ANCHOR_PACKAGES,
  GATE_VERSIONS,
  isActiveCompatibilityProfileId,
  resolveActiveCompatibilityProfile,
  type HostProfile,
} from './gate.js'
import { COMPATIBILITY_PROFILES, type CompatibilityProfile } from './compatibility.js'
import { loadRuntimeConnectionModule } from './connection-runtime.js'
import { createLegacyWebRuntime } from './adapters/legacy-web.js'
import { createCarrierNeutralRuntime } from './adapters/carrier-neutral.js'
import { createCarrierNeutral017Runtime } from './adapters/carrier-neutral-017.js'
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
/** desktop 休眠通知固定文案（0.3.12 起 apply 前置判别休眠时逐字输出；可 grep）。 */
const DESKTOP_DORMANT_NOTICE = '@iasiv5/dsh-skip-browser-auth: desktop host detected — dormant by design (web-only plugin); official connection untouched. Safe to uninstall.'

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

/**
 * direct（无 loader/fiber entry）上下文的 profile 兜底：仅纯单测/dev 树可达。
 * 宿主形态按 'web' 处理（dev 树即 web）——apply 的前置宿主判别（0.3.12）凭
 * 槽位/argv/execPath 信号即可判 desktop，真 desktop 上必然先静默休眠，不会走到
 * 这里；resolver 缺失不影响该判别（信号①自行消化 undefined）。
 */
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
 *
 * 0.3.12 起 desktop 分支由 apply 的前置宿主判别承接（静默休眠，见 apply），
 * 本函数内的 desktop throw 正常不可达，保留为纵深防御（防未来调用路径回退）；
 * 本 backstop 实际只在 web 路径运行，四类契约破坏（锚点解析失败、版本对不在
 * 白名单、profile mismatch、binding violated）照旧 fail loud。
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
  // 宿主 profile 镜像检测（2026-10-07 web-only 门控，纵深防御层）：desktop 信号在
  // 场 ⇒ fail loud。0.3.12 起 apply 的前置判别已在 desktop 上静默休眠返回，此分支
  // 正常不可达，保留为纵深防御（防未来重排序/调用路径回退）。语义与
  // detectHostProfile/表达式层一致（docs/COMPATIBILITY.md §7/§7.8）。
  const hostProfile = detectHostProfile(internal, baseUrl)
  if (hostProfile === 'desktop') {
    throw new Error(`@iasiv5/dsh-skip-browser-auth: desktop profile not supported; disable or uninstall the plugin (${DESKTOP_HOST_PACKAGE} present)`)
  }
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

  const profile = resolveActiveCompatibilityProfile(versions[0], versions[1], hostProfile)
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
    case 'carrier-neutral-017':
      return createCarrierNeutral017Runtime(input)
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
  // 宿主形态判别最前置（0.3.12，运行时权威休眠）：desktop ⇒ 静默休眠，无条件
  // 先于一切配置校验与副作用。背景：用户层 patch 可按行 id 合法覆盖本插件
  // patch 的 !!js disabled 表达式（dsh-m 插件开关 / `dsh plugin add` enable
  // 通道的标准产物，2026-10-11 实录），组合期门控因此不承担语义；apply 内判定
  // 是唯一权威。§7.4 教训（任何半区的 throw 都可能炸宿主）：休眠路径零 throw、
  // 零副作用，仅留一行可 grep 的通知；「激活需要正向 web 证明」的 default-deny
  // 语义不变。resolver 缺失不阻碍判别（信号①自行消化 undefined）。
  const earlyLoader = (ctx.get as (name: string) => unknown)('loader') as { internal?: LoaderInternalLike } | undefined
  const earlyBaseUrl = (ctx as { baseUrl?: string }).baseUrl ?? ''
  if (detectHostProfile(earlyLoader?.internal, earlyBaseUrl) === 'desktop') {
    console.warn(DESKTOP_DORMANT_NOTICE)
    return
  }

  const trustedHosts = config?.trustedHosts ?? []
  const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  assertImageBodyCapacity(ctx, maxRequestBodyBytes)

  const profile = assertGateBackstop(ctx, config?.compatibilityProfile) ?? directProfile(config?.compatibilityProfile)
  const module = await loadRuntimeConnectionModule(ctx)
  const auth = createTrustedAuth(trustedHosts, profile.browserAuthSemantics)
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
