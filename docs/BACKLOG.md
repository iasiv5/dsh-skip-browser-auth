# Backlog（未实施的评审建议）

来源与日期随条目标注；均非缺陷，属可选打磨。实施前按需重新核对现场（行号/口径会漂移）。

## 1. COMPATIBILITY §6「已通过行」纳入 docs-sync 存在性守卫

- 来源：G2 实施评审计划外建议 ①（2026-10-25，台账 `.dsh-research/impl-review-g2-scratch/ledger.md`）。
- 现状：docs-sync 强制 README / GLOSSARY / docs/DESIGN.md 三文档的版本存在性与行形；`docs/COMPATIBILITY.md` §6 的已通过行靠人工。
- 建议：为 §6 增加存在性断言（每个 GATE_VERSIONS 版本在 §6 已通过清单中出现），防下一轮收编漏改第六处文档。
- 验收提示：加一个 test，负控 = 临时删 §6 某版本应红。

## 2. 实施计划「最终验证 1」的 ≈289 预期行勘误（历史文档，默认不动）

- 来源：G2 实施评审计划外建议 ②。
- 事实：计划期顶层算术把 manifest 期望记为 −8+8（实为 −8+2），`≈289` 行未随 Task 8 的「恰 8」修正同步；实测全仓 283（偏差 −6，在 ±10 容差内）。成因与实测已在计划「结果」节如实披露。
- 建议：docs/plans 为历史文档，默认不改写；若主人要求，仅在 ≈289 行后补一行勘误注（引用结果节），不重写正文。

## 3. active-generations 循环补 evil-host 走 dedicated RPC 路径的断言

- 来源：G2 实施评审计划外建议 ③。
- 现状：旧 active-rc15 的 evil 断言打在 dedicated RPC 路径（`/dsh-sba-rpc-probe/hello` + evil host → 403）；新循环统一打在 exact Fetch 路径（`/api/dsh-sba-fetch-probe` + evil → 403）。两者同为「evil host 在 admit/栅栏阶段被拒」的语义，评审判定等价，无覆盖损失。
- 建议：如想逐字保留旧路径形态，在循环里对全部（或仅 v2 代）追加一次 evil-RPC 探测断言；纯锦上添花。
- 验收提示：改 `tests/composition/active-generations.test.mjs` active 块，`npm test` 全绿、组合层计数公式同步 +1×N 时需同步更新计划结果节口径。
