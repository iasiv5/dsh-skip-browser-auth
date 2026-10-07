# 更新日志

本文件格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。
逐版列出面向使用者的变更及当时兼容的 DSH 版本对；白名单之外的版本对插件**自动休眠**，官方行为分毫不变
（详见 [README · 兼容版本与 profile](./README.md#兼容版本与-profile)）。

## [0.3.9] - 2026-10-08

- 修复：desktop 判别新增**安装槽位信号**（`ctx.baseUrl` 目录基名 === `desktop` ⇒ 休眠）——crash log（`crash-2026-10-07T17-11-31-064Z-host.log`）证实 desktop 宿主为多进程树（Electron main → dsh-desktop-host → 纯 node 子进程跑 loader），0.3.8 的 argv/execPath 信号瞄错进程层仍误判 web；槽位为官方 `desktopProfileDirFromArgv` 契约（desktop 客户端恒用 `profiles/desktop` 槽位），与进程树形状无关
- web 侧行为零变化：web/headless 槽位 + node 宿主照常激活；兼容版本对不变
- desktop 实机复核：见 docs/DESKTOP-DORMANT-CHECKLIST.md（0.3.9 需在 desktop 实机验证正常启动 + 无横幅 + 401×2 后方可视为闭环）

## [0.3.8] - 2026-10-08

- 修复 desktop 门控缺陷：0.3.6 的 desktop 判别仅依赖「dsh-desktop-host 包可解析」，而 desktop profile 为 hoisted 物化布局、该包在 app.asar 内不可达 ⇒ 误判 web ⇒ Replacement 在 desktop 激活 ⇒ "Desktop Host authentication failed" 启动失败（desktop 用户请直接升级本版）
- 新判别（default-deny，三重）：desktop 否决 = 宿主 argv 含 `dsh-desktop-host`（官方 isPackagedDesktopArgv 同款 launcher fact）∨ desktop-host 包可解析；web 证明 = 宿主二进制为 node/node.exe——非 node 二进制或未知宿主一律休眠
- web 侧行为零变化：宿主二进制为 node 时判别结果与 0.3.6 一致；兼容 DSH 版本对不变（`0.1.2-rc.1`、`0.1.5-rc.1`、`0.1.5-rc.2`、`0.1.7-rc.1`、`0.1.7-rc.2`、`0.2.0-rc.1`、`0.2.0-rc.2`）
- 事故记录与残余风险见 docs/COMPATIBILITY.md §7.4/§7.6；desktop 实机复核清单见 docs/DESKTOP-DORMANT-CHECKLIST.md

## [0.3.6] - 2026-10-07

- 新增宿主 profile 门控：仅支持 web profile；desktop profile（存在 `dsh-desktop-host` 的环境）一律自动休眠（设计行为），探针与 `apply()` backstop 双层 fail-closed
- web 侧兼容版本对不变：`0.1.2-rc.1`、`0.1.5-rc.1`、`0.1.5-rc.2`、`0.1.7-rc.1`、`0.1.7-rc.2`、`0.2.0-rc.1`、`0.2.0-rc.2`
- 新增 `scripts/audit-candidate.mjs`（`npm run audit-candidate -- <version>`）：以白名单最新 pair 为基准自动完成 docs/COMPATIBILITY.md §5.1 第 1–3 条的锚点包 tarball 审计，判级 `RE-PUBLISH` / `REPUBLISH-WITH-REVIEW` / `CONTRACT-CHANGED`（含 connection 行对比与 loader seam 抽查）；离线纯函数单测见 tests/audit-candidate.test.mjs（原 Unreleased 条目随本版发布）
- 新增 `docs/DESKTOP-DORMANT-CHECKLIST.md`（desktop 机休眠基线验证清单）

## [0.3.5] - 2026-09-29

- 新增 DSH `0.2.0-rc.2` 支持（npm diff 审计：插件契约面与 `0.2.0-rc.1` 逐字节一致的依赖对齐重发布 + 无关 Desktop 插件管理 CLI 演进，并入 `carrier-neutral-v3`，见 docs/COMPATIBILITY.md §5.7）
- 兼容 DSH：`0.1.2-rc.1`、`0.1.5-rc.1`、`0.1.5-rc.2`、`0.1.7-rc.1`、`0.1.7-rc.2`、`0.2.0-rc.1`、`0.2.0-rc.2`

## [0.3.4] - 2026-09-29

- 新增 DSH `0.2.0-rc.1` 支持（npm diff 审计：插件契约面与 `0.1.7-rc.2` 逐字节一致的依赖对齐重发布，并入 `carrier-neutral-v3`，见 docs/COMPATIBILITY.md §5.6）
- 兼容 DSH：`0.1.2-rc.1`、`0.1.5-rc.1`、`0.1.5-rc.2`、`0.1.7-rc.1`、`0.1.7-rc.2`、`0.2.0-rc.1`

## [0.3.3] - 2026-09-28

- 纯版本号 bump（仅 package.json version，无代码变更）

## [0.3.2] - 2026-09-28

- 修复：connection-runtime 固定开发副本改为按需动态加载，避免部分环境下加载报错
- 兼容 DSH：`0.1.2-rc.1`、`0.1.5-rc.1`、`0.1.5-rc.2`、`0.1.7-rc.1`、`0.1.7-rc.2`

## [0.3.1] - 2026-09-26

- 新增 `carrier-neutral-v3` 代际，适配 DSH `0.1.7-rc.1` / `0.1.7-rc.2`：`admit()`/OperatorPeer 准入、`connection/request` waterfall、mount-preserving BrowserAuth 与 0.1.7 client variant
- 修复：干净工作树上 `npm ci` 可复现（此前导致 CI 发布 ERESOLVE）
- 兼容 DSH：`0.1.2-rc.1`、`0.1.5-rc.1`、`0.1.5-rc.2`、`0.1.7-rc.1`、`0.1.7-rc.2`

## [0.2.2] - 2026-09-14

- package.json 描述对齐市场收录文案（描述元数据由插件自管，无功能变更）
- 兼容 DSH：`0.1.2-rc.1`、`0.1.5-rc.1`、`0.1.5-rc.2`

## [0.2.1] - 2026-09-10

- 新增 DSH `0.1.5-rc.2` 支持（rc.2 为 rc.1 代码逐字节一致的重新发布版，并入 `carrier-neutral-v2`）
- 仓库 `.npmrc` 固定公共 registry（CI 可移植）
- 兼容 DSH：`0.1.2-rc.1`、`0.1.5-rc.1`、`0.1.5-rc.2`

## [0.2.0] - 2026-09-10

- 多代际兼容 profile：新增 DSH `0.1.5-rc.1`（`carrier-neutral-v2`：carrier-neutral HostConnectionService + 0.1.5 client variant，含 dedicated RPC 非 405 与 exact `/api` Fetch route 适配）；`0.1.2-rc.1` 维持 `legacy-web-v1`
- 兼容 DSH：`0.1.2-rc.1`、`0.1.5-rc.1`

## [0.1.3] - 2026-09-05

- 许可证规范化：标准 MIT 模板，上游声明移入 [NOTICE](./NOTICE)
- 兼容 DSH：`0.1.2-rc.1`

## [0.1.2] - 2026-09-05

- 门控探测锚定宿主运行时（而非随包 connection 副本）；npm flat 布局下经 manifest 回退确认版本
- 兼容 DSH：`0.1.2-rc.1`

## [0.1.1] - 2026-09-05

- 发布链修复：lockfile resolved URL 固定 registry.npmjs.org、补 repository 元数据（npm provenance 校验）
- 补充状态徽章与兼容版本表
- 兼容 DSH：`0.1.2-rc.1`

## [0.1.0] - 2026-09-05

- 首发：DSH `0.1.2-rc.1`（`legacy-web-v1`）自动跳过 BrowserAuth，打开 Web 地址即可直接使用，无需抄启动 URL 里的随机 token
- 精确版本对门控 + 自门控 bundle patch：版本不匹配 / 解析失败自动休眠，官方行为分毫不变
- 兼容 DSH：`0.1.2-rc.1`

[Unreleased]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.3.9...HEAD
[0.3.9]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.3.8...v0.3.9
[0.3.8]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.3.6...v0.3.8
[0.3.6]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.2.2...v0.3.1
[0.2.2]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/iasiv5/dsh-skip-browser-auth/releases/tag/v0.1.0
