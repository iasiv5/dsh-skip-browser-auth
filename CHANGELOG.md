# 更新日志

本文件格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。
逐版列出面向使用者的变更及当时兼容的 DSH 版本对；白名单之外的版本对插件**自动休眠**，官方行为分毫不变
（详见 [README · 兼容版本与 profile](./README.md#兼容版本与-profile)）。

## [Unreleased]

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

[Unreleased]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.2.2...v0.3.1
[0.2.2]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/iasiv5/dsh-skip-browser-auth/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/iasiv5/dsh-skip-browser-auth/releases/tag/v0.1.0
