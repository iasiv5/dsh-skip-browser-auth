# @iasiv5/dsh-skip-browser-auth

一个个人用的 DSH Web 插件：按精确 compatibility profile 替换 Connection 提供方，跳过 DSH 官方 BrowserAuth 身份层，同时完整保留请求信任栅栏。不修改 DSH 本体，不创建新的监听服务。

## Language

**BrowserAuth**:
DSH 官方的浏览器身份层：进程启动 token 换取 authority 绑定的签名 cookie，保护全部 Host API 与 Remote WebSocket。本插件跳过的唯一对象。
_Avoid_: 登录、DSH 认证（泛称）

**request trust fence（请求信任栅栏）**:
Host、Origin、Fetch Metadata 与 trusted-host 检查的总和，防御 DNS rebinding 与跨站请求。它判定请求来源是否可信，从不建立身份；BrowserAuth skip 后必须继续生效。
_Avoid_: 认证、安全检查（泛称）、防火墙

**Replacement（替换）**:
插件在某个 active compatibility profile 上禁用官方 `connection` row，并由对应 host adapter 与 client variant 提供等效 Connection 能力（服务、路由、浏览器半区）。是整体接替，不是包裹或无条件覆盖。
_Avoid_: adapter（描述 Replacement 本身时）、hook、覆盖层、monkey patch

**compatibility profile（兼容性 profile）**:
一个完整的 DSH runtime/connection 版本对与其实现契约的绑定：包含 profile id、精确版本对、host adapter、client variant、route/body 语义和 active/candidate 状态。profile 是版本兼容的单一事实源。
当前 profile：`legacy-web-v1`（0.1.2-rc.1）与 `carrier-neutral-v2`（0.1.5-rc.1、0.1.5-rc.2）。
_Avoid_: 只写“白名单版本”而不说明代际契约

**compatibility generation（兼容代际）**:
一组可共享 host/client 实现契约的 profile。新版本只有在 API、DI、route、body 和 client bundle 契约都相同并完成验证后，才能加入已有代际；出现不兼容变化必须新增代际和 adapter/client variant。
_Avoid_: 用 semver 范围把不同代际合并

**dormant（休眠）**:
插件已安装但未激活 Replacement 的状态：官方行为分毫不变，插件不注册路由、不提供服务、不加载浏览器 bundle。未知 profile、candidate profile、混合版本对和探针失败均进入 dormant。
_Avoid_: 禁用、no-op 模式、未安装

**self-gating（自门控）**:
Replacement 是否激活由组合期的完整版本对探针和 profile 状态决定，而不是安装器预检或插件运行时补救。门控失败时一律回到 dormant。
_Avoid_: 运行时猜测、自动适配、能力碰运气

**activation probe（激活探针）**:
自门控使用的判据：从已解析的目标包路径/manifest 中确认 runtime 与 connection 的精确版本对，并解析到 active profile。版本对可确认且 profile active 才激活；无法确认、混合或 candidate profile 都视为不在 active 白名单。解析锚点是宿主 runtime 本体（`@deepseek-ai/dsh`，只可能来自 runtime fallback）加官方 connection 包——绝不允许锚定到插件自身依赖提供的副本。
_Avoid_: capability probe（泛称）、结构探测、宽松版本检测

**whitelist（版本白名单）**:
允许激活的精确 profile/pair 集合：当前为 `0.1.2-rc.1 + 0.1.2-rc.1`、`0.1.5-rc.1 + 0.1.5-rc.1` 与 `0.1.5-rc.2 + 0.1.5-rc.2`。白名单匹配完整版本对，不使用 `>=`、范围、`latest` 或两个独立版本 `includes()`；runtime 与 connection 混合版本（含同代际跨 patch 混合，如 rc.1 runtime + rc.2 connection）必须 dormant。
_Avoid_: 最低版本、版本范围、通配符、单独的“0.1.x”判断

**host adapter**:
某个 compatibility profile 的 host 侧实现，负责加载对应 runtime connection module、挂载 carrier route、选择 bridge/body mode、处理 `connection.rpc.handle()` 生命周期和安装浏览器 profile global。`legacy-web` 与 `carrier-neutral` 不可 cross-call。
_Avoid_: 让公共 `apply()` 直接假设所有 DSH 版本的 API 相同

**client variant**:
与 host adapter 成对的官方浏览器 client factory。0.1.2 使用 rc12 variant，0.1.5 使用 rc15 variant；由 host 注入的显式 profile id 选择，profile 缺失或未知时不猜测。
_Avoid_: 把旧 client bundle re-ID 后冒充新版本、通过某个 global 是否存在来猜版本

**trusted-network mode（可信网络模式）**:
Replacement 激活后的行为：通过请求信任栅栏的请求即被接受，不存在身份层。这是有意的安全降级，与具体部署是否配置反代无关。
_Avoid_: 旧版模式、无认证模式、把网络可达当作身份认证
