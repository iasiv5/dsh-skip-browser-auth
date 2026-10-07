# dsh-skip-browser-auth Host Profile 门控（web-only，desktop 休眠）实施计划

## 目标

给 `@iasiv5/dsh-skip-browser-auth`（当前 0.3.5，main @ b9acfe4）的 fail-closed 自门控增加
「宿主 profile（host profile）」维度并发布 0.3.6（版本号为 2026-10-07 主人改版，
替代任务书原拟 0.4.0）：

- 组合期探针：desktop 信号（`@deepseek-ai/dsh-desktop-host` 可解析出合法 URL）⇒ 探针为
  null ⇒ 官方 connection 行保持 enabled、trusted-connection 行 disabled、`apply()` 不运行
  （安静休眠，与未知版本对行为完全一致）；
- `apply()` backstop：desktop 信号存在 ⇒ fail-loud 拒绝运行（纵深防御，正常流程到不了）；
- web 侧现有全部 active 版本对（7 pair）行为零变化（硬性验收项）；
- 完成测试、GLOSSARY/README/COMPATIBILITY 文档、npm/dsh-m 文案同步、发版与双机装机验证。

设计来源：任务书（2026-10-07 定稿）+ grill-with-docs Round 1 共识（2026-10-07，全部按推荐采纳）。

## 已定稿决策（Round 1 共识，实施中不得重开）

1. 任务书 §3.3「`src/host.ts`」勘误为 **`src/index.ts`**（`apply`/`assertGateBackstop`
   所在；构建产物 `lib/host.js`，`package.json` main 指向它）。
2. **desktop 检测语义**（表达式层与 Node 镜像同语义）：
   - `internal.resolveSync` 解析 `@deepseek-ai/dsh-desktop-host/package.json` 得到合法
     `{url: string}` ⇒ **desktop**；
   - 抛错、返回 `null`/`undefined`、`url` 非字符串 ⇒ 视为「包不存在」⇒ **web 继续**
     （组合测试 fake 对未登记 specifier 正是返回 null；真实 v1 loader 类型允许 undefined）；
   - resolver 缺失（`internal` 或 `resolveSync` 不存在）⇒ 表达式层返回 null（休眠）；
   - fail-closed 兜底是后续版本对判定：真异常时双锚点同样解析失败 ⇒ null。
3. **策略表驱动**：每个 compatibility profile 增加 `hostProfiles: ['web']` 字段并随
   `GATE_PROFILE_TABLE` 嵌入表达式；表达式按
   `profile.hostProfiles.includes(检测值) && pair 命中` 放行。规则单一来源
   `src/compatibility.ts`，未来解冻 desktop 只改这一处。
4. **backstop 桌面检测**放 `assertGateBackstop` 的 presence 检查之后、锚点解析之前
   （保持「loader 与 entry 双缺 ⇒ 跳过」的纯单测豁免不被误杀），fail-loud 文案：
   `@iasiv5/dsh-skip-browser-auth: desktop profile not supported; disable or uninstall the plugin (@deepseek-ai/dsh-desktop-host present)`
   （任务书 §2.4 原句 `desktop profile not supported; disable or uninstall the plugin`
   为连续前缀子串，包名注解收尾）。`DESKTOP_HOST_PACKAGE` 常量与
   `detectHostProfile()` 放 `src/gate.ts`。
5. `resolveActiveCompatibilityProfile(runtime, connection, hostProfile)`：第三参**必填**；
   `hostProfile ∉ profile.hostProfiles` ⇒ 无匹配（fail-closed）；`directProfile`
   （无 loader 纯单测回退）显式按 `'web'` 处理并注释说明。
6. **desktop fixture**：compose/gate-fixture 手写桩包（opt-in 参数），配 0.2.0-rc.2
   真实 pair（恰好命中 carrier-neutral-v3 但必须整体休眠——正是 2026-10-07 desktop 实况）；
   回归范围 = 现有全矩阵不缩水（任务书「四对 active 版本对」按现状 7 pair 全量勘误）。
7. `docs/COMPATIBILITY.md` 新增**顶层 §7**「Host profile policy」（含残余风险段 + 解冻
   三条件），§2 数据模型补字段说明，§6 验证状态补一行；不重排被广泛引用的 §5.x。
8. `GLOSSARY.md`：新增 host profile 词条、dormant 触发列表补 desktop、澄清三种
   profile（DSH 安装 profile / compatibility profile / host profile）。
9. npm description 与 dsh-m registry 描述同步统一句式：
   `仅支持 web profile；desktop profile（存在 dsh-desktop-host 的环境）自动休眠，属设计行为。`
   `verified` 数组不动（只记 DSH 运行时版本）。
10. 分工：web 机（本机，DSH 0.2.0-rc.2）装机验证由实施 agent 执行；Windows desktop 机
    输出可复制验证提示词（沉淀为 `docs/DESKTOP-DORMANT-CHECKLIST.md`）；dsh-m push 前
    经主人确认。

## 架构快照

三层防线不变，只在第①②层各加一个前置维度：

```
第①道 补丁表达式（cordis.patch.yml，三处内嵌同一探针，机械生成）
      探针 = resolver 可用？ ⇒ desktop 信号检测 ⇒ 双锚点版本对 ⇒ 白名单表(pair + hostProfiles)
      desktop ⇒ hostProfile='desktop' ⇒ 无 profile 放行 ⇒ null（休眠）
      web ⇒ hostProfile='web' ⇒ 照旧 pair 判定（零变化）
      resolver 缺失/任何异常 ⇒ null（休眠）
      ├─ GATE_PROBE_EXPRESSION      = profile ∈ active 集合（自动继承 desktop 检测）
      ├─ config.compatibilityProfile = GATE_PROFILE_EXPRESSION（自动继承）
      └─ GATE_ROW_ALLOWED_EXPRESSION = 行绑定 ∧ GATE_PROBE_EXPRESSION（自动继承）
第②道 apply() backstop（src/index.ts assertGateBackstop）
      presence 检查 ⇒ [新增] detectHostProfile ⇒ desktop ? fail-loud : 继续锚点 manifest
      校验 ⇒ resolveActiveCompatibilityProfile(runtime, connection, hostProfile) ⇒ 行绑定
第③道 行绑定检查（不变）
```

单点修改传播路径：`src/gate.ts` 的 `GATE_PROFILE_EXPRESSION` 是唯一探针源常量，
`write-patch.mjs`（`npm run build` 自动执行）从 **lib/gate.js** 常量生成
`cordis.patch.yml`——改源常量一处，YAML 三处内嵌表达式全部再生。表达式环境约束不变：
`with(ctx) + eval` 单行、无 require、同步内建模块仅 `process.getBuiltinModule`
（desktop 检测不需要新增内建模块调用）。

## 全局约束（从任务书逐字继承）

1. 不改版本对白名单逻辑本身——本次纯增量 profile 维度；
2. fail-closed 方向不得反转：任何检测异常 ⇒ 探针层休眠 / backstop 层拒绝运行；
3. 禁止手改 cordis.patch.yml（机械生成物，由 `scripts/write-patch.mjs` 从 lib/gate.js 生成）；
4. 禁止引入任何 `@deepseek-ai` 运行时 dependencies（manifest 不变量，connection 包
   只允许出现在 devDependencies；desktop-host 信号只允许以测试桩包形式存在）；
5. 锚点/信号解析一律走 `ctx.loader.internal.resolveSync(ctx.baseUrl, ...)`（含 v1/v2
   两种调用形态）——不得用 fs 固定路径、环境变量等可被 profile 依赖抬升污染的信号；
6. web 侧全部 active 版本对行为零变化；
7. 一切对外文案不得声称支持 desktop；
8. 版本 **0.3.6**（主人 2026-10-07 改版，替代任务书 §6 原拟 0.4.0）：patch 号语义下
   `^0.3.x` 范围的机器常规 `pnpm update` 即得——desktop 休眠护栏随常规更新铺开
   （任务书原「需显式升级」的 0.4.0 理由不再适用，此为改版的自然结果，非缺陷）；
9. client bundle、`NOTICE`、`LICENSE` 不动；解冻条件（任务书 §4）本次只写入文档，不实现；
10. 测试环境：Linux（本仓库开发机），命令为 POSIX shell + npm；发布操作需 git push 与
    GitHub Actions 权限。

## 输入工件

- 任务书：`@iasiv5/dsh-skip-browser-auth 增加 Host Profile 门控（web-only，desktop 默认
  休眠）`（2026-10-07，含 §1 实测事实、§4 解冻条件、§5 红线、§6 发布验证、§7 市场同步）
- Round 1 共识：见上文「已定稿决策」
- know-how（`dsh-workspace/01_docs/dsh-intall-know-how/`）：016（休眠判别法）、
  018（OIDC staged 假绿/409）、020（desktop 装机通道）、008/022（registry 纪律）、014 §8

## 文件结构与职责

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `src/compatibility.ts` | 改 | 新增 `HostProfile` 类型；每个 profile 条目加 `hostProfiles: ['web']`；`GATE_PROFILE_TABLE` 嵌入该字段；`resolveActiveCompatibilityProfile` 增必填第三参并校验 |
| `src/gate.ts` | 改 | 新增 `DESKTOP_HOST_PACKAGE`、`GateResolverLike`、`detectHostProfile()`；`GATE_PROFILE_EXPRESSION` 源常量内联 desktop 检测 + hostProfiles 放行条件；头部注释补 host-profile 维度 |
| `src/index.ts` | 改 | `assertGateBackstop` 在 presence 检查后插入 desktop fail-loud；`resolveActiveCompatibilityProfile` 调用传 `hostProfile`；`directProfile` 补「按 web 处理」注释 |
| `scripts/write-patch.mjs` | 改 | 生成头注释补 host-profile 门控说明（补丁本体逻辑不变，表达式来自 lib 常量） |
| `cordis.patch.yml` | 再生 | 机械生成物；`npm run build` 自动再生成，禁止手改 |
| `tests/helpers/gate-fixture.mjs` | 改 | `writeGateFixtures` 增 `desktopHost` opt-in：写 desktop-host 桩包并登记 resolveSync URL |
| `tests/helpers/compose.mjs` | 改 | `compose` 增 `desktopHost` opt-in：`writeAnchorFixture('@deepseek-ai/dsh-desktop-host', …)` 并登记 fixtureUrls |
| `tests/gate.test.mjs` | 改 | 新增 host-profile 探针真值矩阵 4 例；常量测试扩 `DESKTOP_HOST_PACKAGE` + `hostProfiles` 断言 |
| `tests/host-apply.test.mjs` | 改 | 新增 backstop negative C：desktop 在场 fail-loud 且先于任何 route |
| `tests/patch.test.mjs` | 改 | 新增：生成 YAML 三处内嵌 desktop 门控；YAML 级表达式 desktop 在场时休眠 |
| `tests/composition/desktop-dormant.test.mjs` | 新 | 组合级 dormant 基线：desktop 桩包 + 真实 rc202 pair ⇒ 官方行活跃、插件行 disabled、无横幅、无插件 route |
| `tests/manifest.test.mjs` | 改 | 新增不变量：desktop-host 包永不进入 dependencies/devDependencies |
| `GLOSSARY.md` | 改 | host profile 词条、dormant 触发列表、三种 profile 澄清 |
| `README.md` | 改 | 机制与安全补宿主门控 bullet；兼容表加 desktop 行；安装提示词模板加一行；测试矩阵补 bullet |
| `docs/COMPATIBILITY.md` | 改 | §2 补 `hostProfiles`；§6 补已通过一行；新增 §7「Host profile policy」 |
| `docs/DESKTOP-DORMANT-CHECKLIST.md` | 新 | Windows desktop 机 dormant 基线验证提示词（复用于解冻条件③） |
| `package.json` | 改 | version 0.3.6；description 追加统一句式 |
| `CHANGELOG.md` | 改 | 新增 `[0.3.6]` 小节 |
| `dsh-m/registry.json`（独立仓库 `~/workspace/dsh-m/`） | 改 | `dsh-skip-browser-auth` 条目 description 追加统一句式；`verified` 不动 |

边界保持不变：`src/trusted-auth.ts`、`src/trust-fence.ts`、`src/bridge.ts`、
`src/connection-runtime.ts`、`src/adapters/*`、`scripts/build-client-variants.mjs`、
`scripts/build.mjs`（其内部已串联 tsc → write-patch → client 断言，无需改）。

## 任务清单

### Task 1: 建立绿色基线

**Files**: 无改动。

**Steps**:
1. `cd /home/ubuntu/workspace/dsh-skip-browser-auth`
2. `git status -sb` 确认干净（main @ b9acfe4）
3. `npm run test:all`（安装 rc2/rc15/rc17 真实 npm fixture → build → typecheck → 全部测试）

**验证**: `npm run test:all` 退出码 0。

**Produces**: 已安装的 rc202 系 fixture 别名（Task 5 组合测试依赖）。

### Task 2: 桌面检测失败测试先行（red）

**Files**: `tests/helpers/gate-fixture.mjs`、`tests/gate.test.mjs`、`tests/host-apply.test.mjs`。

**Steps**:
1. `tests/helpers/gate-fixture.mjs`：`writeGateFixtures` 参数增 `desktopHost = false`；
   为 true 时在同一 tmp root 内调用现成的 `writePackageFixture(tmp,
   '@deepseek-ai/dsh-desktop-host', { segmentVersion: '0.2.0-rc.2', manifestVersion:
   '0.2.0-rc.2', layout })`，并把 `urls['@deepseek-ai/dsh-desktop-host/package.json'] =
   <返回的 url>`。桩包 manifest 永远不会被读取（检测只看解析成功），版本值仅求真实感。
2. `tests/gate.test.mjs` 末尾追加 4 例（desktop specifier 在测试中**硬编码字符串**
   `@deepseek-ai/dsh-desktop-host/package.json`，不 import 尚不存在的常量）：
   - `desktop-host present on a whitelisted pair forces the probe dormant`：
     `writeGateFixtures(t, { desktopHost: true })`（pair 默认 0.1.2-rc.1 白名单）⇒
     `evaluateGate(probeCtx(urls)) === false` 且
     `evaluateWith(probeCtx(urls), GATE_PROFILE_EXPRESSION) === null`；
   - `desktop-host absent keeps web behavior (resolver returns null treated as absent)`：
     默认 fixtures（不传 desktopHost）⇒ `evaluateGate(probeCtx(urls)) === true`
     （把 Q2 语义「null ⇒ web」显式钉进命名用例）；
   - `desktop-host lookup throwing is treated as absent (web continues)`：包装
     `dispatchingResolveSync`，仅对 desktop specifier 抛错（v1/v2 双形态取 specifier：
     `typeof args[1] === 'object' ? args[1].specifier : args[0]`）⇒ probe 仍 true；
   - `desktop-host resolving to a non-string url is treated as absent`：同样包装，
     desktop specifier 返回 `{ url: 123 }` ⇒ probe 仍 true。
3. `tests/host-apply.test.mjs` 末尾追加 1 例：
   `backstop negative C: desktop host package present — fail loud before any route`：
   `writeGateFixtures(t, { desktopHost: true })` + `fakeLoader(urls)` +
   `fakeSelfWithRow()` + `ctx.provide('loader', …)` + `ctx.fiber = { entry: self }` ⇒
   `assert.rejects(apply(ctx, {}), /desktop profile not supported.*disable or uninstall the plugin/)`
   且 `routes.length === 0`。

**验证**: `node --test tests/gate.test.mjs tests/host-apply.test.mjs`
预期红绿分布（**精确到例，不得含糊**）：
- **红（2 例）**：`desktop-host present … forces the probe dormant`（现状探针无 desktop
  检测，白名单 pair 命中 ⇒ 得 true 而非 false/null）；`backstop negative C`（现状
  backstop 无 desktop 检测 ⇒ apply 成功而不抛错）；
- **绿（3 例 + 全部既有用例）**：absent / lookup-throwing / non-string-url 三例钉住的
  是「包不存在 ⇒ web 继续」的**现状正确行为**（Q2 语义回归护栏），现状即应通过；
  出现红名单之外的任何失败立即停下排查。

### Task 3: 核心实现（green）

**Files**: `src/compatibility.ts`、`src/gate.ts`、`src/index.ts`、`tests/gate.test.mjs`（常量断言扩展）。

**Steps**:
1. `src/compatibility.ts`：
   - `export type HostProfile = 'web' | 'desktop'`；
   - 三个 profile 条目各加 `hostProfiles: ['web'],`（数组字面量，随 `as const` 收窄）；
   - `GATE_PROFILE_TABLE` 改为 `COMPATIBILITY_PROFILES.map(({ id, pairs, hostProfiles }) => ({ id, pairs, hostProfiles }))`；
   - `resolveActiveCompatibilityProfile(runtimeVersion: unknown, connectionVersion: unknown,
     hostProfile: HostProfile)`：在现有 `status === 'active'` 判定上追加
     `(profile.hostProfiles as readonly string[]).includes(hostProfile)`
     （`as const` 元组对联合类型参数需此收窄，勿省略）。
2. `src/gate.ts`：
   - `export const DESKTOP_HOST_PACKAGE = '@deepseek-ai/dsh-desktop-host'`；
   - `export interface GateResolverLike { readonly version?: unknown; resolveSync(...args: unknown[]): { url?: unknown } | undefined }`；
   - `export function detectHostProfile(internal: GateResolverLike, baseUrl: string): HostProfile`：

     ```ts
     const specifier = `${DESKTOP_HOST_PACKAGE}/package.json`
     try {
       const resolved = internal.version === 'v2'
         ? internal.resolveSync(baseUrl, { specifier, attributes: {} })
         : internal.resolveSync(specifier, baseUrl, {})
       const url = (resolved as { url?: unknown } | null | undefined)?.url
       return typeof url === 'string' ? 'desktop' : 'web'
     } catch {
       return 'web'
     }
     ```

   - `GATE_PROFILE_EXPRESSION` 源常量：紧跟 `if (!internal || typeof
     internal.resolveSync !== 'function') return null;` 之后内联（单行、与锚点同款
     v1/v2 分支）：

     ```
     let hostProfile; try { const desktopSpecifier = '<DESKTOP_HOST_PACKAGE>/package.json'; const desktopResolved = internal.version === 'v2' ? internal.resolveSync(ctx.baseUrl, { specifier: desktopSpecifier, attributes: {} }) : internal.resolveSync(desktopSpecifier, ctx.baseUrl, {}); const desktopUrl = desktopResolved === null || typeof desktopResolved !== 'object' ? undefined : desktopResolved.url; hostProfile = typeof desktopUrl === 'string' ? 'desktop' : 'web'; } catch (hostError) { hostProfile = 'web'; }
     ```

     （`<DESKTOP_HOST_PACKAGE>` 处用 `JSON.stringify(DESKTOP_HOST_PACKAGE)` 内插，与
     锚点表同法；不设 desktop 提前返回——由下方 hostProfiles 条件统一放行，保持策略
     单一来源。）profile 循环条件改为
     `if (profile.hostProfiles.includes(hostProfile) && profile.pairs.some((pair) => pair.runtime === versions[0] && pair.connection === versions[1])) return profile.id;`
     （嵌入表 JSON 自然携带 `hostProfiles`）；
   - 头部长注释补一段 host-profile 维度说明（信号、四态语义、与版本对判定的先后与兜底
     关系）；`export` 块补 `DESKTOP_HOST_PACKAGE`、`detectHostProfile`、`HostProfile`
     再导出（类型定义在 compatibility.ts）；
   - `GATE_PROBE_EXPRESSION`、`GATE_ROW_ALLOWED_EXPRESSION` **不改**（内嵌继承）。
3. `src/index.ts`：
   - import 增 `DESKTOP_HOST_PACKAGE`、`detectHostProfile`、`type HostProfile`；
   - `assertGateBackstop`：在三个 presence throw 之后、`const versions` 循环之前插入：

     ```ts
     const hostProfile = detectHostProfile(internal, baseUrl)
     if (hostProfile === 'desktop') {
       throw new Error(`@iasiv5/dsh-skip-browser-auth: desktop profile not supported; disable or uninstall the plugin (${DESKTOP_HOST_PACKAGE} present)`)
     }
     ```

   - `resolveActiveCompatibilityProfile(versions[0], versions[1])` 改为
     `resolveActiveCompatibilityProfile(versions[0], versions[1], hostProfile)`；
   - `directProfile`：函数注释补一句「direct（无 loader）上下文仅存在于纯单测/dev 树，
     按 web 处理；desktop 判定需要 resolver，必然先经过 backstop fail loud」。逻辑不变。
4. `tests/gate.test.mjs` 常量测试扩展：import `DESKTOP_HOST_PACKAGE`，断言其值等于
   硬编码字符串；对 `COMPATIBILITY_PROFILES` 逐个断言 `[...profile.hostProfiles]` 深等于
   `['web']`。

**验证**:
```sh
npm run build && npm run typecheck
node --test tests/gate.test.mjs tests/host-apply.test.mjs
```
预期：build/typecheck 通过（`npm run build` 已内含 write-patch 再生，此时
`cordis.patch.yml` 随新常量变化，属预期，Task 4 处理其头注释与断言）；
Task 2 的 2 红例转绿；既有用例零回归。

### Task 4: 补丁再生成与结构断言

**Files**: `scripts/write-patch.mjs`、`cordis.patch.yml`（再生）、`tests/patch.test.mjs`。

**Steps**:
1. `scripts/write-patch.mjs` 的 `header` 数组在既有行后追加三行说明（示例）：
   `'# 宿主 profile 门控（web-only）：表达式先解析 @deepseek-ai/dsh-desktop-host/package.json，'`
   `'# 解析出合法 URL 即 desktop ⇒ 探针为 null（desktop 一律休眠，设计行为）；解析异常'`
   `'# 按包不存在处理（web 继续），兜底仍是完整版本对白名单（fail-closed）。'`
2. `npm run build` 再生 `cordis.patch.yml`；
3. `tests/patch.test.mjs` 追加 2 例：
   - `generated patch embeds the desktop-host gate in all three expressions`：
     原文 `readFileSync(patchPath, 'utf8')` 中 `@deepseek-ai/dsh-desktop-host` 出现次数
     `>= 3`（官方行 disabled、insert 行 config、insert 行 disabled 三处内嵌链）；
   - `patch expressions stay dormant when the desktop host package is present`：
     `writeGateFixtures(t, { desktopHost: true })` + `activeRowCtx({ options: { id: 'connection', name: CONNECTION_PACKAGE }, disabled: true }, urls)`
     （行对象用内联字面量，同 patch.test.mjs 既有写法——`officialRow()` helper 只在
     gate.test.mjs，本文件没有），断言：
     `evaluateWith(ctx, patchList[0].disabled.__jsExpr) === false`（探针为假）、
     `evaluateWith(ctx, patchList[1].insert[0].config.compatibilityProfile.__jsExpr) === null`、
     `evaluateWith(ctx, patchList[1].insert[0].disabled.__jsExpr) === true`
     （insert 行 disabled = `!(GATE_ROW_ALLOWED_EXPRESSION)`：desktop ⇒ 行绑定 false ⇒
     取反为 true，行被禁用——与组合断言 `trusted.disabled === true` 同向）。

**验证**:
```sh
npm run build && cp cordis.patch.yml /tmp/patch-a.yml && npm run build && diff -u /tmp/patch-a.yml cordis.patch.yml && echo IDEMPOTENT
node --test tests/patch.test.mjs
```
预期：两次 build 产物逐字节一致（IDEMPOTENT）；patch 测试全绿。
（`git diff --exit-code cordis.patch.yml` 留到 Task 10 提交后做终检。）

### Task 5: 组合级 desktop fixture 与 manifest 不变量

**Files**: `tests/helpers/compose.mjs`、`tests/composition/desktop-dormant.test.mjs`（新）、`tests/manifest.test.mjs`。

**Steps**:
1. `compose.mjs`：参数增 `desktopHost = false`；为 true 时
   `fixtureUrls['@deepseek-ai/dsh-desktop-host/package.json'] = await writeAnchorFixture('@deepseek-ai/dsh-desktop-host', '0.2.0-rc.2')`
   （`writeAnchorFixture` 的 short-name 切分对该包名天然适用）。
2. 新建 `tests/composition/desktop-dormant.test.mjs`，样板照抄 `rc2-dormant.test.mjs`
   （横幅捕获、fixture 依赖检查、行状态断言）+ `active-rc202.test.mjs` 的模块别名：
   - fixture 依赖检查：`dsh-client-connection-rc202`/`frontend-static-rc202`/
     `webserver-rc202` 导入失败 ⇒ `assert.fail('先运行 npm run test:rc17-fixture（提供
     rc202 系别名包）')`；
   - `compose(t, { probeVersion: '0.2.0-rc.2', desktopHost: true, rows: [webserver,
     frontend, connection 三行], modules: {rc202 三别名} })`；
   - 断言：`connection.disabled === false` 且 `connection.fiber !== undefined`；
     `trusted-connection.disabled === true` 且 `trusted.fiber === undefined`；
     `GET /` → 200 且含 `shell`；全程无 `set-cookie`；
     无 `BrowserAuth has been skipped` 横幅；
     插件专属路径 `POST /api/dsh-sba-fetch-probe`（仅插件会注册）必须由官方连接模块
     拒绝——**预期 404 `'not found'`（rc2-dormant 基线先例）；若实测官方基线不同，以
     实测值固定断言并在用例注释记录实测依据**（插件 route 若存在，该路径会返回
     201 streaming echo，断言必然失败）。
3. `tests/manifest.test.mjs` 追加：
   `desktop-host signal stays out of dependencies (stub fixtures only)`：断言
   `dependencies` 与 `devDependencies` 均不含 `@deepseek-ai/dsh-desktop-host`。

**验证**:
```sh
node --test tests/composition/desktop-dormant.test.mjs tests/manifest.test.mjs
```
预期：全绿（fixture 已由 Task 1 装好）。宿主桩包在场 + pair 命中 v3 仍整体休眠。

### Task 6: GLOSSARY.md 同步

**Files**: `GLOSSARY.md`。

**Steps**（遵循现有词条格式：加粗术语 + 定义 + `_Avoid_`）:
1. 在「compatibility profile」词条后新增 **host profile（宿主 profile）**：
   运行时宿主形态维度，当前取值 web / desktop；desktop 判据 = 能经 loader resolver
   解析到 `@deepseek-ai/dsh-desktop-host`。hostProfiles 决定哪些 compatibility profile
   允许在哪个宿主形态激活；desktop 一律休眠（设计行为）。_Avoid_: 把它与 compatibility
   profile 或 DSH 安装 profile（~/.dsh/profiles 安装槽位）混用；「平台」「系统」泛称。
2. 「dormant」词条触发列表「未知 profile、candidate profile、混合版本对和探针失败均进入
   dormant」补「desktop 宿主 profile」。
3. 「compatibility profile」与「self-gating」词条各补半句与 host profile 维度的关系
   （self-gating 判据 = 版本对 ∧ profile 状态 ∧ 宿主 profile）。

**验证**: 人工审阅；`grep -n "host profile" GLOSSARY.md` 命中新词条。

### Task 7: README 同步

**Files**: `README.md`。

**Steps**:
1. 「机制与安全」bullet 列表（现 `apply() backstop` bullet 之后）插入：
   `宿主 profile 门控：探针先解析 @deepseek-ai/dsh-desktop-host——命中即 desktop 环境，整体安静休眠（设计行为，desktop 上 Electron 自带 token，插件无收益）；解析异常按 web 继续走版本对判定，任何异常兜底休眠。`
2. 兼容表在「其它版本或混合版本对」行之前插入一行：
   `| desktop profile（存在 dsh-desktop-host 的环境，任意版本对） | — | 😴 dormant-by-design：desktop 一律休眠 | dormant |`
3. 「复制给 agent 的安装提示词」模板中「其它版本或 runtime/connection 混合版本会自动
   休眠，不要强行处理。」之后加一行（任务书 §3.6 逐字）：
   `desktop profile（存在 dsh-desktop-host 的环境）会自动休眠，这是设计行为，不要强行处理或改代码绕过。`
4. 「测试与验证」矩阵 bullet 列表补：
   `desktop 宿主 fixture：@deepseek-ai/dsh-desktop-host 桩包在场 + 白名单版本对仍整体休眠（官方行活跃、无插件路由、无横幅）`。

**验证**: 人工审阅；`grep -n "dsh-desktop-host" README.md` 命中 4 处。

### Task 8: docs/COMPATIBILITY.md §2 / §6 / §7

**Files**: `docs/COMPATIBILITY.md`。

**Steps**:
1. §2 代码样例的 profile 条目加 `hostProfiles: ['web'],` 行；实现细节 bullet 列表追加：
   `hostProfiles：允许激活的宿主 profile 集合，当前恒为 ['web']（web-only）；探针表达式与 apply backstop 双层校验，语义见 §7。`
2. §6「已通过」列表追加一行：
   `host profile 门控（§7）：desktop 桩包在场 + 白名单 pair ⇒ 组合级整体休眠；desktop-host 查询抛错/空值/怪值按包不存在处理（web 继续）。`
3. 新增顶层 `## 7. Host profile policy`（置于 §6 之后，不重排 §5.x），必含小节：
   - **判定依据**（2026-10-07 定稿）：desktop Electron 自带 token ⇒ 插件收益趋零；desktop
     无版本审计、无实机 checklist；插件经 dsh-m 公开分发且 agent 是第一安装群体 ⇒ 需要
     代码级护栏而非文档约定；拦「激活」不拦「安装」。
   - **信号与语义表**（四态，逐字对齐 Round 1 决策 2）：解析得合法 `{url: string}` ⇒
     desktop；抛错 / `null` / `undefined` / url 非字符串 ⇒ 包不存在（web 继续）；
     resolver 缺失 ⇒ 探针 null（休眠）；兜底 = 版本对判定。
   - **fail-closed 语义**：探针层 desktop ⇒ null（安静休眠，与未知版本对同形态，判别法见
     know-how 016）；backstop 层 desktop ⇒ fail-loud，完整文案
     `@iasiv5/dsh-skip-browser-auth: desktop profile not supported; disable or uninstall the plugin (@deepseek-ai/dsh-desktop-host present)`
     （仅防「patch 激活但不应激活」的绕过态）。
   - **残余风险（书面化）**：desktop 未来若移除/改名信号包 ⇒ 探针误判 web，而
     desktop runtime 版本对（如 0.2.0-rc.2）与 web 白名单共享 ⇒ 可能误激活。兜底：任何
     新 runtime 版本进入白名单前必须走 §5.1 审计流程（届时必然重审 desktop 形态）+ 下述
     解冻条件；本节为唯一权威记录处。对称情形（web 侧反向污染）：web profile 下第三方
     插件经 hoisted 抬升携带 `@deepseek-ai/dsh-desktop-host` 依赖（gate.ts 头注记载的
     同类抬升遮蔽机制）⇒ 信号误真 ⇒ 本插件安静休眠——方向 fail-closed，最坏损失是本
     插件不工作，无安全暴露；本仓库自身不可能引入该包：manifest 不变量（全局约束 4）
     禁止任何 `@deepseek-ai` 运行时依赖，`tests/manifest.test.mjs` 看护。
   - **解冻条件**（逐字继承任务书 §4，本次不实现）：同时满足才允许把 `'desktop'` 加入
     hostProfiles——① 出现真实 desktop 需求；② desktop 信号 + fixture 全套验证；
     ③ desktop 实机 checklist（无 token `GET /` 401→200、伪造 Host → 403、`/?token=x`
     → 303、卸载后官方行为原样恢复）+ 暴露模型书面化（回环绑定 + 本机进程可信度假设）。
   - **实机事实（2026-10-07）**：desktop runtime 0.2.0-rc.2（`dsh --version` 与
     runtime.json 双证）；Desktop Web GUI 以 127.0.0.1:19387 仅回环绑定；BrowserAuth
     激活中（无 token 401、伪造 Host 401——休眠态无栅栏，401 即正确）；
     `app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/` 存在；web runtime 树无此包
     （本机 `ls ~/.dsh/profiles/node_modules/@deepseek-ai/ | grep desktop` 为空，2026-10-07 复核）。
   - **实机状态（发版后回填）**：web 0.2.0-rc.2 升级零回归断言结果；desktop dormant
     基线断言结果（按 `docs/DESKTOP-DORMANT-CHECKLIST.md`）。

**验证**: 人工审阅；`grep -n "^## 7" docs/COMPATIBILITY.md` 恰一条；§5.x 标题行号不因
插入 §7 之外的操作改变（§7 只追加在文件尾部区域）。

### Task 9: 版本 0.3.6、npm description、CHANGELOG

**Files**: `package.json`、`CHANGELOG.md`。

**Steps**:
1. `package.json`：`"version": "0.3.6"`；description 末尾（`详见仓库。` 之后）追加
   `仅支持 web profile；desktop profile（存在 dsh-desktop-host 的环境）自动休眠，属设计行为。`
2. `CHANGELOG.md` 在 `## [Unreleased]` 与 `## [0.3.5]` 之间插入（日期用实际发布日）：

   ```md
   ## [0.3.6] - 2026-10-07

   - 新增宿主 profile 门控：仅支持 web profile；desktop profile（存在 `dsh-desktop-host` 的环境）一律自动休眠（设计行为），探针与 `apply()` backstop 双层 fail-closed
   - web 侧兼容版本对不变：`0.1.2-rc.1`、`0.1.5-rc.1`、`0.1.5-rc.2`、`0.1.7-rc.1`、`0.1.7-rc.2`、`0.2.0-rc.1`、`0.2.0-rc.2`
   - 新增 `docs/DESKTOP-DORMANT-CHECKLIST.md`（desktop 机休眠基线验证清单）
   ```

   同步清空 `## [Unreleased]` 中已随本版发布的内容（audit-candidate 条目移入 0.3.6 小节
   或保留视其是否已发版——0.3.5 后无发版，故并入 0.3.6 小节后 Unreleased 置空）。
3. CHANGELOG 尾部链接引用维护（顺带修复 0.3.5 发版时的既有遗漏）：
   `[Unreleased]: …/compare/v0.3.6...HEAD`、补 `[0.3.5]: …/compare/v0.3.4...v0.3.5`、
   新增 `[0.3.6]: …/compare/v0.3.5...v0.3.6`
   （`…` = `https://github.com/iasiv5/dsh-skip-browser-auth`）。

**验证**: `node -e "console.log(require('./package.json').version)"` → `0.3.6`；
`grep -n "0.3.6" CHANGELOG.md | head -1` 命中新小节；`grep -n "^\[0.3.6\]:" CHANGELOG.md`
命中，且尾部引用 `[Unreleased]`/`[0.3.5]`/`[0.3.6]` 三条 compare 区间连续无缺口
（v0.3.4→v0.3.5→v0.3.6→HEAD）。

### Task 10: 全量门禁（提交前）

**Files**: 无新改动（纯验证）。

**Steps**:
1. `npm run test:all`（fixture 重装 → build → typecheck → 全部测试）
2. **web 机发布前预检**（任务书 §6 发布门禁，与步骤 1 同属发版前置）：
   `ls ~/.dsh/profiles/node_modules/@deepseek-ai/ | grep -c "dsh-desktop-host$"` → 0
   （精确匹配包名全名，防未来其它 desktop 系包名造成假阳性；以**输出值 0** 为门禁
   信号——`grep -c` 无命中时命令退出码为 1，勿以退出码判定）
3. `git diff cordis.patch.yml` 人工核对：变化仅为三处内嵌表达式的 desktop 检测与
   write-patch 头注释（生成物与 lib 常量的因果关系见 Task 4 双 build 幂等验证）
4. `git status -sb` 逐文件核对改动范围 = 本计划「文件结构与职责」表。

**验证**: `npm run test:all` 退出码 0；步骤 2 预检输出 0；改动文件清单与计划表完全一致
（多出或缺失即停下）。

### Task 11: 发版（🔴 gated：push 前经主人确认）

**Files**: 无新改动（git 操作）。

**Steps**（每步遇阻即停，按 know-how 018 处置）:
1. 向主人展示最终 diff 摘要并确认提交与 push；
2. `git add -A && git commit`，message 遵循仓库风格：
   `feat: gate Replacement by host profile — web-only, desktop dormant (v0.3.6)`；
3. **push 前幂等终检**：`npm run build && git diff --exit-code cordis.patch.yml`
   （提交后工作树干净，再生结果必须与提交内容逐字节一致）；
4. `git push origin main`（确认后）；
5. `git tag v0.3.6 && git push origin v0.3.6`（确认后）→ 触发 `.github/workflows/publish.yml`
   （Trusted Publishing OIDC，`npm ci && npm publish --provenance`）；
6. 等待 Actions publish job 绿；
7. **workflow 绿 ≠ 已上架**：按 know-how 018 三键轮询 registry 确认——per-version
   文档、dist-tags、packument time 三键齐：
   `npm view @iasiv5/dsh-skip-browser-auth@0.3.6 version dist-tags.latest time --json`；
   外加更严一项：`dist.integrity` 与本地 `npm pack --dry-run` 产物一致。全部满足才算
   上架；404/409 等待重查，勿急重推。

**验证**: npm registry 三键确认；`npm view @iasiv5/dsh-skip-browser-auth dist-tags.latest`
→ `0.3.6`。

### Task 12: web 机装机验证（本机）+ desktop checklist 交付

**Files**: `docs/DESKTOP-DORMANT-CHECKLIST.md`（新）、`docs/COMPATIBILITY.md` §7 实机状态回填。

**Steps**:
1. 预检留档（发布门禁已在 Task 10 步骤 2 通过；此处升级前重跑一次留输出）：
   `ls ~/.dsh/profiles/node_modules/@deepseek-ai/ | grep -c "dsh-desktop-host$"` → 0
   （web 机不存在 desktop-host，防误伤休眠——任务书 §6 预检；以输出值 0 为准，
   命令退出码勿作判定）。
2. 升级并重启：
   `dsh plugin --profile web add @iasiv5/dsh-skip-browser-auth@0.3.6`
   → `sudo systemctl restart deepseek-harness.service`
   → 轮询 `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3080` 至 200。
3. 零回归断言（逐条记录输出）：
   - `journalctl -u deepseek-harness.service -b --no-pager | grep -F "BrowserAuth has been skipped"`
     → 横幅**逐字**出现（按本次 boot 过滤，避免历史 boot 噪声）；
   - `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3080/` → 200；
   - `curl -s -o /dev/null -w "%{http_code}\n" -H "Host: evil.example" http://127.0.0.1:3080/` → 403；
   - `curl -s -D - -o /dev/null "http://127.0.0.1:3080/?token=x" | grep -iE "^HTTP|^location"`
     → 303 + `Location: ./`（mount-preserving）。
4. 新建 `docs/DESKTOP-DORMANT-CHECKLIST.md`：可直接粘给 Windows desktop 机 agent 的
   验证提示词，内容覆盖任务书 §6 desktop 段：安装/升级
   （`dsh plugin --profile desktop add @iasiv5/dsh-skip-browser-auth@0.3.6` 或市场安装）→
   重启 Desktop 应用 → dormant 基线断言（无 token `GET http://127.0.0.1:19387/` 仍 401、
   伪造 Host 仍 401——休眠态无栅栏 401 即正确、进程无 skipped 横幅、DSH 连接与 GUI 与
   agent 会话正常）；注明 `dsh plugin --profile desktop list` 须在普通终端跑（agent
   沙箱 profile 写锁 EPERM 属环境限制）；回滚 = 直接卸载。文首注明复用场景
   （COMPATIBILITY.md §7 解冻条件③的基线形态）。
5. 回填 COMPATIBILITY.md §7「实机状态」：web 零回归结果 + desktop 基线结果（desktop
   结果待主人在 Windows 机执行后回填，可先记「待执行」）。

**验证**: 3 的四条断言全部符合预期值；任何一条不符 ⇒ 停下，按 know-how 016 判别法
分诊（休眠 vs 拒载），不得带病进入 Task 13。

**回滚预案**（任务书 §6，验证失败或主人要求时执行）：通用——卸载或停用插件 +
`sudo systemctl restart deepseek-harness.service`，官方 BrowserAuth 原样恢复（零本体
侵入）；web 机可 pin 回 0.3.5：
`dsh plugin --profile web add @iasiv5/dsh-skip-browser-auth@0.3.5`（或 profile 侧
`pnpm update` 锁定 ^0.3.5）后重启。

### Task 13: dsh-m 市场文案同步（🔴 gated：push 前经主人确认）

**Files**: `~/workspace/dsh-m/registry.json`（独立仓库）。

**Steps**:
1. `dsh-skip-browser-auth` 条目 description 更新：web-only / desktop 休眠语义必须入场
   （统一句式主干：`仅支持 web profile；desktop profile（存在 dsh-desktop-host 的环境）自动休眠，属设计行为。`）。
   既有「已适配」版本串压缩为**不含任何版本号**的
   `已适配七个已审计精确版本对，详见仓库。`——理由：范围/裸版本写法（如 `0.1.2~0.2.0`）
   会触发 validate-registry.mjs 的「版本号 ⊆ verified」检查（提取的裸版本不在 verified
   ⇒ 每次出现 2 条「升级后必查」误导性 warn），且违反 GLOSSARY「whitelist」_Avoid_
   版本范围与 README「白名单匹配完整版本对」的公开文案纪律。长度事实：registry
   description 有 60 当量软上限（validate 仅 warn 不 fail；现值 60.0；含版本号压缩句的
   候选实测 86.0 当量）；统一句式全文与 60 上限不可兼得——两个出路在步骤 3 由主人
   定夺（当量以 validate 实测输出为准）：
   (i) 保留统一句式全文、接受 length warn（diff 中明示当量数）【默认，忠实 Round 1
   决策 9 的统一句式】；
   (ii) registry 侧改用精简变体
   `仅支持 web；desktop（有 dsh-desktop-host）自动休眠，属设计行为。`（实测 75.0 当量，
   仍超 60；(i) 全文实测 87.5——两路均触发 length warn，差别在告警量级与语义取舍；
   若主人要求 (ii) 真正达标，需在基座再削约 15 当量，如去「，详见仓库」类补充成分，
   以 validate 实测为准），
   npm description 无此限制、仍用 Task 9 完整句不压缩。
   `verified` 数组**不动**（know-how 022：只记 DSH 运行时版本，严禁混入插件版本号）。
2. `cd ~/workspace/dsh-m && node scripts/validate-registry.mjs` → 退出码 0 且**无任何
   warn**（按步骤 1 选定出路达成；若主人选 (i)，length warn 为唯一例外且已明示接受）。
3. 展示 diff（含所选出路与当量实测数）→ 主人确认 → commit + push（走 know-how 008
   流程）。

**验证**: `node scripts/validate-registry.mjs` 退出码 0 且无任何 warn，或仅剩 length warn
且已经主人明示接受；registry 条目 diff 仅 description 一行变化。

## 任务间接口契约

| 生产者 → 消费者 | 契约 |
| --- | --- |
| Task 3 → Task 2 测试 / Task 4 / Task 5 | `lib/gate.js` 导出 `DESKTOP_HOST_PACKAGE = '@deepseek-ai/dsh-desktop-host'`、`detectHostProfile(internal, baseUrl) → 'web'\|'desktop'`、`GATE_PROFILE_TABLE` 条目含 `hostProfiles`、`resolveActiveCompatibilityProfile(runtime, connection, hostProfile)`（第三参必填）；`HostProfile` 类型由 compatibility.ts 定义、gate.ts 再导出 |
| Task 1 → Task 5 | rc202 系 fixture 别名（`dsh-client-connection-rc202`/`frontend-static-rc202`/`webserver-rc202`）已安装 |
| Task 2/5 helper → 各测试 | `writeGateFixtures(t, { desktopHost })` 与 `compose(t, { desktopHost })`：true 时 resolver 对 `@deepseek-ai/dsh-desktop-host/package.json` 返回 `{url: <file: URL>}` |
| Task 3 → Task 4 | `npm run build` 内部串写 write-patch；补丁表达式变化只源于 lib 常量 |
| Task 9 → Task 11 | tag `v0.3.6` 触发 publish.yml；包版本必须已是 0.3.6 |
| Task 11 → Task 12/13 | registry 三键确认上架后才允许装机升级与 dsh-m 文案同步 |

## 执行纪律

- 开始实现前先批判性复查本计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划再动手。
- 按任务顺序执行，不无声跳步、合并或改目标；当前在 `main`：仓库惯例是 main 直提 + tag
  发版，push 前经主人确认（Task 11 gated）。
- 每完成一个任务立即运行该任务定义的验证；红绿判据写明的（如 Task 2 的 2 红 3 绿
  分布）不得含糊。
- 遇阻塞、重复失败或计划与仓库现实不符（如 rc202 官方 /api 基线与预期不同），停下记录
  实测值并按计划内的决策规则处理，不猜。
- `cordis.patch.yml` 任何情况下不手改；`lib/` 不提交（已 gitignore）。
- 全部任务完成后运行「最终验证」并输出修改摘要。

## 最终验证

```sh
cd /home/ubuntu/workspace/dsh-skip-browser-auth
npm run test:all                                   # fixture + build + typecheck + 全部测试，退出码 0
npm run build && git diff --exit-code cordis.patch.yml   # 提交后生成物幂等
node --test tests/composition/desktop-dormant.test.mjs    # desktop 休眠组合基线
git status -sb                                     # 改动范围 = 计划文件表
```

发布与运行面验证：Task 11（npm 三键）、Task 12（web 四条断言 + desktop checklist 交付）、
Task 13（dsh-m validate 全绿）全部通过且回填完成，本计划才算交付完毕。
