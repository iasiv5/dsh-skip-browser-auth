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
export type HostAdapterKind = 'legacy-web' | 'carrier-neutral'
export type ClientVariant = 'rc12' | 'rc15'

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
    // Promoted after the carrier-neutral host/client adapter and fixture path
    // are implemented; real deployment validation remains documented separately.
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

/** Resolve only a profile whose implementation is promoted to active. */
export function resolveActiveCompatibilityProfile(
  runtimeVersion: unknown,
  connectionVersion: unknown,
): CompatibilityProfile | undefined {
  const profile = resolveCompatibilityProfile(runtimeVersion, connectionVersion)
  return profile?.status === 'active' ? profile : undefined
}

export function isActiveCompatibilityProfileId(value: unknown): value is CompatibilityProfileId {
  return typeof value === 'string' && (ACTIVE_COMPATIBILITY_PROFILE_IDS as readonly string[]).includes(value)
}

/** Small JSON-safe table embedded into the Loader `!!js` expression. */
export const GATE_PROFILE_TABLE = COMPATIBILITY_PROFILES.map(({ id, pairs }) => ({ id, pairs }))
