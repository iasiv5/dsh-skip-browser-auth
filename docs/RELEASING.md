# RELEASING — 发版与 DSH 版本收编流程

兼容性判级（RE-PUBLISH / REPUBLISH-WITH-REVIEW / CONTRACT-CHANGED）与代际准入条件见
[docs/COMPATIBILITY.md](./COMPATIBILITY.md) §5.0–§5.2；本文只写判级通过后的机械步骤。
先例：`git show dbcaefa`（rc.4/0.4.6 轮）与 `git show 0fb962a`（rc.5/0.4.7 轮）。

## 1. 收编改动面（republish 快速通道 = 两处代码 + 六处文档）

**代码**（仅两处，0.4.3 起表驱动化）：

- `src/compatibility.ts`：`carrier-neutral-v4.pairs` 追加 pair + 代际注释块（引用 §5.x 审计记录）
- `tests/fixtures/registry.mjs`：追加 `rc<N><M>` 别名条目（version/profileId/aliasSuffix/aliases）

**文档**（docs-sync 守卫会强制同步，漏改必红；以测试报错为准补位）：

| 文件 | 位点 |
| --- | --- |
| `docs/COMPATIBILITY.md` | 新 §5.x 审计记录 + §6 已通过清单一行 |
| `README.md` | 徽章 URL、精确门控句、分代适配句、agent 提示词两行（支持列表 + 验证步骤 3）、兼容表格行、白名单示例三行 |
| `GLOSSARY.md` | compatibility profile 行、whitelist 行（注意：每对版本一个反引号组） |
| `docs/DESIGN.md` | 代际表 v4 行、不得激活清单两行（跨 patch 混合双向）、行为矩阵一行 |
| `CHANGELOG.md` | 新版本节（判级结论 + 测试项 + 兼容 DSH 全列） |
| `package.json` + `package-lock.json` | `npm version <x.y.z> --no-git-tag-version` 同步三处根字段；description 版本串（紧凑记法） |

## 2. 审计与验证

```sh
export npm_config_cache=<workspace>/.npm-ci-cache   # 沙箱 ~/.npm EROFS（know-how 026）
npm run audit-candidate -- <candidate>              # 判级；基准自动取白名单最新 pair
npm ci                                              # 依赖缺失时按 lockfile 恢复
npm run test:all                                    # = fixtures(真实 npm 包) + typecheck + test
```

docs-sync / structure / manifest 测试会逐一核对你改的文档位；红即按提示补。

## 3. 发版

1. 单提交含全部改动面，message 记判级结论与测试计数（先例格式见 git log）；
2. push `main` —— CI（fixtures + build + typecheck + 全量测试）必绿，是发版前置门；
3. push tag `v<version>` —— `.github/workflows/publish.yml` OIDC Trusted Publishing 自动发布；
4. registry 轮询：`01_docs/dsh-intall-know-how/tools/release-monitor.sh iasiv5/dsh-skip-browser-auth v<version> @iasiv5/dsh-skip-browser-auth <version>`
   （npmjs 直查；staged 假绿窗口与 rerun 纪律见 know-how 018，绿 ≠ 已上架）。

## 4. 装机与回填

1. registry 转正后 `dshm_upgrade` 装机 → 重启 → 实机 active checklist
   （journal `BrowserAuth has been skipped` 恰一次 + 无 token `GET /` 200 + `skipping profile bundle`=0）；
2. 回填 `docs/COMPATIBILITY.md` §5.x 第 6 条与 README 表格状态列（先例 §5.11/§5.13），单独 docs commit；
3. dsh-m 市场条目联动的核对与确认流程见 know-how 008/022（verified 只记实机验证过的 DSH 版本）。
