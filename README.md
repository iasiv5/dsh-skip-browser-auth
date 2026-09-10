# @iasiv5/dsh-skip-browser-auth

[![npm](https://img.shields.io/npm/v/@iasiv5/dsh-skip-browser-auth?label=npm&color=cb3837)](https://www.npmjs.com/package/@iasiv5/dsh-skip-browser-auth)
[![DSH Web](https://img.shields.io/badge/DSH_Web-0.1.2--rc.1_%7C_0.1.5--rc.1_%7C_0.1.5--rc.2_verified-blue)](#兼容版本)
[![License](https://img.shields.io/github/license/iasiv5/dsh-skip-browser-auth?color=green)](./LICENSE)

个人自用的 DSH Web 插件：在已验证的 DSH compatibility profile 上自动跳过 BrowserAuth，打开 Web 地址即可直接使用，**不必每次把启动 URL 里那串随机 token 抄进浏览器**。

- **精确 profile 门控**：当前支持 `0.1.2-rc.1`、`0.1.5-rc.1` 与 `0.1.5-rc.2`，按 host/client 兼容代际分组；不是把所有版本塞进同一个实现。
- **严格成对匹配**：runtime `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-client-connection` 必须组成已知版本对。混合版本、未知版本、profile 未实现或解析失败都会自动休眠。
- **分代适配**：`0.1.2-rc.1` 使用 `legacy-web-v1`；`0.1.5-rc.1` 与 `0.1.5-rc.2` 使用 `carrier-neutral-v2`，包含 request body mode、RPC carrier 和对应浏览器 client variant 适配。
- **不修改 DSH 本体与任何机制**：仅通过 DSH 官方插件 patch 机制替换 Connection 行；卸载或禁用插件并重启，即完全恢复官方行为。
- **安全提醒**：跳过认证后，Web 对本机/可信网络内的访问不再有身份层，请勿把 DSH 端口暴露给不可信网络。

> 0.1.5 的官方 Connection 在 carrier-neutral 重构后出现过 `connection.rpc.handle()` 返回 HTTP 405 的回归。本插件对 0.1.5 使用独立 adapter，并通过真实 npm fixture 覆盖 dedicated RPC 与 exact Fetch route；GitHub 审计与根因见 [docs/COMPATIBILITY.md](./docs/COMPATIBILITY.md)。

## 安装

### 方式一：从插件市场一键安装（推荐）

本插件已收录进我的 DSH 插件市场 **[dsh-m](https://github.com/iasiv5/dsh-m)**（收录 id：`dsh-skip-browser-auth`）。装好 dsh-m 后，在 Web 侧栏「插件市场」搜索 **Skip Browser Auth**，即可**一键安装 / 更新 / 卸载**；也可以直接对 agent 说：

> 从 dsh-m 插件市场安装 dsh-skip-browser-auth，装完重启 DSH Web。

### 方式二：直接命令安装

```sh
dsh plugin --profile web add @iasiv5/dsh-skip-browser-auth
sudo systemctl restart deepseek-harness.service   # 按你的部署方式重启 DSH Web
```

### 复制给 agent 的安装提示词

```text
请给我的 DSH Web 安装 @iasiv5/dsh-skip-browser-auth 插件。
它支持的精确 compatibility profile：
- DSH 0.1.2-rc.1：legacy-web-v1
- DSH 0.1.5-rc.1 / 0.1.5-rc.2：carrier-neutral-v2
其它版本或 runtime/connection 混合版本会自动休眠，不要强行处理。

1. 先执行 dsh --version 告诉我当前 DSH 版本，然后照常安装：
   dsh plugin --profile web add @iasiv5/dsh-skip-browser-auth
2. 重启 DSH Web 并轮询 http://127.0.0.1:3080 直到恢复 200
   （systemd 系统级部署：sudo systemctl restart deepseek-harness.service；
   user 级部署：systemctl --user restart dsh-web.service；端口以实际部署为准）。
3. 若版本是 0.1.2-rc.1、0.1.5-rc.1 或 0.1.5-rc.2：
   确认 journal/日志中出现固定警告
   "BrowserAuth has been skipped"，并验证浏览器直接打开 Web 地址不再要求 token。
4. 若版本不是精确白名单版本，或 profile/依赖契约不匹配：插件应自动休眠，
   保持官方行为，不要修改 DSH 本体或强行覆盖版本检测。
```

## 卸载

```sh
dsh plugin --profile web remove @iasiv5/dsh-skip-browser-auth
sudo systemctl restart deepseek-harness.service
```

市场安装的用户在「插件市场 → 已装」里点卸载即可。卸载或禁用并重启后，官方 BrowserAuth 完全恢复。

## 兼容版本与 profile

| DSH runtime / connection 版本对 | Profile | Host/client 适配 | 状态 |
| --- | --- | --- | --- |
| `0.1.2-rc.1` + `0.1.2-rc.1` | `legacy-web-v1` | legacy `/api` prefix + 0.1.2 client | ✅ active |
| `0.1.5-rc.1` + `0.1.5-rc.1` | `carrier-neutral-v2` | carrier-neutral HostConnectionService + 0.1.5 client | ✅ active（代码/真实 npm fixture 已验证；真实部署仍需按清单确认） |
| `0.1.5-rc.2` + `0.1.5-rc.2` | `carrier-neutral-v2` | 同上（rc.2 为 rc.1 的重发布：代码逐字节一致） | ✅ active（npm diff 审计 + 真实 rc.2 npm fixture 组合测试已验证；真实部署仍需按清单确认） |
| 其它版本或混合版本对 | — | 😴 自动休眠：官方行为分毫不变 | dormant |

白名单匹配的是**完整版本对**，不是两个独立的 `includes()`：

```text
runtime=0.1.2-rc.1 + connection=0.1.5-rc.1 → dormant
runtime=0.1.5-rc.1 + connection=0.1.5-rc.1 → carrier-neutral-v2
runtime=0.1.5-rc.1 + connection=0.1.5-rc.2 → dormant（同代际跨 patch 混合同样是事故形态）
runtime=0.1.5-rc.2 + connection=0.1.5-rc.2 → carrier-neutral-v2
```

未来的新版本如果保持同一契约，可以加入对应 profile 的精确版本对；如果发生 API、DI、route、body 或 client bundle 契约变化，必须新增 profile、host adapter 和 client variant，不能 fallback 到旧代际。详细流程见 [docs/COMPATIBILITY.md](./docs/COMPATIBILITY.md)。

## 机制与安全

- 组合期版本探针使用 runtime 本体与官方 connection 包双锚点，并返回 profile id；路径段和 npm flat manifest 两种布局均支持。任何异常都 fail-closed 到 dormant。
- `apply()` backstop 再读取两个 manifest，验证 active profile、patch 传入的 profile id、官方 connection sibling 行的 id/name/disabled/fiber 状态；不满足时在创建服务、注册 route、输出 warning 前 fail loud。
- `legacy-web-v1` 保留 0.1.2 的 `/api` prefix 与 buffered bridge。
- `carrier-neutral-v2` 使用 runtime loader 取得当前 0.1.5 connection module，支持 `requestBodyMode`、exact Fetch route 和 streaming body，并将 generic `connection.rpc.handle()` 绑定到拥有 Web carrier 的 replacement context，避免 0.1.5 的 405 回归。
- client bundle 是显式 profile dispatcher：host 通过 `webserver/index-inject` 注入 profile id，0.1.2/0.1.5 使用各自官方 factory；profile 缺失或未知时不猜测、不加载错误 variant。
- 激活时进程逐字输出固定警告：

```text
@iasiv5/dsh-skip-browser-auth: BrowserAuth has been skipped. DSH Web is using the trusted-network behavior; this plugin does not verify any upstream proxy.
```

trusted-network mode 的判据只有一个：**请求来源是否通过信任栅栏**（Host/Origin/Fetch Metadata/trustedHosts）。能通过栅栏的请求一律被接受，不存在身份层，本插件也不校验任何上游反代。

## 测试与验证

```sh
# 安装真实 rc.2 + rc.15 fixture，并运行 build/typecheck/全部 Node tests
npm run test:all

# 单独重建与加载 host
rm -rf lib
npm run build
node --input-type=module -e "await import('./lib/host.js')"

# 确认 patch 生成幂等
npm run build
git diff --exit-code cordis.patch.yml
```

测试矩阵覆盖：

- 两个完整 profile pair、混合版本、未知版本和 manifest/path drift
- pnpm 路径段与 npm flat manifest fallback
- legacy buffered bridge 与 carrier-neutral streaming bridge
- 真实 0.1.5 dedicated `connection.rpc.handle()`、exact Fetch route 和 405 回归
- 两个官方 client factory 的 materialization、profile dispatcher 和未知 profile fail-closed
- rc.2 dormant 基线、dispose/unload、Host/Origin/Fetch Metadata trust fence

完整的 GitHub API 审计、profile 数据模型、adapter seam、client 变体和未来新增代际 checklist 见 [docs/COMPATIBILITY.md](./docs/COMPATIBILITY.md)；机制详版见 [docs/DESIGN.md](./docs/DESIGN.md)。

本插件以 [MIT License](./LICENSE) 发布；包含或移植的 DeepSeek Harness（MIT）代码，其版权与许可声明见 [NOTICE](./NOTICE)。
