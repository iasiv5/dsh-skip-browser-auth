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
    hostProfiles: ['web'],
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
    hostProfiles: ['web'],
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
- `hostProfiles`：允许激活的宿主 profile 集合，当前恒为 `['web']`（web-only）；探针表达式与 apply backstop 双层校验，语义见 §7。

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

`scripts/build-client-variants.mjs` 从各 exact dev source 生成 dispatcher：

| Profile | Source | Dispatcher 选择 |
| --- | --- | --- |
| `legacy-web-v1` | `@deepseek-ai/dsh-client-connection@0.1.2-rc.1/client` | profile global = `legacy-web-v1` |
| `carrier-neutral-v2` | `@deepseek-ai/dsh-client-connection@0.1.5-rc.1/client` | profile global = `carrier-neutral-v2` |
| `carrier-neutral-v3` | `@deepseek-ai/dsh-client-connection@0.1.7-rc.2/client` | profile global = `carrier-neutral-v3`（服务 v3 全部 pair，见 §5.5） |

构建和测试要求：

- 两个官方 wrapper 各自做 anchor 检查。
- 最终只注册 `@iasiv5/dsh-skip-browser-auth` 一个 ModuleLoader id。
- 缺失/未知 profile 直接抛错，不 fallback 到其它 variant。
- 两个 factory 分别 materialize；external require、`inject`、`apply` 和 recovery global 分别验证。
- 0.1.2 client 不能作为 0.1.5 client 的替代证明。

## 5. 新版本进入流程

> 自动化辅助（2026-09-29 起）：`npm run audit-candidate -- <candidate-version>`
> （`scripts/audit-candidate.mjs`）以白名单最新 pair 为基准，拉取 8 个锚点包的
> 两版 tarball 逐字节对比并判级 `RE-PUBLISH` / `REPUBLISH-WITH-REVIEW` /
> `CONTRACT-CHANGED`（含 web-app connection 行截取对比与 runtime chunk 重命名的
> loader seam 抽查）。它只覆盖 §5.1 第 1–3 条的机器可判部分，并打印建议 pair
> 片段；第 4–6 条（gate/混合负例、真实 fixture 组合测试、实机 active checklist）
> 仍必须人工完成。判级依据与本节各审计记录的人工判据一致。

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

### 5.4 审计记录：`0.1.7-rc.2` 新增 `carrier-neutral-v3`（2026-09-26）

结论：**`0.1.7-rc.2` 是真实契约变化而非重发布，按 §5.2 新增 profile `carrier-neutral-v3`、host adapter `carrier-neutral-017` 与 client variant `rc17`**，未改动既有代际。

审计方法：从 npm 拉取四个锚点包的 `0.1.5-rc.2` 与 `0.1.7-rc.2` tarball 做 `diff -r` 逐包对比（四包全部有真实代码差异，直接排除 §5.1 加入既有代际的可能），再对 connection 包 `lib/index.js` 做逐行对照。与插件相关的契约差异：

| 维度 | `0.1.5-rc.2` | `0.1.7-rc.2` | v3 适配 |
| --- | --- | --- | --- |
| `HostConnectionService` 构造器 | `(ctx, trustedHosts, browserAuth)` | 相同 | 沿用 runtime module 实例化 |
| 准入 | `requestRejection(req)` | 新增 `admit(req)` → `{peer}`/`{rejection}`；内部经新依赖 `dsh-scope` 建 `OperatorPeer`，作为 RPC handler 第 4 参传入 | route 改走 `admit()`；peer 语义由 runtime module 自带 |
| 共享 `/api` route | `bridge()` 直调 | `webCtx.waterfall('connection/request', req, res, next)` 包裹 bridge（listener 可否决/改写请求） | adapter 复刻 waterfall；经真实组合测试断言 sibling 插件监听器可见、403 拒绝不进瀑布 |
| `register(owner, channel, handler)` | `owner.effect(() => owner.webServer.register(route))` | 结构相同 | v2 的 405 修复（register owner 绑定到有 webServer 的 ctx）原样保留 |
| BrowserAuth 消费 | `authenticatedUrl` 重写 pathname `/`；token 清理 303 → `/` | mount-preserving：保留 mount；303 → `./` | trusted-auth stub 新增 `mount-preserving` 语义，由 profile 显式选择（v1/v2 保持 `root`） |
| RPC 响应 | JSON | 可携带 attachments（multipart），在 `rpcFetchHandler` 内部 | 对插件透明 |
| 浏览器 client | 221KB bundle | 重写为 59KB；ModuleLoader 提取锚点各恰出现 1 次；globals 仍为 `__DSH_CONNECTION_RECOVERY__` + `__DSH_TRANSPORT__`（均可选）；无外部 require | 新 client variant `rc17` 机械提取，dispatcher 显式选择 |
| `dsh-host-webserver` | — | 仅注释级 diff | 无 |
| 官方 connection 行（web-app patch） | `id/name/inject:[webRuntime]/config` | 逐字段一致 | 行绑定 patch 结构不变 |
| cordis / loader | 4.0.2 / 1.0.3 | 4.0.4 / 1.0.5；`waterfall` 两版同实现；loader internal v1/v2 `resolveSync` 契约逐字一致 | gate 双签名处理仍有效；devDeps cordis 升 4.0.4 以满足 rc17 peer `~4.0.4` 并保持单一实例 |

新增测试（§5.2 第 3 步）：

- `tests/composition/active-rc17.test.mjs`：真实 npm `0.1.7-rc.2` 三包组合——行状态、index profile marker + recovery global、303 `./`、dedicated RPC 200（405 回归）+ OperatorPeer 第 4 参、streaming Fetch route、`connection/request` 瀑布对 sibling 可见且仅覆盖共享 `/api`（与官方一致）、evil host 403、双向跨代际混合 dormant。
- `tests/composition/npm-flat-rc17.test.mjs`：npm 扁平布局（dshm 形态）manifest 回退激活。
- `tests/gate.test.mjs`：`0.1.7-rc.2` 精确对正例与跨代际混合负例。
- `tests/trusted-auth.test.mjs`：`mount-preserving` 语义（303 `./`、URL 保留 mount、栅栏行为不变）。
- `tests/host-apply.test.mjs`：direct 上下文 pinned 0.1.2 模块缺 `admit()` 时 fail loud（不猜测、不降级）。
- `tests/manifest.test.mjs`：rc17 dev-only 别名不变量。

第 4 条（布局/resolver/drift 测试）由全量 `npm run test:all`（新增 `test:rc17-fixture`）覆盖。第 5–6 条（真实部署 active checklist + 回滚演练）已于 2026-09-26 在本机 `0.1.7-rc.2` 宿主完成，记录见 `docs/DESIGN.md` 实机验证一节。

### 5.5 审计记录：`0.1.7-rc.1` 加入 `carrier-neutral-v3`（2026-09-26）

结论：**rc.1 通过 §5.1 全部条件，作为新 pair 加入既有代际**，未新增 adapter/client variant。

审计方法：从 npm 拉取锚点包的 `0.1.7-rc.1` 与 `0.1.7-rc.2` tarball 做 `diff -r` 逐字节对比。除 §5.3/§5.4 的四个锚点包外，本轮额外覆盖 `dsh-scope`（`admit()`/OperatorPeer 的实现来源）、`dsh-host-frontend-static` 与 boot 层 `dsh-app-boot`：

| 包 | rc.1 → rc.2 代码差异 |
| --- | --- |
| `@deepseek-ai/dsh-client-connection`（被替换对象 + client variant 源） | 无（仅 package.json 版本/依赖区间 bump；`lib/`、`client/` 逐字节一致） |
| `@deepseek-ai/dsh-host-webserver`（DI/web carrier 契约） | 无（仅 package.json bump） |
| `@deepseek-ai/dsh-scope`（`admit()`/OperatorPeer 来源） | 无（仅 package.json bump） |
| `@deepseek-ai/dsh-host-frontend-static` | 无（仅 package.json bump） |
| `@deepseek-ai/dsh-web-app`（浏览器壳 + 官方 patch） | `cordis.patch.yml` 仅**新增行**（`time-context`/`schedule`/`shortcuts`/`ui-shortcuts`）与 schedule 注释改写；`connection` 行（`id/name/inject/config`）逐字段一致；package.json 为依赖 bump 与新增包（schedule、time-context、shortcuts 等） |
| `@deepseek-ai/dsh`（runtime 本体，探针第一锚点） | 有 diff 但语义无关：`bin.js`/`profile-boot.js` 仅 chunk 哈希重命名的 import 引用；重命名 chunk 逐一配对对比——**plugin chunk（ModuleLoader，gate 依赖的 loader seam 所在）逐字节一致**，profile-boot chunk 新增 `reportSkippedBundles` 调用（纯诊断，见下行），dump-config chunk 为 CLI 内部签名调整 |
| `@deepseek-ai/dsh-app-boot`（boot 层，profile patch 读取） | 有 diff 但语义无关：skipped-bundle 从「边加载边打印」重构为「收集进 `profile.skippedBundles`、由 launcher 一次性打印」（加载与 patch 应用语义不变）；`OPTIONAL_BUNDLES` 追加 experimental 包；resolver 错误消息格式化。`readProfilePatches`/`loadOverlayPatches` 契约不变 |

即 `0.1.7-rc.2` 相对 rc.1 是「插件契约面上的等价重发布 + 无关诊断演进」：§5.1 第 1–3 条（host 入口/构造器/`admit()`/`createSharedFetchHandler`/route/body 契约、adapter 无分支、client bundle 契约）由逐字节一致与 connection 行逐字段一致直接满足；rc17 client variant 以 profile id 单一来源同时服务两个 pair。第 4–5 条由本轮新增测试满足：

- gate 探针/profile 解析：rc.1 精确对正例；`0.1.7-rc.1 runtime + 0.1.7-rc.2 connection` 及反向**同代际跨 patch 混合负例**（必须 dormant）；`0.1.5-rc.2 ↔ 0.1.7-rc.1` 跨代际混合负例。
- 真实 npm fixture：`install-rc17-fixture.mjs` 追加 `*-rc171` 别名（真实 `0.1.7-rc.1` 包），`tests/composition/active-rc171.test.mjs` 用真实 rc.1 包复刻 full active checklist（行状态、index profile marker + recovery global、mount-preserving 303 `./`、dedicated RPC 200 + OperatorPeer 第 4 参、waterfall 对 sibling 可见且 403 不进瀑布、streaming Fetch route），并断言同代际跨 patch 双向 dormant 与跨代际 dormant。
- `tests/composition/npm-flat-rc17.test.mjs` 追加 rc.1 manifest 回退激活用例（dshm npm 扁平形态）。
- `tests/manifest.test.mjs`：rc171 保持 fixture-only 别名——不进 dependencies，也不进 devDependencies（client variant 构建锚点保持 rc17 单一来源，避免出现第二个 0.1.7 构建输入）。

第 6 条（真实 DSH `0.1.7-rc.1` 宿主 active checklist）待宿主运行 rc.1 时按 DESIGN 清单执行；本机宿主为 `0.1.7-rc.2`，其 checklist 已完成（§5.4）。

### 5.6 审计记录：`0.2.0-rc.1` 加入 `carrier-neutral-v3`（2026-09-29）

结论：**`0.2.0-rc.1` 通过 §5.1 全部条件，作为新 pair 加入既有代际**，未新增 adapter/client variant。虽然 semver 上是跨 minor（0.1.7 → 0.2.0），但代际由契约决定而非版本号：审计显示它在插件契约面上是 `0.1.7-rc.2` 的**依赖对齐重发布**，与 §5.3（`0.1.5-rc.2`）同类。

审计方法：从 npm 拉取锚点包的 `0.1.7-rc.2` 与 `0.2.0-rc.1` tarball 做 `diff -r` 逐包对比（锚点集合同 §5.5）：

| 包 | 0.1.7-rc.2 → 0.2.0-rc.1 代码差异 |
| --- | --- |
| `@deepseek-ai/dsh-client-connection`（被替换对象 + client variant 源） | 无（仅 package.json 版本/依赖区间 bump；`lib/`、`client/` 逐字节一致） |
| `@deepseek-ai/dsh-host-webserver`（DI/web carrier 契约） | 无（仅 package.json version bump） |
| `@deepseek-ai/dsh-scope`（`admit()`/OperatorPeer 来源） | 无（仅 package.json 版本/依赖区间 bump） |
| `@deepseek-ai/dsh-invariants` | 无（仅 package.json version bump） |
| `@deepseek-ai/dsh-host-frontend-static` | 无（仅 package.json 版本/依赖区间 bump） |
| `@deepseek-ai/dsh`（runtime 本体，探针第一锚点） | 无 `lib` 代码 diff（`diff -rq` 仅 package.json 不同）：全量依赖区间 bump 0.1.7-rc.2 → 0.2.0-rc.1、键重排、新增 `dsh-experimental-schedule-bundle`；ModuleLoader chunk 因此逐字节一致 |
| `@deepseek-ai/dsh-app-boot`（boot 层，profile patch 读取） | `lib/index.js` 仅一行：`OPTIONAL_BUNDLES` 追加 `@deepseek-ai/dsh-experimental-schedule-bundle`；`readProfilePatches`/`loadOverlayPatches` 契约不变（与 §5.5 同类的 OPTIONAL_BUNDLES 演进） |
| `@deepseek-ai/dsh-web-app`（浏览器壳 + 官方 patch） | `cordis.patch.yml` 仅增删 telemetry/product-analytics/schedule/session-log 行，**`connection` 行逐字段一致**（id/name/inject/config 未动）；package.json 为依赖 bump 与包进出（`dsh-client-product-analytics`、`dsh-host-product-telemetry-otel`、`dsh-client-ui-settings-session-log` 进，`dsh-schedule`/`dsh-time-context`/`dsh-client-ui-schedule` 出），均不涉及 connection 行 |

即 `0.2.0-rc.1` 相对 `0.1.7-rc.2` 是「插件契约面上的等价重发布 + 无关遥测/日程演进」：§5.1 第 1–3 条（host 入口/构造器/`admit()`/`createSharedFetchHandler`/route/body 契约、adapter 无分支、client bundle 契约）由逐字节一致与 connection 行逐字段一致直接满足；rc17 client variant 继续以 profile id 单一来源服务全部三个 pair。第 4–5 条由本轮新增测试满足：

- gate 探针/profile 解析：`0.2.0-rc.1` 精确对正例；`0.1.7-rc.2 runtime + 0.2.0-rc.1 connection` 及反向**同代际跨 minor 混合负例**（必须 dormant）；`0.1.5-rc.2 ↔ 0.2.0-rc.1` 跨代际混合负例。
- 真实 npm fixture：`install-rc17-fixture.mjs` 追加 `*-rc20` 别名（真实 `0.2.0-rc.1` 包），`tests/composition/active-rc20.test.mjs` 用真实 0.2.0-rc.1 包复刻 full active checklist（行状态、index profile marker + recovery global、mount-preserving 303 `./`、dedicated RPC 200 + OperatorPeer 第 4 参、waterfall 对 sibling 可见且 403 不进瀑布、streaming Fetch route），并断言跨 minor 混合双向 dormant。
- `tests/composition/npm-flat-rc17.test.mjs` 追加 0.2.0-rc.1 manifest 回退激活用例（dshm npm 扁平形态）。
- `tests/manifest.test.mjs`：rc20 保持 fixture-only 别名——不进 dependencies，也不进 devDependencies（client variant 构建锚点保持 rc17 单一来源，避免出现第二个 0.1.x/0.2.x 构建输入）。

第 6 条（真实 DSH `0.2.0-rc.1` 宿主 active checklist）待宿主升级后按 DESIGN 清单执行；本机宿主当前仍为 `0.1.7-rc.2`（其 checklist 已完成，§5.4）。

### 5.7 审计记录：`0.2.0-rc.2` 加入 `carrier-neutral-v3`（2026-09-29）

结论：**`0.2.0-rc.2` 通过 §5.1 全部条件，作为新 pair 加入既有代际**，未新增 adapter/client variant。

审计方法：从 npm 拉取锚点包的 `0.2.0-rc.1` 与 `0.2.0-rc.2` tarball 做 `diff -rq` 逐包对比（锚点集合同 §5.5/§5.6）：

| 包 | rc.1 → rc.2 代码差异 |
| --- | --- |
| `@deepseek-ai/dsh-client-connection`（被替换对象 + client variant 源） | 无（仅 package.json bump；`lib/`、`client/` 逐字节一致） |
| `@deepseek-ai/dsh-host-webserver`（DI/web carrier 契约） | 无（仅 package.json bump） |
| `@deepseek-ai/dsh-scope`（`admit()`/OperatorPeer 来源） | 无（仅 package.json bump） |
| `@deepseek-ai/dsh-invariants` | 无（仅 package.json bump） |
| `@deepseek-ai/dsh-host-frontend-static` | 无（仅 package.json bump） |
| `@deepseek-ai/dsh-app-boot`（boot 层，profile patch 读取） | 无（仅 package.json bump） |
| `@deepseek-ai/dsh-web-app`（浏览器壳 + 官方 patch） | 无代码 diff（仅 package.json bump）——`cordis.patch.yml` 逐字节一致，`connection` 行原样 |
| `@deepseek-ai/dsh`（runtime 本体，探针第一锚点） | 有 diff 但语义无关：`lib/bin.js` 与 `lib/types/{args,bin,plugin}.d.ts` 为 **Desktop 保留 profile 的插件管理 CLI** 演进（`manageDesktopProfile`、`runProfilePnpm`、`requireDesktopProfile`、`withFileLock`）；ModuleLoader chunk 哈希重命名（`plugin-DkYIj96-` → `plugin-BGnVfe_D`），全部 34 行变更落在上述 CLI 区，对 `resolveSync` 的用法逐行一致（vendor loader seam 零变化）；`package.json` 为全量依赖区间 bump；README* 为文档 |

即 `0.2.0-rc.2` 相对 `0.2.0-rc.1` 是「插件契约面上的等价重发布 + 无关 Desktop CLI 演进」：§5.1 第 1–3 条（host 入口/构造器/`admit()`/`createSharedFetchHandler`/route/body 契约、adapter 无分支、client bundle 契约）由逐字节一致、connection 行逐字段一致与 loader seam 零变化直接满足；rc17 client variant 继续以 profile id 单一来源服务全部四个 pair。第 4–5 条由本轮新增测试满足：

- gate 探针/profile 解析：`0.2.0-rc.2` 精确对正例；`0.2.0-rc.1 runtime + 0.2.0-rc.2 connection` 及反向**同代际跨 patch 混合负例**（必须 dormant）；`0.1.7 ↔ 0.2.0-rc.2` 跨 minor 混合与 `0.1.5 ↔ 0.2.0-rc.2` 跨代际混合负例。
- 真实 npm fixture：`install-rc17-fixture.mjs` 追加 `*-rc202` 别名（真实 `0.2.0-rc.2` 包），`tests/composition/active-rc202.test.mjs` 用真实 rc.2 包复刻 full active checklist（行状态、index profile marker + recovery global、mount-preserving 303 `./`、dedicated RPC 200 + OperatorPeer 第 4 参、waterfall 对 sibling 可见且 403 不进瀑布、streaming Fetch route），并断言同代际跨 patch 混合双向 dormant。
- `tests/composition/npm-flat-rc17.test.mjs` 追加 0.2.0-rc.2 manifest 回退激活用例（dshm npm 扁平形态）。
- `tests/manifest.test.mjs`：rc202 保持 fixture-only 别名——不进 dependencies，也不进 devDependencies（client variant 构建锚点保持 rc17 单一来源）。

第 6 条（真实 DSH `0.2.0-rc.2` 宿主 active checklist）随本机宿主当日升级（0.2.0-rc.1 → 0.2.0-rc.2）按 DESIGN 清单执行并留档。

## 6. 当前验证状态

已通过：

- profile exact pair、mixed pair、unknown pair、path/manifest drift、npm/pnpm fallback
- 0.1.2 legacy active composition
- 0.1.5 真实 npm package carrier-neutral composition
- 0.1.5-rc.2 真实 npm package carrier-neutral composition（含跨 patch 混合 dormant，见 §5.3）
- 0.1.5 `connection.rpc.handle()` dedicated channel 不再返回 405
- 0.1.5 exact `/api` streaming Fetch route
- 0.1.5 recovery/profile index globals
- 0.1.7-rc.2 真实 npm package carrier-neutral-v3 composition（§5.4：admit/OperatorPeer、waterfall、303 `./`、dedicated RPC 非 405、双向跨代际混合 dormant、npm flat 布局）
- 0.1.7-rc.1 真实 npm package carrier-neutral-v3 composition（§5.5：full active checklist、同代际跨 patch 混合双向 dormant、跨代际 dormant、npm flat 布局）
- 0.2.0-rc.1 真实 npm package carrier-neutral-v3 composition（§5.6：full active checklist、跨 minor 混合双向 dormant、跨代际 dormant、npm flat 布局）
- 0.2.0-rc.2 真实 npm package carrier-neutral-v3 composition（§5.7：full active checklist、同代际跨 patch 混合双向 dormant、npm flat 布局）
- rc2 dormant 基线
- 三个官方 client factory materialization 和 unknown profile fail-closed
- `npm run test:all`：三代际全量测试通过；真实机器 pnpm layout 检查按当前环境条件跳过。
- 真实 DSH `0.1.7-rc.2` 宿主 active checklist + 卸载回滚演练（2026-09-26，见 `docs/DESIGN.md`）。
- 真实 DSH `0.2.0-rc.1` 宿主 active checklist（2026-09-29：宿主当日运行 rc.1，`/` 200、BrowserAuth skipped 横幅在案）。
- host profile 门控（§7）：desktop 桩包在场 + 白名单 pair ⇒ 组合级整体休眠；desktop-host 查询抛错/空值/怪值按包不存在处理（web 继续）。

尚未宣称：

- 在真实运行 DSH `0.1.5-rc.1` 服务上的 active 部署结果。该验证应按 `docs/DESIGN.md` active checklist 执行并记录。
- 在真实运行 DSH `0.1.5-rc.2` 服务上的 active 部署结果（升级宿主后按同一清单执行）。
- 在真实运行 DSH `0.1.7-rc.1` 服务上的 active 部署结果（宿主运行 rc.1 时按同一清单执行）。
- 在真实运行 DSH `0.2.0-rc.2` 服务上的 active 部署结果（宿主已于 2026-09-29 升级 rc.2；本插件 0.3.5 装机后按 DESIGN 清单执行并回填本节）。

已知无关问题（非本插件职责，记录备查）：同宿主上第三方插件对 0.1.7 的不适配——`dsh-auth` 的 `/auth/login` 在 edge 请求下因 `ctx.settings.get()`（其源码自注的 rc.1 shim）对 0.1.7 settings API 抛 TypeError；`modsearch` 报 `scope.settings.register is not a function`（同一 settings API 变化）；`copilot-authorization` 与官方 `dsh-authorization` 服务重名冲突。定性依据：dsh-auth 代码不依赖 connection 服务（登录页渲染路径无 connection 消费）；该 TypeError 首次出现于 2026-09-26 宿主升级 0.1.7 之后，与本插件激活无关（升级后至插件激活前 `/auth/login` 零访问，TypeError 首次触发于插件激活 51 秒后的 edge 请求，与同 boot 的 modsearch/settings 报错同源）。未做卸载态下的 edge 复现差分。

## 7. Host profile policy

> 2026-10-07 定稿（任务书 §0-§4 + 实机实测）。决策不重开；本节是 host profile 维度的唯一权威记录处。

### 7.1 判定依据

desktop 上 Electron 启动自带 token ⇒ 插件收益趋零；desktop 无版本审计、无实机 active checklist；插件经 dsh-m 公开分发且 agent 是第一安装群体 ⇒ 需要代码级护栏而非文档约定。**拦「激活」不拦「安装」**：desktop 上可装、但必须休眠（dormant，非 fail-loud、非市场层拒装）。

### 7.2 信号与语义（0.3.8 三重判别，default-deny）

设计公理（0.3.6 事故后确立，跨 Windows/macOS/Linux 全平台生效）：**激活需要正向 web 证明，休眠不需要理由**——误激活 desktop ⇒ 宿主不可启动；误休眠 web ⇒ 回到 token 输入且一分钟可定位（know-how 016 判别法）。伤害不对称 ⇒ 举证责任在激活侧。

| # | 判别 | 信号 | 命中判定 |
| --- | --- | --- | --- |
| ① | desktop 否决 | `resolveSync(ctx.baseUrl, 'dsh-desktop-host/package.json')` 得合法 `{url: string}`（表达式层内联 + `detectHostProfile()` 镜像）。**注意平台差异**：该包不可达时，web 机 resolver 返回 null，desktop 机 resolver **抛错**（真机探针实证）——两平台都要落到「非 desktop」分支 | desktop ⇒ 休眠 |
| ② | desktop 否决 | 宿主进程 `process.argv` 含 `dsh-desktop-host`（desktop 宿主以 `[execPath, dsh-desktop-host/lib/index.js, <dsh>, <profileDir>, …]` 启动；与官方 dsh-plugin-manager `isPackagedDesktopArgv` 同款 launcher fact） | desktop ⇒ 休眠 |
| ②′ | desktop 否决 | `ctx.baseUrl` 目录基名（大小写归一）=== `desktop`——desktop 客户端恒以 profiles/desktop 槽位启动 loader（官方 `desktopProfileDirFromArgv` 契约），**进程树形状无关**（0.3.8 事故形态：宿主以纯 node 子进程跑 loader，argv/execPath 双双落空） | desktop ⇒ 休眠 |
| ③ | web 证明 | 宿主二进制 `process.execPath` 基名（大小写归一）∈ {node, node.exe, nodejs, nodejs.exe}——Windows/macOS/Linux web 全形态（systemd/docker/nvm/fnm/volta/mise/直接 node）经解释器 exec 后恒为 node 系二进制；desktop 宿主（Electron run-as-node）恒非 node 系 | 不成立 ⇒ desktop ⇒ 休眠 |

判定式：①∨②′∨② 命中 或 ③ 不成立 ⇒ desktop（休眠）；全否 ⇒ web，继续版本对判定。**实现纪律（0.3.11 事故教训）：每个信号必须独立 try/catch——信号①在 desktop 上的 throw 绝不允许跳过其余信号**。resolver 缺失 ⇒ 探针 `null`（休眠）。检测异常的 fail-closed 兜底是版本对判定本身：真异常时双锚点同样解析失败 ⇒ `null`。

### 7.3 fail-closed 语义（双层）

- 探针层（表达式）：desktop ⇒ `GATE_PROFILE_EXPRESSION` 为 `null`（由白名单表条目 `hostProfiles: ['web']` 条件统一拒绝，策略单一来源 `src/compatibility.ts`）⇒ 官方行 enabled、trusted 行 disabled、apply 不运行——安静休眠，与未知版本对同形态（判别法见 know-how 016）。
- backstop 层（`assertGateBackstop`）：desktop ⇒ fail loud，完整文案 `@iasiv5/dsh-skip-browser-auth: desktop profile not supported; disable or uninstall the plugin (@deepseek-ai/dsh-desktop-host present)`——仅防「patch 激活但不应激活」的绕过态。**0.3.12 起本分支由 apply 前置判别承接（desktop ⇒ 静默休眠 no-op，见 §7.8），正常不可达，保留为纵深防御**。

### 7.4 残余风险与事故记录（书面化）

- **【事故 2026-10-07/08，两阶段缺陷，已修复于 0.3.10；探针/crash log 实证 2026-10-08】**
  - 宿主架构（探针实证）：desktop 宿主为多进程树——Electron main → ChildProcess（dsh-desktop-host/lib/index.js，**loader 与插件在此进程内**，Electron run-as-node，node 24.18.1）；信号①的 desktop-host 包在 app.asar 内、自 profile baseUrl **不可达**（THROW: Cannot find package）；信号②（argv[1] 恒含 dsh-desktop-host）、信号②′（baseUrl 槽位=desktop）、信号③（execPath 为 Electron exe 非 node）在该进程**全部成立**。
  - ① 0.3.6：仅凭信号①误判 web ⇒ 激活 ⇒ "Desktop Host authentication failed"。
  - ② 0.3.8/0.3.9：宿主侧判别已正确休眠，但**客户端半区**漏修——休眠时宿主仍注入 client bundle 且不注入 profile global，client dispatcher 读缺失 global 直接 throw ⇒ 客户端启动链断裂 ⇒ dsh-desktop-host 读 `undefined.authenticatedUrl`（crash-2026-10-07T17-11-31 / 17-35-15 host.log 实证，两版签名一致）。
  - **0.3.10 修复 = 客户端 dispatcher 休眠静默 no-op（绝不 throw、绝不猜测变体）**；宿主侧三信号 + 槽位判别保留。
  - 教训：**休眠必须全链路静默（宿主行、客户端 bundle、配置表达式），任何半区的 throw 都可能炸宿主；desktop 实机验证前置为该维度变更的发布门禁（0.3.10 起执行）**。
- desktop 未来若移除/改名信号包 ⇒ 信号①失效，但②②′③仍在 ⇒ 仍休眠（①自 0.3.8 起已非唯一判据）。
- **【事件 2026-10-11，非崩溃、报错风暴，收编于 0.3.12（§7.8）】**：desktop 上用户层 patch 按行 id 写 `- id: trusted-connection  disabled: false`（dsh-m 插件开关 / `dsh plugin add` enable 通道的标准产物，2026-10-11 Windows 实机实录）合法覆盖自门控 `!!js` disabled 表达式 ⇒ 行强制 active、apply 被调 ⇒ 0.3.11 及以前 backstop fail loud，且每次任意插件开关触发热重载都弹 `desktop profile not supported`。教训：**组合期门控可被用户层合法覆盖，不承担语义；apply 内判定才是权威**；良态强制启用必须静默休眠而非报错。
- 对偶风险（web 侧反向污染）：web profile 下第三方插件经 hoisted 抬升携带 `@deepseek-ai/dsh-desktop-host` 依赖（gate.ts 头注记载的同类抬升遮蔽机制）⇒ 信号①误真 ⇒ 本插件安静休眠——方向 fail-closed，最坏损失是本插件不工作，无安全暴露；且信号③（web 宿主为 node 二进制）不受抬升影响，仍为独立兜底。本仓库自身不可能引入该包：manifest 不变量（红线：dependencies 禁止任何 `@deepseek-ai` 包）+ `tests/manifest.test.mjs` 看护。
- desktop runtime 版本对（如 0.2.0-rc.2）与 web 白名单共享 ⇒ 判别信号失效时存在误激活暴露。兜底：任何新 runtime 版本进入白名单前必须走 §5.1 审计流程（届时必然重审 desktop 形态）+ 下述解冻条件。

### 7.5 解冻条件（本次不实现）

同时满足才允许把 `'desktop'` 加入 hostProfiles：

1. 出现真实 desktop 需求；
2. desktop 信号 + fixture 全套验证；
3. desktop 实机 checklist（无 token `GET /` 401→200、伪造 Host → 403、`/?token=x` → 303、卸载后官方行为原样恢复）+ 暴露模型书面化（回环绑定 + 本机进程可信度假设）。基线形态见 `docs/DESKTOP-DORMANT-CHECKLIST.md`。

### 7.6 实机事实（2026-10-07）

- desktop runtime 0.2.0-rc.2（`dsh --version` 与 runtime.json `desktopVersion` 双证）；Desktop Web GUI 以 127.0.0.1:19387 仅回环绑定（netstat 实证）。
- BrowserAuth 激活中：无 token `GET /` → 401；伪造 Host → 401（休眠态无栅栏，401 即正确，勿误判）。
- `app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/` 存在（堆栈实证）；web runtime 树无此包（web 机 `ls ~/.dsh/profiles/node_modules/@deepseek-ai/ | grep -c "dsh-desktop-host$"` = 0，2026-10-07 复核）。
- fixture 层实测补充：rc202 官方组合休眠态在最小 fixture 下 `/`、`/api/*` 均为 404 空体（0.2.0 代际 frontend-static 走 registerFallback + authorizeIndex(BrowserAuth)，无凭据最小环境不服务索引；webserver 默认 404 空体，与 0.1.1-rc.2 代际的 `'not found'` 文本体不同），见 `tests/composition/desktop-dormant.test.mjs` 注释。

### 7.7 实机状态（发版后回填）

- web 0.2.0-rc.2 升级零回归断言（历版全过）：0.3.6（2026-10-07 22:44）、0.3.8（2026-10-08 01:41）、0.3.9（01:41 修复版）、0.3.10（02:23）、0.3.11（10:23:24 重启后横幅逐字输出、无 token `GET /` 200、伪造 Host 403、`/?token=x` 303 `location: ./`）；web profile 预检 `grep -c "dsh-desktop-host$"` = 0。
- desktop dormant 基线断言（0.3.11）：**已通过（2026-10-08，Windows 实机）**——安装 0.3.11 后 Desktop 正常启动（不再崩溃）、无 "BrowserAuth has been skipped" 横幅、休眠态无 token 访问 401×2 符合预期、GUI 与 agent 会话正常。0.3.6-0.3.10 在 desktop 均无法启动（§7.4 事故），desktop 用户请使用 0.3.11+。

### 7.8 运行时权威休眠（0.3.12，用户层 pin 覆盖收编）

- **分层语义**：组合期 `!!js` 表达式 = 优化（避免无谓 apply；可被用户层 id-pin 合法覆盖——dsh-m 开关 / `dsh plugin add` enable 通道的标准产物，见 §7.4 事件 2026-10-11——因此不承担语义）；**apply 内宿主判别 = 唯一权威**。
- **apply 结构（0.3.12）**：① 最前置 `detectHostProfile()`（resolver 允许 undefined，信号①自行消化；槽位/argv/execPath 信号不依赖 resolver）——desktop ⇒ 固定文案 `desktop host detected — dormant by design (web-only plugin); official connection untouched. Safe to uninstall.` + return（零 throw、零配置校验、零副作用）；② web 路径照旧：配置校验 → backstop 四类契约破坏 fail loud。backstop 内的 desktop throw 保留为纵深防御（正常不可达）。
- **不变量**：desktop 激活三关不减（镜像判 web ∧ 白名单 pair ∧ binding 完好）；官方 connection 行表达式、client 半区（0.3.10 inert no-op）、web 全路径零改动；新增路径仅纯函数判定 + 一行 `console.warn`，无文件/网络/服务操作。
- **§7.4 四类历史模式预演（2026-10-11 会话留档）**：①2026-09-10 apply-throw 崩溃循环——desktop 分支零 throw，不回归；②0.3.6 组合期误判——激活三关未减，镜像判对时 no-op 优于 throw（throw→行失败→官方行若已被误禁→connection 缺失，两版同等，0.3.12 不恶化）；③0.3.8/0.3.9 client 半区——0.3.10 已修，pinned 态不注入 global ⇒ client 走同一 inert 路径，与实机 PASS 的休眠基线运行时同态；④0.3.11 信号控制流——不触碰 `detectHostProfile`/表达式，每信号独立 try/catch 原样。
- **desktop 实机 checklist 新增断言（0.3.12 起）**：pin 态（`disabled: false` 在用户层在场）下 dsh-m 开关任意插件零报错横幅、日志恰一行 dormant 通知、Desktop 正常启动。
