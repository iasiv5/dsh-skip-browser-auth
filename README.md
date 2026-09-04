# @iasiv5/dsh-skip-browser-auth

个人自用的 DSH Web 插件：在兼容版本上替换官方 Connection 提供方，跳过 DSH 官方
BrowserAuth 浏览器身份层，同时完整保留请求信任栅栏（request trust fence）。
不修改 DSH 本体，不创建任何新的监听服务或端口。

## 这是什么

DSH 官方的 BrowserAuth 在进程启动 token 与浏览器之间换取 authority 绑定的签名
cookie，保护全部 Host API 与 Remote WebSocket。本插件安装后在任意 DSH 版本上都能
被 `dsh plugin add` 接受；但只有当运行环境中
`@deepseek-ai/dsh-client-connection` 的**精确版本为 `0.1.2-rc.1`** 时才激活：

- 组合期（Loader 装配阶段）由 bundle patch（`cordis.patch.yml`）自门控：
  - 第一行把官方 `connection` 行的 `disabled` 绑定到版本探针（`!!js` 表达式，
    从 pnpm store 路径段提取精确版本并与白名单比对）；
  - 第二行插入本插件的 `trusted-connection` 行，其 `disabled` 为行绑定表达式的
    否定（自身探针为真 + 同组官方行存在、名字匹配、确被禁用）。
- 激活后由本插件提供 trusted-network（可信网络）等效 Connection：复用官方导出的
  `HostConnectionService`，以三方法 stub（trusted-network 语义）替代 BrowserAuth，
  `/api` 路由、请求体上限、image capacity 断言照抄官方 apply 语义。
- 任一门控条件不成立（探针为假、行不存在、名字漂移、官方行未禁用）→ 插件保持
  dormant（休眠）：官方行为分毫不变，插件不注册路由、不提供服务、不加载浏览器
  bundle。注意：在探针为假（非白名单版本）时，即使后续 patch 层把官方行强制设为
  `disabled: true`，行绑定内嵌的版本探针仍会阻止 Replacement 激活。
- `apply()` 内另有 backstop（最后防线）：读官方 manifest 比对白名单、校验行绑定
  状态，任一不满足即 fail loud 拒绝运行；产品上下文中 loader / internal /
  当前 entry 任一缺失（最后防线无法执行）同样 fail loud。

本插件包含或移植 DeepSeek Harness 的 MIT 许可代码，详见 LICENSE。

## 安全警告

Replacement 激活时进程会输出以下固定警告（逐字）：

```
@iasiv5/dsh-skip-browser-auth: BrowserAuth has been skipped. DSH Web is using the trusted-network behavior; this plugin does not verify any upstream proxy.
```

trusted-network mode 的判据只有一个：**请求来源是否通过信任栅栏**
（Host/Origin/Fetch Metadata/trustedHosts）。**网络可达即身份**——能通过栅栏的
请求一律被接受，不存在身份层，本插件也不校验任何上游反代。仅在与外界隔离、或由
可信网络层（如具备身份认证的反代）完全包住的网络中使用；`trustedHosts` 只声明
「这些主机名解析到的请求被接受」，不构成认证。

## 安装与卸载

```sh
# 从本地 checkout 安装（scope 是包名的一部分，不是目录路径）
dsh plugin --profile web add /path/to/dsh-skip-browser-auth

# 发布 npm 后，从 registry 安装
dsh plugin --profile web add @iasiv5/dsh-skip-browser-auth

sudo systemctl restart deepseek-harness.service

# 卸载（恢复官方行为；统一使用 manifest 包名）
dsh plugin --profile web remove @iasiv5/dsh-skip-browser-auth
sudo systemctl restart deepseek-harness.service
```

没有 `skipBrowserAuth` 之类的配置项——始终 skip；卸载或禁用插件并重启即恢复官方
行为。激活状态由「行为 + 警告」共同证明（见下方升级清单），配置证据
（dump-config 出现 `trusted-connection` 行）仅作安装证据。

## 版本白名单与升级策略

- 唯一白名单版本：字符串精确值 `'0.1.2-rc.1'`。禁止 `>=`、范围、`latest` 判断；
  探测失败一律 fail-closed 到 dormant。
- 升级后 `@deepseek-ai/dsh-client-connection` 版本不在精确白名单内时，本插件
  自动回到 dormant（官方行为分毫不变），不影响使用；升级到白名单版本
  （`0.1.2-rc.1`）则会激活。
- 新版本需要逐个测试验证后把精确版本加入白名单（`src/gate.ts` 的
  `GATE_VERSION` 与白名单判断、`src/index.ts` backstop 的白名单文案）；
  无法安全跟随时对插件做版本分叉。

## 行为矩阵

| 组合 | 官方 `connection` 行 | 本插件 `trusted-connection` 行 | 行为 |
| --- | --- | --- | --- |
| rc.1 + 探针真 + 绑定完好 | `disabled: true`（被 patch 禁用，无 fiber） | `disabled: false`（活跃 fiber） | Replacement 激活：trusted-network 行为 + 固定警告 |
| rc.1 + 探针假（如 9.9.9 段） | 活跃 | dormant | 官方 BrowserAuth 照常（401/cookie 换取） |
| rc.2（0.1.1-rc.2，真实产物） | 活跃（rc.2 无 BrowserAuth） | dormant | 官方 rc.2 基线：`GET /` 200、`/api` 无认证层 |
| 官方行名字漂移 | 活跃（patch 被 name-guard 跳过） | dormant | 官方行为，无冲突 |
| 非白名单版本 + 后续 patch 层强制禁用官方行 | `disabled: true`（探针仍为假） | dormant（行绑定内嵌探针拦截） | 无 Connection 服务（无身份层也无替代） |
| 白名单 rc.1 + 后续 patch 层强制禁用官方行 | `disabled: true`（与本插件自身禁用一致） | 激活（行绑定要求的正是官方行已禁用） | Replacement 照常激活 |
| 路径段真、manifest 版本漂移 | 禁用 | 进入 apply 后被 backstop 拒绝 | fail loud：whitelist 诊断，`loader.await()` reject |

## 测试说明

```sh
npm run test:all
# 等价于：npm run test:rc2-fixture && npm run build && npm run typecheck && npm test
```

- `test:rc2-fixture` 需要 npm 网络访问：以别名安装 rc.2 dormant 组合所需产物。
  `--no-save` 会改动 `node_modules`（以及为满足 rc.2 peer 链所需的嵌套安装），
  但不改 package manifest 与 lockfile（脚本内以 `git diff` 证明）。
- 本机 npm 11.19 的 allow-scripts 策略与 project-scoped 安装存在三处适配
  （`--ignore-scripts`、`--force` 取代 `--legacy-peer-deps`、仅剥离
  `npm_config_allow_scripts` / `NPM_CONFIG_ALLOW_SCRIPTS` 两个确证冲突键），
  详见 `scripts/install-rc2-fixture.mjs` 头注释。
- 组合测试（`tests/composition/`）用真实 Loader + Include + 真实官方产物端到端
  覆盖 active / gate-false / 真实 rc.2 dormant / gate 绑定负向四条路径；探针
  fixture 是真实文件（临时目录内构造 pnpm 风格路径段 + manifest）。
- 测试使用 Node 内置 test runner（无 vitest）。

## 已知限制

- npm 布局（`node_modules/@deepseek-ai/dsh-client-connection`，路径无版本段）下
  探针无法确认版本 → 不激活（dormant）。pnpm 布局与真实部署（pnpm store 路径段）
  可确认版本。
- 组合测试的探针 fixture 是受控构造（真实文件但路径段版本可指定），真实布局的
  版本提取由 Task 11 式实机验证与 Task 5 的 pnpm 真实路径断言兜底。
- 完整浏览器组图 e2e（client-modules 组图、浏览器半区真实加载）未覆盖；
  由 client bundle materialization 测试（单次注册、factory 可执行、external
  全满足）与下方升级 active 清单兜底。
- 激活要求 DSH 升级到 `0.1.2-rc.1` 后执行实机清单验证。

## 实机 dormant 前后对照记录

本机 DSH runtime 为 `0.1.1-rc.2`（2026-09-05 实测）。验证协议：安装前基线 →
安装 + 重启 → 行为逐项对照 → 卸载 + 重启 → 复验基线；journal 检查统一使用
安装前固化的时间锚；任何失败立即回滚（本次回滚未被触发）。

| 检查项 | 安装前基线 | 安装后（dormant） | 卸载恢复后 |
| --- | --- | --- | --- |
| `GET /` | `200` `text/html; charset=utf-8` | `200` `text/html; charset=utf-8` | `200` `text/html; charset=utf-8` |
| `POST /api/session.list`（未认证） | `200` `application/json` | `200` `application/json` | `200` `application/json` |
| envelope `type` / `rpcId` / `resultOk` | `server-response` / `probe` / `true` | `server-response` / `probe` / `true` | `server-response` / `probe` / `true` |
| 首页静态 shell marker（首个 `<script src=`） | 在 | 在 | 在 |
| 首页认证文案 `dsh web authentication required` | 0 次出现 | 0 次出现 | 0 次出现 |

三组行为文件逐字节 diff 均为空；安装后与卸载后 journal（同一时间锚窗口内）
均无固定警告 `BrowserAuth has been skipped`、无 err 级日志。配置证据：安装后
`dsh --profile web --dump-config` 出现 `trusted-connection` 行（仅作安装证据，
不作为未激活证明）；卸载后该行消失、bundles 中无本插件。回滚未被触发。

## 升级到 0.1.2-rc.1 后的 active 验证清单

DSH 升级到 `0.1.2-rc.1` 并安装本插件、重启后，依次执行：

1. 配置证据（仅安装证据，不证明激活）：

   ```sh
   dsh --profile web --dump-config | grep -n -A2 'id: trusted-connection'
   # 预期：出现 trusted-connection 行
   ```

2. 行为验证（与固定警告共同证明激活）：

   ```sh
   # GET / 免 token → 200（无 401、无认证文案）
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/
   # 预期：200

   # GET /?token=x → 303 location: /（token 清理）
   curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' 'http://127.0.0.1:3080/?token=x'
   # 预期：303 http://127.0.0.1:3080/

   # 无 cookie POST /api → 非 401/403（无认证层；无 api-gateway 挂载时 404）
   curl -s -o /dev/null -w '%{http_code}\n' -X POST \
     -H 'content-type: application/json' \
     -d '{"type":"client-request","rpcId":"probe","method":"session.list","payload":{}}' \
     http://127.0.0.1:3080/api/session.list
   # 预期：非 401/403
   ```

3. journal 固定警告：

   ```sh
   sudo journalctl -u deepseek-harness.service --since '<重启时间点>' \
     | grep -F 'BrowserAuth has been skipped'
   # 预期：出现固定警告文案
   ```

4. 回滚路径（任何时候行为异常）：

   ```sh
   dsh plugin --profile web remove @iasiv5/dsh-skip-browser-auth
   sudo systemctl restart deepseek-harness.service
   ```
