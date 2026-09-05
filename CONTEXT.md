# @iasiv5/dsh-skip-browser-auth

一个个人用的 DSH Web 插件：通过在兼容版本上替换 Connection 提供方来跳过 DSH 官方 BrowserAuth 身份层，同时完整保留请求信任栅栏。不修改 DSH 本体，不创建新的监听服务。

## Language

**BrowserAuth**:
DSH 官方的浏览器身份层：进程启动 token 换取 authority 绑定的签名 cookie，保护全部 Host API 与 Remote WebSocket。本插件跳过的唯一对象。
_Avoid_: 登录、DSH 认证（泛称）

**request trust fence（请求信任栅栏）**:
Host、Origin、Fetch Metadata 与 trusted-host 检查的总和，防御 DNS rebinding 与跨站请求。它判定请求来源是否可信，从不建立身份；BrowserAuth skip 后必须继续生效。
_Avoid_: 认证、安全检查（泛称）、防火墙

**Replacement（替换）**:
插件在兼容版本上禁用官方 `connection` row，并由插件自身提供等效的 Connection 能力（服务、路由、浏览器半区）。是整体接替，不是包裹或打补丁。
_Avoid_: adapter、hook、覆盖层、monkey patch

**dormant（休眠）**:
插件已安装但未激活 Replacement 的状态：官方行为分毫不变，插件不注册路由、不提供服务、不加载浏览器 bundle。
_Avoid_: 禁用、no-op 模式、未安装

**self-gating（自门控）**:
Replacement 是否激活由组合期的版本探针决定，而不是安装器预检或插件运行时补救。门控失败时一律回到 dormant。
_Avoid_: 运行时检测、自动适配

**activation probe（激活探针）**:
自门控使用的判据：从已解析的目标包路径中确认精确版本，并与白名单比对。版本可确认且在白名单内才激活；无法确认版本即视为不在白名单。解析锚点是宿主 runtime 本体（`@deepseek-ai/dsh`，只可能来自 runtime fallback）加官方 connection 包双锚点——绝不允许锚定到插件自身依赖可能提供的副本（2026-09-05 事故根因）。版本确认双分支：pnpm store 路径段为快路径（段真时保留「manifest 漂移由 backstop 兜底」语义）；无版本段的 `file:` URL 同步读 manifest 比对（npm 扁平布局/dshm 部署）。
_Avoid_: capability probe（泛称）、结构探测、版本检测

**whitelist（版本白名单）**:
允许激活 Replacement 的精确 DSH 版本集合，当前仅 `0.1.2-rc.1`。新版本经测试验证后逐个加入；无法安全跟随时对插件做版本分叉。
_Avoid_: 最低版本、版本范围、`>=` 判断

**trusted-network mode（可信网络模式）**:
Replacement 激活后的行为：通过请求信任栅栏的请求即被接受，不存在身份层。这是有意的安全降级，与具体部署是否配置反代无关。
_Avoid_: 旧版模式、rc2 模式、无认证模式
