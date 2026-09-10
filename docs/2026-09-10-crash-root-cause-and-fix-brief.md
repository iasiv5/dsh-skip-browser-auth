# dsh-skip-browser-auth 2026-09-10 故障根因与修复任务书

> 交接：Hermes（小舒子）→ DSH Agent。**【更新 2026-09-10 22:10：本任务书已结案**——DSH Agent 21:57 的修复仍崩溃（原因：`const importer = loader.internal?.import` detached 调用丢 `this`，`importer.call(loader.internal, name, baseUrl, options)` 才正确，已由 Hermes 修复并验证）；Task 1–4 已全部完成、`npm run test:all` 107/107 通过（1 skip 为 pnpm-only 布局测试）、Task 5 文档完成、服务端到端验证通过。本文件仅留档。】

> 交接：Hermes（小舒子）→ DSH Agent。DSH Web 已由 Hermes 临时回退恢复，本文档供 DSH Agent 继续修复 WIP 使用。

## 背景

2026-09-10 晚 `dsh-skip-browser-auth` 多代兼容重构（未提交 WIP）导致 DSH Web（deepseek-harness.service，3080）两次故障。现已临时回退：`lib/` 与 `cordis.patch.yml` 从 npm 官方 0.1.3 制品恢复，服务稳定运行；WIP 的 `src/` 改动原样保留，WIP 版 lib 备份在 `lib.wip-backup-20260910-2140/`。

**DSH runtime（0.1.2-rc.1）没有被自动更新，与本故障无关**（当天 12:32 的重启是一次独立的 Node 堆内存 OOM，1.4G 峰值，systemd 自动拉起）。

## 故障 1（已随回退消失）

浏览器端报错：

```
@iasiv5/dsh-skip-browser-auth: missing or unknown compatibility profile in __DSH_SKIP_BROWSER_AUTH_PROFILE__: undefined
```

根因：插件是 `link:` 直链本仓库（profile `dependencies` 里 `"@iasiv5/dsh-skip-browser-auth": "link:/home/ubuntu/workspace/dsh-skip-browser-auth"`），17:23 重新 build 后浏览器拿到了新 `lib/client.js`（factory 按 `globalThis.__DSH_SKIP_BROWSER_AUTH_PROFILE__` 分发 variant），但当时还在跑的旧宿主进程（12:32 启动）不会通过 `webserver/index-inject` 注入该 global → 分发器落到兜底 throw。

这是新旧宿主/客户端混跑的过渡态错误，重启即自愈——真正致命的是故障 2。

## 故障 2（真正的 bug，请修复）

新 `src/adapters` 路径引入的 `lib/connection-runtime.js`（对应 WIP 源码 `src/connection-runtime.ts`）在 `loadRuntimeConnectionModule()` 里调用运行时内部 loader：

```js
const importer = loader?.internal?.import;
const loaded = await importer(CONNECTION_PACKAGE);   // ← 只传 1 个参数，错误
```

`loader.internal` 是 Node 内部 ESM loader（v2 形态，Node ≥24.12），其 `import` 需要 `(name, baseUrl, options)` 三参。单参调用时 baseUrl 为 undefined，内部走到 `getOrCreateModuleJob` 前即抛：

```
TypeError: Cannot read properties of undefined (reading 'getOrCreateModuleJob')
    at loadRuntimeConnectionModule (.../lib/connection-runtime.js:20:30)
    at Object.apply [as callback] (.../lib/host.js:156:26)
```

宿主 apply fail-loud 把它上抛，插件树加载失败 → 进程退出 → systemd 5 秒重拉 → **崩溃循环**（journal 证据：`failed to apply loader entry trusted-connection (@iasiv5/dsh-skip-browser-auth)`）。

## 修复方向

1. 参照 cordis-plugin-loader 自身的调用方式（`cordis-plugin-loader/lib/index.js:274`）：`await loader.internal.import(CONNECTION_PACKAGE, ctx.baseUrl, {})`——baseUrl 从当前 context 取（插件 ctx 的 `baseUrl` 是 profile 目录）。注意同文件 `src/index.ts` 的 backstop 已经正确处理了 v1/v2 的 `resolveSync` 双签名，import 同样要照顾两种形态或明确只支持 v2 并在 v1 下走别的路径。
2. 修完后 `npm run build` 重建 lib，先做 ESM 冒烟（`node -e "import('./lib/host.js').then(()=>console.log('ok'))"`）再重启服务。
3. 重启后验证：
   - `systemctl is-active deepseek-harness.service` = active
   - `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3080/` = 200
   - journal 出现 `@iasiv5/dsh-skip-browser-auth: BrowserAuth has been skipped`
   - 重启后 1 分钟内无 `FAILURE` / 崩溃循环
4. 回退期间如果其他改动依赖新 lib（如 `@deepseek-ai` 依赖声明不变式），先核对 `tests/manifest.test.mjs` 的不变量再动手。

## 当前状态快照（2026-09-10 21:40 左右）

- `lib/` = npm 0.1.3 官方制品（无 `adapters/`、无 `connection-runtime.js`）
- `lib.wip-backup-20260910-2140/` = 17:23 build 的 WIP lib（含 bug，供 diff 对照）
- `src/`、`docs/plans/*.md` 等 WIP 源码改动原样保留（未 stash、未提交）
- `cordis.patch.yml` 已被 0.1.3 版覆盖；WIP 版是 build 时从 `src/gate.ts` 生成的，重跑 `npm run build` 即可再生

## 运维红线（~/.dsh/AGENTS.md 摘要）

- 重启只用 `sudo systemctl restart deepseek-harness.service`（或 user 级 shim `systemctl --user start dsh-web.service`）
- 3080 端口唯一实例，勿另起任何监听 3080 的进程
- 修完务必按上面第 3 条端到端验证，不要只看进程 active
