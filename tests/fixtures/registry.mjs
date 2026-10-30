// 版本 fixture 登记表：白名单版本 ↔ npm 别名三件的唯一映射事实源
// （2026-10-25 测试层表驱动化，docs/plans/2026-10-25-fixture-registry-implementation-plan.md）。
//
// 数据原则：只登记「查不到的事实」——别名后缀与版本的映射不可从版本串推导
// （rc17 = 0.1.7-rc.2、rc171 = 0.1.7-rc.1、rc21 = 0.2.1-rc.1 构建锚），必须显式
// 落表；相邻对与 N×N 混合矩阵由 GATE_VERSIONS 全局序现算，绝不落表（防第二
// 事实源）。完备性（registry ↔ COMPATIBILITY_PROFILES 双向镜像、后缀唯一）由
// tests/structure.test.mjs 守卫。收编新版本的代码侧触点 = src/compatibility.ts
// 加 pair + 本表加一行（docs/COMPATIBILITY.md §5.0）。

/** fixture 三件别名对应的官方包名（spec 组装与 loadFixtureModules 共用）。 */
const ALIAS_PACKAGES = {
  connection: '@deepseek-ai/dsh-client-connection',
  frontendStatic: '@deepseek-ai/dsh-host-frontend-static',
  webServer: '@deepseek-ai/dsh-host-webserver',
}

/**
 * 全部白名单版本的 fixture 条目，顺序 = GATE_VERSIONS 全局序（structure 守卫锁定）。
 * 0.1.2-rc.1 无 fixture 别名（aliases: null）：组合测试经 pinned devDependencies
 * 直连官方包（与 compose.mjs 默认 moduleMap 同源），由 npm-flat-generations 与
 * active.test.mjs 覆盖，不进 active-generations 别名循环。
 */
export const VERSION_FIXTURES = [
  {
    version: '0.1.2-rc.1',
    profileId: 'legacy-web-v1',
    aliasSuffix: null,
    aliases: null,
  },
  {
    version: '0.1.5-rc.1',
    profileId: 'carrier-neutral-v2',
    aliasSuffix: 'rc15',
    aliases: {
      connection: 'dsh-client-connection-rc15',
      frontendStatic: 'frontend-static-rc15',
      webServer: 'webserver-rc15',
    },
  },
  {
    version: '0.1.5-rc.2',
    profileId: 'carrier-neutral-v2',
    aliasSuffix: 'rc152',
    aliases: {
      connection: 'dsh-client-connection-rc152',
      frontendStatic: 'frontend-static-rc152',
      webServer: 'webserver-rc152',
    },
  },
  {
    version: '0.1.7-rc.1',
    profileId: 'carrier-neutral-v3',
    aliasSuffix: 'rc171',
    aliases: {
      connection: 'dsh-client-connection-rc171',
      frontendStatic: 'frontend-static-rc171',
      webServer: 'webserver-rc171',
    },
  },
  {
    version: '0.1.7-rc.2',
    profileId: 'carrier-neutral-v3',
    aliasSuffix: 'rc17',
    aliases: {
      connection: 'dsh-client-connection-rc17',
      frontendStatic: 'frontend-static-rc17',
      webServer: 'webserver-rc17',
    },
  },
  {
    version: '0.2.0-rc.1',
    profileId: 'carrier-neutral-v3',
    aliasSuffix: 'rc20',
    aliases: {
      connection: 'dsh-client-connection-rc20',
      frontendStatic: 'frontend-static-rc20',
      webServer: 'webserver-rc20',
    },
  },
  {
    version: '0.2.0-rc.2',
    profileId: 'carrier-neutral-v3',
    aliasSuffix: 'rc202',
    aliases: {
      connection: 'dsh-client-connection-rc202',
      frontendStatic: 'frontend-static-rc202',
      webServer: 'webserver-rc202',
    },
  },
  {
    version: '0.2.1-rc.1',
    profileId: 'carrier-neutral-v4',
    aliasSuffix: 'rc211',
    aliases: {
      connection: 'dsh-client-connection-rc211',
      frontendStatic: 'frontend-static-rc211',
      webServer: 'webserver-rc211',
    },
  },
  {
    version: '0.2.1-rc.2',
    profileId: 'carrier-neutral-v4',
    aliasSuffix: 'rc212',
    aliases: {
      connection: 'dsh-client-connection-rc212',
      frontendStatic: 'frontend-static-rc212',
      webServer: 'webserver-rc212',
    },
  },
  {
    version: '0.2.1-rc.3',
    profileId: 'carrier-neutral-v4',
    aliasSuffix: 'rc213',
    aliases: {
      connection: 'dsh-client-connection-rc213',
      frontendStatic: 'frontend-static-rc213',
      webServer: 'webserver-rc213',
    },
  },
  {
    version: '0.2.1-rc.4',
    profileId: 'carrier-neutral-v4',
    aliasSuffix: 'rc214',
    aliases: {
      connection: 'dsh-client-connection-rc214',
      frontendStatic: 'frontend-static-rc214',
      webServer: 'webserver-rc214',
    },
  },
  {
    version: '0.2.1-rc.5',
    profileId: 'carrier-neutral-v4',
    aliasSuffix: 'rc215',
    aliases: {
      connection: 'dsh-client-connection-rc215',
      frontendStatic: 'frontend-static-rc215',
      webServer: 'webserver-rc215',
    },
  },
]

/**
 * 每 profile 的 client variant 构建锚（devDependencies 精确 spec，manifest.test
 * 正向 pin 断言的数据源）。legacy-web-v1 无构建锚别名：其 client variant 由
 * pinned `@deepseek-ai/dsh-client-connection@0.1.2-rc.1` devDep 直接构建。
 */
export const PROFILE_BUILD_ALIASES = {
  'carrier-neutral-v2': {
    alias: 'dsh-client-connection-rc15',
    spec: 'npm:@deepseek-ai/dsh-client-connection@0.1.5-rc.1',
  },
  'carrier-neutral-v3': {
    alias: 'dsh-client-connection-rc17',
    spec: 'npm:@deepseek-ai/dsh-client-connection@0.1.7-rc.2',
  },
  'carrier-neutral-v4': {
    alias: 'dsh-client-connection-rc21',
    spec: 'npm:@deepseek-ai/dsh-client-connection@0.2.1-rc.1',
  },
}

/**
 * 版本无关的固定安装常量（照抄 install-rc17-fixture.mjs 时代清单）：
 * - rc2 组：0.1.1-rc.2 事故回归 fixtures（connection/frontend 两件，无 webserver）
 *   + 未别名化的 apiproxy；
 * - peer pins：repo .npmrc legacy-peer-deps=true 后 npm 不自动安装 peer，0.1.7/
 *   0.2.1 connection 的 peer 链（scope → invariants）必须显式列出，锚定 0.1.7-rc.2
 *   （契约面逐字节一致，见 docs/COMPATIBILITY.md §5.5–§5.11 各轮审计）；
 * - rc2 时代传递依赖：apiproxy 0.1.1-rc.2 未声明 peers，一并钉住。
 */
export const LEGACY_FIXTURE_SPECS = [
  'dsh-client-connection-rc2@npm:@deepseek-ai/dsh-client-connection@0.1.1-rc.2',
  'frontend-static-rc2@npm:@deepseek-ai/dsh-host-frontend-static@0.1.1-rc.2',
  '@deepseek-ai/dsh-host-apiproxy@0.1.1-rc.2',
  '@deepseek-ai/dsh-scope@0.1.7-rc.2',
  '@deepseek-ai/dsh-invariants@0.1.7-rc.2',
  '@deepseek-ai/dsh-timeout@0.1.1-rc.2',
  '@deepseek-ai/dsh-storage-domain@0.1.1-rc.2',
  '@deepseek-ai/dsh-storage@0.1.1-rc.2',
  '@deepseek-ai/dsh-agent-presets@0.1.1-rc.2',
]

/** 带别名三件的条目（active-generations 循环面）。 */
export const FIXTURE_ENTRIES = VERSION_FIXTURES.filter((entry) => entry.aliases !== null)

/** 按全局序取相邻条目（首/尾自然单侧）。 */
export function adjacentVersions(version) {
  const index = VERSION_FIXTURES.findIndex((entry) => entry.version === version)
  if (index === -1) return undefined
  return {
    prev: index > 0 ? VERSION_FIXTURES[index - 1] : undefined,
    next: index + 1 < VERSION_FIXTURES.length ? VERSION_FIXTURES[index + 1] : undefined,
  }
}

/**
 * 取一个条目的组合测试 modules 映射（键 = compose rows 的官方包名）。
 * 别名条目 → aliased dynamic import；null 条目（0.1.2-rc.1）→ pinned devDeps。
 */
export async function loadFixtureModules(entry) {
  const resolved = entry.aliases === null
    ? {
        connection: await import(ALIAS_PACKAGES.connection),
        frontendStatic: await import(ALIAS_PACKAGES.frontendStatic),
        webServer: await import(ALIAS_PACKAGES.webServer),
      }
    : {
        connection: await import(entry.aliases.connection),
        frontendStatic: await import(entry.aliases.frontendStatic),
        webServer: await import(entry.aliases.webServer),
      }
  return {
    [ALIAS_PACKAGES.connection]: resolved.connection,
    [ALIAS_PACKAGES.frontendStatic]: resolved.frontendStatic,
    [ALIAS_PACKAGES.webServer]: resolved.webServer,
  }
}

/** 一次 npm install 的全量 specs（scripts/install-fixtures.mjs 消费）。 */
export function installSpecs() {
  const specs = []
  for (const entry of FIXTURE_ENTRIES) {
    specs.push(`${entry.aliases.connection}@npm:${ALIAS_PACKAGES.connection}@${entry.version}`)
    specs.push(`${entry.aliases.frontendStatic}@npm:${ALIAS_PACKAGES.frontendStatic}@${entry.version}`)
    specs.push(`${entry.aliases.webServer}@npm:${ALIAS_PACKAGES.webServer}@${entry.version}`)
  }
  return [...specs, ...LEGACY_FIXTURE_SPECS]
}
