# dsh-skip-browser-auth 实施计划

## 目标

- 交付个人用 DSH 插件 `dsh-skip-browser-auth`：安装在任意 DSH 版本上都成功；仅在 `@deepseek-ai/dsh-client-connection` 版本为 `0.1.2-rc.1` 时激活，禁用官方 `connection` row 并提供跳过 BrowserAuth 的等效 Connection 能力；其他版本（含 `0.1.1-rc.2`）保持 dormant。
- **dormant 的定义是行为前后一致**：安装前官方行为是什么，安装后仍是什么（不硬编码任何具体状态码）；对已核实的本机 rc.2 而言，基线为根路径 `200`、未认证 `/api` `200`（rc.2 本身无 BrowserAuth 层）。
- 全部行为由本地组合测试矩阵覆盖：active（rc.1 + 门控真）、gate-false wiring（rc.1 + 门控假）、真实 rc.2 dormant（加载真实 `0.1.1-rc.2` 官方产物）、gate 绑定负向用例（name mismatch、后续层强制 disabled、路径/manifest 版本漂移）；本机完成 dormant 前后对照实机验证；active 实机验证清单留给 DSH 升级到 `0.1.2-rc.1` 后执行。
- 不写任何实现代码以外的新范围：不改 DSH、不建仓库外服务、不发布 npm、不收录 dsh-m（留给后续）。

## 架构快照

**形态**：单 DSH 插件包（dual-face：host `lib/host.js` + client `lib/client.js`），经 `dsh.bundle.patch` 声明 `cordis.patch.yml`。任何版本都可 `dsh plugin add` 安装。

**自门控（组合期激活，双行绑定）**：bundle patch 含两行，第二行的激活条件绑定第一行的实际结果，且**直接包含版本探针**：

1. patch 官方行：`id: connection`、`name: '@deepseek-ai/dsh-client-connection'`（名称不匹配时 Include 警告并跳过本 patch）、`disabled: !!js <GATE_PROBE_EXPRESSION>`；
2. insert 插件行：`id: trusted-connection`、`name: dsh-skip-browser-auth`、`inject: [webRuntime]`、`config.trustedHosts: !!js ctx.webRuntime.trustedHosts`、`disabled: !!js !(<GATE_ROW_ALLOWED_EXPRESSION>)`。

`GATE_ROW_ALLOWED_EXPRESSION = probe && 同组 sibling 校验`：

- 版本探针本身为 `true`（不依赖 `official.disabled` 反推——后续 patch 层可以在未知版本上把官方行设为 `disabled: true`，此时 Replacement 仍必须 dormant）；
- 通过 `ctx[Symbol.for('cordis.entry')]` 取**当前 entry**，从 `self.parent.tree.resolve('connection')` 解析 sibling（业务行位于 Include 子树，根 Loader 的 `resolve` 看不到它们），并校验 `official.parent === self.parent`、`official.options.id === 'connection'`、`official.options.name === CONNECTION_PACKAGE`；
- `official.disabled === true`（getter 重新求值第一行探针，绑定第一行的实际结果）。

任一条件不成立 → Replacement dormant。Loader 对 `disabled` 的 `!!js` 求值发生在所有插件 `apply()` 之前的同步阶段；同一子树列表按顺序同步创建（前一行 store 写入与 options 赋值先于后一行求值），sibling 读取可靠。

**探针（纯版本白名单）**：npm 发布产物只含 `lib/`（实测无 `src/`），探针同步解析 `@deepseek-ai/dsh-client-connection/package.json`，从 pnpm store 路径段 `@deepseek-ai+dsh-client-connection@<版本>_<hash>` 提取版本，与 `'0.1.2-rc.1'` 精确比对；解析失败、无 internal、路径无版本段一律 `false`（dormant）。

**Replacement 组成**：

- host 半区复用官方导出的 `HostConnectionService`（对认证的全部依赖只有 `isAuthenticated` / `authorizeIndex` / `authenticatedUrl` 三个方法），传入 `createTrustedAuth(trustedHosts)`——首页 fence 与 `/api` fence 消费同一个 `trustedHosts`；`/api` 前缀路由、请求体上限、image capacity 断言由插件胶水复刻官方 `apply` 语义；`http-bridge` 按官方源码复刻（官方未导出）。
- Host/Origin trust fence 由插件自写（官方未从入口导出），语义照抄 rc.1；`/api` 与 Remote WebSocket 的 fence 由官方 service 内部执行。
- 按 Q8：`authorizeIndex` 新增 trust fence（不可信 403）；按 Q9：`GET /` 带 token → 303 干净 `/`。
- client 半区：**发布的 `lib/client.js` 已是 `window.__ModuleLoader__.load({ id, factory })` 最终 bundle（已实测：六个锚点串各恰好出现 1 次，包名全文件仅出现于注册 id 一处）**。构建不做任何 import/再打包，只做不可变 re-ID：读取 pinned 依赖的 `client.js`，断言锚点唯一性，把注册 id `id: "@deepseek-ai/dsh-client-connection"` 精确替换为 `id: "dsh-skip-browser-auth"`（恰好 1 处），其余字节不变写入本包 `lib/client.js`。
- 浏览器侧无模块表断链：`api-gateway`/`session-controller`/`workspace-controller` 对 connection 只有 `dsh.client.inject`（纯信息）或对 `@deepseek-ai/dsh-api-gateway/client` 的 external；client-modules 组图跳过 `disabled` 行，官方行休眠时其 client bundle 不进图。

**apply 内 backstop（版本与绑定状态断言）**：`apply()` 里用 `ctx.loader.internal.resolveSync(ctx.baseUrl, …)` 解析官方包（与官方 row 同一解析锚点，非插件私有依赖），`readFileSync(fileURLToPath(url))` 读 manifest 比对白名单；并通过 `ctx.fiber.entry`（当前 `trusted-connection` entry）从 `entry.parent.tree.resolve('connection')` 取 sibling 官方行，校验同组、name、`disabled === true`、无活跃 fiber。任一不满足即 throw（fail loud，最后防线）；`ctx.loader`/`ctx.fiber.entry` 不存在时（仅手搭测试上下文）跳过。

**已排除方案**（不再重开）：官方认证策略 seam（要改 DSH）；插件 `apply()` 运行时检测作为唯一门控；安装器版本预检；`inject`/`intercept` 服务门控；不禁用官方行直接并行提供服务；esbuild 二次打包官方 client bundle（发布产物已是最终 ModuleLoader wrapper，不可作为普通 ESM 导入）。

**参照源码**（只读研究副本）：`/home/ubuntu/workspace/.dsh-research/deepseek-harness-v0.1.2-rc.1/`（下称 `RC1`）。

## 全局约束

- 严格不改 DSH：不修改官方包源码、API、依赖与部署文件；所有改动限于本插件仓库。
- 版本白名单：唯一允许版本为字符串精确值 `'0.1.2-rc.1'`；禁止 `>=`、范围、`latest` 判断；任何探测失败都必须落入 dormant（fail-closed 到 dormant，而非 fail loud）。
- dormant 判定采用**前后对照**；已核实的 rc.2 基线（根 `200`、未认证 `/api` `200`）只作为本机预期参考值。
- 始终 skip：不设 `skipBrowserAuth` 配置项；卸载或禁用插件并重启即恢复官方行为。
- 启动警告固定文案（Replacement 激活时 `console.warn` 输出，逐字）：
  `dsh-skip-browser-auth: BrowserAuth has been skipped. DSH Web is using the trusted-network behavior; this plugin does not verify any upstream proxy.`
- 不创建任何监听 3080 的进程或服务；不修改 systemd 单元；不检测、不配置反向代理。
- host 源码相对导入一律使用 **`.js` specifier**；每个涉及 host 源码的任务完成后必须通过 clean-build smoke：`rm -rf lib && npm run build && node --input-type=module -e "await import('./lib/host.js')"`。
- 客户端构建原则：发布的官方 client bundle 是不可变产物，只做**精确 re-ID**（锚点唯一性断言 + 单处 id 替换），禁止 import/再打包。构建不使用 esbuild。
- 依赖钉死：
  - `dependencies`（唯一运行时依赖）：`@deepseek-ai/dsh-client-connection` 精确 `"0.1.2-rc.1"`。
  - `peerDependencies`：`@deepseek-ai/cordis: "*"`、`@deepseek-ai/schemastery: "*"`。
  - `devDependencies`：`typescript: "^5.6.0"`、`@types/node: "^24.0.0"`、`js-yaml: "^4.2.0"`、`@deepseek-ai/cordis: "4.0.2"`、`@deepseek-ai/cordis-plugin-include: "1.0.7"`、`@deepseek-ai/cordis-plugin-loader: "1.0.3"`、`@deepseek-ai/dsh-host-webserver: "0.1.2-rc.1"`、`@deepseek-ai/dsh-host-frontend-static: "0.1.2-rc.1"`、`@deepseek-ai/dsh-credentials: "0.1.2-rc.1"`、`@deepseek-ai/dsh-credentials-local: "0.1.2-rc.1"`、`@deepseek-ai/schemastery: "^3.18.2"`（均核实存在）。
  - rc.2 dormant 组合所需 `0.1.1-rc.2` 产物不进 package.json，由 Task 9 fixture 脚本以 `npm install --no-save --legacy-peer-deps` 别名安装。
- 运行环境：Node `^22.19.0 || >=24`（本机 v24.20.0；与 package.json engines 一致）；ESM；构建用 tsc（host）+ 发布产物 re-ID（client）+ js-yaml 生成 patch；测试用 Node 内置 test runner。
- 仓库依赖安装器不限：组合测试用受控探针 fixture（真实文件）注入探针值；真实布局验证点为 Task 5 真实路径断言（pnpm 时执行）与 Task 11 实机前后对照。
- 语言规范：代码注释中文、文档中文（跟随 dsh-m 惯例）。
- checkpoint commit 使用显式路径 `git add <paths> && git diff --cached --check && git commit`。

## 输入工件

- 术语表：`/home/ubuntu/workspace/dsh-skip-browser-auth/CONTEXT.md`。
- 设计共识：grilling 结论 Q1–Q11；评审二轮修订要求（BLOCKER-1…4、MAJOR-1…5、Task 11 四点）。
- 移植参照：`RC1/packages/client/connection/src/`、`RC1/vendor/include/src/index.ts`（`!!js` 标签）、`RC1/vendor/loader/src/config/{tree,entry,group,utils}.ts`（`resolve`/`disabledOf`/`Entry.key = Symbol.for('cordis.entry')`/求值语义）。
- npm 实测：`@deepseek-ai/dsh-client-connection@0.1.2-rc.1` 发布 `lib/client.js` 首行 `window.__ModuleLoader__.load({`、`\tid: "@deepseek-ai/dsh-client-connection",`、尾部 `exports.apply = apply; exports.inject = inject; … return module.exports;`；六个锚点串（wrapper 开头、注册 id、`dsh-client-connection`、`exports.apply = apply`、`exports.inject = inject`、`return module.exports`）各恰好出现 1 次。

## 文件结构与职责

- Create: `package.json` — 包清单（完整契约见 Task 1）、依赖分节、build/typecheck/test/test:rc2-fixture/test:all 脚本
- Create: `package-lock.json` — `npm install` 生成并提交（依赖复现性；fixture 安装以 `--package-lock=false` 保证不改动它，Task 9 用 `git diff` 证明）
- Create: `tsconfig.json` — host 半区编译（`src` → `lib`，NodeNext，strict）
- Create: `.gitignore` — `node_modules/`、`lib/`
- Create: `scripts/build.mjs` — tsc 构建 `lib/host.js`、官方 client 产物 re-ID 写出 `lib/client.js`、调用 patch 生成、产物断言
- Create: `scripts/write-patch.mjs` — 从 `lib/gate.js` 常量用 js-yaml 确定性生成 `cordis.patch.yml`（单一常量源，无人工复制）
- Create: `scripts/install-rc2-fixture.mjs` — 以 `--no-save --legacy-peer-deps` 别名安装 rc.2 dormant 组合所需产物
- Create: `cordis.patch.yml` — 生成产物（提交入库；build 后 `git diff --exit-code` 校验一致）
- Create: `src/gate.ts` — `GATE_VERSION`、`CONNECTION_PACKAGE`、`GATE_PROBE_EXPRESSION`、`GATE_ROW_ALLOWED_EXPRESSION`、`evaluateGate(ctx)`
- Create: `src/trust-fence.ts` — `isTrustedApiRequest`、`assertTrustedAuthority`
- Create: `src/trusted-auth.ts` — `createTrustedAuth(trustedHosts)`
- Create: `src/bridge.ts` — `bridge(...)`、`DEFAULT_MAX_REQUEST_BODY_BYTES`
- Create: `src/index.ts` — host apply（含 loader 锚点 backstop）
- Create: `tests/*.test.mjs`、`tests/composition/*.test.mjs`、`tests/helpers/compose.mjs`
- Create: `README.md` — 用途、安全警告、安装/卸载、白名单策略、行为矩阵、dormant 前后对照记录、升级后 active 清单、已知限制
- 产物：`lib/host.js`、`lib/client.js`（gitignore）

## 任务清单

### Task 1: 仓库脚手架与构建管线

- 目标：建立可构建、可测试、可提交的空插件包，产物可被 Node 真实加载。
- 涉及文件：`package.json`、`tsconfig.json`、`.gitignore`、`scripts/build.mjs`（本任务先含 tsc + client re-ID + 断言；patch 生成调用在 Task 7 接入）、`tests/smoke.test.mjs`、`src/index.ts`（最小占位 host 入口，Task 6 覆写）。
- 接口契约
  - Consumes: 全局约束依赖清单；pinned 依赖的 `lib/client.js`（re-ID 源）。
  - Produces: `npm run build`、`npm run typecheck`、`npm test`、`npm run test:rc2-fixture`（脚本位，实现在 Task 9）、`npm run test:all`、clean-build smoke、git 仓库（`main`）。
- 验证范围：构建、类型检查、smoke、clean-build 加载、pack 文件清单（不含 README——它在 Task 10 创建）全绿。

- [ ] Step 1: 写失败检查 — `tests/smoke.test.mjs`：`import test from 'node:test'; import assert from 'node:assert/strict'; test('host entry loads', async () => { const mod = await import('../lib/host.js'); assert.equal(typeof mod.apply, 'function'); assert.equal(mod.name, 'dsh-skip-browser-auth'); });`
- Run: `npm test`
- Expected: 失败（`lib/host.js` 不存在）。
- [ ] Step 2: 建包 — `package.json` 完整契约：

  ```json
  {
    "name": "dsh-skip-browser-auth",
    "version": "0.1.0",
    "description": "个人自用：在 DSH 0.1.2-rc.1 上跳过 BrowserAuth 的 trusted-network Connection 替换插件",
    "license": "MIT",
    "type": "module",
    "main": "lib/host.js",
    "exports": {
      ".": "./lib/host.js",
      "./client": "./lib/client.js",
      "./cordis.patch.yml": "./cordis.patch.yml",
      "./package.json": "./package.json"
    },
    "files": ["lib", "cordis.patch.yml", "README.md"],
    "engines": { "node": "^22.19.0 || >=24" },
    "scripts": {
      "build": "node scripts/build.mjs",
      "typecheck": "tsc -p tsconfig.json --noEmit",
      "test": "node --test tests/*.test.mjs tests/composition/*.test.mjs",
      "test:rc2-fixture": "node scripts/install-rc2-fixture.mjs",
      "test:all": "npm run test:rc2-fixture && npm run build && npm run typecheck && npm test",
      "prepare": "npm run build"
    },
    "dsh": {
      "bundle": { "patch": "./cordis.patch.yml" },
      "client": { "platform": "web", "inject": [], "immediately": true }
    },
    "dependencies": { "@deepseek-ai/dsh-client-connection": "0.1.2-rc.1" },
    "peerDependencies": { "@deepseek-ai/cordis": "*", "@deepseek-ai/schemastery": "*" },
    "devDependencies": {
      "@deepseek-ai/cordis": "4.0.2",
      "@deepseek-ai/cordis-plugin-include": "1.0.7",
      "@deepseek-ai/cordis-plugin-loader": "1.0.3",
      "@deepseek-ai/dsh-credentials": "0.1.2-rc.1",
      "@deepseek-ai/dsh-credentials-local": "0.1.2-rc.1",
      "@deepseek-ai/dsh-host-frontend-static": "0.1.2-rc.1",
      "@deepseek-ai/dsh-host-webserver": "0.1.2-rc.1",
      "@deepseek-ai/schemastery": "^3.18.2",
      "@types/node": "^24.0.0",
      "js-yaml": "^4.2.0",
      "typescript": "^5.6.0"
    }
  }
  ```
  `scripts/build.mjs` 本任务实现：①`execFileSync(tsc, ['-p', 'tsconfig.json'])`；②client re-ID——`createRequire(import.meta.url).resolve('@deepseek-ai/dsh-client-connection/client')` 定位官方 `lib/client.js`，读全文，断言六个锚点各恰好出现 1 次（`window.__ModuleLoader__.load({`、`id: "@deepseek-ai/dsh-client-connection"`、`dsh-client-connection`、`exports.apply = apply`、`exports.inject = inject`、`return module.exports`），将 `id: "@deepseek-ai/dsh-client-connection"` 精确替换为 `id: "dsh-skip-browser-auth"`（替换后再次断言原 id 0 次、新 id 恰 1 次），写 `lib/client.js`；③产物断言（client 以 wrapper 开头、含新 id、`lib/host.js` 存在）。`tsconfig.json`：`strict: true`、`module: nodenext`、`moduleResolution: nodenext`、`outDir: lib`、`rootDir: src`、`types: ["node"]`。`.gitignore`：`node_modules/`、`lib/`。执行 `git init -b main`；`npm install` 生成的 `package-lock.json` 纳入版本控制（Step 3 提交）。
- Run: `npm install && npm run build && npm run typecheck && npm test && rm -rf lib && npm run build && node --input-type=module -e "await import('./lib/host.js')" && npm pack --dry-run --json`
- Expected: 全部退出码 0；clean-build 后 `lib/host.js` 可加载；pack `files` 至少含 `lib/host.js`、`lib/client.js`、`package.json`（`cordis.patch.yml` 在 Task 7 生成后纳入断言，README 在 Task 10 后纳入最终验证——Task 1 阶段两者尚不存在，`files` 声明缺失项时 pack 只是省略、不报错）。
- [ ] Step 3: checkpoint commit — `git add package.json package-lock.json tsconfig.json .gitignore scripts/build.mjs tests/smoke.test.mjs src/index.ts && git diff --cached --check && git commit -m "chore: scaffold dsh-skip-browser-auth package"`

### Task 2: 移植 request trust fence（`src/trust-fence.ts`）

- 目标：插件自带与 rc.1 官方语义一致的信任栅栏。
- 涉及文件：`src/trust-fence.ts`、`tests/trust-fence.test.mjs`。
- 接口契约
  - Consumes: `RC1/packages/client/connection/src/api-request-trust.ts`（移植母本）。
  - Produces: `isTrustedApiRequest(request, trustedHosts): boolean`、`assertTrustedAuthority(entry): void`（Task 3、Task 6 消费）。
- 验证范围：官方 `RC1/packages/client/connection/tests/api-request-trust.host.spec.ts` 用例矩阵全绿。

- [ ] Step 1: 写失败测试 — 用例矩阵：loopback 各拼写可过；rebound Host 拒绝；`trustedHosts` 精确/无端口语义；WHATWG 归一化；`sec-fetch-site: cross-site` 拒绝；`origin: null` 拒绝；无 marker 请求受 Host fence 约束；`assertTrustedAuthority` 对非法形态全部抛 `not a bare host[:port] authority`。
- Run: `npm test`
- Expected: 失败（模块不存在）。
- [ ] Step 2: 移植实现 — 照抄官方源码，相对导入用 `.js`，类型局部化，保留原注释。
- Run: `npm run build && npm run typecheck && npm test`
- Expected: 全绿。
- [ ] Step 3: checkpoint commit — `git add src/trust-fence.ts tests/trust-fence.test.mjs && git diff --cached --check && git commit -m "feat: port request trust fence from rc.1"`

### Task 3: stub 认证对象（`src/trusted-auth.ts`）

- 目标：三方法 stub；首页 fence 消费与 `/api` 相同的 `trustedHosts`。
- 涉及文件：`src/trusted-auth.ts`、`tests/trusted-auth.test.mjs`。
- 接口契约
  - Consumes: `src/trust-fence.js` 的 `isTrustedApiRequest`。
  - Produces: `createTrustedAuth(trustedHosts: readonly string[])` → `{ isAuthenticated; authorizeIndex; authenticatedUrl }`（Task 6 消费）。
- 验证范围：本任务用例全绿。

- [ ] Step 1: 写失败测试 — `const auth = createTrustedAuth(['app.internal', 'lan.host:8443'])`：
  - `Host: evil.example` → 写 403 返回 `false`；`Host: app.internal` → 放行；`Host: lan.host:8443` → 放行；`Host: lan.host:9999` → 403；
  - 受信 Host 下 `sec-fetch-site: cross-site` → 403；Origin 与 Host 不一致 → 403；`origin: null` → 403；
  - 可信 `GET /?token=x` → 303（`location: /`、`cache-control: no-store`）返回 `false`；可信 `GET /` → `true`；`GET /index.html?token=x` → `true`；`POST /?token=x` → `true`；
  - `isAuthenticated` 恒 `true`；`authenticatedUrl('http://127.0.0.1:3080/?token=x#frag')` → `'http://127.0.0.1:3080/'`。
- Run: `npm test`
- Expected: 失败（模块不存在）。
- [ ] Step 2: 实现 — `authorizeIndex` 先 `isTrustedApiRequest(request, trustedHosts)`；token 清理仅 `GET /`；303 头含 `cache-control: no-store`、`location: /`、`referrer-policy: no-referrer`；`authenticatedUrl` 用 `new URL` 清 `search`/`hash`、置 `pathname='/'`。
- Run: `npm run build && npm run typecheck && npm test`
- Expected: 全绿。
- [ ] Step 3: checkpoint commit — `git add src/trusted-auth.ts tests/trusted-auth.test.mjs && git diff --cached --check && git commit -m "feat: trusted-network auth stub consuming configured trustedHosts"`

### Task 4: 移植 http bridge（`src/bridge.ts`）

- 目标：`/api` 路由的 node:http ↔ fetch 桥。
- 涉及文件：`src/bridge.ts`、`tests/bridge.test.mjs`。
- 接口契约
  - Consumes: `RC1/packages/client/connection/src/http-bridge.ts`（移植母本）。
  - Produces: `bridge(req, res, apiHandler, maxRequestBodyBytes)`、`DEFAULT_MAX_REQUEST_BODY_BYTES = 300 * 1024 * 1024`（Task 6 消费）。
- 验证范围：本任务用例全绿。责任边界：`bridge()` 对 handler 抛错不捕获（promise reject）；HTTP 错误状态由上层 webserver 请求失败处理负责（其契约为 400 + 告警），不在本任务断言。

- [ ] Step 1: 写失败测试 — fake `req`/`res`（`EventEmitter` + `write/end/writeHead` 记录）：
  - `content-length` 超限 → `413` 且 `req.destroy` 被调用；流式累计超限 → `413`；
  - 正常 JSON POST → handler 收到完整 body，响应透传；
  - handler promise reject → `bridge(...)` reject（不吞错、不写状态码）；
  - 客户端断开：`res.emit('close')` 且未 `writableEnded` → handler 收到的 `request.signal` 被 abort；
  - 背压：`res.write` 首次返回 `false` → 等待 `drain` 后继续写完；等待期间 `close` → 不悬挂。
- Run: `npm test`
- Expected: 失败（模块不存在）。
- [ ] Step 2: 移植实现 — 照抄官方 `http-bridge.ts`（含 `res.on('close')` 挂 abort、`writableEnded` 区分、413 后 `req.destroy()`、drain/close 双等待），相对导入 `.js`。
- Run: `npm run build && npm run typecheck && npm test`
- Expected: 全绿。
- [ ] Step 3: checkpoint commit — `git add src/bridge.ts tests/bridge.test.mjs && git diff --cached --check && git commit -m "feat: port http bridge from rc.1 with abort and backpressure coverage"`

### Task 5: 门控探针与行绑定表达式（`src/gate.ts`）

- 目标：探针与行绑定的单一事实源；sibling 解析走 `Symbol.for('cordis.entry')`，不依赖根 Loader `resolve`。
- 涉及文件：`src/gate.ts`、`tests/gate.test.mjs`。
- 接口契约
  - Consumes: 无。
  - Produces: `CONNECTION_PACKAGE`、`GATE_VERSION`、`GATE_PROBE_EXPRESSION`、`GATE_ROW_ALLOWED_EXPRESSION`、`evaluateGate(ctx)`（Task 6/7 消费）。
- 验证范围：两类表达式在 fake entry/ctx 下的真值矩阵 + 真实 pnpm 路径断言。

- [ ] Step 1: 写失败测试 — `tests/gate.test.mjs`（从 `'../lib/gate.js'` 导入；`ENTRY_KEY = Symbol.for('cordis.entry')`）：
  - `GATE_PROBE_EXPRESSION`（fake `ctx.loader.internal`，v2 `resolveSync(base,{specifier})→{url}`）：url 含 `…@deepseek-ai+dsh-client-connection@0.1.2-rc.1_abc/…` → `true`；`@0.1.1-rc.2_`、`@9.9.9_` → `false`；npm 布局无版本段 → `false`；v1 形态 `0.1.2-rc.1` → `true`；loader/internal 缺失、resolveSync 抛错、url 非字符串 → `false`。
  - `GATE_ROW_ALLOWED_EXPRESSION`：fake `ctx` 以 `ctx[ENTRY_KEY] = fakeSelf` 提供当前 entry，`fakeSelf.parent.tree.resolve = (id) => …`；且 fake `ctx.loader.internal.resolveSync` 返回真实 fixture 文件 url（见下）——表达式内嵌探针必须为 `true`。断言：
    - sibling `{ options: { id: 'connection', name: CONNECTION_PACKAGE }, disabled: true, parent: fakeSelf.parent }` → `true`；
    - sibling `disabled: false` → `false`（即使 name 正确）；
    - sibling name 不匹配 → `false`；
    - `resolve` 抛错（行不存在）→ `false`；
    - `official.parent !== self.parent`（跨组同名行）→ `false`；
    - **探针为假但 sibling `disabled === true`**（模拟后续层强制禁用官方行）→ `false`；
    - **`ctx.loader.resolve` 不存在或抛错但 symbol 路径可用** → 仍按上述结果判定（证明不依赖根 Loader resolve）。
    - fake `resolveSync` 用真实文件：测试内 `mkdtemp` 写 `<tmp>/@deepseek-ai+dsh-client-connection@0.1.2-rc.1_t/node_modules/@deepseek-ai/dsh-client-connection/package.json`（内容 `{"name":"@deepseek-ai/dsh-client-connection","version":"0.1.2-rc.1"}`），url 用 `pathToFileURL`。
  - 真实路径断言：`createRequire(import.meta.url).resolve('@deepseek-ai/dsh-client-connection/package.json')` 匹配 `/@deepseek-ai\+dsh-client-connection@0\.1\.2-rc\.1_/`；非 pnpm 布局 `t.skip`（真实布局由 Task 11 兜底）。
- Run: `npm test`
- Expected: 失败（`lib/gate.js` 不存在）。
- [ ] Step 2: 实现 — `src/gate.ts`（表达式为单行模板字符串，行绑定内嵌探针）：

  ```ts
  export const CONNECTION_PACKAGE = '@deepseek-ai/dsh-client-connection'
  export const GATE_VERSION = '0.1.2-rc.1'
  // 版本探针：单行；生成 cordis.patch.yml 官方行 disabled（scripts/write-patch.mjs）。
  export const GATE_PROBE_EXPRESSION = `(() => { try { const internal = ctx.loader && ctx.loader.internal; if (!internal || typeof internal.resolveSync !== 'function') return false; let url; try { url = internal.version === 'v2' ? internal.resolveSync(ctx.baseUrl, { specifier: '${CONNECTION_PACKAGE}/package.json', attributes: {} }).url : internal.resolveSync('${CONNECTION_PACKAGE}/package.json', ctx.baseUrl, {}).url; } catch (gateError) { return false; } if (typeof url !== 'string') return false; const match = decodeURIComponent(url).match(/[+]dsh-client-connection@([^/_]+)[_/]/); return match !== null && match[1] === '${GATE_VERSION}'; } catch (gateError) { return false; } })()`
  // 行绑定放行：自身探针为真 + 同组 sibling 存在且名字匹配且其 effective disabled 为真。
  // sibling 必须从当前 entry（Symbol.for('cordis.entry')）所属子树解析，
  // 根 Loader 的 resolve 看不到 Include 子树内的行。
  export const GATE_ROW_ALLOWED_EXPRESSION = `(() => { try { const self = ctx[Symbol.for('cordis.entry')]; if (!self || !self.parent || !self.parent.tree) return false; const official = self.parent.tree.resolve('connection'); if (!official || official.parent !== self.parent) return false; if (official.options.id !== 'connection' || official.options.name !== '${CONNECTION_PACKAGE}') return false; const probeAllowed = (${GATE_PROBE_EXPRESSION}); if (probeAllowed !== true) return false; return official.disabled === true; } catch (gateError) { return false; } })()`
  export function evaluateGate(ctx: object): boolean {
    // 与 vendor/loader/src/config/utils.ts 的 evaluate 同语义：with(ctx) + eval。
    return new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }')(ctx, GATE_PROBE_EXPRESSION) as boolean
  }
  ```
- Run: `npm run build && npm run typecheck && npm test`
- Expected: 全绿。
- [ ] Step 3: checkpoint commit — `git add src/gate.ts tests/gate.test.mjs && git diff --cached --check && git commit -m "feat: version probe and subtree-bound row gate expressions"`

### Task 6: host 半区（`src/index.ts`）

- 目标：Replacement host apply：配置校验、官方 service 复用 + stub、`/api` 路由、启动警告、backstop。
- 涉及文件：`src/index.ts`（覆写占位）、`tests/host-apply.test.mjs`。
- 接口契约
  - Consumes: Task 2/3/4/5 产物；pinned 包导出的 `HostConnectionService`、`API_PATH`。
  - Produces: `name`、`inject = ['webServer']`、`Config`（`trustedHosts`、`maxRequestBodyBytes`）、`apply(ctx, config)`。
- 验证范围：hand-built context 下注册/拒绝/放行/警告/backstop 全绿。

- [ ] Step 1: 写失败测试 — `tests/host-apply.test.mjs`（`new Context()` + `ctx.provide('webServer', fake)`）：
  - 注册唯一 `prefix '/api'` 路由；`Host: evil.example` JSON POST → `403 'forbidden'`；loopback → `404 'not found'` 且无 `set-cookie`；
  - `console.warn`（临时替换还原）以固定文案调用；
  - `trustedHosts: ['bad entry']` → reject 含 `not a bare host[:port] authority`；
  - attachments image capacity 不足 → reject 含 `must be at least`；
  - **backstop 负向 A（版本漂移）**：`ctx.provide('loader', fakeLoader)`，其 `internal.resolveSync` 返回真实 fixture 的 url——fixture 的**路径段**是 `@0.1.2-rc.1_t` 但 manifest `version` 写 `9.9.9` → apply reject 含 `whitelist`（探针只读路径段会误判 true，backstop 读 manifest 拦截）；
  - **backstop 负向 B（绑定破坏）**：fakeLoader 内部版本正确，但 `ctx.fiber = { entry: fakeSelf }`、`fakeSelf.parent.tree.resolve('connection')` 返回 `disabled === false` 的官方行 → reject 含 `gate binding`；返回 name 不匹配行 → 同样 reject；
  - `ctx.get('loader')` 缺失（无 fiber entry）→ 跳过 backstop，不抛。
- Run: `npm test`
- Expected: 失败（`src/index.ts` 仍是占位）。
- [ ] Step 2: 实现 — 对齐官方 `apply`：

  ```ts
  import { readFileSync } from 'node:fs'
  import { fileURLToPath } from 'node:url'
  import type { Context } from '@deepseek-ai/cordis'
  import z from '@deepseek-ai/schemastery'
  import { HostConnectionService, API_PATH } from '@deepseek-ai/dsh-client-connection'
  import { assertTrustedAuthority } from './trust-fence.js'
  import { createTrustedAuth } from './trusted-auth.js'
  import { bridge, DEFAULT_MAX_REQUEST_BODY_BYTES } from './bridge.js'
  import { CONNECTION_PACKAGE, GATE_VERSION } from './gate.js'

  export const name = 'dsh-skip-browser-auth'
  export const inject = ['webServer']

  export const Config = z.object({
    trustedHosts: z.array(String).default([]),
    maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
  })
  ```
  `apply` 步骤：①`assertTrustedAuthority` 逐条校验；②image capacity 断言 + `ctx.inject(['attachments'], …)` 复检（照抄官方）；③backstop——`const loader = ctx.get('loader')`；`const current = (ctx as { fiber?: { entry?: EntryLike } }).fiber?.entry`；两者皆存在时：`(a)` 用 `loader.internal` 按 v2/v1 形态解析 `${CONNECTION_PACKAGE}/package.json`（锚点 `ctx.baseUrl`），`JSON.parse(readFileSync(fileURLToPath(url), 'utf8')).version !== GATE_VERSION` → `throw new Error(\`dsh-skip-browser-auth: official connection manifest is \${version}, whitelist is ['0.1.2-rc.1']; disable or uninstall the plugin\`)`；`(b)` `current.parent.tree.resolve('connection')`：`official.parent !== current.parent` / `options.id !== 'connection'` / `options.name !== CONNECTION_PACKAGE` / `official.disabled !== true` / `official.fiber !== undefined` 任一成立 → `throw new Error('dsh-skip-browser-auth: gate binding violated; refusing to run')`。`loader` 或 `current` 缺失时跳过 ③（仅手搭测试上下文；产品组合必有）。④`createTrustedAuth(trustedHosts)` + `new HostConnectionService(ctx, trustedHosts, auth as unknown as ConstructorParameters<typeof HostConnectionService>[2])`（注释：官方未导出 BrowserAuth 类型，用构造器参数位取回）。⑤`/api` prefix 路由：`requestRejection` → 401/403 短路，否则 `bridge(req, res, connection.createSharedFetchHandler(API_PATH), maxRequestBodyBytes)`。⑥固定警告 `console.warn`。
- Run: `npm run build && npm run typecheck && npm test`
- Expected: 全绿。
- [ ] Step 3: checkpoint commit — `git add src/index.ts tests/host-apply.test.mjs && git diff --cached --check && git commit -m "feat: trusted-network host half with loader-anchored backstop"`

### Task 7: 自门控 patch（生成器 + `cordis.patch.yml`）

- 目标：bundle patch 由单一常量源机械生成，无人工复制、无占位符。
- 涉及文件：`scripts/write-patch.mjs`、`scripts/build.mjs`（接入生成步骤）、`cordis.patch.yml`（生成产物）、`tests/patch.test.mjs`。
- 接口契约
  - Consumes: `lib/gate.js` 的四个常量；js-yaml 与 `!!js` Type（照抄 `RC1/vendor/include/src/index.ts` 第 9–23 行的 `JsExpr` 定义，含 `represent`）。
  - Produces: `cordis.patch.yml`；build 流程固定为 `tsc → write-patch → client re-ID`。
- 验证范围：生成幂等（`git diff --exit-code cordis.patch.yml`）、结构断言、求值行为。

- [ ] Step 1: 写失败测试 — `tests/patch.test.mjs`：先 `assert` 仓库存在 `cordis.patch.yml`；用 js-yaml（`JSON_SCHEMA.extend(JsExpr)`）解析：
  - 顶层数组长度 2；
  - 第一行 `{ id: 'connection', name: '@deepseek-ai/dsh-client-connection', disabled: { __jsExpr: GATE_PROBE_EXPRESSION } }`，无其他键；
  - 第二行 `insert` 长度 1：`{ id: 'trusted-connection', name: 'dsh-skip-browser-auth', inject: ['webRuntime'], disabled: { __jsExpr: `!(${GATE_ROW_ALLOWED_EXPRESSION})` }, config: { trustedHosts: { __jsExpr: 'ctx.webRuntime.trustedHosts' } } }`；
  - 行为抽查：fake ctx（symbol entry + 真实 fixture manifest，构造同 Task 5）下两行 disabled 求值互斥（官方行 true、插件行 false）；sibling `disabled: false` 或 name 不匹配时插件行求值 `true`（保持 dormant）。
- Run: `npm test`
- Expected: 失败（文件或生成器不存在）。
- [ ] Step 2: 实现生成器 — `scripts/write-patch.mjs`：`import { GATE_PROBE_EXPRESSION, GATE_ROW_ALLOWED_EXPRESSION } from '../lib/gate.js'`；构造 patch 对象（结构与测试断言一致）；用 js-yaml `dump(data, { schema: jsExprSchema, lineWidth: 1000, noRefs: true })` 序列化（`!!js` 由 schema 的 `represent` 输出），写入 `cordis.patch.yml`（带中文头注释说明自门控与 fail-closed 语义，注释块在 dump 结果前拼接）。`scripts/build.mjs` 在 tsc 之后、client re-ID 之前调用 `node scripts/write-patch.mjs`。首次生成后先 `git add cordis.patch.yml`（untracked 文件不受 `git diff` 约束），再运行 `npm run build` 并执行 `git diff --exit-code cordis.patch.yml`（生成幂等、与已暂存内容一致；进入最终验证时文件已跟踪，该命令直接有效）。
- Run: `npm run build && git diff --exit-code cordis.patch.yml && npm test`
- Expected: 全部通过。
- [ ] Step 3: checkpoint commit — `git add scripts/write-patch.mjs scripts/build.mjs cordis.patch.yml tests/patch.test.mjs && git diff --cached --check && git commit -m "feat: generated self-gating bundle patch from gate constants"`

### Task 8: client 半区 re-ID 与 materialization 测试

- 目标：官方 client 最终 bundle 精确 re-ID 为本包 id，并以真实 factory materialization 验证。
- 涉及文件：`scripts/build.mjs`（re-ID 段已在 Task 1 落地，本任务补断言增强）、`tests/artifacts.test.mjs`、`tests/client-materialize.test.mjs`。
- 接口契约
  - Consumes: pinned 依赖的 `lib/client.js`（最终 ModuleLoader wrapper，不可变）。
  - Produces: `lib/client.js`（唯一注册 id 为 `dsh-skip-browser-auth` 的同构 bundle）。
- 验证范围：产物断言 + materialization（单次注册、新 id、原 id 不出现、factory 执行、external 全满足、返回形状正确）。

- [ ] Step 1: 写失败测试 — `tests/artifacts.test.mjs`：`lib/client.js` 以 `window.__ModuleLoader__.load({` 开头；含 `id: "dsh-skip-browser-auth"`；不含 `id: "@deepseek-ai/dsh-client-connection"`；`return module.exports` 存在。`tests/client-materialize.test.mjs`：`const registrations = []; globalThis.window = { __ModuleLoader__: { load: (reg) => registrations.push(reg) } }`；`await import('../lib/client.js')`（CJS 文件无顶层 await，动态 import 以副作用完成注册，不依赖 `require(ESM)` 的跨版本行为差异）；断言：`registrations.length === 1`；`registrations[0].id === 'dsh-skip-browser-auth'`；stub `require` 只放行基线集合（`['@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives', 'react', 'react-dom', 'react/jsx-runtime', 'react-dom/client']`，经 `createRequire` 解析，集合外 specifier 抛 `unsatisfied require`）；`const { inject, apply } = registrations[0].factory(stubRequire)` → `Array.isArray(inject) && inject.length === 0` 且 `typeof apply === 'function'`，全程无 `unsatisfied require`。
- Run: `npm test`
- Expected: 两种可接受结果，均须如实记录：①失败 → 按 Step 2 修复 build 的锚点/替换逻辑后重跑；②直接通过 → 说明 Task 1 的 re-ID 实现已满足全部断言，本次为补齐覆盖缺口，不伪造红灯。
- [ ] Step 2: 实现 — 确认 `scripts/build.mjs` re-ID 段的锚点断言覆盖 Step 1 全部检查（六个锚点唯一性、替换恰 1 次、替换后原 id 0 次）；如 Task 1 已满足则本步骤仅补缺口并注明。
- Run: `npm run build && npm test`
- Expected: 全绿。
- [ ] Step 3: checkpoint commit — `git add scripts/build.mjs tests/artifacts.test.mjs tests/client-materialize.test.mjs && git diff --cached --check && git commit -m "test: re-ID'd client bundle materialization coverage"`

### Task 9: 组合测试矩阵（active / gate-false / 真实 rc.2 dormant / gate 绑定负向）

- 目标：真实 Loader + Include + 真实官方产物，端到端验证四条路径；探针 fixture 使用真实文件。
- 涉及文件：`tests/helpers/compose.mjs`、`tests/composition/active.test.mjs`、`tests/composition/gate-false.test.mjs`、`tests/composition/rc2-dormant.test.mjs`、`tests/composition/gate-binding.test.mjs`、`scripts/install-rc2-fixture.mjs`。
- 接口契约
  - Consumes: Task 1/6/7/8 产物；devDeps rc.1 生态；rc.2 fixture 别名（connection、frontend-static、host-apiproxy 的 `0.1.1-rc.2`）；`applyEntryPatches`；组合手法参照 `RC1/packages/host/frontend-static/tests/frontend-static.spec.ts`。
  - Produces: `compose(t, { rows, modules, probeVersion, manifestVersion?, extraPatches?, webRuntime })` → `{ context, port, root }`：
    - 在临时目录写真实探针 fixture：`<root>/gate-fixture/@deepseek-ai+dsh-client-connection@${probeVersion}_fixture/node_modules/@deepseek-ai/dsh-client-connection/package.json`，内容 `{"name":"…","version":"${manifestVersion ?? probeVersion}"}`；`loader.internal.resolveSync` 对 `${CONNECTION_PACKAGE}/package.json` 返回该文件的 `pathToFileURL` url，其余 specifier 走 `createRequire(new URL('x.js', base)).resolve` 真实解析；
    - `webRuntime` 提供值为传入对象（默认 `{ lanAddresses: [], trustedHosts: [] }`）；
    - `extraPatches` 追加在本插件 patch 之后（模拟后续覆盖层）；
    - patchList = js-yaml 解析仓库 `cordis.patch.yml` + `extraPatches`；用例结束 dispose + 清理。
- 验证范围：四个组合测试全绿；收口行为验证。

- [ ] Step 1: 写 helper 与 rc.2 fixture — 按上述契约实现 helper；`scripts/install-rc2-fixture.mjs`：`execFileSync('npm', ['install', '--no-save', '--package-lock=false', '--legacy-peer-deps', 'dsh-client-connection-rc2@npm:@deepseek-ai/dsh-client-connection@0.1.1-rc.2', 'frontend-static-rc2@npm:@deepseek-ai/dsh-host-frontend-static@0.1.1-rc.2', '@deepseek-ai/dsh-host-apiproxy@0.1.1-rc.2'], { stdio: 'inherit' })`；脚本末尾执行 `git diff --exit-code package.json package-lock.json` 证明 fixture 安装未改动依赖清单与 lockfile（`--package-lock=false` 保证），失败即报错。
- Run: `npm run test:rc2-fixture && npm test`
- Expected: fixture 安装成功且 `git diff --exit-code package.json package-lock.json` 通过；现有用例不回归。
- [ ] Step 2: active 用例 — `probeVersion: '0.1.2-rc.1'`；base rows：`webserver`（`127.0.0.1:0`）、`frontend`（rc.1 frontend-static）、官方 `connection` 行；`webRuntime: { lanAddresses: [], trustedHosts: ['app.internal'] }`（正式 patch 的 `ctx.webRuntime.trustedHosts` 自然求值，不用测试专用 patch）。断言：
  - `GET /` → `200`、`text/html`、body 含 `shell`（无 cookie/token）；`Host: app.internal` → `200`；`Host: other.internal` → `403`；
  - `GET /?token=whatever` → `303`、`location: /`；
  - `POST /api/session.list`（loopback，JSON envelope）→ `404 'not found'`，无 `set-cookie`；`Host: evil.example` → `403 'forbidden'`；
  - `GET /app.js` → `200`；
  - loader entries：`connection` entry `disabled === true` 且 `fiber === undefined`；`trusted-connection` entry `disabled === false` 且有活跃 fiber；
  - 临时 credentials 文件无 `browser-session` 记录。
- Run: `npm test`
- Expected: active 全绿。
- [ ] Step 3: gate-false 用例 — `probeVersion: '9.9.9'`；rows 同 Step 2 另加 `credentials-local`。断言：官方 rc.1 BrowserAuth 路径工作（`GET /` → `401` 官方文案；`authenticatedUrl` 换 cookie 后 `200`；带 cookie `POST /api/session.list` → `404`）；`trusted-connection` dormant；无固定警告输出。定位为门控假分支 wiring 测试，不冒充真实 rc.2 兼容测试。
- Run: `npm test`
- Expected: 全绿。
- [ ] Step 4: 真实 rc.2 dormant 用例 — `probeVersion: '0.1.1-rc.2'`；`connection` 行 modules 映射指向 `await import('dsh-client-connection-rc2')`，frontend 行指向 `await import('frontend-static-rc2')`。断言：`connection` entry `disabled === false`（官方活跃）、`trusted-connection` dormant；`GET /` → `200`（rc.2 无 BrowserAuth 的官方基线）；`POST /api/session.list`（loopback）→ 非 401/403（无认证层；apiproxy 未挂载时 `404 'not found'`）；全程无 `set-cookie`、无固定警告。文件开头：`import('dsh-client-connection-rc2')` 失败则 `t.fail('先运行 npm run test:rc2-fixture')`。
- Run: `npm run test:rc2-fixture && npm test`
- Expected: 全绿。
- [ ] Step 5: gate 绑定负向用例 — `tests/composition/gate-binding.test.mjs` 三个子用例：
  - **name mismatch**：官方行 `id: connection`、`name: '@deepseek-ai/dsh-client-connection-wrong'`（modules 提供该 specifier 指向 rc.1 模块），`probeVersion: '0.1.2-rc.1'` → 第一行 patch 被 name-guard 跳过（官方行 `disabled === false` 且活跃）、`trusted-connection` dormant、`loader.await()` 正常完成（无冲突）；
  - **后续层强制 disabled**：`probeVersion: '9.9.9'`，`extraPatches: [{ id: 'connection', disabled: true }]` → 官方行 `disabled === true` 但 `trusted-connection` 仍 dormant（行绑定内的探针拦截）；
  - **路径/manifest 版本漂移**：`probeVersion: '0.1.2-rc.1'`、`manifestVersion: '9.9.9'` → Replacement 进入 apply 后被 backstop 以 `whitelist` 诊断 fail loud（`loader.await()` reject，消息含 `whitelist`）——证明 backstop 是最后防线且组合期正常时不会走到它。
- Run: `npm test`
- Expected: 全绿。
- [ ] Step 6: checkpoint commit — `git add tests/helpers/compose.mjs tests/composition scripts/install-rc2-fixture.mjs && git diff --cached --check && git commit -m "test: active/gate-false/real-rc2-dormant/gate-binding composition matrix"`

### Task 10: README.md

- 目标：中文说明文档。
- 涉及文件：`README.md`。
- 接口契约
  - Consumes: 全局约束；Task 11 将追加实测记录。
  - Produces: `README.md`。
- 验证范围：人工核对约束逐条出现。

- [ ] Step 1: 撰写 — 章节：这是什么 / 安全警告（固定文案 + “网络可达即身份”）/ 安装与卸载 / 版本白名单与升级策略 / 行为矩阵表 / 测试说明（`npm run test:all`；`test:rc2-fixture` 有 npm 网络依赖，`--no-save` 会改动 `node_modules` 但不改 package manifest/lockfile）/ 已知限制（npm 布局无版本段不激活；组合测试探针 fixture 说明；完整浏览器组图 e2e 未覆盖，由 materialization + 实机清单兜底）/ 空小节「实机 dormant 前后对照记录」与「升级到 0.1.2-rc.1 后的 active 验证清单」（清单正文本任务写全：命令 + 预期）。
- Run: 人工核对。
- Expected: 与全局约束一致。
- [ ] Step 2: checkpoint commit — `git add README.md && git diff --cached --check && git commit -m "docs: readme"`

### Task 11: 本机 dormant 实机验证（live，前后对照，带回滚纪律）

- 目标：在当前 runtime 为 `0.1.1-rc.2` 的本机上，以**行为前后对照**实证 dormant 零影响；配置证据与行为证据分离；检查警告缺席；任何失败立即回滚。
- 涉及文件：`README.md`（追加实测记录）。
- 接口契约
  - Consumes: Task 1–10 产物；本机 `dsh` CLI、`deepseek-harness.service`（重启走 `sudo systemctl restart deepseek-harness.service`；user 级 `dsh-web.service` 是 shim，不得改动）。
  - Produces: README 实测记录。
- 验证范围：行为对照逐项一致；预期参考值（本机 rc.2 已核实基线）：根 `GET /` → `200`、未认证 `POST /api/session.list` → `200` 且 envelope 稳定字段 `type=server-response`、`rpcId=probe`、`resultOk=true`。

- [ ] Step 0: 固化回滚纪律（安装前完成）— 记录回滚命令：`dsh plugin --profile web remove dsh-skip-browser-auth && sudo systemctl restart deepseek-harness.service`。**自安装成功起至 Step 4 正常卸载并完成恢复验证前，任何命令失败、服务无响应、行为不一致或 journal 异常，都立即执行回滚命令并重复 Step 1 行为命令确认恢复基线；仅当回滚本身也失败时才停止并报告。**全程禁止：创建任何备用 3080 监听/进程、修改 user 级 shim、用其他进程抢占端口验证。
- [ ] Step 1: 安装前基线 + journal 时间锚 — `journal_since=$(date --iso-8601=seconds)`（后续所有 journal 检查一律用 `--since "$journal_since"`，避免窗口内旧日志假失败）。行为文件 `/tmp/dsh-skip-behavior-before.txt` 记录以下固定命令的输出：`curl -s -o /dev/null -w 'root %{http_code} %{content_type}\n' http://127.0.0.1:3080/`；`curl -s -X POST -H 'content-type: application/json' -H 'Host: 127.0.0.1:3080' -d '{"type":"client-request","rpcId":"probe","method":"session.list","payload":{}}' -o /tmp/dsh-api-body.json -w 'api %{http_code} %{content_type}\n' http://127.0.0.1:3080/api/session.list`；`node -e "const r=JSON.parse(require('fs').readFileSync('/tmp/dsh-api-body.json','utf8')); console.log('type='+r.type); console.log('rpcId='+r.rpcId); console.log('resultOk='+(r.result&&r.result.ok))"`（协议级稳定字段，不比较 session 数量/时间戳/sessionId）；`curl -fsS http://127.0.0.1:3080/ -o /tmp/dsh-root-body.html`；`node -e "const fs=require('node:fs'); const body=fs.readFileSync('/tmp/dsh-root-body.html','utf8'); const marker=body.match(/<script[^>]*src=\"[^\"]*\"/); if(!marker){console.error('root page has no script marker');process.exit(1)}; const authCount=body.includes('dsh web authentication required')?1:0; console.log('script='+marker[0]); console.log('authCount='+authCount); if(authCount!==0)process.exit(1)"`（同一响应体同时产出静态 shell marker 与 authCount；不依赖 grep 零匹配退出码 1 的语义——页面请求失败、marker 缺失或出现认证文案都会显式以非零退出）。配置证据 `/tmp/dsh-skip-config-before.txt`：`dsh --profile web --dump-config | grep -n -A2 'id: connection'`。
- Expected: `root 200 …`；`api 200 …`；`type=server-response`、`rpcId=probe`、`resultOk=true`；`script=<首条 script 标签>`、`authCount=0`。与参考值不符则停下核实基线，不进入安装。
- [ ] Step 2: 安装并重启 — `dsh plugin --profile web add /home/ubuntu/workspace/dsh-skip-browser-auth && sudo systemctl restart deepseek-harness.service`。
- Expected: 安装成功，`dsh.profile.bundles` 追加 `dsh-skip-browser-auth`；服务有响应（无响应 → 立即执行回滚命令，恢复后停下报告）。
- [ ] Step 3: 安装后对照（失败即回滚）— 重复 Step 1 全部行为命令写入 `/tmp/dsh-skip-behavior-after.txt` 并 `diff /tmp/dsh-skip-behavior-before.txt /tmp/dsh-skip-behavior-after.txt`（必须为空）；配置证据单独重取（`trusted-connection` 行出现属预期，仅作安装证据，**不作为未激活证明**）；执行 `if sudo journalctl -u deepseek-harness.service --since "$journal_since" | grep -Fq 'BrowserAuth has been skipped'; then echo 'unexpected active warning' >&2; exit 1; fi`（退出码 0 = 无警告）。**本步任何失败 → 立即执行回滚命令、复验基线，然后停下报告。**
- Expected: 行为 diff 为空；journal 检查通过。
- [ ] Step 4: 卸载恢复 — `dsh plugin --profile web remove dsh-skip-browser-auth && sudo systemctl restart deepseek-harness.service`，重复 Step 1 行为命令与 journal 检查（仍用同一 `$journal_since`）。
- Expected: 与安装前基线逐项一致；journal 检查通过（本步失败同样处于回滚路径，按 Step 0 纪律报告）。
- [ ] Step 5: 把对照结果（三组状态码/content-type/envelope 字段/marker 结论 + journal 结论 + 回滚是否被触发）写入 README「实机 dormant 前后对照记录」小节。
- Run: `git add README.md && git diff --cached --check && git commit -m "docs: live dormant before/after verification results"`
- Expected: 提交成功。

## 执行纪律

- 开始实现前先批判性复查整份计划；发现缺项、矛盾、命名不一致或命令无效，先修计划再动手。
- 按任务顺序执行，不无声跳步、合并或改变任务目标；每完成一个任务立即运行该任务定义的验证。
- 遇到阻塞、重复失败或计划与仓库/机器现实不符（尤其 Task 5 真实路径断言、Task 9 rc.2 fixture、Task 11 对照结果），立即停下说明，不要猜。
- 当前工作目录不在任何 git 仓库内时，Task 1 的 `git init -b main` 必须先完成再继续。
- 全部任务完成后运行最终验证并输出修改摘要。

## 最终验证

- `npm install && npm run test:all`（= `test:rc2-fixture && build && typecheck && test`）：全部退出码 0（含四个组合用例；fixture 有 npm 网络依赖，README 已说明）。
- `rm -rf lib && npm run build && node --input-type=module -e "await import('./lib/host.js')"`：clean-build smoke 通过。
- `git diff --exit-code cordis.patch.yml`：生成幂等。
- `npm pack --dry-run --json`：tarball 含 `lib/host.js`、`lib/client.js`、`cordis.patch.yml`、`package.json`、`README.md`。
- `git status --short`：仅预期产物（`lib/` 被忽略）。
- Task 11 前后对照结论已写入 README（dormant 零影响）。
- active 实机验证按 README 升级清单在 DSH 升级 `0.1.2-rc.1` 后执行（清单：dump-config 显示 `trusted-connection` 行存在（安装证据）；行为验证 `GET /` 免 token `200`、`/?token=x` → `303`、无 cookie `POST /api` 非 401/403、journal 出现固定警告——行为与警告共同证明激活）。

## 审阅 Checkpoint

- 实施计划已按三轮评审意见修订（v3.1）并保存到 `docs/plans/2026-09-04-dsh-skip-browser-auth-implementation-plan.md`。请先确认这份计划；如果没问题，下一步可以按计划由普通编码 agent 或人工继续执行。
