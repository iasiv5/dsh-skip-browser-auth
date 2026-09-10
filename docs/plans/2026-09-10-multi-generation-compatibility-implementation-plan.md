# dsh-skip-browser-auth 兼容代际分支实施计划

## 目标

- 在不把不同运行时契约误归为同一兼容组的前提下，支持 DSH `0.1.2-rc.1` 与 `0.1.5-rc.1`。
- 将兼容性单一事实源从单纯的版本字符串列表升级为 compatibility profile：每个 profile 绑定完整的 runtime/connection 版本对、host adapter、client variant、路由/请求体契约和验证状态。
- 保留 fail-closed：未知版本、混合版本对、未实现 profile、解析异常和 profile 配置不一致都不能激活 Replacement。
- 为未来第三、第四代兼容性预留稳定 seam：同一契约的新版本只需加入已有 profile 的版本对；出现 API/运行时契约变化时新增 profile、host adapter 和 client variant，不修改旧 profile 的行为。
- 只有在 0.1.5 的 host、RPC route、request body、client bundle 和真实组合验证完成后，才把 `0.1.5-rc.1` 从 candidate 标记为 active；不能把“版本被探针识别”写成“真实兼容已验证”。
- 同步升级 README、`CONTEXT.md`、`docs/DESIGN.md`，并新增兼容性审计说明，记录 0.1.2/0.1.5 的 API 差异、profile 选择规则、未来新增代际的流程和当前验证边界。

## GitHub 兼容性审计结论

`0.1.5-rc.1` **不能直接与 `0.1.2-rc.1` 共用当前实现**，不是只追加一个版本字符串即可解决的兼容性变化。

### 已确认的差异

1. `packages/client/connection/src/index.ts`：
   - `0.1.2-rc.1` 的官方 Connection 行声明 `inject = ['webServer', 'credentials']`，在 `apply()` 中直接注册 `/api`。
   - `0.1.5-rc.1` 改为 carrier-neutral：Connection 行只注入 `credentials`，Host carrier 通过 `ctx.inject(['webServer'], ...)` 延迟挂载；同时新增 recovery 配置和 `__DSH_CONNECTION_RECOVERY__` 页面全局。
2. `packages/client/connection/src/rpc-host.ts` / `src/rpc.ts`：
   - 0.1.5 增加 exact Fetch route 的 `POST` 支持、`requestBody` 和 `ConnectionFetchHandler.requestBodyMode()`；0.1.2 的 handler 只有统一 buffered bridge 语义。
   - 0.1.5 的 `HostConnectionService` 仍提供同名核心方法，但 route/body carrier 契约已经变化。
3. 0.1.5 存在已公开报告的真实回归：`connection.rpc.handle()` 因 Connection 自身 context 没有 `webServer` 注入而抛出 `cannot get property "webServer" without inject`，浏览器侧 dedicated RPC 落到静态 fallback 并返回 HTTP 405。该问题见 [Discussion #6105](https://github.com/deepseek-ai/deepseek-harness/discussions/6105) 与独立复现 [Discussion #6111](https://github.com/deepseek-ai/deepseek-harness/discussions/6111)。
4. 0.1.5 浏览器 client 源码新增 recovery config/global 读取，不能把当前只从 0.1.2 re-ID 的 `lib/client.js` 当作 0.1.5 client 产物。
5. 官方发布说明明确 0.1.5 引入 Session V3、Session lifecycle、插件 Agent/Inbox/Web panel API 等开发者变化；完整变更见 [v0.1.5-rc.1 release notes](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1) 和 [v0.1.2-rc.1...v0.1.5-rc.1 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.2-rc.1...dsh-v0.1.5-rc.1)。官方 connection 源码可直接对照：[0.1.2 index.ts](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-rc.1/packages/client/connection/src/index.ts)、[0.1.5 index.ts](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.5-rc.1/packages/client/connection/src/index.ts)、[0.1.2 rpc-host.ts](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-rc.1/packages/client/connection/src/rpc-host.ts)、[0.1.5 rpc-host.ts](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.5-rc.1/packages/client/connection/src/rpc-host.ts)。

### 结论对当前插件的影响

当前插件的 `src/index.ts`、`src/bridge.ts` 和 `scripts/build.mjs` 都以 0.1.2 为实现基准。直接把 `0.1.5-rc.1` 加到同一个 `GATE_VERSIONS` 会产生“门控通过、实现契约错误”的风险：host 可能启动但 `connection.rpc.handle` 返回 405，client bundle 缺失 recovery global，或 exact POST/body 语义被旧 bridge 吞掉。因此本计划不采用“单数组 + 单实现”方案。

## 架构快照

### Profile 是单一事实源

新建 `src/compatibility.ts`，以完整版本对而不是独立 `includes()` 为匹配单位：

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
    pairs: [{ runtime: '0.1.5-rc.1', connection: '0.1.5-rc.1' }],
    hostAdapter: 'carrier-neutral',
    clientVariant: 'rc15',
    requiresRecoveryGlobal: true,
    status: 'candidate',
  },
] as const
```

实际类型应保持小而深：profile 提供选择结果和契约元数据，调用方不需要知道每一代的 route、bridge 和 bundle 细节。未来同一兼容代的版本只扩展 `pairs`；新的 API 变化新增 profile 和 adapter，不能用运行时猜测把新版本降级到旧 adapter。

### Gate 返回 profile，而不只是 boolean

`src/gate.ts` 生成两层表达式：

- `GATE_PROFILE_EXPRESSION`：从两个锚点 manifest/路径段解析完整 runtime/connection 版本对，返回 profile id 或 `null`。
- `GATE_PROBE_EXPRESSION`：`GATE_PROFILE_EXPRESSION !== null`，供官方 `connection` 行的 `disabled` 使用。
- `GATE_ROW_ALLOWED_EXPRESSION`：继续校验同组 sibling、官方行 name/id、官方行 effective disabled，并内嵌 profile probe。

`cordis.patch.yml` 的插件行配置同时传递 `compatibilityProfile: !!js <GATE_PROFILE_EXPRESSION>`。禁止用“runtime 在列表内且 connection 在列表内”的独立判断；`0.1.2 + 0.1.5` 必须 dormant。

### Host adapter seam

公共 `apply()` 只负责配置校验、读取 profile、选择 adapter、安装 index global、注册生命周期和输出固定 warning。具体差异藏在两个 adapter 后面：

- `legacy-web`：保留 0.1.2 的 webServer prefix `/api`、旧 bridge 和旧版 HostConnectionService 调用契约。
- `carrier-neutral`：通过 runtime loader 取得当前 0.1.5 connection module；显式验证 carrier、支持 `requestBodyMode`/exact POST route、保证 `connection.rpc.handle` 的 owner context 能解析 webServer，并处理 0.1.5 recovery global。不能把官方 0.1.5 的 `inject` 与插件替代行的注入集合机械合并。

两个 adapter 都使用相同的 trusted auth、request trust fence、固定 warning 和 `/api` 认证跳过语义；差异只存在于 runtime module 加载、carrier route 注册和 body bridge。

### Client variant dispatcher

当前构建只 re-ID 0.1.2 client。新构建产出一个显式 profile dispatcher：

- 内嵌/生成 0.1.2 官方 client factory，re-ID 为插件名。
- 内嵌/生成 0.1.5 官方 client factory，re-ID 为插件名。
- dispatcher 读取 host adapter 通过 `webserver/index-inject` 注入的固定 global `__DSH_SKIP_BROWSER_AUTH_PROFILE__`，只允许已知 profile id；缺失或未知 profile 直接抛错，不猜测。
- `carrier-neutral-v2` 同时注入 `__DSH_CONNECTION_RECOVERY__` 的受控配置；legacy client 不依赖该 global。
- 两个 factory 各自通过 materialization、external 依赖和浏览器 boot 组合测试，不能用 0.1.2 bundle 冒充 0.1.5。

## 全局约束

- 精确匹配完整版本对；禁止 `>=`、范围、`latest`、`0.1.x` 前缀和能力猜测。
- profile 未实现、status 不是 active、版本对未知、anchor 缺失或 profile config 被篡改时 fail-closed；host backstop 发现 product loader/internal/current entry 单边缺失时 fail loud，并且必须早于服务、route、warning。
- 0.1.2 与 0.1.5 的 adapter、client variant 和测试不可 cross-call；新版本不得 fallback 到旧 adapter。
- 继续使用 runtime fallback 解析官方包；插件 `dependencies` 不携带任何 `@deepseek-ai` runtime 包。为构建 0.1.5 client 而增加的 alias 只能是 devDependency，不能进入发布清单。
- 0.1.5 adapter 若需要 webServer 作为 HTTP carrier，必须在 adapter 内明确声明、验证并测试；不能以修改全局 `inject` 并集掩盖 carrier-neutral 契约。
- 保留 Host/Origin/Fetch Metadata/trustedHosts 信任栅栏，不把 405 翻译、重试或吞成成功；错误路由/方法必须按对应 profile 的预期状态处理。
- host 源码相对 import 使用 `.js`；构建流程继续 `tsc → patch generation → client variants`；`cordis.patch.yml` 只能由脚本生成。
- Node `^22.19.0 || >=24`、ESM、Node 内置 test runner、固定启动 warning、不创建 3080 服务、不修改 systemd/反代均保持不变。
- 文档必须区分“代码 profile 已实现/组合测试通过”和“真实 DSH 0.1.5 部署已验证”；没有真实部署证据不能写成已完成实机兼容。

## 输入工件

- GitHub 兼容性证据：[v0.1.5 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)、[compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.2-rc.1...dsh-v0.1.5-rc.1)、[#6105](https://github.com/deepseek-ai/deepseek-harness/discussions/6105)、[#6111](https://github.com/deepseek-ai/deepseek-harness/discussions/6111)。
- 当前术语与插件边界：`CONTEXT.md`。
- 当前 gate/host/build：`src/gate.ts`、`src/index.ts`、`src/bridge.ts`、`scripts/build.mjs`、`scripts/write-patch.mjs`、`cordis.patch.yml`。
- 当前测试矩阵：`tests/gate.test.mjs`、`tests/host-apply.test.mjs`、`tests/patch.test.mjs`、`tests/composition/`、`tests/client-materialize.test.mjs`。
- 历史实现计划 `docs/plans/2026-09-04-dsh-skip-browser-auth-implementation-plan.md` 保留为历史记录，不在本次重写。

## 文件结构与职责

- Create: `src/compatibility.ts` — profile 数据、完整版本对匹配、profile id/adapter/client variant 类型和安全选择函数。
- Create: `src/connection-runtime.ts` — 从当前产品 loader 取得官方 connection module；无 loader 的直接单元测试才允许使用 pinned fallback。
- Create: `src/adapters/legacy-web.ts` — 0.1.2 host runtime adapter。
- Create: `src/adapters/carrier-neutral.ts` — 0.1.5 host runtime adapter，含 carrier、body mode 和 recovery global 适配。
- Modify: `src/gate.ts` — 由 profiles 生成 profile probe、boolean probe 和 row gate expression。
- Modify: `src/index.ts` — profile config/backstop、adapter 选择、index global、统一生命周期与 warning。
- Modify: `src/bridge.ts` — 支持 legacy buffered handler 与 carrier-neutral `requestBodyMode`/streaming handler 的最小共同接口。
- Modify: `scripts/write-patch.mjs` — 生成 profile config，并在头注释写明 pair matching 与 fail-closed。
- Modify/possibly create: `scripts/build.mjs`、`scripts/build-client-variants.mjs` — 分别读取两个 pinned official client bundle，生成显式 dispatcher。
- Regenerate: `cordis.patch.yml` — 只由 build 生成。
- Modify: `package.json`、`package-lock.json` — 加入 0.1.5 client 构建 alias 为 devDependency，更新 description；不加入 runtime dependency、不改变插件自身版本号。
- Create: `scripts/install-rc15-fixture.mjs` — 以 alias、`--package-lock=false` 安装 0.1.5 组合测试产物并证明 manifest/lockfile 不变。
- Modify: `tests/gate.test.mjs`、`tests/helpers/gate-fixture.mjs`、`tests/patch.test.mjs` — profile/pair gate。
- Modify: `tests/bridge.test.mjs`、`tests/host-apply.test.mjs` —两个 adapter 的 route/body/backstop/DI 行为。
- Modify/Create: `tests/adapters/*.test.mjs`、`tests/composition/*.test.mjs`、`tests/helpers/compose.mjs`、`tests/fixtures/rpc-probe.mjs` —真实 0.1.2/0.1.5 module 组合和 `rpc.handle` 405 回归。
- Modify: `tests/artifacts.test.mjs`、`tests/client-materialize.test.mjs` —两个 client variant 和 dispatcher。
- Create: `docs/COMPATIBILITY.md` — GitHub 审计结论、profile matrix、API 差异、升级/新增代际流程、验证状态。
- Modify: `README.md`、`CONTEXT.md`、`docs/DESIGN.md` —用户说明、术语、详版机制和运维清单。
- Verify: `lib/` 继续忽略；发布包不包含 `src/`、`tests/`、`docs/` 和 fixture alias。

## 任务清单

### Task 1: 建立 profile 数据模型并替换单值 gate

- 目标：让探针匹配完整 runtime/connection 版本对并返回 profile id，拒绝混合版本。
- 涉及文件：`src/compatibility.ts`、`src/gate.ts`、`tests/gate.test.mjs`、`tests/helpers/gate-fixture.mjs`、`tests/manifest.test.mjs`。
- 接口契约
  - Consumes: 当前双锚点路径段/manifest 回退、`GATE_ANCHOR_PACKAGES`、Loader v1/v2 resolver。
  - Produces: `COMPATIBILITY_PROFILES`、`resolveProfile(runtimeVersion, connectionVersion)`、`GATE_PROFILE_EXPRESSION`、`GATE_PROBE_EXPRESSION`；Task 2、Task 3、patch generator 直接消费。
- 验证范围：两个 active/candidate profile 的 exact pair、反向混合 pair、未列版本、manifest/path drift、npm/pnpm、异常 fail-closed。

- [x] Step 1: 先写失败测试：断言两个 profile 的 exact pair；`0.1.2 + 0.1.5`、`0.1.5 + 0.1.2`、未知 pair 都返回 `null/false`；两个 anchor 解析失败和 malformed manifest 仍 dormant。
- Run: `npm test`
- Expected: 当前没有 `COMPATIBILITY_PROFILES`/profile expression，或旧单值 gate 对混合/0.1.5 行为无法满足新断言而失败。
- [x] Step 2: 实现 profile 数据和表达式：profile 以 `pairs` 为匹配键；gate expression 内嵌 profile pair 表，先得到两个 anchor 实际版本，再返回唯一 profile id；保留路径段优先级、manifest fallback、v1/v2 调用和异常 catch。
- Run: `npm run build && npm run typecheck && npm test`
- Expected: 0.1.2 pair 能识别，0.1.5 pair 能识别，混合/未知/解析异常全部 dormant；现有 gate 回归通过。
- [x] Step 3: 更新 patch 结构测试的预期接口（不手改生成文件），为插件行增加 `compatibilityProfile: !!js <GATE_PROFILE_EXPRESSION>`。
- Run: `npm run build && git diff --exit-code cordis.patch.yml && npm test`
- Expected: patch 生成幂等，官方行 disabled 仍使用 boolean probe，插件行携带 profile id 表达式。

### Task 2: 抽出 host runtime loader 与两个 adapter

- 目标：把旧版 prefix bridge 与 0.1.5 carrier-neutral/body-mode 语义隔离到 profile adapter，修复 0.1.5 `rpc.handle` 405 风险。
- 涉及文件：`src/connection-runtime.ts`、`src/adapters/legacy-web.ts`、`src/adapters/carrier-neutral.ts`、`src/index.ts`、`src/bridge.ts`、`tests/bridge.test.mjs`、`tests/host-apply.test.mjs`、`tests/adapters/*.test.mjs`。
- 接口契约
  - Consumes: Task 1 的 profile id 与版本 pair；runtime loader 的 `internal.import('@deepseek-ai/dsh-client-connection')`；现有 trusted auth/trust fence/attachments 逻辑。
  - Produces: `HostAdapter`/`HostRuntime` 内部 seam；legacy 与 carrier-neutral 各自的 `createRuntime`、`registerRoutes`、`handleRequest`、index global 安装；profile mismatch/backstop fail loud。
- 验证范围：0.1.2 旧行为全绿；0.1.5 实际 module 的 carrier-neutral 组合、`connection.rpc.handle` 非 405、exact POST/body mode、teardown 和安全栅栏。

- [x] Step 1: 写失败测试：
  - 0.1.5 actual module fixture 下，通过一个 probe plugin 调用 `ctx.connection.rpc.handle('/probe', handler)`，POST `/probe/x` 不能落到 405；
  - 0.1.5 exact Fetch route 使用 `requestBody: 'streaming'` 时 body 可到达 handler；
  - 0.1.2 仍使用 prefix `/api` 与 legacy bridge；
  - runtime/connection pair 与 `compatibilityProfile` 不一致时 apply 在 route/service/warning 之前拒绝。
- Run: `npm test`
- Expected: 当前单一 0.1.2 static import/bridge 无法加载 actual 0.1.5 module，或 0.1.5 probe 返回 405/body 语义错误。
- [x] Step 2: 实现 runtime loader 和 adapter seam：产品上下文优先从 `ctx.loader.internal.import` 取得当前 runtime connection module；仅无 loader 的直接单元测试使用 pinned fallback。legacy adapter 保留旧 prefix/bridge；carrier-neutral adapter 显式使用 0.1.5 HostConnectionService、web carrier 注入、requestBodyMode 和 exact POST，并安装 profile/recovery globals。不得在 adapter 选择失败时 fallback 到 legacy。
- [x] Step 3: 扩展 `src/bridge.ts`：对 legacy handler 缺少 `requestBodyMode` 时保持 buffered；对 carrier-neutral handler 调用 `requestBodyMode({ method, url })`，支持 buffered/streaming、413、abort、backpressure 和 response teardown；不吞 handler 错误。
- Run: `npm run build && npm run typecheck && npm test`
- Expected: 两个 adapter 测试通过；0.1.5 valid `rpc.handle` 不再 405，wrong method/path 和 body limit 状态明确，0.1.2 旧行为无回归。

### Task 3: 构建并选择两个官方 client variant

- 目标：禁止 rc1 client 冒充 rc15，为两个 profile 生成可验证的官方 client factory，并让 host 注入的 profile id 显式选择 variant。
- 涉及文件：`package.json`、`package-lock.json`、`scripts/build.mjs`、`scripts/build-client-variants.mjs`（新建或从 build 拆出）、`tests/artifacts.test.mjs`、`tests/client-materialize.test.mjs`、`src/adapters/carrier-neutral.ts`。
- 接口契约
  - Consumes: Task 1 的 profile id/clientVariant；官方 `@deepseek-ai/dsh-client-connection` 0.1.2 client 与 exact 0.1.5 client；webserver index-inject global。
  - Produces: `lib/client.js` 单一显式 dispatcher；两个 profile factory 的 registration/materialization；0.1.5 recovery global 的注入与消费。
- 验证范围：wrapper、re-ID、两个 factory external 依赖、profile 缺失/未知拒绝、legacy/rc15 client boot 形状。

- [x] Step 1: 增加失败检查：为 0.1.5 exact client 添加 dev-only alias，测试分别加载 profile `legacy-web-v1` 与 `carrier-neutral-v2`；断言生成产物包含两个 variant 的唯一 registration 逻辑，0.1.2 bundle 不能作为 rc15 唯一实现。
- Run: `npm test`
- Expected: 当前 build 只生成 0.1.2 re-ID bundle，无法通过 rc15 variant/materialization 断言。
- [x] Step 2: 实现 dispatcher：分别验证两个官方 wrapper 的 anchor，抽取/封装 factory，生成 `window.__ModuleLoader__.load({ id: '@iasiv5/dsh-skip-browser-auth', factory })`；factory 根据 `globalThis.__DSH_SKIP_BROWSER_AUTH_PROFILE__` 选择已知 variant，缺失/未知直接抛错；不使用 heuristic fallback。
- [x] Step 3: 在 materialization 测试中分别运行两个 profile，验证 `inject`/`apply`、external require、recovery global；保留 NOTICE/MIT 产物断言。
- Run: `npm run build && npm run typecheck && npm test`
- Expected: 两个 variant 都能 factory materialize，未知 profile 失败，生成 wrapper 只注册插件 id，原官方 id 不残留。

### Task 4: 加入真实 0.1.5 fixture 与组合/浏览器矩阵

- 目标：用真实 npm 0.1.5 packages 验证 host/client，而不是只用伪造版本路径。
- 涉及文件：`scripts/install-rc15-fixture.mjs`、`tests/helpers/compose.mjs`、`tests/fixtures/rpc-probe.mjs`、`tests/composition/active.test.mjs`、`tests/composition/npm-flat.test.mjs`、`tests/composition/gate-binding.test.mjs`、`tests/composition/client-profile.test.mjs`（新建）、`tests/composition/rpc-channel.test.mjs`（新建）。
- 接口契约
  - Consumes: Task 1–3 的 profiles、adapters、dispatcher；真实 `@deepseek-ai/dsh-client-connection@0.1.5-rc.1`、`@deepseek-ai/dsh-host-frontend-static@0.1.5-rc.1` 等 fixture aliases。
  - Produces: actual 0.1.2 legacy profile 与 actual 0.1.5 carrier-neutral profile 的端到端证据；fixture 安装不改变 package manifest/lockfile。
- 验证范围：pnpm/npm layout、profile pair、DI、RPC 405 回归、exact POST/body mode、client boot、unload/dormant。

- [x] Step 1: 编写 rc15 fixture 脚本，以 `npm install --no-save --package-lock=false` 安装 alias，脚本结束用 `git diff --exit-code package.json package-lock.json` 证明清单不变；compose 支持按 profile 把 official connection module 映射到真实 rc15 alias。
- Run: `npm run test:rc15-fixture`
- Expected: 真实 0.1.5 fixture 安装成功，manifest/lockfile 无变化；网络/registry 失败时停止并报告，不用 synthetic fixture 冒充。
- [x] Step 2: 组合测试：
  - 0.1.2 pair：既有 active trusted-network、token 303、trust fence、legacy `/api`；
  - 0.1.5 pair：carrier-neutral host、profile global、0.1.5 client variant、valid `connection.rpc.handle` 非 405、exact POST/body mode、dispose；
  - 0.1.2+0.1.5 与 0.1.5+0.1.2：两行 dormant；
  - unknown/manifest drift/name mismatch/后续 patch 强制 disabled：dormant 或 backstop fail loud；
  - npm flat 两个 profile 都走 manifest fallback。
- Run: `npm run test:rc15-fixture && npm test`
- Expected: 两个 active profile 的真实组合全部通过；mixed/unknown 不激活；0.1.5 dedicated RPC 不返回 405。
- [x] Step 3: 浏览器 module graph/materialization：在 profile global 分别为 legacy/carrier-neutral 时运行生成 client wrapper，确认对应 variant 的 `apply` 注册、0.1.5 recovery config 被读取，错误 profile 不加载错误 factory。
- Run: `npm test -- tests/client-materialize.test.mjs tests/composition/client-profile.test.mjs`
- Expected: 两种 client boot 路径通过，外部依赖集合完整。

### Task 5: 升级 package metadata、README、兼容性与设计文档

- 目标：文档从“单一版本白名单”升级为“兼容代际 profile”，并如实记录 GitHub API 差异与验证状态。
- 涉及文件：`package.json`、`README.md`、`CONTEXT.md`、`docs/DESIGN.md`、`docs/COMPATIBILITY.md`。
- 接口契约
  - Consumes: Task 1–4 的 profile 表、adapter/client 行为、GitHub 证据与测试结果。
  - Produces: 用户可读版本矩阵、技术设计、术语定义、未来新增代际操作步骤；明确 0.1.5 不再共用 0.1.2 adapter/client。
- 验证范围：README/设计文档包含两个 profile、混合版本规则、405 根因/修复边界、真实验证状态和未来扩展流程；不把 synthetic/fixture 证据写成实机证据。

- [x] Step 1: 更新 `docs/COMPATIBILITY.md`：记录 GitHub release/source/discussion 链接、0.1.2 vs 0.1.5 差异表、profile 数据模型、版本 pair 匹配、host/client adapter seam、测试矩阵、未来新增 profile 的 checklist。
- [x] Step 2: 更新 `README.md`：安装说明、兼容矩阵、profile 选择、0.1.5 `connection.rpc.handle` 405 风险与插件 adapter 处理、固定安全 warning、active 验证命令、未知/未验证版本 dormant 规则。
- [x] Step 3: 更新 `CONTEXT.md` 与 `docs/DESIGN.md`：把 whitelist 术语改为“精确 profile/pair 集合”，记录同一代内部可扩展、跨代必须新 adapter/client、profile mismatch fail loud；更新 active checklist 标题以覆盖两个 profile。
- [x] Step 4: 更新 `package.json.description`，不修改插件自身 version；确认 `package-lock.json` 仅包含明确 dev alias 变更，不含 runtime `@deepseek-ai` dependency。
- Run: `node --input-type=module -e "import fs from 'node:fs'; for (const f of ['README.md','CONTEXT.md','docs/DESIGN.md','docs/COMPATIBILITY.md','package.json']) { const s=fs.readFileSync(f,'utf8'); for (const x of ['0.1.2-rc.1','0.1.5-rc.1','compatibility','profile']) if (!s.toLowerCase().includes(x.toLowerCase())) throw new Error(f+' missing '+x); }" && git diff --check`
- Expected: 文档均提及两个版本和 profile 机制；没有“两个版本共用一个 adapter/client”的错误表述；空白检查通过。

## 任务间接口契约

- Task 1 的 `COMPATIBILITY_PROFILES`/`resolveProfile()` 是唯一版本 pair 来源；Task 2、patch generator、Task 3 dispatcher 和文档矩阵不得重新维护版本字面量。
- Task 1 的 profile id 通过 patch config 传入 Task 2 host `apply()`，并由 Task 2 的 webserver index injection 传给 Task 3 client dispatcher；host 与 client 不能各自猜测版本。
- Task 2 的 `HostRuntime` 只向 `apply()` 暴露 request rejection、route/bridge 生命周期和 index globals；legacy/carrier-neutral 的内部 API 不泄漏到公共 apply。
- Task 3 的两个 client variant 必须共享相同 registration id 但由 profile global 选择；Task 4 负责证明选择与实际 host profile 对齐。
- Task 4 的真实组合结果决定 Task 5 文档中 0.1.5 的状态；如果真实 fixture 或 active E2E 未通过，文档必须保持 candidate/dormant，不得标 active。

## 执行纪律

- 开始实现前先批判性复查本计划；如果 profile 字段、adapter seam、client dispatcher 或真实 package 路径与仓库现实不一致，先修计划。
- 按 Task 1→5 顺序执行；每完成一个任务运行其验证，遇到依赖安装或 API 变化阻塞立即停下，不猜测放宽 gate。
- 仅修改 `/home/ubuntu/workspace/dsh-skip-browser-auth`；不修改工作区顶层无关改动、`~/.dsh/AGENTS.md`、systemd、反代或 3080 服务。
- 不发布 npm、不 push、不重启 DSH 服务；本次先交付 profile 分支实现、测试和文档。
- 每次改动后运行 `git diff --check`；不手工编辑 `cordis.patch.yml` 或提交 `lib/`。
- 在真实 0.1.5 部署不可用时，不能把 fixture 结果写成真实 active 实机验证；保留可执行的后续验证清单。

## 最终验证

在插件仓库目录执行：

1. `npm run test:rc15-fixture && npm run test:all`：真实 rc15 fixture、build、typecheck、全部 Node tests 通过；fixture 证明 package manifest/lockfile 没有被临时安装改写。
2. `rm -rf lib && npm run build && node --input-type=module -e "await import('./lib/host.js')"`：clean-build smoke 通过。
3. `git diff --exit-code cordis.patch.yml`：profile patch 生成幂等。
4. `npm pack --dry-run --json`：包含 host/client/patch/README/LICENSE/NOTICE，不包含 `src/`、`tests/`、`docs/`、fixture alias 目录。
5. `git diff --check` 与文档 profile/version assertion 通过。
6. `git status --short`：只出现本计划列出的源码、测试、生成 patch、package metadata、lockfile 和文档；`lib/` 不入 Git。
7. 真实 DSH `0.1.5-rc.1` active 验证若未执行，最终输出必须明确标注 candidate/待实机验证，不得宣称已完成兼容。

## 审阅 Checkpoint

由于 GitHub 审计确认 0.1.5 不是 0.1.2 的同一兼容组，原“单一版本列表”计划已改为本兼容代际分支计划，并保存到 `docs/plans/2026-09-10-multi-generation-compatibility-implementation-plan.md`。请先审阅这份修订计划；批准后再进入实现。

## 执行后勘误与完成记录（2026-09-10 收尾回填）

1. **Task 1–5 全部完成**：`npm run test:all` 107/107 通过（1 skip 为 gate.test.mjs 的 pnpm-only 真实布局检查，本机插件仓库是 npm 布局）；勾选框已按实际完成度回填。
2. **0.1.5 profile 晋级时点**：`carrier-neutral-v2` 在 host adapter（含 0.1.5 `rpc.handle` 405 修复）、rc15 client variant 与真实 npm fixture 组合测试全部通过后，从计划的 candidate 晋级为 active；真实 0.1.5 宿主部署验证仍未执行，README 与 docs/COMPATIBILITY.md 已如实标注「fixture 已验证、真实部署待清单确认」。
3. **Task 2 期间的崩溃事故**：`loadRuntimeConnectionModule` 先以单参调用 `loader.internal.import`（缺 baseUrl），21:57 修正为三参但 detached 调用丢 `this` 仍崩溃，最终由 Hermes 以 `importer.call(loader.internal, …)` bound 调用修复并完成服务端到端验证；全过程见 `docs/2026-09-10-crash-root-cause-and-fix-brief.md`（已结案留档）。回归固化：`tests/connection-runtime.test.mjs`（bound 三参契约 + fail-loud 防御）与 `tests/helpers/compose.mjs`（fake import 严格校验三参签名，杜绝同类签名 bug 漏测）。
4. **Task 3 兜底方式**：dispatcher 物料化用 `node:vm` 按 legacy/carrier-neutral 双 profile 加载测试 + 组合测试 index 注入 marker 兜底，未做真实浏览器组图 e2e（与计划「已知限制」一致）。
5. **Task 4 fixture 适配**：rc15 fixture 脚本最终同时保留 rc2 与 rc15 aliases（npm peer resolver 会在顺序安装时移除上一代），并以安装前后文件快照替代 `git diff --exit-code` 校验（工作树存在预期内 package metadata 改动）。
6. **计划外补充**：`tests/composition/active-rpc-legacy.test.mjs`（0.1.2 dedicated RPC 回归，证明 carrier-neutral 修复不破坏旧代际）。
