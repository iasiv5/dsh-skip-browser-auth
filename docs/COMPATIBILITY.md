# Compatibility Profile 审计与扩展指南

本文件记录 DSH Skip Browser Auth 的版本兼容性决策。它回答两个问题：

1. 某个 DSH 版本能否安全激活 BrowserAuth Replacement？
2. 新版本是加入现有兼容代际，还是必须新增 host/client 分支？

## 1. 0.1.2 与 0.1.5 的 GitHub 审计

审计对象：

- [DeepSeek Harness v0.1.5-rc.1 release notes](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)
- [v0.1.2-rc.1 → v0.1.5-rc.1 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.2-rc.1...dsh-v0.1.5-rc.1)
- [0.1.2 connection/index.ts](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-rc.1/packages/client/connection/src/index.ts)
- [0.1.5 connection/index.ts](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.5-rc.1/packages/client/connection/src/index.ts)
- [0.1.2 connection/rpc-host.ts](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-rc.1/packages/client/connection/src/rpc-host.ts)
- [0.1.5 connection/rpc-host.ts](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.5-rc.1/packages/client/connection/src/rpc-host.ts)
- [Discussion #6105：`connection.rpc.handle()` 405](https://github.com/deepseek-ai/deepseek-harness/discussions/6105)
- [Discussion #6111：dedicated channels never register](https://github.com/deepseek-ai/deepseek-harness/discussions/6111)

### 1.1 API 差异

| 维度 | `0.1.2-rc.1` | `0.1.5-rc.1` | 对本插件的影响 |
| --- | --- | --- | --- |
| Connection 注入 | `webServer` + `credentials` | Connection 行只注入 `credentials`，Web carrier 通过 `ctx.inject(['webServer'])` | 不能共用旧版 DI 假设 |
| HostConnectionService | 旧版 HTTP `/api` carrier | carrier-neutral registry | 必须按 profile 加载 runtime module |
| Fetch route | GET/HEAD exact route | 增加 POST、`requestBody`、`requestBodyMode` | 旧 buffered bridge 不能完整表达 0.1.5 |
| Generic RPC | `rpc.handle()` 旧 route 语义 | `rpc.handle()` 可能因 owner context 缺 webServer 返回 405 | carrier-neutral adapter 绑定 carrier owner |
| Browser client | rc12 bundle | rc15 bundle 增加 recovery config/global | 不能 re-ID 旧 bundle 冒充新 bundle |
| 其它开发者 API | 旧版 contracts | Session V3、Session lifecycle、Agent/Inbox/Web panel 等变更 | 本插件只声明 Connection replacement 范围 |

**判断**：`0.1.5-rc.1` 不能直接加入旧版单一 adapter。它必须拥有独立 profile、host adapter 和 client variant。

## 2. Profile 数据模型

单一事实源在 `src/compatibility.ts`：

```ts
const COMPATIBILITY_PROFILES = [
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
    pairs: [
      { runtime: '0.1.5-rc.1', connection: '0.1.5-rc.1' },
      { runtime: '0.1.5-rc.2', connection: '0.1.5-rc.2' },
    ],
    hostAdapter: 'carrier-neutral',
    clientVariant: 'rc15',
    requiresRecoveryGlobal: true,
    status: 'active',
  },
] as const
```

实现细节：

- `pairs` 是完整 runtime/connection 版本对；不能拆成两个独立集合。
- `GATE_VERSIONS` 只用于诊断/文档和旧内部 fixture 兼容，不是 profile 选择逻辑。
- `GATE_PROFILE_EXPRESSION` 返回 profile id 或 `null`。
- `GATE_PROBE_EXPRESSION` 只对 `status: 'active'` 的 profile 返回 true。
- patch 把 profile id 传给插件行；host backstop 再以 manifest 验证一遍。
- host 通过 `__DSH_SKIP_BROWSER_AUTH_PROFILE__` 把同一个 profile id 传给 client dispatcher。

### 2.1 安全不变量

以下任一情况都必须 dormant 或 fail loud：

```text
runtime=0.1.2-rc.1 + connection=0.1.5-rc.1
runtime=0.1.5-rc.1 + connection=0.1.2-rc.1
runtime/connection 未知
path segment 与 manifest 漂移
patch config profile 与 manifest profile 不一致
profile 为 candidate 或没有实现 adapter/client
```

不能使用：

```ts
version >= '0.1.2'
version.startsWith('0.1.')
allowedRuntime.includes(runtime) && allowedConnection.includes(connection)
```

## 3. Host adapter seam

公共 host `apply()` 只做：

1. trustedHosts / body limit 校验
2. gate backstop
3. 选择 profile
4. 通过 Loader 取得当前 runtime 的 connection module
5. 创建对应 `HostRuntime`
6. 注册 Web route、index global 和 attachments 检查
7. 输出固定 warning

### 3.1 `legacy-web` adapter

`legacy-web-v1` 保留：

- 0.1.2 `HostConnectionService` 核心方法
- `/api` prefix route
- 全量 buffered bridge
- 0.1.2 official client factory

### 3.2 `carrier-neutral` adapter

`carrier-neutral-v2` 负责：

- 通过 `ctx.loader.internal.import('@deepseek-ai/dsh-client-connection')` 使用当前 runtime module
- 要求 handler 提供 `requestBodyMode()`
- 支持 exact `/api/...` POST Fetch route 和 streaming body
- 在 replacement instance 上把 `rpc.handle()` 的 physical route owner 绑定到有 `webServer` 的 carrier context，修复 0.1.5 公开的 405 回归
- 注入 profile global 与 recovery global
- 不修改官方包源码、不修改系统服务、不把所有版本的 `inject` 改成并集

该 adapter 的 register seam 是针对 0.1.5 契约的局部兼容层，不是对 DSH 本体的永久 monkey patch；未来上游修复后，应以源码/实测/无副作用三条证据重新评估是否退役。

## 4. Client variant seam

`scripts/build-client-variants.mjs` 从两个 exact dev source 生成 dispatcher：

| Profile | Source | Dispatcher 选择 |
| --- | --- | --- |
| `legacy-web-v1` | `@deepseek-ai/dsh-client-connection@0.1.2-rc.1/client` | profile global = `legacy-web-v1` |
| `carrier-neutral-v2` | `@deepseek-ai/dsh-client-connection@0.1.5-rc.1/client` | profile global = `carrier-neutral-v2` |

构建和测试要求：

- 两个官方 wrapper 各自做 anchor 检查。
- 最终只注册 `@iasiv5/dsh-skip-browser-auth` 一个 ModuleLoader id。
- 缺失/未知 profile 直接抛错，不 fallback 到其它 variant。
- 两个 factory 分别 materialize；external require、`inject`、`apply` 和 recovery global 分别验证。
- 0.1.2 client 不能作为 0.1.5 client 的替代证明。

## 5. 新版本进入流程

### 5.1 加入已有 profile

只有以下条件全部满足，才可把新版本对追加到既有 `pairs`：

1. runtime/connection 的 host 入口、构造器、`requestRejection`、`createSharedFetchHandler`、route/body contract 与该 profile 完全一致。
2. 现有 host adapter 无需分支即可正确工作。
3. 现有 client variant 的 bundle 与 browser boot/global contract 完全一致。
4. pnpm/npm 两种布局、v1/v2 resolver、path/manifest drift 测试通过。
5. 真实 npm package fixture 和对应组合测试通过。
6. 真实 DSH 版本完成 active checklist，记录状态码、warning 和卸载恢复。

### 5.2 新增 profile

若出现以下任一差异，必须新增 profile：

- `inject` 或 DI topology 改变
- HostConnectionService 构造器/公开方法或 owner 语义改变
- route kind/method/body mode 改变
- BrowserAuth stub 消费方法改变
- client bundle 需要新 global、recovery、external 或 ModuleLoader 形状
- 官方 release/issue 证明旧 adapter 会产生 4xx、405、静默 route 丢失或错误身份行为

新增 profile 的顺序：

1. 在 `src/compatibility.ts` 增加新 profile/pair，先设为 `candidate`。
2. 新建 host adapter 和 client variant；公共 `apply()` 不添加版本分支。
3. 增加真实 package fixture、gate/DI/route/body/client 测试。
4. 通过全量组合与真实部署验证后，将 profile 改为 `active`。
5. 更新 README、CONTEXT、DESIGN、本文件和版本矩阵。

### 5.3 审计记录：`0.1.5-rc.2` 加入 `carrier-neutral-v2`（2026-09-10）

结论：**rc.2 通过 §5.1 全部条件，作为新 pair 加入既有代际**，未新增 adapter/client variant。

审计方法：从 npm 拉取四个锚点包的 `0.1.5-rc.1` 与 `0.1.5-rc.2` tarball 做 `diff -r` 逐字节对比：

| 包 | rc.1 → rc.2 代码差异 |
| --- | --- |
| `@deepseek-ai/dsh`（runtime 本体，探针第一锚点） | 无（仅 package.json version/依赖区间 bump） |
| `@deepseek-ai/dsh-client-connection`（被替换对象 + client variant 源） | 无（仅 package.json bump；`lib/`、`client/` 逐字节一致） |
| `@deepseek-ai/dsh-host-webserver`（DI/web carrier 契约） | 无（仅 package.json version bump） |
| `@deepseek-ai/dsh-web-app`（浏览器壳） | 无（仅 package.json bump） |

即 `0.1.5-rc.2` 是 rc.1 的**依赖版本对齐重发布**：§5.1 的第 1–3 条（host 入口/构造器/`requestRejection`/`createSharedFetchHandler`/route/body 契约、adapter 无分支、client bundle 契约）由逐字节一致直接满足；第 4–5 条由本轮新增测试满足：

- gate 探针/profile 解析：rc.2 精确对正例；`rc.1 runtime + rc.2 connection` 同代际跨 patch 混合负例（必须 dormant）。
- 真实 npm fixture：`install-rc15-fixture.mjs` 追加 `*-rc152` 别名（真实 `0.1.5-rc.2` 包），`tests/composition/active-rc152.test.mjs` 用真实 rc.2 包复刻 full active checklist（host/client/RPC/streaming Fetch/trust fence），并断言跨 patch 混合 dormant。

第 6 条（真实 DSH `0.1.5-rc.2` 宿主 active checklist）待宿主升级后按 DESIGN 清单执行。

## 6. 当前验证状态

已通过：

- profile exact pair、mixed pair、unknown pair、path/manifest drift、npm/pnpm fallback
- 0.1.2 legacy active composition
- 0.1.5 真实 npm package carrier-neutral composition
- 0.1.5-rc.2 真实 npm package carrier-neutral composition（含跨 patch 混合 dormant，见 §5.3）
- 0.1.5 `connection.rpc.handle()` dedicated channel 不再返回 405
- 0.1.5 exact `/api` streaming Fetch route
- 0.1.5 recovery/profile index globals
- rc2 dormant 基线
- 两个官方 client factory materialization 和 unknown profile fail-closed
- `npm run test:all`：双代际全量测试通过；真实机器 pnpm layout 检查按当前环境条件跳过。

尚未宣称：

- 在真实运行 DSH `0.1.5-rc.1` 服务上的 active 部署结果。该验证应按 `docs/DESIGN.md` active checklist 执行并记录。
- 在真实运行 DSH `0.1.5-rc.2` 服务上的 active 部署结果（升级宿主后按同一清单执行）。
