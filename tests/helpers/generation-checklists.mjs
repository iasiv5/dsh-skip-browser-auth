// 代际差异断言开关：按 profileId 收敛「这一代测什么」。值取自旧逐版本套件
// 实测（active-rc15 / active-rc17 / active-rc213 一线断言），机制依据：
// installBrowserGlobals 对所有 active profile 注入 PROFILE_GLOBAL=profile.id
// （src/index.ts:188-200），故四个代际的 indexMarker 断言均成立——v1 为新增
// 增强（旧 v1 块未断言）、v2 为既有迁移（旧 active-rc15:47 等已有）。
// token 清理位置（'/' vs './'）与 recovery global 不入本表：由 profile 的
// browserAuthSemantics / requiresRecoveryGlobal 派生（单一事实源）。
export const GENERATION_CHECKLISTS = {
  'legacy-web-v1': {
    indexMarker: /legacy-web-v1/,
    trustedRowId: 'trusted-connection',
    service: 'webRuntime',
    waterfall: false,
    rpcPeer: false,
    fetchPeer: false,
    connectRoute: false,
  },
  'carrier-neutral-v2': {
    indexMarker: /carrier-neutral-v2/,
    trustedRowId: 'trusted-connection',
    service: 'webRuntime',
    waterfall: false,
    rpcPeer: false,
    fetchPeer: false,
    connectRoute: false,
  },
  'carrier-neutral-v3': {
    indexMarker: /carrier-neutral-v3/,
    trustedRowId: 'trusted-connection',
    service: 'webRuntime',
    waterfall: true,
    rpcPeer: true,
    fetchPeer: false,
    connectRoute: false,
  },
  'carrier-neutral-v4': {
    indexMarker: /carrier-neutral-v4/,
    trustedRowId: 'trusted-connection-021',
    service: 'webStartup',
    waterfall: true,
    rpcPeer: true,
    fetchPeer: true,
    connectRoute: true,
  },
}
