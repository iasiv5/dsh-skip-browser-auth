// 兼容版本清单的文档同步看护（2026-10-17 retro 立项）：白名单每加一个 pair，
// README / GLOSSARY / DESIGN 的版本清单都是 GATE_VERSIONS 的机械衍生物——
// 漂移（文档宣称支持而白名单没有，或反之）从此必红。只做机械存在性/形状
// 检查，不复核文案措辞（那是 008 式人工流程的职责）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { GATE_VERSIONS, COMPATIBILITY_PROFILES, resolveCompatibilityProfile } from '../lib/gate.js'

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

// ── c4 扩展（2026-10-25 表驱动化，实施计划 Task 10；展开公式与片段判据为评审
// 探针实证版）───────────────────────────────────────────────────────────────

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/**
 * 展开 description 的紧凑版本记法（两步公式：首元素已是完整版本原样保留；
 * 后续 `/rc.N` 尾巴拼「首元素最后一个 `-` 前缀」，如 `0.1.5-rc.1/rc.2` →
 * `0.1.5-rc.1` + `0.1.5-rc.2`）。每个产物必须匹配精确版本串形状，防误吞
 * 非版本 token。
 */
function expandDescriptionVersions(description) {
  const segments = description
    .split('、')
    .flatMap((token) => token.split('与'))
    .flatMap((token) => token.match(/\d+\.\d+\.\d+-rc\.\d+(?:\/rc\.\d+)*/) ?? [])
  const expanded = []
  for (const segment of segments) {
    const parts = segment.split('/')
    expanded.push(parts[0])
    const prefix = parts[0].slice(0, parts[0].lastIndexOf('-'))
    for (const tail of parts.slice(1)) expanded.push(`${prefix}-${tail}`)
  }
  for (const version of expanded) {
    assert.match(version, /^\d+\.\d+\.\d+-rc\.\d+$/, `description 展开产物必须是精确版本串：${version}`)
  }
  return expanded
}

test('package.json description expands to exactly the whitelist versions in order', () => {
  // 曾实际漂移过一版（v0.2.2 专版修复）；从此 description 与白名单的有序
  // 相等由测试强制（紧凑记法两边都可改，集合与顺序不可漂）。
  assert.deepEqual(expandDescriptionVersions(pkg.description), [...GATE_VERSIONS])
})

test('README generation grouping is position-aware (each profile segment/line holds exactly its versions)', () => {
  // 两类片段：「……使用 `<profile-id>`」的分代适配段（按 ；／。天然分段）与
  // agent 提示块行「- DSH <版本列表>：<profile-id>」。片段内版本集合必须
  // 恰好等于该 profile 的版本集——多、少、错代都红（位置盲 includes() 的补集）。
  const SEG_ID = /([^；;。]*?)使用\s*`(legacy-web-v1|carrier-neutral-v[234])/g
  const LINE_ID = /^-\s*DSH\s+(.+?)：\s*(legacy-web-v1|carrier-neutral-v[234])\s*$/gm
  const VERSION_RE = /\d+\.\d+\.\d+-rc\.\d+/g
  const profileVersionSet = (profileId) => {
    const profile = COMPATIBILITY_PROFILES.find((candidate) => candidate.id === profileId)
    return [...(profile?.pairs ?? []).flatMap((pair) => [pair.runtime])].sort()
  }
  const problems = []
  let match
  while ((match = SEG_ID.exec(README)) !== null) {
    const got = [...new Set(match[1].match(VERSION_RE) ?? [])].sort()
    const want = profileVersionSet(match[2])
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      problems.push(`分代适配段 ${match[2]}：got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
    }
  }
  while ((match = LINE_ID.exec(README)) !== null) {
    const got = [...new Set(match[1].split(' / ').flatMap((part) => part.match(VERSION_RE) ?? []))].sort()
    const want = profileVersionSet(match[2])
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      problems.push(`提示块行 ${match[2]}：got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
    }
  }
  assert.deepEqual(problems, [])
})
