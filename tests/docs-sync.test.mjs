// 兼容版本清单的文档同步看护（2026-10-17 retro 立项）：白名单每加一个 pair，
// README / GLOSSARY / DESIGN 的版本清单都是 GATE_VERSIONS 的机械衍生物——
// 漂移（文档宣称支持而白名单没有，或反之）从此必红。只做机械存在性/形状
// 检查，不复核文案措辞（那是 008 式人工流程的职责）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { GATE_VERSIONS, resolveCompatibilityProfile } from '../lib/gate.js'

const README = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
const GLOSSARY = readFileSync(new URL('../GLOSSARY.md', import.meta.url), 'utf8')
const DESIGN = readFileSync(new URL('../docs/DESIGN.md', import.meta.url), 'utf8')

test('every whitelisted version appears in README, GLOSSARY and DESIGN', () => {
  for (const version of GATE_VERSIONS) {
    assert.ok(README.includes(version), `README 缺白名单版本 ${version}`)
    // GLOSSARY 两处：whitelist 行（`v + v` 形态）与 profile 行（纯版本号）。
    assert.ok(GLOSSARY.includes(`${version} + ${version}`), `GLOSSARY 白名单行缺 ${version} 的 pair`)
    assert.ok(GLOSSARY.includes(version), `GLOSSARY 缺白名单版本 ${version}`)
    assert.ok(DESIGN.includes(version), `DESIGN 缺白名单版本 ${version}`)
  }
})

test('README and DESIGN compatibility tables have a pair row per version, bound to the right profile', () => {
  for (const version of GATE_VERSIONS) {
    const profile = resolveCompatibilityProfile(version, version)
    assert.ok(profile, `${version} 必须能解析到 active profile（白名单与代际表失配）`)
    // README 兼容表的行首形状：`| \`v\` + \`v\` | \`profile-id\` |`。
    const rowHead = `| \`${version}\` + \`${version}\` | \`${profile.id}\` |`
    assert.ok(README.includes(rowHead), `README 兼容表缺 ${version} 的 pair 行（${rowHead}）`)
    // DESIGN profile 表的 pairs 列：`\`v\` + \`v\`` 与代际同行。
    const designRowHead = `| \`${profile.id}\` |`
    const designRow = DESIGN.split('\n').find((line) => line.startsWith(designRowHead))
    assert.ok(designRow, `DESIGN profile 表缺 ${profile.id} 行`)
    assert.ok(designRow.includes(`\`${version}\` + \`${version}\``), `DESIGN ${profile.id} 行缺 ${version} 的 pair`)
  }
})
