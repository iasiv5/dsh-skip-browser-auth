/**
 * Compatibility generations for the DSH BrowserAuth replacement.
 *
 * A profile is the unit of compatibility: a complete runtime/connection
 * version pair plus the host/client implementation generation that knows how
 * to serve it. Do not replace this table with independent version `includes`
 * checks: a runtime from one generation and a connection package from another
 * generation must never activate together.
 */

export type CompatibilityStatus = 'active' | 'candidate'
export type HostAdapterKind = 'legacy-web' | 'carrier-neutral' | 'carrier-neutral-017'
export type ClientVariant = 'rc12' | 'rc15' | 'rc17'

/**
 * 运行时宿主形态（host profile）：web = 通用 Web runtime；desktop = 内置
 * `@deepseek-ai/dsh-desktop-host` 的桌面 runtime。当前策略 web-only：desktop 一律
 * dormant（docs/COMPATIBILITY.md §7）。
 */
export type HostProfile = 'web' | 'desktop'

/**
 * BrowserAuth stub semantics consumed by a profile's host generation.
 *
 * - `root`: 0.1.2/0.1.5 generation — the app lives at `/`; the token-clean
 *   redirect targets `/` and `authenticatedUrl` rewrites the pathname to `/`.
 * - `mount-preserving`: 0.1.7 generation — the app may be mounted at a
 *   sub-path; the redirect targets the directory-relative `./` and
 *   `authenticatedUrl` preserves the caller's mount.
 */
export type BrowserAuthSemantics = 'root' | 'mount-preserving'

export interface CompatibilityPair {
  readonly runtime: string
  readonly connection: string
}

export const COMPATIBILITY_PROFILES = [
  {
    id: 'legacy-web-v1',
    pairs: [{ runtime: '0.1.2-rc.1', connection: '0.1.2-rc.1' }],
    hostAdapter: 'legacy-web',
    clientVariant: 'rc12',
    requiresRecoveryGlobal: false,
    browserAuthSemantics: 'root',
    hostProfiles: ['web'],
    status: 'active',
  },
  {
    id: 'carrier-neutral-v2',
    // 0.1.5-rc.2 joined this generation after a byte-level audit: every anchor
    // package the gate probes (@deepseek-ai/dsh, dsh-client-connection,
    // dsh-host-webserver, dsh-web-app) ships rc.1-identical code and only bumps
    // manifest versions/dependency ranges. See docs/COMPATIBILITY.md §6.
    pairs: [
      { runtime: '0.1.5-rc.1', connection: '0.1.5-rc.1' },
      { runtime: '0.1.5-rc.2', connection: '0.1.5-rc.2' },
    ],
    hostAdapter: 'carrier-neutral',
    clientVariant: 'rc15',
    requiresRecoveryGlobal: true,
    browserAuthSemantics: 'root',
    hostProfiles: ['web'],
    // Promoted after the carrier-neutral host/client adapter and fixture path
    // are implemented; real deployment validation remains documented separately.
    status: 'active',
  },
  {
    // 0.1.7 is a real contract change from 0.1.5, not a republish: the shared /api
    // route admits through the new OperatorPeer (`admit()`) and wraps the
    // bridge in the `connection/request` waterfall; BrowserAuth consumption
    // becomes mount-preserving; the browser client bundle is rewritten. Audited
    // package-by-package in docs/COMPATIBILITY.md §5.4.
    //
    // 0.1.7-rc.1 joined this generation after a byte-level audit (§5.5): every
    // package the replacement touches (dsh-client-connection lib/+client/,
    // dsh-host-webserver, dsh-scope, dsh-host-frontend-static) ships rc.2-identical
    // code, the web-app patch's connection row is field-identical, and the runtime
    // diff is chunk-hash renames plus diagnostics-only boot changes. The rc17
    // client variant therefore serves both pairs, selected by this one profile id.
    //
    // 0.2.0-rc.1 joined for the same reason (§5.6): despite the minor bump it is
    // a dependency-alignment republish on every surface the replacement probes
    // or serves — lib/+client/ byte-identical in all anchor packages, the
    // official patch's connection row field-identical, and the only code diffs
    // (dsh-app-boot OPTIONAL_BUNDLES, web-app patch telemetry/schedule rows)
    // never intersect the connection contract. No second 0.1.x-line build input
    // is introduced: the rc17 client variant keeps anchoring at 0.1.7-rc.2.
    //
    // 0.2.0-rc.2 joined for the same reason (§5.7): another dependency-alignment
    // republish on the contract face — lib/+client/ byte-identical in all anchor
    // packages (web-app's whole diff is package.json, so cordis.patch.yml and its
    // connection row are byte-identical too) — plus unrelated Desktop-only
    // plugin-management CLI changes in the runtime (bin.js, lib/types/*.d.ts) and
    // a ModuleLoader chunk-hash rename whose 34 changed lines all sit in that CLI
    // area with resolveSync usage line-identical. rc17 keeps anchoring at
    // 0.1.7-rc.2; no second 0.2.x-line build input is introduced.
    id: 'carrier-neutral-v3',
    pairs: [
      { runtime: '0.1.7-rc.1', connection: '0.1.7-rc.1' },
      { runtime: '0.1.7-rc.2', connection: '0.1.7-rc.2' },
      { runtime: '0.2.0-rc.1', connection: '0.2.0-rc.1' },
      { runtime: '0.2.0-rc.2', connection: '0.2.0-rc.2' },
    ],
    hostAdapter: 'carrier-neutral-017',
    clientVariant: 'rc17',
    requiresRecoveryGlobal: true,
    browserAuthSemantics: 'mount-preserving',
    hostProfiles: ['web'],
    // Promoted together with the adapter/client implementation; the fixture
    // composition suite and the real 0.1.7-rc.2 deployment checklist are the
    // promotion evidence (docs/COMPATIBILITY.md §5.4, docs/DESIGN.md).
    status: 'active',
  },
] as const

export type CompatibilityProfile = typeof COMPATIBILITY_PROFILES[number]
export type CompatibilityProfileId = CompatibilityProfile['id']

/** All exact versions represented by profiles, for diagnostics and fixtures. */
export const GATE_VERSIONS = [...new Set(
  COMPATIBILITY_PROFILES.flatMap((profile) => profile.pairs.flatMap((pair) => [pair.runtime, pair.connection])),
)] as readonly string[]

/** Backward-compatible internal alias for the original 0.1.2 build/test pin. */
export const GATE_VERSION = GATE_VERSIONS[0]

/** Profile ids whose host/client implementations are currently safe to activate. */
export const ACTIVE_COMPATIBILITY_PROFILE_IDS = COMPATIBILITY_PROFILES
  .filter((profile) => profile.status === 'active')
  .map((profile) => profile.id) as readonly CompatibilityProfileId[]

/** Resolve a complete runtime/connection pair, including candidate profiles. */
export function resolveCompatibilityProfile(
  runtimeVersion: unknown,
  connectionVersion: unknown,
): CompatibilityProfile | undefined {
  if (typeof runtimeVersion !== 'string' || typeof connectionVersion !== 'string') return undefined
  return COMPATIBILITY_PROFILES.find((profile) => profile.pairs.some((pair) =>
    pair.runtime === runtimeVersion && pair.connection === connectionVersion))
}

/** Resolve only a profile whose implementation is promoted to active AND whose
 *  hostProfiles admit the given host profile（未知宿主形态一律无匹配，fail-closed）。 */
export function resolveActiveCompatibilityProfile(
  runtimeVersion: unknown,
  connectionVersion: unknown,
  hostProfile: HostProfile,
): CompatibilityProfile | undefined {
  const profile = resolveCompatibilityProfile(runtimeVersion, connectionVersion)
  return profile?.status === 'active' && (profile.hostProfiles as readonly string[]).includes(hostProfile)
    ? profile
    : undefined
}

export function isActiveCompatibilityProfileId(value: unknown): value is CompatibilityProfileId {
  return typeof value === 'string' && (ACTIVE_COMPATIBILITY_PROFILE_IDS as readonly string[]).includes(value)
}

/** Small JSON-safe table embedded into the Loader `!!js` expression. */
export const GATE_PROFILE_TABLE = COMPATIBILITY_PROFILES.map(({ id, pairs, hostProfiles }) => ({ id, pairs, hostProfiles }))
