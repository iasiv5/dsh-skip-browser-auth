# 设计与运维细节（docs/DESIGN.md）

> 本文件是 README 的详版留档：完整机制说明、compatibility profile、行为矩阵、测试说明、已知限制与实机验证记录。面向后续维护与二次适配；用户向内容以 README 为准。

---

## 兼容 profile

本插件不把 DSH 版本简单当作一个字符串白名单，而是匹配完整的 runtime/connection 版本对，并选择一组已经验证过的 host/client 实现。

| profile | runtime/connection 精确版本对 | Host adapter | Client variant | 状态 |
| --- | --- | --- | --- | --- |
| `legacy-web-v1` | `0.1.2-rc.1` + `0.1.2-rc.1` | legacy webserver：`/api` prefix + buffered bridge | rc12 官方 client | ✅ active |
| `carrier-neutral-v2` | `0.1.5-rc.1` + `0.1.5-rc.1` | carrier-neutral：runtime module + requestBodyMode + RPC carrier | rc15 官方 client | ✅ active（代码和真实 npm fixture 已验证；真实 DSH 部署仍需执行清单） |
| — | 混合版本、未知版本、未实现 profile | — | — | 😴 dormant |

以下组合不得激活：

```text
runtime=0.1.2-rc.1 + connection=0.1.5-rc.1
runtime=0.1.5-rc.1 + connection=0.1.2-rc.1
```

profile 数据源位于 `src/compatibility.ts`。`src/gate.ts` 从 profile pairs 生成 `GATE_PROFILE_EXPRESSION`、boolean activation probe 和 row binding expression；`cordis.patch.yml` 把 profile id 传入插件行。host adapter 与 client dispatcher 都消费同一个 profile id，不各自猜测版本。

## GitHub API 兼容性审计

0.1.5 不是 0.1.2 的纯补丁版本。官方源码与报告显示：

- 0.1.2 的 Connection 行直接注入 `webServer`、`credentials` 并直接挂载 `/api`。
- 0.1.5 改为 carrier-neutral，Connection 行只注入 `credentials`，通过 `ctx.inject(['webServer'], ...)` 延迟接入 Web carrier。
- 0.1.5 的 `HostConnectionService` 增加 exact Fetch route、`POST`、`requestBody`、`requestBodyMode()`；旧 bridge 不能完整表达新契约。
- 0.1.5 的浏览器 client 读取 recovery config/global，不能把 0.1.2 的 re-ID bundle 当作 0.1.5 client。
- GitHub Discussions [#6105](https://github.com/deepseek-ai/deepseek-harness/discussions/6105) 和 [#6111](https://github.com/deepseek-ai/deepseek-harness/discussions/6111) 报告 `connection.rpc.handle()` 因 `webServer` context 缺失而返回 HTTP 405。

参照资料：

- [v0.1.5-rc.1 Release Notes](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1)
- [v0.1.2-rc.1 → v0.1.5-rc.1 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.2-rc.1...dsh-v0.1.5-rc.1)
- [0.1.2 connection/index.ts](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-rc.1/packages/client/connection/src/index.ts)
- [0.1.5 connection/index.ts](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.5-rc.1/packages/client/connection/src/index.ts)
- [0.1.2 connection/rpc-host.ts](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-rc.1/packages/client/connection/src/rpc-host.ts)
- [0.1.5 connection/rpc-host.ts](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.5-rc.1/packages/client/connection/src/rpc-host.ts)

因此，0.1.5 使用独立 `carrier-neutral` host adapter 和 rc15 client variant。carrier-neutral adapter 只在 replacement 自己的 Connection instance 上把 generic RPC register owner 绑定到有 Web carrier 的 context；不修改 DSH 本体，也不把所有 profile 的 `inject` 粗暴合并。

## 这是什么

DSH 官方 BrowserAuth 在进程启动 token 与浏览器之间换取 authority 绑定的签名 cookie，保护全部 Host API 与 Remote WebSocket。本插件安装后可在任意 DSH 版本上被 `dsh plugin add` 接受；只有运行环境的完整版本对能匹配 active profile 时才激活。

激活流程：

1. Loader 组合期从 runtime fallback 解析 `@deepseek-ai/dsh/package.json` 与 `@deepseek-ai/dsh-client-connection/package.json`。
2. profile probe 从 pnpm 路径段或 npm flat manifest 取得两个版本，按完整 pair 选择 profile id。
3. 官方 `connection` row 只有在 active profile 时才被禁用；candidate、混合版本和未知版本保持官方 row 活跃，插件 row dormant。
4. 插件行 config 携带同一个 profile id；`apply()` backstop 读取 manifest 并检查 profile、row binding、loader/internal/current entry。
5. host adapter 创建对应 runtime Connection、挂载 trusted-network route，并注入 `__DSH_SKIP_BROWSER_AUTH_PROFILE__`；carrier-neutral profile 还注入 `__DSH_CONNECTION_RECOVERY__` 默认配置。
6. client dispatcher 根据 profile global 选择 0.1.2 或 0.1.5 官方 client factory；没有 profile 时直接失败，不猜测。

任一门控条件不成立，插件保持 dormant：官方行为分毫不变，不注册路由、不提供服务、不加载浏览器 bundle。

## 安全警告

Replacement 激活时进程会输出以下固定警告（逐字）：

```text
@iasiv5/dsh-skip-browser-auth: BrowserAuth has been skipped. DSH Web is using the trusted-network behavior; this plugin does not verify any upstream proxy.
```

trusted-network mode 的判据只有一个：**请求来源是否通过信任栅栏**（Host/Origin/Fetch Metadata/trustedHosts）。**网络可达即身份**——能通过栅栏的请求一律被接受，不存在身份层，本插件也不校验任何上游反代。仅在与外界隔离、或由可信网络层完全包住的网络中使用；`trustedHosts` 只声明「这些主机名解析到的请求被接受」，不构成认证。

## 安装与卸载

```sh
# 从本地 checkout 安装
dsh plugin --profile web add /path/to/dsh-skip-browser-auth

# 发布 npm 后，从 registry 安装
dsh plugin --profile web add @iasiv5/dsh-skip-browser-auth

sudo systemctl restart deepseek-harness.service

# 卸载
dsh plugin --profile web remove @iasiv5/dsh-skip-browser-auth
sudo systemctl restart deepseek-harness.service
```

没有 `skipBrowserAuth` 配置项——始终 skip；卸载或禁用插件并重启即恢复官方行为。激活状态由“行为 + warning”共同证明，dump-config 中出现 `trusted-connection` 只作安装证据。

## 版本策略与未来代际

- 版本匹配是 profile 的完整 pair，禁止 `>=`、范围、`latest`、`0.1.x` 前缀和独立 `includes()`。
- 同一代际的新版本只有在 host/client/route/body/DI 契约完全一致、组合测试通过并完成对应验证后，才加入该 profile 的 `pairs`。
- 如果新版本发生 API 不兼容，新增 `CompatibilityProfile`、host adapter 和 client variant；旧 profile 不变。
- 新 profile 在 adapter/client/真实组合未完成前可以保持 `candidate`，candidate 的 probe 只返回 profile id，不允许 boolean activation probe 禁用官方行。
- 所有 profile 共享 request trust fence、trusted auth stub、固定 warning 和卸载恢复纪律，但不共享未经验证的 HostConnectionService 调用、bridge 或 client bundle。
- 增加新代际的完整 checklist、GitHub 证据和测试矩阵见 [docs/COMPATIBILITY.md](./COMPATIBILITY.md)。

## 行为矩阵

| 组合 | 官方 `connection` 行 | 本插件 `trusted-connection` 行 | Host/client 行为 |
| --- | --- | --- | --- |
| 0.1.2 pair + `legacy-web-v1` | `disabled: true` | `disabled: false` | 旧版 `/api` prefix、buffered bridge、rc12 client、固定 warning |
| 0.1.5 pair + `carrier-neutral-v2` | `disabled: true` | `disabled: false` | carrier-neutral runtime、requestBodyMode、exact Fetch POST、RPC carrier、rc15 client、固定 warning |
| 0.1.2 runtime + 0.1.5 connection | 活跃 | dormant | 官方行为，不提供替代服务 |
| 0.1.5 runtime + 0.1.2 connection | 活跃 | dormant | 官方行为，不提供替代服务 |
| 未知版本对 | 活跃 | dormant | 官方行为分毫不变 |
| active pair + runtime/manifest drift | 不稳定 | backstop fail loud | 不创建服务、不注册 route、不输出 active warning |
| active pair + 官方行 name mismatch | 活跃 | dormant | patch name guard 防止冲突 |
| active pair + 后续 patch 强制官方行 disabled | 视 gate probe | probe/row binding 仍需为真 | 未知 profile 不会被后续 patch 强行复活 |
| active profile + client global 缺失 | host 可拒绝/client fail loud | 不猜测 client variant | 不把旧 bundle 冒充新 bundle |

## 测试说明

```sh
npm run test:all
# 等价于：安装 rc2 fixture + 安装 rc2/rc15 双代际 fixture + build + typecheck + npm test
```

`test:rc2-fixture` 和 `test:rc15-fixture` 需要 npm 网络访问，使用 alias、`--no-save`、`--package-lock=false` 和 `--ignore-scripts`；脚本以安装前后快照证明不修改 `package.json` 与 `package-lock.json`。rc15 fixture 脚本会同时保留 rc2 与 rc15 aliases，避免 npm peer resolver 在顺序安装时删除上一代。

组合测试使用真实 Loader + Include + 官方产物，覆盖：

- 两个完整 profile pair、混合版本、未知版本、path/manifest drift、name mismatch、后续 patch 覆盖
- pnpm 路径段与 npm flat manifest fallback
- legacy buffered bridge 与 carrier-neutral streaming bridge
- 0.1.5 `connection.rpc.handle()` 真实 405 回归，以及 exact `/api` Fetch route
- 两个 client factory 的 materialization、dispatcher、recovery global 和未知 profile fail-closed
- rc.2 dormant 基线、dispose/unload、Host/Origin/Fetch Metadata trust fence

## 已知限制

- 真实 DSH `0.1.5-rc.1` 宿主部署的 active checklist 仍需在对应机器上执行；当前仓库已用真实 npm 0.1.5 packages 完成 host/client/route 组合验证，但不能把 fixture 结果等同于真实部署结果。
- 完整浏览器组图 e2e（client-modules 生产组图、实际浏览器页面加载）仍由 dispatcher materialization、index-inject boot marker 和真实组合测试兜底，未覆盖所有 UI feature。
- 0.1.5 官方 release 还包含 Session V3、Session lifecycle、Agent/Inbox/Web panel 等与本插件无关的其他 breaking changes；本插件只声明 Connection/BrowserAuth replacement 相关 profile 兼容性。
- profile 选择故意 fail-closed：当未来 DSH 改动但尚未建立新 adapter/client variant 时，插件会 dormant，而不会尝试“尽量运行”。

## 实机 dormant 前后对照记录

本机 DSH runtime 为 `0.1.1-rc.2`（既有记录）。验证协议：安装前基线 → 安装 + 重启 → 行为逐项对照 → 卸载 + 重启 → 复验基线；journal 检查统一使用安装前固化的时间锚；任何失败立即回滚。

| 检查项 | 安装前基线 | 安装后（dormant） | 卸载恢复后 |
| --- | --- | --- | --- |
| `GET /` | `200` `text/html; charset=utf-8` | `200` `text/html; charset=utf-8` | `200` `text/html; charset=utf-8` |
| `POST /api/session.list`（未认证） | `200` `application/json` | `200` `application/json` | `200` `application/json` |
| envelope `type` / `rpcId` / `resultOk` | `server-response` / `probe` / `true` | `server-response` / `probe` / `true` | `server-response` / `probe` / `true` |
| 首页静态 shell marker | 在 | 在 | 在 |
| 首页认证文案 `dsh web authentication required` | 0 次出现 | 0 次出现 | 0 次出现 |

既有三组行为文件逐字节 diff 为空；安装后与卸载后 journal 均无固定 warning、无 err 级日志。配置中的 `trusted-connection` 只作为安装证据，不能证明 active。

## active 实机验证清单（两个 profile 通用）

在 DSH 升级到 `0.1.2-rc.1` 或 `0.1.5-rc.1`、安装插件并重启后执行：

1. 确认 profile 行存在：

   ```sh
   dsh --profile web --dump-config | grep -n -A4 'id: trusted-connection'
   # 预期：出现 trusted-connection 与 compatibilityProfile
   ```

2. 首页免 token：

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/
   # 预期：200
   ```

3. token 清理：

   ```sh
   curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' 'http://127.0.0.1:3080/?token=x'
   # 预期：303，并跳转到干净 /
   ```

4. 无 cookie API：

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -X POST \
     -H 'content-type: application/json' \
     -d '{"type":"client-request","rpcId":"probe","method":"session.list","payload":{}}' \
     http://127.0.0.1:3080/api/session.list
   # 预期：非 401/403；没有 api-gateway 时通常为 404
   ```

5. 固定 warning：

   ```sh
   sudo journalctl -u deepseek-harness.service --since '<重启时间点>' \
     | grep -F 'BrowserAuth has been skipped'
   # 预期：出现固定 warning
   ```

6. 0.1.5 专项：若使用 `carrier-neutral-v2`，至少验证一个通过 `connection.rpc.handle()` 注册的 dedicated channel 不返回 405，并验证 exact Fetch route/body mode；若任一失败，立即卸载插件并重启恢复官方行为。

7. 回滚：

   ```sh
   dsh plugin --profile web remove @iasiv5/dsh-skip-browser-auth
   sudo systemctl restart deepseek-harness.service
   ```

真实 active 结果应记录到本节或独立运维记录中，不能用 synthetic fixture 结果替代。
