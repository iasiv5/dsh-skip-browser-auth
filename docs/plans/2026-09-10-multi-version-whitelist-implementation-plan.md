# dsh-skip-browser-auth 双版本白名单实施计划

> ⚠️ 已被 `docs/plans/2026-09-10-multi-generation-compatibility-implementation-plan.md` superseded：GitHub 审计确认 `0.1.5-rc.1` 不能直接复用 `0.1.2-rc.1` 的 host/client 实现；本文件保留为原方案历史记录，不再执行。

## 目标

- 将 DSH Skip Browser Auth 的精确激活白名单从单一 `0.1.2-rc.1` 扩展为 `0.1.2-rc.1` 与 `0.1.5-rc.1` 两个版本。
- 保留双锚点（`@deepseek-ai/dsh` runtime 本体 + `@deepseek-ai/dsh-client-connection`）和 fail-closed 语义：两个锚点必须解析到同一个白名单版本；混用两个白名单版本、解析失败或版本不在白名单时不得激活 Replacement。
- 让组合期探针、`apply()` backstop、生成的 `cordis.patch.yml`、单元/组合测试和发布元数据使用同一份版本列表，避免“探针允许但 backstop 拒绝”或文档落后。
- 升级 README、`CONTEXT.md` 与 `docs/DESIGN.md`，补充两个白名单版本、混合版本行为、安装后判断方式、两版本 active 验证清单和当前验证边界；保留既有历史实施计划不改写。
- 不升级插件自身发布版本号、不发布 npm、不修改 DSH 本体、systemd、反向代理或任何仓库外服务。

## 架构快照

`src/gate.ts` 继续作为版本白名单与 `!!js` 探针的单一事实源，但将 `GATE_VERSION` 语义改为 `GATE_VERSIONS` 精确元组 `['0.1.2-rc.1', '0.1.5-rc.1']`，并把该列表内嵌到探针表达式。探针逐个检查两个锚点：每个版本必须在列表内，且第二个锚点必须与第一个锚点的实际版本相同。`src/index.ts` 的 backstop 使用同一列表检查两个 manifest，并拒绝跨白名单版本的混合锚点；诊断消息列出完整白名单。

`scripts/write-patch.mjs` 仍从 `lib/gate.js` 生成 patch；`cordis.patch.yml` 只通过 `npm run build` 更新。测试 fixture 继续支持 pnpm 路径段和 npm 扁平 manifest 回退，但会为 `0.1.5-rc.1` 增加显式 active、混合版本和 fail-loud 覆盖。文档以“精确版本集合”描述白名单，不使用 `>=`、范围或 `latest`。

## 全局约束

- 白名单只能匹配精确字符串：`0.1.2-rc.1`、`0.1.5-rc.1`；禁止范围、前缀、`>=`、`latest` 或“任意 `0.1.x`”判断。
- 双锚点必须同时存在、都属于白名单，并且版本值相同；例如 runtime 为 `0.1.2-rc.1`、connection 为 `0.1.5-rc.1` 时保持 dormant，不能因为两个值分别都在列表内而激活。
- 组合期任何解析、读取或求值异常都 fail-closed 到 dormant；`apply()` 只有在产品 loader、internal resolver、当前 entry 存在时才执行 backstop，backstop 发现版本或行绑定异常则 fail loud，并且必须发生在创建服务、注册 `/api` 路由和输出启动警告之前。
- 保留现有双锚点解析基准：runtime 本体只能从 runtime fallback 解析，插件不得声明任何 `@deepseek-ai` 运行时 dependency；`@deepseek-ai/dsh-client-connection` 仍作为现有 pinned devDependency 供编译期类型与构建锚点使用，不因本次白名单扩展新增运行时依赖。
- 保留 npm 扁平布局的 manifest 回退、pnpm 路径段快路径、Node `^22.19.0 || >=24`、ESM、Node 内置 test runner、host 源码 `.js` 相对导入和生成 patch 的确定性约束。
- 保留固定启动警告文案和 trusted-network 请求信任栅栏；不添加 `skipBrowserAuth` 配置，不创建监听 `3080` 的进程或服务，不修改 systemd 单元。
- 文档和代码注释继续使用中文；验证命令在 `/home/ubuntu/workspace/dsh-skip-browser-auth` 下执行。

## 输入工件

- 用户需求：额外将 DSH `0.1.5-rc.1` 加入现有 `0.1.2-rc.1` 白名单，并同步升级 README 与仓库说明文档。
- 术语与边界：`CONTEXT.md`。
- 当前机制说明与验证协议：`README.md`、`docs/DESIGN.md`、`cordis.patch.yml`、`src/gate.ts`、`src/index.ts`。
- 既有实现历史：`docs/plans/2026-09-04-dsh-skip-browser-auth-implementation-plan.md`；该文件保留为历史计划，不在本次改动中重写。

## 文件结构与职责

- Modify: `src/gate.ts` — 引入 `GATE_VERSIONS`（以及供 host 使用的白名单判断辅助），生成允许两个精确版本且拒绝混合锚点的探针表达式。
- Modify: `src/index.ts` — 让 manifest backstop 检查完整版本集合、拒绝混合锚点并输出完整白名单诊断。
- Modify: `scripts/write-patch.mjs` — 更新生成产物头注释，明确两个锚点必须命中同一个白名单版本。
- Regenerate: `cordis.patch.yml` — 由 `npm run build` 机械生成，禁止手工编辑表达式。
- Modify: `package.json` — 更新公开 description 中的适配版本；不改 package version、依赖或 lockfile。
- Modify: `tests/gate.test.mjs`、`tests/helpers/gate-fixture.mjs`、`tests/manifest.test.mjs` — 覆盖版本列表、双版本接受、混合版本拒绝和发布清单不变量。
- Modify: `tests/host-apply.test.mjs` — 覆盖 `0.1.5-rc.1` 的 backstop 放行、manifest 漂移、混合锚点 fail loud 与完整白名单诊断。
- Modify: `tests/patch.test.mjs`、`tests/composition/active.test.mjs`、`tests/composition/npm-flat.test.mjs`、`tests/composition/gate-binding.test.mjs` — 覆盖生成 patch、pnpm/npm 两种布局、第二白名单版本 active 和混合版本 dormant/fail loud。
- Modify: `README.md` — 更新用户安装说明、版本矩阵、agent 提示词、安全说明和两版本 active 验证清单。
- Modify: `CONTEXT.md` — 更新 whitelist 术语及双锚点同版本约束。
- Modify: `docs/DESIGN.md` — 更新详版兼容表、探针机制、行为矩阵、升级策略、限制和实机验证清单。
- Test/verify: `package-lock.json` 不应发生变更；`lib/` 仍为构建忽略产物。
- Create: 本计划文件 `docs/plans/2026-09-10-multi-version-whitelist-implementation-plan.md`。

## 任务清单

### Task 1: 将 gate 探针改为双版本白名单并补齐单元测试

- 目标：使组合期版本探针接受两个白名单版本，但拒绝未列版本和两个锚点的混合版本。
- 涉及文件：`src/gate.ts`、`tests/gate.test.mjs`、`tests/helpers/gate-fixture.mjs`、`tests/manifest.test.mjs`。
- 接口契约
  - Consumes: 现有 `GATE_ANCHOR_PACKAGES`、pnpm 路径段与 npm manifest 回退逻辑、`writeGateFixtures()` 的双锚点 URL 分发。
  - Produces: `GATE_VERSIONS` 精确元组、`isWhitelistedGateVersion(version)`（类型守卫/白名单判断）、包含完整版本列表的 `GATE_PROBE_EXPRESSION`；后续 Task 2、Task 3 和生成脚本使用这些导出。
- 验证范围：pnpm v1/v2、npm 扁平 manifest、路径段优先级、异常 fail-closed、两个白名单版本 active、未列版本与混合版本 dormant。

- [ ] Step 1: 先加入失败检查：
  - `tests/gate.test.mjs` 改为导入 `GATE_VERSIONS`，断言它严格等于 `['0.1.2-rc.1', '0.1.5-rc.1']`；对两个版本分别写双锚点 fixture 并断言探针为 `true`；加入 `0.1.4-rc.1`（或其他未列版本）为 `false`，以及 runtime/connection 分别使用两个白名单版本时为 `false`。
  - `tests/helpers/gate-fixture.mjs` 的默认版本从硬编码改为使用编译后 `GATE_VERSIONS[0]`，避免测试 helper 再维护第二份白名单。
  - `tests/manifest.test.mjs` 改为验证编译期 connection devDependency 仍是一个明确的白名单版本，且两个锚点都不进入 runtime `dependencies`。
- Run: `npm test`
- Expected: 当前 `lib/gate.js` 没有 `GATE_VERSIONS`/新导出，测试在模块导入或常量断言处失败；这是实现前的可观察红灯。
- [ ] Step 2: 实现最小 gate 变更：
  - 在 `src/gate.ts` 定义 `GATE_VERSIONS = ['0.1.2-rc.1', '0.1.5-rc.1'] as const` 和 `isWhitelistedGateVersion`；如为保持现有内部 fixture 兼容而保留 `GATE_VERSION`，只能作为首个版本的兼容别名，所有新判断与文档语义必须使用复数列表。
  - 在 `GATE_PROBE_EXPRESSION` 中内嵌 `JSON.stringify(GATE_VERSIONS)`；对每个锚点先确认解析版本属于列表，再保存首个锚点版本并要求后续锚点与其相等；保留 v1/v2 resolve、pnpm 段、npm manifest 回退和总异常捕获。
  - 更新文件头注释、函数注释和 `@returns`，把“等于唯一 `GATE_VERSION`”改为“命中同一个白名单版本”。
- Run: `npm run build && npm run typecheck && npm test`
- Expected: 构建重新生成 `lib/gate.js`，gate、manifest、既有回归测试全部通过；探针对 `0.1.2-rc.1` 与 `0.1.5-rc.1` 返回 `true`，未列或混合版本返回 `false`。
- [ ] Step 3: 运行 clean-build smoke，确认 host 相对导入与生成前置条件未受影响：
- Run: `rm -rf lib && npm run build && node --input-type=module -e "await import('./lib/host.js')"`
- Expected: 退出码为 0，`lib/host.js` 可加载。

### Task 2: 让 host backstop 共享白名单并拒绝混合 manifest

- 目标：`apply()` 的最后防线与组合期探针使用相同的两个版本集合和同版本约束。
- 涉及文件：`src/index.ts`、`tests/host-apply.test.mjs`。
- 接口契约
  - Consumes: Task 1 产出的 `GATE_VERSIONS`、`isWhitelistedGateVersion`、`GATE_ANCHOR_PACKAGES`。
  - Produces: 对两个白名单版本都能通过的 `assertGateBackstop(ctx)`；对未列版本、manifest 漂移、混合白名单 manifest 输出含完整 `whitelist` 的 fail-loud 错误，且错误发生在 route/service/warning 之前。
- 验证范围：`0.1.5-rc.1` 正常 backstop、两个锚点 manifest 漂移、混合版本拒绝、缺失 loader/internal/current entry 的既有行为。

- [ ] Step 1: 加入失败测试：
  - 在 `tests/host-apply.test.mjs` 使用 `writeGateFixtures()` 构造 runtime 与 connection 都为 `0.1.5-rc.1` 的完整 fixture，提供绑定完好的 `ctx.loader`/`ctx.fiber.entry`，断言 `apply(ctx, {})` 成功注册 `/api` route，并断言错误文案在负向场景中同时包含 `0.1.2-rc.1` 与 `0.1.5-rc.1`。
  - 增加 runtime=`0.1.2-rc.1`、connection=`0.1.5-rc.1` 的混合 manifest 用例，断言 backstop 拒绝且消息含 `whitelist`；保留现有路径段真、manifest 漂移负向用例并至少将一个 fixture 切换为 `0.1.5-rc.1`。
- Run: `npm test`
- Expected: 在仍使用单版本比较的实现下，`0.1.5-rc.1` 成功用例被错误拒绝，或混合版本用例无法证明“两个白名单值不能混用”，形成明确红灯。
- [ ] Step 2: 实现 backstop：
  - `src/index.ts` 改为导入 `GATE_VERSIONS` 与 `isWhitelistedGateVersion`；遍历 `GATE_ANCHOR_PACKAGES` 时读取 manifest，首个 manifest 记录 `expectedVersion`，后续 manifest 必须相等且每个版本必须在白名单内。
  - 将“未解析”和“manifest 不在白名单”诊断改为列出 `['0.1.2-rc.1', '0.1.5-rc.1']`；为两个锚点都是白名单但彼此不同的情况增加明确的混合版本/gate anchor 诊断。不要放宽缺失 loader/internal/current entry 的 fail-loud 规则。
- Run: `npm run build && npm run typecheck && npm test`
- Expected: Task 2 新增与既有 host-apply 测试全部通过，失败发生在服务创建、路由注册和固定警告之前。

### Task 3: 重新生成 patch 并覆盖第二版本的真实组合路径

- 目标：生成的 `cordis.patch.yml` 与多版本 gate 常量一致，并通过 pnpm/npm 组合测试证明 `0.1.5-rc.1` 的 active/dormant 边界。
- 涉及文件：`scripts/write-patch.mjs`、`cordis.patch.yml`、`tests/patch.test.mjs`、`tests/composition/active.test.mjs`、`tests/composition/npm-flat.test.mjs`、`tests/composition/gate-binding.test.mjs`。
- 接口契约
  - Consumes: Task 1 的 `GATE_PROBE_EXPRESSION`/`GATE_ROW_ALLOWED_EXPRESSION` 和 Task 2 的 backstop 行为。
  - Produces: 确定性生成的 `cordis.patch.yml`；pnpm 与 npm 扁平布局下 `0.1.5-rc.1` active；混合版本在组合期 dormant 或在 backstop 处 fail loud；既有 rc.2、name mismatch、后续 patch 覆盖回归保持通过。
- 验证范围：patch 结构、两个版本的 active 行互斥、npm manifest 回退、混合版本拒绝、生成幂等。

- [ ] Step 1: 先加入失败检查：
  - `tests/patch.test.mjs` 将 active fixture 参数化为 `0.1.2-rc.1` 和 `0.1.5-rc.1`，并新增混合双锚点求值为 `false` 的断言。
  - `tests/composition/active.test.mjs` 至少为 `0.1.5-rc.1` 跑一次完整 trusted-network active 组合；`tests/composition/npm-flat.test.mjs` 将一个 active manifest-fallback 用例使用 `0.1.5-rc.1`；`tests/composition/gate-binding.test.mjs` 将版本漂移 backstop 用例使用 `0.1.5-rc.1`。
- Run: `npm test`
- Expected: 生成的旧 patch 探针只接受 `0.1.2-rc.1`，新增 `0.1.5-rc.1` 组合断言失败。
- [ ] Step 2: 更新生成器并生成产物：
  - `scripts/write-patch.mjs` 的 header 改为说明“两个锚点必须同为 `0.1.2-rc.1` 或 `0.1.5-rc.1`”，并继续声明任何解析/绑定失败都 dormant；不在 `cordis.patch.yml` 手工修改长表达式。
  - 执行 `npm run build` 生成 `cordis.patch.yml`，确认产物中探针与行绑定表达式都包含两个版本列表及同版本约束。
- Run: `npm run build && git diff --exit-code cordis.patch.yml && npm test`
- Expected: patch 生成幂等、结构断言通过、两个版本的 patch active 组合通过，rc.2 与既有 gate-binding 回归不变。

### Task 4: 更新 package metadata 与用户向 README

- 目标：让 npm 元数据和 README 明确反映两个精确白名单版本，并提供可执行的安装后判断与升级验证说明。
- 涉及文件：`package.json`、`README.md`。
- 接口契约
  - Consumes: Task 1–3 的最终白名单与行为矩阵。
  - Produces: 不含单版本过时断言的公开说明；README 明确列出两个 active 版本、其他版本 dormant、混合锚点不激活、探测失败 fail-closed、固定安全警告和两版本验证命令。
- 验证范围：版本号、安装提示词、兼容表、机制描述、安全警告和 active checklist 与源码一致；package-lock 不因 metadata 更新而改变。

- [ ] Step 1: 写文档前检查：
  - 对照 `README.md` 中当前“仅 `0.1.2-rc.1`”的介绍、badge、兼容表、agent 提示词和 active 清单，列出所有需要从单数改为集合的段落；确认 `package.json.description` 也没有继续声称只支持一个版本。
- Run: `node --input-type=module -e "import fs from 'node:fs'; const files=['README.md','package.json']; for (const f of files) { const s=fs.readFileSync(f,'utf8'); if (!s.includes('0.1.2-rc.1')) throw new Error(f+' missing 0.1.2-rc.1'); if (!s.includes('0.1.5-rc.1')) console.log(f+' currently lacks 0.1.5-rc.1'); }"`
- Expected: 当前 `README.md` 与 `package.json` 至少有一个不包含 `0.1.5-rc.1`，并输出缺失文件。
- [ ] Step 2: 更新内容：
  - `package.json.description` 改为同时描述 `0.1.2-rc.1` 与 `0.1.5-rc.1`，不改变 package `version`、依赖和 `package-lock.json`。
  - README badge、开头摘要、安装后的 agent 提示词、兼容版本表、版本白名单与升级策略统一列出两个精确版本；将“当前仅一个/唯一激活版本”改为“两个版本组成的精确白名单”。
  - 补充“两个锚点必须是同一个白名单版本”的说明和混合版本行为；active 判断同时要求免 token首页行为、`/?token=x` 的 303、无 cookie `/api` 非 401/403 与固定 warning，不能只看 dump-config；active 验证清单标题和命令适用于升级到任一白名单版本。
  - 保留网络可达即身份、安全警告、dormant 前后对照、测试命令和已知限制；明确 `0.1.5-rc.1` 已加入代码白名单，但对应真实 DSH 部署仍需按清单验证，不能伪造实机结果。
- Run: `node --input-type=module -e "import fs from 'node:fs'; const s=fs.readFileSync('README.md','utf8'); for (const v of ['0.1.2-rc.1','0.1.5-rc.1']) if (!s.includes(v)) throw new Error('README missing '+v); for (const stale of ['当前仅 `0.1.2-rc.1`','当前生效的兼容版本只有一个']) if (s.includes(stale)) throw new Error('stale README text: '+stale);" && git diff --check && git diff --exit-code package-lock.json`
- Expected: 两个版本均出现在 README，旧单版本断言不存在，空白检查通过，package-lock 无差异。

### Task 5: 更新术语、详版设计与维护说明

- 目标：让仓库内的技术说明与实现一致，并补充双版本/混合版本的行为与运维验证边界。
- 涉及文件：`CONTEXT.md`、`docs/DESIGN.md`。
- 接口契约
  - Consumes: Task 1–4 的版本集合、探针/backstop 语义、组合测试结果和 README 的用户向表述。
  - Produces: `whitelist` 术语定义、兼容版本表、机制、行为矩阵、升级策略、限制和 active 验证清单均反映两个精确版本；历史 `docs/plans/2026-09-04-dsh-skip-browser-auth-implementation-plan.md` 不被改写。
- 验证范围：文档没有把白名单写成范围/唯一单值，明确“同版本双锚点”和 fail-closed/fail-loud 边界，命令与仓库脚本一致。

- [ ] Step 1: 写文档前检查：
  - 读取 `CONTEXT.md` 的 whitelist 定义、`docs/DESIGN.md` 的兼容表/机制/版本策略/行为矩阵/限制/active 清单，标出所有“只有一个”“唯一 `0.1.2-rc.1`”和仅适用于 `0.1.2-rc.1` 的标题或说明；将历史实施计划列为不改写的历史输入。
- Run: `node --input-type=module -e "import fs from 'node:fs'; for (const f of ['CONTEXT.md','docs/DESIGN.md']) { const s=fs.readFileSync(f,'utf8'); if (!s.includes('0.1.2-rc.1')) throw new Error(f+' missing existing whitelist'); if (!s.includes('唯一') && f === 'CONTEXT.md') console.log(f+' has no current singleton marker'); }"`
- Expected: 当前 `CONTEXT.md` 与 `docs/DESIGN.md` 至少有一个缺少 `0.1.5-rc.1`，或仍含只支持单版本的旧表述，形成待修正文档差异。
- [ ] Step 2: 更新技术说明：
  - `CONTEXT.md` 将 whitelist 定义改为两个精确字符串集合，补充“双锚点必须命中同一集合成员；混合版本不激活”的术语约束，同时保留“不可安全跟随时做版本分叉”的原则。
  - `docs/DESIGN.md` 增加/更新 `0.1.2-rc.1` 与 `0.1.5-rc.1` 两行兼容表，改写探针与 backstop 说明、版本升级策略、行为矩阵和已知限制；加入“各白名单版本单独验证，混合锚点 dormant/fail loud”的示例。
  - 将 active 实机清单改为“升级到 `0.1.2-rc.1` 或 `0.1.5-rc.1` 后”，用同一组命令验证；新增说明组合 fixture 证明的是门控与回归，不等于已经完成真实 `0.1.5-rc.1` 部署验证，避免过度宣称。
- Run: `node --input-type=module -e "import fs from 'node:fs'; for (const f of ['CONTEXT.md','docs/DESIGN.md']) { const s=fs.readFileSync(f,'utf8'); for (const v of ['0.1.2-rc.1','0.1.5-rc.1']) if (!s.includes(v)) throw new Error(f+' missing '+v); } const d=fs.readFileSync('docs/DESIGN.md','utf8'); if (!/同一|混合/.test(d)) throw new Error('DESIGN.md lacks same-version/mixed-version rule');" && git diff --check`
- Expected: 两份说明都含两个版本与同版本约束，`git diff --check` 通过；历史实施计划未被修改。

## 任务间接口契约

- Task 1 产出 `GATE_VERSIONS`、`isWhitelistedGateVersion` 与包含“列表成员 + 锚点间版本相等”语义的 `GATE_PROBE_EXPRESSION`；Task 2 必须直接消费这些导出，不能在 `src/index.ts` 重新维护版本字面量。
- Task 2 产出完整白名单错误文案和混合 manifest 拒绝行为；Task 3 的 patch/组合测试必须覆盖该行为，Task 4/5 的文档必须按同一行为矩阵描述。
- Task 3 产出通过 `npm run build` 生成的 `cordis.patch.yml`；Task 4/5 不手工复制长表达式，只引用其版本和行为语义。
- Task 4 的 README 用户验证步骤与 Task 5 的 DESIGN 详版步骤必须保持同一固定 warning、状态码和回滚命令；不把 dump-config 单独当作激活证明。

## 执行纪律

- 开始实现前先批判性复查本计划；如果发现文件、导出名、版本约束或验证命令与仓库现实不一致，先修计划再改代码。
- 按 Task 1→5 顺序执行，不无声跳步、合并任务或改变任务目标；每完成一个任务立即运行该任务定义的验证。
- 遇到依赖不可安装、测试重复失败、真实包 API 与现有 host 复用契约不一致，立即停下说明，不猜测放宽白名单或跳过测试。
- 仅在插件仓库 `/home/ubuntu/workspace/dsh-skip-browser-auth` 内修改文件；不要修改工作区顶层现有无关改动，不要修改 `~/.dsh/AGENTS.md`、systemd、反代或 3080 服务。
- 不进行 npm 发布、Git push 或服务重启；本次需求只交付仓库代码、生成 patch、测试和说明文档。
- 每次改动后先运行 `git diff --check`；不得手工编辑 `cordis.patch.yml` 的生成表达式或提交 `lib/` 构建产物。

## 最终验证

在插件仓库目录执行：

1. `npm run test:all`：rc.2 fixture 安装脚本、build、typecheck、全部 Node test（含两个白名单版本、混合版本、npm/pnpm 组合）退出码均为 0；fixture 脚本继续证明没有修改 `package.json` 或 `package-lock.json`。
2. `rm -rf lib && npm run build && node --input-type=module -e "await import('./lib/host.js')"`：clean-build smoke 通过。
3. `git diff --exit-code cordis.patch.yml`：生成 patch 与仓库版本一致，重复 build 不产生差异。
4. `npm pack --dry-run --json`：包清单含 `lib/host.js`、`lib/client.js`、`cordis.patch.yml`、`package.json`、`README.md`、`LICENSE`、`NOTICE`，不含 `src/` 与 `docs/` 私有/开发文件。
5. `node --input-type=module -e "import fs from 'node:fs'; const files=['README.md','CONTEXT.md','docs/DESIGN.md','package.json']; for (const f of files) { const s=fs.readFileSync(f,'utf8'); for (const v of ['0.1.2-rc.1','0.1.5-rc.1']) if (!s.includes(v)) throw new Error(f+' missing '+v); }"`：公开元数据与当前说明均提及两个白名单版本。
6. `git diff --check && git status --short`：无空白错误；只出现本计划列出的源码、测试、生成 patch、元数据和文档改动，`lib/` 不入 Git，`package-lock.json` 无意外变化。

真实 DSH `0.1.5-rc.1` 主机的 active 实机验证不在本次仓库改动中伪造；交付文档必须保留可执行清单，待该版本部署后按清单记录实际状态码、warning 和回滚结果。

## 审阅 Checkpoint

实施计划已写好并保存到 `docs/plans/2026-09-10-multi-version-whitelist-implementation-plan.md`。请先确认这份计划；审阅通过后，下一步再按 Task 1–5 由普通编码 agent 或人工执行者实施。
