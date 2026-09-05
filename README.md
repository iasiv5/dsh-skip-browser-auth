# @iasiv5/dsh-skip-browser-auth

[![npm](https://img.shields.io/npm/v/@iasiv5/dsh-skip-browser-auth?label=npm&color=cb3837)](https://www.npmjs.com/package/@iasiv5/dsh-skip-browser-auth)
[![DSH Web](https://img.shields.io/badge/DSH_Web-0.1.2--rc.1_verified-blue)](#兼容版本)
[![License](https://img.shields.io/github/license/iasiv5/dsh-skip-browser-auth?color=green)](./LICENSE)

个人自用的 DSH Web 插件：在 **DSH 0.1.2-rc.1** 上自动跳过 BrowserAuth——打开 Web 地址即可直接使用，**不必每次把启动 URL 里那串随机 token 抄进浏览器**。

- **只在适配版本激活**：当前仅 `0.1.2-rc.1`。在 `0.1.1-rc.2` 及其它所有未测试版本上**自动休眠**，官方行为分毫不变。
- **不修改 DSH 本体与任何机制**：仅通过 DSH 官方插件 patch 机制替换 Connection 行；卸载或禁用插件并重启，即完全恢复官方行为。
- **提醒**：跳过认证后，Web 对本机/可信网络内的访问不再有身份层，请勿把 DSH 端口暴露给不可信网络。

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

把下面整段贴给你机器上的 agent，它就能完成安装与验证：

```text
请给我的 DSH Web 安装 @iasiv5/dsh-skip-browser-auth 插件（DSH 0.1.2-rc.1 专用：
自动跳过 BrowserAuth，免每次在启动 URL 后输入随机 token；其它版本会自动休眠，
不影响任何行为）。
1. 先执行 dsh --version 告诉我当前 DSH 版本，然后照常安装：
   dsh plugin --profile web add @iasiv5/dsh-skip-browser-auth
2. 重启 DSH Web 并轮询 http://127.0.0.1:3080 直到恢复 200
   （systemd 系统级部署：sudo systemctl restart deepseek-harness.service；
   user 级部署：systemctl --user restart dsh-web.service；端口以实际部署为准）。
3. 若版本是 0.1.2-rc.1：确认 journal/日志中出现固定警告
   "BrowserAuth has been skipped"，且浏览器直接打开 Web 地址不再要求 token，
   即激活成功。
4. 若版本不是 0.1.2-rc.1：插件会自动休眠（官方行为不变），直接告诉我即可，
   不要做任何强行处理。
```

## 卸载

```sh
dsh plugin --profile web remove @iasiv5/dsh-skip-browser-auth
sudo systemctl restart deepseek-harness.service
```

市场安装的用户在「插件市场 → 已装」里点卸载即可。卸载或禁用并重启后，官方 BrowserAuth 完全恢复。

## 兼容版本

| DSH 版本 | 状态 |
| --- | --- |
| `0.1.2-rc.1` | ✅ 激活：跳过 BrowserAuth（pnpm 与 npm 扁平安装布局均可识别） |
| `0.1.1-rc.2` 及其它未测试版本 | 😴 自动休眠：官方行为分毫不变 |

新版本经实测验证后逐个加入白名单；版本探测失败一律自动休眠（fail-closed）。

## 机制与安全（简述）

- 组合期版本探针采用**双锚点**（宿主 runtime 本体 + 官方 connection 包）与**双分支**版本确认（pnpm 路径段 / manifest 读取，兼容两种安装布局），精确匹配白名单才激活；任何解析失败、版本漂移、结构漂移都保持休眠。
- 激活后复用官方导出的 `HostConnectionService` 提供 trusted-network Connection：Host/Origin/trustedHosts 请求信任栅栏完整保留，仅移除身份层；激活时进程逐字输出固定警告 `@iasiv5/dsh-skip-browser-auth: BrowserAuth has been skipped. ...`。
- 运行前 backstop 复核 manifest 白名单与行绑定状态，任何不满足即拒绝运行。

详细设计、行为矩阵与实机验证记录见 [docs/DESIGN.md](./docs/DESIGN.md)。

本插件包含或移植 DeepSeek Harness 的 MIT 许可代码，详见 [LICENSE](./LICENSE)。
