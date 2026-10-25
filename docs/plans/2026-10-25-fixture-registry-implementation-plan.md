# 测试层表驱动化（fixture registry）实施计划

## 目标

把「republish 版本收编」（仓库史上最重复操作；收编 0.2.1-rc.3 一轮 `git show e477a1a` 实证 **15 文件、+316/−21 行**，docs/COMPATIBILITY.md §5.0 触点清单是该轮的文件级 runbook）的代码侧触点压缩为两处数据改动：`src/compatibility.ts` 加一个 pair + `tests/fixtures/registry.mjs` 加一行。具体交付：

- 一份测试侧 fixture 登记表 + 派生 helper，消灭 9 份 `active-rc*.test.mjs` 与 3 份 `npm-flat*` 逐版本拷贝（~1,530 行 → ~300 行）；
- `gate.test.mjs`/`audit-candidate.test.mjs`/`manifest.test.mjs` 的手写版本字面量全部改为从 `COMPATIBILITY_PROFILES` / 登记表派生，gate 层混合负例升级为全 N×N；
- 三个 install 脚本合并为一个登记表驱动的 `install-fixtures.mjs`；
- docs-sync 扩展到 package.json description（有序展开相等）与 README 代际分组（位置感知）；
- 防回潮结构守卫 + §5.0 触点清单改写。

**纯测试/脚本/文档变更：`src/` 与 `cordis.patch.yml` 一字不动，`lib/` 永不手改。** 白名单集合、profile 语义、发布产物全部不变。

## 架构快照

```
src/compatibility.ts (COMPATIBILITY_PROFILES)  ← 仍是 profile 唯一事实源（不动）
        │ lib/gate.js 导出
        ▼
tests/fixtures/registry.mjs                     ← 新：版本↔fixture 别名映射（不可推导数据）
  VERSION_FIXTURES（10 版本条目，GATE_VERSIONS 全局序）
  PROFILE_BUILD_ALIASES（rc15/rc17/rc21 三条构建锚）
  LEGACY_FIXTURE_SPECS（rc2 组 + peer pins + 传递依赖，版本无关常量）
  helpers: FIXTURE_ENTRIES / adjacentVersions / loadFixtureModules / installSpecs
        │
        ├── tests/composition/active-generations.test.mjs   ← 循环 9 个别名版本
        │     × tests/helpers/generation-checklists.mjs      ← 按 profileId 的代际断言包
        ├── tests/composition/npm-flat-generations.test.mjs ← 循环 10 版本 + v1 深行为 + 0.1.1-rc.2 回归
        ├── tests/gate.test.mjs（正例循环 + N×N 混合矩阵循环）
        ├── tests/audit-candidate.test.mjs / tests/manifest.test.mjs（字面量→派生）
        ├── tests/structure.test.mjs（防回潮 + 双向完备性 + 后缀唯一）
        └── scripts/install-fixtures.mjs（一次 npm install 全量 specs）
```

相邻对规则：每个版本测**全局版本序两侧相邻对**的 dormant（首/尾只测存在侧，双向）。gate 层 N×N = 10 对角线 active + 90 混合对 dormant，严格强于现有手挑 28 例。

## 全局约束

- `src/`、`cordis.patch.yml`、`lib/` 零改动；`npm run build` 后 `git diff --exit-code cordis.patch.yml` 必须干净（patch 幂等即 src 未动的机器证明）。
- **覆盖严格 ≥ 旧**：被删文件中每条断言必须在对账表（附录 A）有新对应；无一条丢弃。`test:all` 0 fail，恒定 1 个环境条件 skip（pnpm 布局真机用例）。
- `devDependencies` 键集合不变；`package.json` 只改 `scripts` 字段（发版轮另行改 version/description）。
- 别名约定沿用 §5.0：rc.NXX 紧凑别名；rc2 组特例（connection/frontend-static 两件、无 webserver 别名）原样保留在 `LEGACY_FIXTURE_SPECS`。
- 直推 main（用户已确认，Q15-B），五连 commit c1–c5，每 commit 独立全绿。
- npm 纪律：任何触网 npm 命令先 `npm_config_cache=D:/_dsh-workspace/.npm-ci-cache`；fixture 安装器跑完先 `test -d node_modules` 再跑后续测试。
- Windows 跨平台：保留 `runNpm` 的 node npm-cli.js 直启 shim 与 env scrub；测试命令本身跨平台（node --test）。
- 发版（G3）不在本计划内执行：`npm version` + tag + push + OIDC publish + registry 轮询（know-how 018）由用户在实施评审（G2）通过后另行发起。
- `GLOSSARY.md` 不加词条（登记表是测试基础设施非领域概念）；决策记录落 `docs/COMPATIBILITY.md` §5.0/§2。
- 与已批准设计的唯一处机械修正：**结构守卫（structure.test.mjs）从 c1 挪到 c2**——守卫禁止 `active-rc*.test.mjs` 存在，而 c1 阶段旧文件尚在并存，守卫若在 c1 落地必红。

## 输入工件

- 本会话 grilling 共识：16 项裁决（Q1–Q16），含范围=四件套、登记表居测试侧、两段式迁移+断言对账、gate 层 N×N、计划先行、§5.0 改写+守卫、docs-sync 双扩展、直推 main、四道闸门（计划→人审→实施→人审→发版）。
- 事实基线：两份只读走查报告（2026-10-25，本会话）；`tests/` 现有 190 个 test()（组合层 46 / 顶层 144），其中逐版本组合 test 35 个（见附录 A）。
- 仓库契约：`docs/COMPATIBILITY.md` §5.0/§5.1；`tests/helpers/compose.mjs` 参数面（probeVersion/runtimeVersion/layout/modules/webRuntime/webStartup/rows）。

## 文件结构与职责

- Create: `tests/fixtures/registry.mjs` — 版本↔别名数据与派生 helper（唯一新增"事实"文件）
- Create: `tests/helpers/generation-checklists.mjs` — 按 profileId 的代际断言包（trustedRowId / indexMarker / service / waterfall / peerRpc / fetchPeer / connectRoute）
- Create: `tests/composition/active-generations.test.mjs` — 循环 9 个别名版本的 active + 相邻 dormant 套件
- Create: `tests/composition/npm-flat-generations.test.mjs` — 循环 10 版本 npm 布局 + v1 深行为 + 0.1.1-rc.2 dormant 回归
- Create: `tests/structure.test.mjs` — 三守卫（c2 落地）
- Create: `scripts/install-fixtures.mjs` — 登记表驱动单次安装器（c3）
- Modify: `tests/gate.test.mjs` — 四处字面量 → 循环派生（c2）
- Modify: `tests/audit-candidate.test.mjs` — parsePairs 期望表/pickBasePair 期望值 → 派生（c2）
- Modify: `tests/manifest.test.mjs` — 8 个逐版本/构建锚块 → 登记表循环（c2）
- Modify: `tests/docs-sync.test.mjs` — 新增 description 与代际分组检查（c4）
- Modify: `package.json` — 仅 `scripts` 字段收敛（c3）
- Modify: `docs/COMPATIBILITY.md` §5.0/§2/§5.1、`docs/DESIGN.md`（引用旧文件名处）、`CHANGELOG.md`（c5）
- Delete（c2）: `tests/composition/active-rc15/-rc152/-rc17/-rc171/-rc20/-rc202/-rc211/-rc212/-rc213.test.mjs`、`tests/composition/npm-flat.test.mjs`、`npm-flat-rc15.test.mjs`、`npm-flat-rc17.test.mjs`
- Delete（c3）: `scripts/install-rc2-fixture.mjs`、`install-rc15-fixture.mjs`、`install-rc17-fixture.mjs`
- 不动：`tests/composition/active.test.mjs`、`active-rpc-legacy.test.mjs`（v1 原始用例，无拷贝病）、全部 dormant/desktop/gate-binding/rc2-* 文件（其中 desktop-dormant/desktop-pinned-active/rc2-dormant 三文件在 c3 有一次**仅提示文案**的例外修改，见 Task 9 Step 2b）、`tests/helpers/compose.mjs`、`tests/helpers/gate-fixture.mjs`、`tests/fixtures/rpc-probe.mjs`

接口契约（Task 1 Produces，后续任务 Consumes）：

```js
// tests/fixtures/registry.mjs
export const VERSION_FIXTURES // [{version, profileId, aliasSuffix:'rc213'|null,
                              //   aliases:{connection,frontendStatic,webServer}|null}] 全局序
export const PROFILE_BUILD_ALIASES // {profileId: {alias, spec}} 三条（rc15/rc17/rc21）
export const LEGACY_FIXTURE_SPECS  // string[]：rc2 组两别名+apiproxy+scope/invariants pins+4 传递依赖
export const FIXTURE_ENTRIES       // VERSION_FIXTURES.filter(e => e.aliases)（9 条）
export function adjacentVersions(version) // {prev?: entry, next?: entry} 按全局序
export async function loadFixtureModules(entry) // 别名条目→aliased import；null 条目→pinned devDep import
export function installSpecs()      // string[]：FIXTURE_ENTRIES 三件 + LEGACY_FIXTURE_SPECS
```

```js
// tests/helpers/generation-checklists.mjs
export const GENERATION_CHECKLISTS // {profileId: {trustedRowId, indexMarker:RegExp,
                                   //   service:'webRuntime'|'webStartup', waterfall:boolean,
                                   //   rpcPeer:boolean, fetchPeer:boolean, connectRoute:boolean}}
```

## 任务清单

### Commit c1 — 登记表与新套件（新旧并存全绿）

#### Task 1: 建 `tests/fixtures/registry.mjs`

- 目标：落地版本↔fixture 别名数据与派生 helper
- 涉及文件：`tests/fixtures/registry.mjs`（新建）
- 接口契约：Produces 见上方接口契约块（后续所有任务依赖）
- 验证范围：数据可导入、helper 行为正确

- [ ] Step 1: 写数据与 helper
  - Change: `VERSION_FIXTURES` 按 GATE_VERSIONS 全局序 10 条（0.1.2-rc.1 条目 `aliases:null`；rc15/rc152/rc17/rc171/rc20/rc202/rc211/rc212/rc213 九条带三件别名，别名串照抄 `install-rc17-fixture.mjs` L43–105）；`PROFILE_BUILD_ALIASES` 三条（spec 照抄 `package.json` devDependencies）；`LEGACY_FIXTURE_SPECS` 照抄 L40–42、L110–117；helpers 按契约实现（`loadFixtureModules` 用动态 `await import(alias)`，null 条目导入 pinned `@deepseek-ai/dsh-client-connection`/`@deepseek-ai/dsh-host-frontend-static`/`@deepseek-ai/dsh-host-webserver`）
- [ ] Step 2: 冒烟验证
  - Run: `npm run build && node --input-type=module -e "const r = await import('./tests/fixtures/registry.mjs'); console.log(r.VERSION_FIXTURES.length, r.FIXTURE_ENTRIES.length, r.installSpecs().length)"`
  - Expected: `10 9 36`（9 别名条目 ×3 = 27 specs + LEGACY 9 条：rc2 组 2 + apiproxy 1 + scope/invariants pins 2 + 传递依赖 4；与 `install-rc17-fixture.mjs` L40–117 逐项对账）

#### Task 2: 建 `tests/helpers/generation-checklists.mjs`

- 目标：按 profileId 收敛代际差异断言的开关与期望值
- 涉及文件：`tests/helpers/generation-checklists.mjs`（新建）
- 接口契约：Consumes Task 1 的 profileId 串；Produces 见契约块
- 验证范围：五个 profile 的开关值与旧文件断言一一对应

- [ ] Step 1: 写清单（值取自现有文件实测）：`legacy-web-v1` {indexMarker:/legacy-web-v1/, trustedRowId:'trusted-connection', service:'webRuntime', waterfall:false, rpcPeer:false, fetchPeer:false, connectRoute:false}；`carrier-neutral-v2` {indexMarker:/carrier-neutral-v2/, 其余同 v1}（recovery 由 profile.requiresRecoveryGlobal 派生，不入清单）；`carrier-neutral-v3` {indexMarker:/carrier-neutral-v3/, waterfall:true, rpcPeer:true, fetchPeer:false, 其余同 v2}；`carrier-neutral-v4` {indexMarker:/carrier-neutral-v4/, trustedRowId:'trusted-connection-021', service:'webStartup', waterfall:true, rpcPeer:true, fetchPeer:true, connectRoute:true}。indexMarker 机制依据：`installBrowserGlobals` 对**所有** active profile 注入 PROFILE_GLOBAL=profile.id（src/index.ts:188-200），故 v1/v2 的 marker 断言均成立；**v1 marker 断言为新增增强**（旧 npm-flat v1 块只断言 rootGet 200+shell，无 marker）；**v2 marker 断言为既有迁移**（旧 active-rc15:47 / active-rc152:49 / npm-flat-rc15:33 已有 /carrier-neutral-v2/ 断言）；附录 A 按此口径标注（R3-01）
- [ ] Step 2: `node --input-type=module -e "const c = await import('./tests/helpers/generation-checklists.mjs'); console.log(Object.keys(c.GENERATION_CHECKLISTS))"`
  - Expected: 四个 profileId 全列出

#### Task 3: 建 `tests/composition/active-generations.test.mjs`

- 目标：循环 9 个别名版本：每版本 1 个 active 测试 + 相邻对 dormant 测试
- 涉及文件：`tests/composition/active-generations.test.mjs`（新建）
- 接口契约：Consumes Task 1（FIXTURE_ENTRIES/adjacentVersions/loadFixtureModules）、Task 2（GENERATION_CHECKLISTS）、`compose.mjs` 既有参数面
- 验证范围：9 active + 18 相邻 dormant 全绿；test 标题含版本串与 profileId（journal 可 grep）

- [ ] Step 1: 写循环骨架——active 测试逐版本做：`loadFixtureModules` → `compose`（modules、`webRuntime`/`webStartup` 按 checklist.service 传空配置、probe 行）→ 通用断言（三行状态：connection disabled、本代 row 活跃、另代 row disabled；rootGet 200 + shell；evil-host 403；recovery global 按 profile）+ checklist 断言（waterfall 可见性 v3+；dedicated RPC 200 与第 4 参 peer v3+；fetch peer 语义 v4；/connect 302→`./api/remote.mux`、400、403 三态 v4；index marker 与 trustedRowId）
- [ ] Step 2: 写相邻 dormant 循环——**按全局序枚举 9 个相邻对 (i, i+1)，i = 0..8**（含 0.1.2-rc.1↔0.1.5-rc.1 代际边界对：0.1.2-rc.1 侧 probe 经 `loadFixtureModules` 的 pinned devDep 路径，对向 probe 用 rc15 别名；首尾版本由对枚举自然单侧覆盖，无需按版本算侧）；每对两方向（a runtime + b connection / b runtime + a connection）各生成 1 个 test，断言官方行活跃、插件行 disabled、无横幅 → **恰 18 个 dormant test；Task 3 合计 9 + 18 = 27**
- [ ] Step 3: `npm test`（与旧套件并存）
  - Expected: 全绿；active-generations 恰 27 个新 test 通过（9 + 18，与 Step 2 公式一致）

#### Task 4: 建 `tests/composition/npm-flat-generations.test.mjs`

- 目标：npm 扁平布局循环 10 版本 + 移植旧 `npm-flat.test.mjs` 的两块独有内容
- 涉及文件：`tests/composition/npm-flat-generations.test.mjs`（新建）
- 接口契约：Consumes Task 1/2；`compose({layout:'npm'})`
- 验证范围：10 个激活块（connection disabled / trusted row 活跃 / rootGet 200 / marker 按 checklist）全绿；0.1.2-rc.1 块额外含 v1 深行为（token 303→`/` root 语义、/api 无 401、evil 403、固定警告）；独立保留「host 0.1.1-rc.2 → dormant + 官方 401 文案」回归测试——**原样移植**：probeVersion 0.1.2-rc.1 + 默认 pinned modules + runtimeVersion 0.1.1-rc.2 的混合漂移形态，与旧 `npm-flat.test.mjs` L79–113 逐字同构，**不引入 rc2 别名**（引入真实 rc2 包会把被测形态从「混合漂移事故」变成「非白名单同版本对」；rc2 真实包场景由既有 `rc2-dormant.test.mjs` 覆盖，该文件在不动清单）

- [ ] Step 1: 写 10 版本循环（0.1.2-rc.1 用 `loadFixtureModules(null 条目)`）
- [ ] Step 2: 移植 0.1.1-rc.2 dormant 回归（照抄旧 `npm-flat.test.mjs` L79–113 语义）
- [ ] Step 3: `npm test`
  - Expected: 全绿；npm-flat 维度**恰 11** 个新 test（10 循环块 + 1 个 0.1.1-rc.2 dormant 移植块；v1 深行为并入 0.1.2-rc.1 循环块内部，不另立块）

#### Task 5: c1 收口

- [ ] Step 1: `test -d node_modules || npm_config_cache=D:/_dsh-workspace/.npm-ci-cache npm run test:rc17-fixture`（fixture 已在场则跳过）
- [ ] Step 2: `npm test`
  - Expected: 0 fail（新旧并存，总量 ≈228 = 190 基线 + 27 新 active-generations + 11 新 npm-flat-generations）；1 skip 保持
- [ ] Step 3: checkpoint commit c1：`test: add fixture registry and table-driven generation suites (coexist with per-version copies)`

### Commit c2 — 删旧拷贝 + 字面量派生 + 结构守卫

#### Task 6: 删 12 份逐版本文件并落结构守卫

- 目标：删除 9 份 active-rc* 与 3 份 npm-flat*；新增 `tests/structure.test.mjs` 三守卫
- 涉及文件：Delete 12 份（见文件结构清单）；Create `tests/structure.test.mjs`
- 接口契约：Consumes Task 1（registry）；Produces: 守卫（c5 §5.0 改写引用）
- 验证范围：守卫三条全绿，且负控能红

- [ ] Step 1: 删除 12 份文件
- [ ] Step 2: 写 `tests/structure.test.mjs`：① `readdirSync('tests/composition')` 检出 `/(?:active|npm-flat)-rc\d+\.test\.mjs/` 即 fail；② 双向完备性——`COMPATIBILITY_PROFILES` 每个 active pair 在 `VERSION_FIXTURES` 有同 profileId 条目且顺序与 GATE_VERSIONS 一致，反之每个登记条目 `resolveCompatibilityProfile(v,v)` 解析为 active；③ `aliasSuffix` 唯一且别名串以 `-${aliasSuffix}` 结尾
- [ ] Step 3: 负控验证守卫真会红——删除与验证**同步骤原子执行**（防中断残留临时文件触发守卫误红，评审计划外建议②）：`touch tests/composition/active-rc999.test.mjs && { node --test tests/structure.test.mjs; rc=$?; rm tests/composition/active-rc999.test.mjs; [ $rc -ne 0 ]; }` → Expected: 整条命令退出码 0（内部测试红过且临时文件已删）；再跑 `node --test tests/structure.test.mjs` → pass
- [ ] Step 4: `npm test`
  - Expected: 0 fail、1 skip；组合层 test 总数**恰为 49**（46 − 35 旧 + 27 + 11 新）

#### Task 7: `gate.test.mjs` 四处字面量循环化

- 目标：L71 清单、L82–139 正/负例、L141–209 fixture 正例、L283–313 手挑混合对全部改为循环派生；`evaluateGate` 覆盖全 10 版本
- 涉及文件：`tests/gate.test.mjs`
- 接口契约：Consumes `lib/gate.js` 的 COMPATIBILITY_PROFILES/GATE_VERSIONS/resolveCompatibilityProfile（既有导出；判据一律在 `npm run build`/pretest 之后读产物——盘上 lib/ 可能落后 src，2026-10-25 实测 7 vs 10 版本，勿直接采信旧产物）
- 验证范围：正例 10（循环）、N×N 90 混合对（`a≠b` 双断言 PROFILE null + PROBE false，test 标题含两版本串）、fixture 正例 10（含 evaluateGate）、unknown 保留两块；其余 37 个保留块（40 − 3 被替换块）不动

- [ ] Step 0: 清点被替换块：现 40 个 test() 中 L82（正负例）、L141（fixture 正例）、L211（混合+unknown）共 3 块被替换/拆分；清点结果记入本计划结果节
- [ ] Step 1: 替换四处（正/负例与 fixture 正例保持单块内循环，用 writeGateFixtures/probeCtx 既有机制；混合对复用 L211–315 既有混合 fixture 生成机制——两版本分别落 manifest——循环生成 **90 个独立 test() 块**，标题含两版本串）；**unknown 用例显式保留两块**：① `resolveCompatibilityProfile('9.9.9','9.9.9') === undefined` 断言块；② unknown fixture 的 PROFILE null + PROBE false 断言块（N×N 不覆盖「同版本但不在白名单」语义，不得丢弃）
- [ ] Step 2: `npm test`
  - Expected: gate 文件 0 fail；test() 数 = 37 保留 + 1 正负例循环块 + 1 fixture 循环块 + 90 N×N 块 + 2 unknown 保留块 = **131**（实测与公式偏差记入结果节）

#### Task 8: `audit-candidate.test.mjs` 与 `manifest.test.mjs` 派生化

- 目标：parsePairs 期望表从 `lib/gate.js` COMPATIBILITY_PROFILES 展开（与源文本 regex 形成双表示互证，非同义反复）；pickBasePair 期望值用测试内独立数值比较器求最大；manifest 的 6 个 fixture-only 块 + 2 个构建锚块 + rc211 内联 pin 改为登记表循环
- 涉及文件：`tests/audit-candidate.test.mjs`、`tests/manifest.test.mjs`
- 接口契约：Consumes Task 1（VERSION_FIXTURES/PROFILE_BUILD_ALIASES）
- 验证范围：断言语义与旧逐条等价（fixture 三件别名于 dependencies/devDependencies 均缺席；构建锚精确 spec 在 devDependencies）

- [ ] Step 1: 改两个文件
- [ ] Step 2: `npm test`
  - Expected: 两文件 0 fail；manifest 循环化后**恰 8 块**（14 − 8 被替换 + 2 循环块），audit-candidate 块数不变（11）——消除全仓 ≈289 的隐性块数假设（评审计划外建议①）
- [ ] Step 3: checkpoint commit c2：`test: derive version literals from the profile table, delete per-version copies, add structure guards`

### Commit c3 — 安装器三合一

#### Task 9: 建 `scripts/install-fixtures.mjs` 并收敛 package.json

- 目标：登记表驱动单次 `npm install` 全量 specs；三个旧脚本删除；scripts 字段收敛
- 涉及文件：Create `scripts/install-fixtures.mjs`；Delete 三个旧 install 脚本；Modify `package.json` scripts
- 接口契约：Consumes Task 1 `installSpecs()`；保留 runNpm Windows shim、env scrub、package.json+lock 前后快照守卫（照抄 `install-rc17-fixture.mjs` L15–30、L120–123）
- 验证范围：单脚本安装后 node_modules 完整、package.json/lock 不变、test:all 全绿

- [ ] Step 1: 写新脚本（spec 数组 = `installSpecs()`，注释说明「单次全量安装使 npm peer resolver 不再移除旧别名」承接旧注释语义）
- [ ] Step 2: `package.json`：删 `test:rc2-fixture`/`test:rc15-fixture`/`test:rc17-fixture`，增 `"test:fixtures": "node scripts/install-fixtures.mjs"`；`test:all` 改为 `npm run test:fixtures && npm run typecheck && npm test`
- [ ] Step 2b: 更新三处 fixture 排障文案（不动清单的**文案例外**：仅改 assert.fail 提示字符串，断言语义不变）：`tests/composition/desktop-dormant.test.mjs:21` 与 `tests/composition/desktop-pinned-active.test.mjs:25` 的「先运行 npm run test:rc17-fixture…」、`tests/composition/rc2-dormant.test.mjs:19` 的「test:rc2-fixture」→ 一律指向 `npm run test:fixtures`——三个旧 script 名在 c3 后不存在，旧文案会误导排障（R1-12）
- [ ] Step 3: `grep -rn "test:rc2-fixture\|test:rc15-fixture\|test:rc17-fixture\|install-rc" README.md docs/ tests/ scripts/ --include="*.md" --include="*.mjs" --include="*.json"`
  - Expected: 仅剩本任务将改写或 c5 将改写的引用（列出清单）
- [ ] Step 4: `npm_config_cache=D:/_dsh-workspace/.npm-ci-cache npm run test:fixtures`
  - Expected: 安装成功，输出 `fixtures installed; package.json and package-lock.json unchanged`
- [ ] Step 5: `npm run test:all`
  - Expected: 0 fail、1 skip
- [ ] Step 5b: 暂存全部 c3 变更后断言 package.json 仅 scripts 段变化：`git add -A && [ $(git diff --cached -U0 -- package.json | grep -E '^[+-][^+-]' | grep -cvE '^[+-]\s*"(test[^"]*|build|typecheck|pretest|prepare|audit-candidate)[^"]*"\s*:') -eq 0 ] && echo PKG-SCOPE-OK`
  - Expected: 输出 `PKG-SCOPE-OK`（变更行全部为 scripts 键；`grep -c` 计 0 退出码 1 的陷阱已用 `$()` 捕获规避；R1-07）
- [ ] Step 6: checkpoint commit c3：`chore(scripts): single registry-driven fixture installer`

### Commit c4 — docs-sync 扩展

#### Task 10: `tests/docs-sync.test.mjs` 增两检查

- 目标：① description 紧凑记法展开后与 GATE_VERSIONS **有序相等**——两步展开公式（评审 R1-06 探针实证版）：截取 description 中「已适配 」之后、「，详见」之前的片段，按 `、` 切分、丢词首「与」；token 无 `/` 即单版本原样保留；含 `/` 时 parts = token.split('/')，**首元素已是完整版本**，prefix = 首元素截去最后一个 `-` 及其后缀（`0.1.5-rc.1` → `0.1.5`），其余片段 f 展开为 prefix + '-' + f；每个产物须匹配 `^\d+\.\d+\.\d+-rc\.\d+$`，否则 fail（防误吞非版本 token）。② README 代际分组位置感知（评审 R1-08 修订版，判基在现状基线实证可过）——两类片段断言：(a)「分代适配」句式：全文全局匹配「使用 + 反引号包裹的 profile-id」，其前段（按 ；／。天然分段）中的版本集合须**恰好等于**该 id 的版本集；(b) agent 安装提示块行式：逐行匹配「- DSH <版本列表>：<profile-id>」，版本按 ` / ` 切分，集合须恰好等于该 id 版本集。兼容表 pair 行由既有 docs-sync 测试守，不重复；README 本体不改造（超出批准范围）
- 涉及文件：`tests/docs-sync.test.mjs`
- 接口契约：Consumes `lib/gate.js` GATE_VERSIONS/COMPATIBILITY_PROFILES（既有）
- 验证范围：两类片段判据在现状 README 基线全绿（「分代适配」四段 + 提示块四行逐一吻合）；负控红

- [ ] Step 1: 增两个 test。①按两步公式实现展开与有序相等；②片段检查用两条正则常量（精确形式，id 在 README 中带反引号）：

      const SEG_ID  = /([^；;。]*?)使用\s*`(legacy-web-v1|carrier-neutral-v[234])/g
      const LINE_ID = /^-\s*DSH\s+(.+?)：\s*(legacy-web-v1|carrier-neutral-v[234])\s*$/gm

  段/行内版本提取统一用 `/\d+\.\d+\.\d+-rc\.\d+/g`；集合断言均为「恰好等于」（多、少、错代都红）。参考实现（评审探针资产，可直接对照移植）：`.dsh-research/fixture-registry-plan-review-scratch/probe-desc-expand.mjs`（两步公式）与 `probe-readme-segments.mjs`（片段判据 + 三负控）（评审计划外建议③）
- [ ] Step 2: `npm run build && node --test tests/docs-sync.test.mjs`（build 先行：判据经 lib/gate.js 产物取 GATE_VERSIONS，勿读盘上旧产物）
  - Expected: 4 个 test 全 pass（基线自证，判据非永真）
- [ ] Step 3: 双向负控：①把 README 某版本挪进错误代际段 → 分组检查 fail；②description 临时删一个版本 → 展开相等 fail；各还原后 pass
- [ ] Step 4: checkpoint commit c4：`test(docs-sync): description expansion equality and generation grouping checks`

### Commit c5 — 文档改写与对账收口

#### Task 11: 改写 `docs/COMPATIBILITY.md` §5.0/§2，清理文档引用

- 目标：§5.0 换成 registry 时代触点清单：① `audit-candidate` 判级 → ② compatibility.ts 加 pair+注释指针 → ③ registry 加条目（含相邻对自动纳入）→ ④ 文档五件（docs-sync 守）→ ⑤ package.json description（docs-sync 守）→ ⑥ `npm version` → ⑦ `npm run test:all`；§2 增一句「测试层版本清单一律派生自 COMPATIBILITY_PROFILES/登记表，禁止逐版本落测试文件（tests/structure.test.mjs 守卫）」；§5.1 第 4/5 条措辞指向表驱动套件；Task 9 Step 3 列出的残留引用逐一改写
- 涉及文件：`docs/COMPATIBILITY.md`、`docs/DESIGN.md`（引用旧文件名处）、必要时 `README.md` 测试节措辞
- 验证范围：`npm test` 全绿（docs-sync 不红）；全文无 `active-rc`/`npm-flat-rc`/`install-rc` 旧引用残留

- [ ] Step 1: 改写三处文档
- [ ] Step 2: `grep -rn "active-rc\|npm-flat-rc\|install-rc2-fixture\|install-rc15-fixture\|install-rc17-fixture\|test:rc2-fixture\|test:rc15-fixture\|test:rc17-fixture" README.md GLOSSARY.md CHANGELOG.md docs/ --exclude-dir=plans`
  - Expected: 仅两类豁免允许出现——docs/COMPATIBILITY.md §5.N 历史审计纪实（逐轮记录，不改写）与 CHANGELOG 历史条目；**docs/plans/ 整体豁免**（历史实施计划与本计划自身为历史文档，不改写，故 grep 直接排除之；R1-13）；触点类现行文档（README / GLOSSARY / docs/DESIGN.md / COMPATIBILITY §2/§5.0）零残留
- [ ] Step 3: `npm test`
  - Expected: 0 fail、1 skip

#### Task 12: CHANGELOG 与本计划核销

- 目标：CHANGELOG 在 `0.4.3` 标题下记一条（tests-only 重构，无产品/白名单变更；若发版评审改号以发版轮为准）；本计划附录 A 对账表逐行打勾并补「结果」节
- 涉及文件：`CHANGELOG.md`、本文件
- 验证范围：文档一致、对账完整

- [ ] Step 1: 写 CHANGELOG 条目与本计划结果节（结果节记录 c3 commit hash）
- [ ] Step 2: 断言 c3 之后 package.json 零变化：`git diff --exit-code <c3-hash> -- package.json`（工作区对 c3 比较）→ 干净（c4/c5 均不得触碰 package.json；R1-07）
- [ ] Step 3: checkpoint commit c5：`docs: rewrite §5.0 touchpoints for the registry era; reconcile plan`

## 执行纪律

- 实施前先批判性复查整份计划；发现缺项、矛盾、命名不一致或验证命令无效，先修计划再动手。
- 按任务顺序执行，不无声跳步、合并步或改目标；每任务跑该任务定义的验证。
- 直推 main 已获用户同意；每 commit 前跑 `git diff --exit-code HEAD -- src/ && npm run build && git diff --exit-code cordis.patch.yml`——第一条**直接断言** src 零改动，且对 HEAD 比较覆盖 staged+unstaged（Task 9 的 `git add -A` 之后跑也不会漏检暂存区；R2-01）；cordis.patch.yml 仅由 lib/gate.js 常量生成，只覆盖 gate/compatibility 面，不能代理 index.ts 等其余 src 文件，故第二条仅作双保险（R1-05）。
- 触网 npm 命令一律带 `npm_config_cache=D:/_dsh-workspace/.npm-ci-cache`。
- 遇阻塞、重复失败或计划与仓库现实不符：立即停下说明，不猜。
- 回退路径：五连 commit 每个独立全绿即回退粒度——任一 commit 出问题，`git revert <hash>` 单 commit 回退，无需拆解混合提交。
- **闸门**：c5 完成即停（G2 实施评审）；评审通过后发版（G3）另行发起，不在本计划内。

## 最终验证

1. `npm run test:all` → 0 fail、恒定 1 skip；分套计数：组合层**恰 49**（46−35+27+11）、`tests/structure.test.mjs` **恰 3**、`tests/docs-sync.test.mjs` **恰 4**（2 旧 + 2 新）、`tests/gate.test.mjs` **131**（Task 7 公式）；顶层其余文件块数不变。全仓总量预期 ≈289（240 顶层 + 49 组合；块粒度合并允许 ±10 偏差，以附录 A 逐行核销 + 0 fail 为准，实测值记入结果节）。
   > 勘误（2026-10-25，G2 评审后补）：本行 ≈289 预算含计划期算术笔误——manifest 期望记为 −8+8，实为 −8+2；实测全仓 283（偏差 −6，容差内），成因与明细见文末「结果」节。历史文档按惯例不改写正文数值，仅留此注。
2. `git diff --exit-code HEAD -- src/ && npm run build && git diff --exit-code cordis.patch.yml` → 均干净（src/ 为直接断言、对 HEAD 比较覆盖 staged+unstaged（R2-01）；patch 为双保险，理由见执行纪律）。
3. 附录 A 对账表逐行核销：35 个旧 test 的每条断言有新对应，rc152/npm-flat-rc152 等增强项已标注。
4. **0.2.1-rc.4 纸面推演**：按新 §5.0 清单走一遍，确认触点 = compatibility.ts + registry + docs（守卫覆盖）+ package.json description + npm version，无测试字面量、无新拷贝文件。
5. `git log --oneline -6` → c1–c5 五连 + 计划文档 commit。

## 审阅 Checkpoint

- 本计划经用户安排的外部评审（G0）通过后方可实施；实施完成停在 G2 再评审；发版（G3）另行发起。

---

## 附录 A：断言对账表（c2 删除前逐行核销；核销结论见文末「结果」节——全部行已验证落位 ✅）

| 旧文件（test 数） | 新落点 | 增强标注 |
| --- | --- | --- |
| active-rc15（1） | active-generations 循环 0.1.5-rc.1 active | — |
| active-rc152（2） | 循环 active + prev 相邻 | 单向→双向 dormant（Q8 增强） |
| active-rc17（3） | 循环 active + prev 相邻（跨代际边界） | — |
| active-rc171（4） | 循环 active + 双侧相邻（prev=0.1.5-rc.2 跨代际、next=0.1.7-rc.2） | next-pair 用法被双侧规则吸收 |
| active-rc20（3）/ active-rc202（3） | 循环 active + 相邻 | — |
| active-rc211（3）/ active-rc212（3）/ active-rc213（3） | 循环 active + 相邻 + v4 checklist（/connect 三态、fetchPeer、trusted-connection-021、webStartup） | — |
| npm-flat.test.mjs（2） | npm-flat-generations：0.1.2-rc.1 循环块（含 v1 深行为：token 303 `/`、/api 无 401、evil 403、警告）+ 0.1.1-rc.2 dormant 回归原样移植 | v1 indexMarker 断言为新增增强 |
| npm-flat-rc15（1） | 循环 npm 块 0.1.5-rc.1 | marker 断言为既有迁移（旧 :33 已有） |
| npm-flat-rc17（7） | 循环 npm 块 7 版本 | 新增 0.1.5-rc.2 的 npm 块（历史缺口） |
| gate.test L71 清单 | structure.test 派生断言（唯一性/计数/可解析） | 字面量角色由 docs-sync+守卫接管 |
| gate.test L82–139（1 块：10 正 + 33 负断言 = 32 混合向 + 1 unknown） | 正负例循环块（正 10 + 混合负 N×N 承接）+ unknown 保留块① | 口径：负断言按行计 33 |
| gate.test L141–209（10 fixture，evaluateGate 7） | 循环 10，evaluateGate 全覆盖 | 7→10 |
| gate.test L211–315（1 块：16 混合 fixture 32 断言 + unknown fixture 断言） | N×N 90 块含全部既有混合对 + unknown 保留块② | 16→90；unknown 不入 N×N、独立保留 |
| manifest.test 8 块 | 登记表循环（fixture-only 三件缺席 + 构建锚精确 spec） | rc171 单别名→三件（Q8 归一） |
| audit-candidate.test 期望表 | COMPATIBILITY_PROFILES 展开互证 + 独立比较器 | — |
| 合计 35 组合 test | 恰 38 新组合 test（27 active-generations + 11 npm-flat-generations）+ 结构守卫 3 + docs-sync +2 | 覆盖严格 ≥ 旧 |

---

## 结果（G1 实施核销，2026-10-25）

**闸门**：G0 评审通过（独立评审 Agent，4 轮往返，18 项问题全部闭环，零分歧，台账 `.dsh-research/fixture-registry-plan-review-scratch/ledger.md`）；G1 实施完成；**本节写毕即停，等 G2 人工评审**；G3 发版另行发起。

**Commit 清单**（每 commit 前均过 `git diff --exit-code HEAD -- src/` + build + `git diff --exit-code cordis.patch.yml`）：

| commit | 内容 | 验证 |
| --- | --- | --- |
| `c183f04` | 计划文档（G0 通过版） | — |
| `9aee128` | c1：registry + checklists + 双循环套件（与旧拷贝并存） | 228 tests / 0 fail / 1 skip（= 190 + 27 + 11，逐位吻合） |
| `dcfe1ef` | c2：删 12 拷贝 + structure 守卫（负控红验证）+ gate/audit/manifest 派生化 | 281 tests / 0 fail / 1 skip；组合层恰 49 |
| `23968e2` | c3：install-fixtures.mjs 三合一 + scripts 收敛 + 三处文案 | `test:all` 全绿（281/0/1）；PKG-SCOPE-OK |
| `237c5c2` | c4：docs-sync 双扩展 | 4 tests 全绿；README 三负控 + description 负控全红（log 落 scratch） |
| c5 | §5.0/§2/§5.1 + DESIGN + CHANGELOG + 本节 | 见最终验证 |

**分套实测**：gate **131**（37 保留 + 1 正负例循环 + 1 fixture 循环 + 90 N×N + 2 unknown，与公式逐位吻合）；manifest **8**（14 − 8 + 2）；audit-candidate 11；structure 3；docs-sync 4（c4 起）；组合层 49；顶层合计 234，全仓 **283**（c2/c3 阶段为 281，c4 +2）。计划预期 ≈289±10，实际 283（偏差 −6 在容差内；偏差来源：计划期顶层算术把 manifest 记为 −8+8，实为 −8+2——Task 8 期望已按「恰 8」修正，但 ≈289 行未同步，属计划文档内部数字笔误，非覆盖缺口）。

**附录 A 核销**：35 旧组合 test 逐行验证落位（9 active 循环 + 18 相邻 dormant + 10 npm 块 + 1 移植回归 = 38 ≥ 35）；rc152 双向、evaluateGate 7→10、N×N 16→90、npm-flat 补 0.1.5-rc.2、v1 indexMarker 等增强项全部到位。

**实施偏差记录**（均为断言面 ≥ 计划或等价，无覆盖损失）：
1. GATE_VERSIONS 派生断言最终形态为「与按序去重的 flatMap 相等 + 去重前后计数一致（每版本恰 runtime/connection 各一次）」——比计划的直比 flatMap 更精确（直比会因 20 vs 10 项恒红，实施时发现并修正）。
2. manifest 循环① 发现 rc15/rc17 别名**双重身份**（fixture 别名 = 所在代际构建锚，合法驻留 devDeps）：该二别名跳过 devDep 缺席断言，其精确 spec 由循环②守——语义严格 ⊇ 旧八块。
3. 相邻 dormant 测试用 3 行 ROWS（不挂探针行）：旧文件挂探针但对其零断言（惰性脚手架），删除无断言损失，并规避 v1 官方连接上的探针兼容风险。
4. 统一探针名 `dsh-sba-gen-probe` 取代逐版本探针名（名称差异，语义同构；每测试独立闭包状态取代旧文件模块级可变状态）。
5. 环境实录：开工时本地 node_modules 缺 v4 代际 9 个别名包（Task 5 Step 1 的目录级守卫不足以及时发现内容级缺失），先跑一次旧 `test:rc17-fixture` 补齐后再进 c1——c3 后该问题类由 `test:fixtures` 单命令消除。

**0.2.1-rc.4 纸面推演**（最终验证 4）：按新 §5.0 走——audit-candidate 判级 → compatibility.ts 加 pair（1 处）→ registry 加一行（1 处）→ 文档五件（docs-sync 四重守卫：存在性 ×3 文档 + 表行 + 代际分组位置感知）→ package.json description（docs-sync 有序相等守卫）→ `npm version` → `test:all`。无测试字面量、无新拷贝文件（structure 守卫禁止回潮）；代码侧触点恰两处。✅

**最终验证**（c5 commit 前执行）：`test:all`→`npm test` 283/0 fail/1 skip；src/ 与 patch 双断言干净；`git diff --exit-code 23968e2 -- package.json` 干净（c4/c5 未触碰 package.json）。
