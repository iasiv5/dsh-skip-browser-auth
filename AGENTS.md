# AGENTS.md — dsh-skip-browser-auth 仓库导航与元数据红线

## 包元数据红线（2026-11-19 主人裁决，禁止随 dsh-m 家族统一口径收敛）

本插件是**白名单激活型**：`docs/COMPATIBILITY.md` 的精确 runtime/connection 版本对
**就是**兼容性契约本身（fail-closed：不在表内即休眠）。以下四面是同一契约的投影，
**必须逐字同步、禁止任何「统一 / 收敛 / 顺手对齐」类批量操作波及**：

| 面 | 现值 | 为什么不许改 |
|---|---|---|
| `package.json` → `dsh.engines.dsh` | `>=0.1.2-rc.1` | 地板 = 白名单最低对的元数据投影。若提到 0.2.0-rc.1，0.1.x 宿主将装不上现行版本，而白名单表内明含 0.1.x 各对——元数据与激活表自相矛盾。本插件不靠地板保护：fail-closed 设计本身就是保护，地板的唯一职责是如实映射白名单。 |
| `package.json` → `description` | 含全部 16 对白名单版本的**有序枚举句** | description 会被 dsh-m 已装页原样展示（installed.ts 读安装包 description）——它是「已装页上的激活表」。`tests/docs-sync.test.mjs` 以「expands to exactly the whitelist versions in order」钉死有序全等（历史上真实漂移过一版的补丁成果）；市场文案对齐类操作禁波及。 |
| `package.json` → peer `@deepseek-ai/cordis` | `*` | cordis 版本随各代宿主捆绑，与激活逻辑无关（激活与否由白名单裁决）。约束 cordis 会在 legacy 线宿主（捆绑旧 cordis）制造 ERESOLVE 假阳，直接违反版本对契约。 |
| `README` 徽章 | 16 版本对长链 `DSH_Web …_verified-blue` | 徽章即激活表的公开形态（主人裁决 2026-11-19：还原，勿压缩为单版本徽章）。 |
| `dsh-m registry.json` → `verified` | 16 条数组 | 全家唯一保留该栏位的条目（008 §3 唯一例外行）。 |

**实录（2026-11-19）**：dsh-m 家族统一战役（S1 engines 地板统一 0.2.0-rc.1 / S2 cordis
统一 >=4.0.2 / 徽章统一 rc.5 verified / 已装页文案对齐）曾把本插件一并卷入：registry
verified 与 README 徽章两处被主人现场叫停还原；package.json 三处（地板→0.2.0-rc.1、
cordis→>=4.0.2、description 白名单枚举句被抹）漏网，其中 description 由本仓
docs-sync 契约测试红灯拦回——三处事后全部还原，本文件立项拦回。

**判别口诀：凡「统一 / 对齐 / 收敛」类批量操作，本仓库一律豁免。本插件的兼容性事实只有
一个源头——`docs/COMPATIBILITY.md` 的白名单对表；其余一切面只是它的投影。**

## 测试与发版

- `npm test`（pretest build）；`npm run audit-candidate` 为白名单候选审计入口。
- 新版本对验证后：同步 `docs/COMPATIBILITY.md` → 上表四面（徽章链尾、verified 数组等），
  一个对都不能少。
