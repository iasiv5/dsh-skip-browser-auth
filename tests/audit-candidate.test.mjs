// audit-candidate.mjs 的离线单测：只覆盖纯函数（pair 解析、版本比较、diff 分类、
// connection 行截取、loader seam 报告），不触发 npm 网络。真实 tarball 审计由
// `npm run audit-candidate -- <version>` 人工触发（见 docs/COMPATIBILITY.md §5）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ANCHOR_PACKAGES,
  chunkKey,
  compareVersions,
  classifyPackage,
  extractConnectionRow,
  isManifestOrDoc,
  parsePairs,
  pickBasePair,
} from '../scripts/audit-candidate.mjs'
import { readFileSync } from 'node:fs'

test('anchor set matches the §5.5–§5.7 audited collection, order = probe surface first, runtime last', () => {
  assert.equal(ANCHOR_PACKAGES.length, 8)
  assert.equal(ANCHOR_PACKAGES[0], '@deepseek-ai/dsh-client-connection')
  assert.equal(ANCHOR_PACKAGES.at(-1), '@deepseek-ai/dsh')
})

test('parsePairs reads the exact-pair table from the compatibility source', () => {
  const pairs = parsePairs(readFileSync(new URL('../src/compatibility.ts', import.meta.url), 'utf8'))
  assert.deepEqual(pairs, [
    { runtime: '0.1.2-rc.1', connection: '0.1.2-rc.1' },
    { runtime: '0.1.5-rc.1', connection: '0.1.5-rc.1' },
    { runtime: '0.1.5-rc.2', connection: '0.1.5-rc.2' },
    { runtime: '0.1.7-rc.1', connection: '0.1.7-rc.1' },
    { runtime: '0.1.7-rc.2', connection: '0.1.7-rc.2' },
    { runtime: '0.2.0-rc.1', connection: '0.2.0-rc.1' },
    { runtime: '0.2.0-rc.2', connection: '0.2.0-rc.2' },
  ])
  assert.equal(pickBasePair(pairs).runtime, '0.2.0-rc.2')
})

test('compareVersions orders semver cores and rc pre-release numerics', () => {
  assert.ok(compareVersions('0.2.0-rc.2', '0.2.0-rc.1') > 0)
  assert.ok(compareVersions('0.2.0-rc.10', '0.2.0-rc.2') > 0) // 数值比较，不是字典序
  assert.ok(compareVersions('0.2.0', '0.2.0-rc.2') > 0) // 正式版 > 预发布
  assert.ok(compareVersions('0.2.0-rc.1', '0.1.9') > 0)
  assert.ok(compareVersions('0.2.0-rc.1', '0.2.0-rc.1') === 0)
  assert.ok(compareVersions('0.3.0', '0.2.0-rc.9') > 0)
})

test('isManifestOrDoc exempts only package.json, README*, *.md', () => {
  assert.equal(isManifestOrDoc('package.json'), true)
  assert.equal(isManifestOrDoc('README.md'), true)
  assert.equal(isManifestOrDoc('README.zh.md'), true)
  assert.equal(isManifestOrDoc('docs/DESIGN.md'), true)
  assert.equal(isManifestOrDoc('lib/index.js'), false)
  assert.equal(isManifestOrDoc('cordis.patch.yml'), false)
})

function makeTree(root, files) {
  mkdirSync(join(root, 'package'), { recursive: true })
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, 'package', path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
}

test('classifyPackage: manifest-only diff stays a republish signal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sba-test-'))
  try {
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    makeTree(a, { 'package.json': '{"version":"1"}', 'lib/index.js': 'same' })
    makeTree(b, { 'package.json': '{"version":"2"}', 'lib/index.js': 'same' })
    const result = classifyPackage('@deepseek-ai/dsh-scope', a, b)
    assert.equal(result.status, 'manifest-or-docs-only')
    assert.deepEqual(result.codeChanged, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('classifyPackage: content-identical renames are detected as chunk-hash renames', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sba-test-'))
  try {
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    makeTree(a, { 'package.json': '{"v":1}', 'lib/plugin-AAA.js': 'chunk-body', 'lib/bin.js': 'x' })
    makeTree(b, { 'package.json': '{"v":2}', 'lib/plugin-BBB.js': 'chunk-body', 'lib/bin.js': 'x' })
    const result = classifyPackage('@deepseek-ai/dsh', a, b)
    assert.equal(result.renames.length, 1)
    assert.equal(result.renames[0].from, 'lib/plugin-AAA.js')
    assert.equal(result.renames[0].to, 'lib/plugin-BBB.js')
    assert.equal(result.renames[0].contentIdentical, true)
    assert.equal(result.status, 'manifest-or-docs-only')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('chunkKey strips the trailing 8-char hash so content-changed chunks still pair', () => {
  assert.equal(chunkKey('lib/plugin-DkYIj96-.js'), 'lib/plugin-')
  assert.equal(chunkKey('lib/plugin-BGnVfe_D.js'), 'lib/plugin-')
  assert.equal(chunkKey('lib/index-Cx9zAb12.js'), 'lib/index-')
  assert.equal(chunkKey('lib/bin.js'), null) // 非哈希名不参与配对
  assert.equal(chunkKey('README.md'), null)
})

test('classifyPackage: content-changed chunk renames pair by key and leave the seam to decide', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sba-test-'))
  try {
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    makeTree(a, { 'package.json': '{"v":1}', 'lib/plugin-DkYIj96-.js': 'cli v1; resolveSync(a, b, c);' })
    makeTree(b, { 'package.json': '{"v":2}', 'lib/plugin-BGnVfe_D.js': 'cli v2; resolveSync(a, b, c);' })
    const result = classifyPackage('@deepseek-ai/dsh', a, b)
    assert.equal(result.renames.length, 1)
    assert.equal(result.renames[0].contentIdentical, false)
    assert.equal(result.unmatchedCode.length, 0) // 已配对，不再以「单侧文件」阻断
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('classifyPackage: a real code change on a replacement-surface anchor blocks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sba-test-'))
  try {
    const a = join(dir, 'a')
    const b = join(dir, 'b')
    makeTree(a, { 'package.json': '{"v":1}', 'lib/index.js': 'admit(req)' })
    makeTree(b, { 'package.json': '{"v":2}', 'lib/index.js': 'admit(req, extra)' })
    const result = classifyPackage('@deepseek-ai/dsh-client-connection', a, b)
    assert.equal(result.status, 'code-diff')
    assert.deepEqual(result.codeChanged, ['lib/index.js'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('extractConnectionRow isolates the official connection row and detects drift', () => {
  const patchA = [
    '# header',
    '- id: connection',
    '  name: \'@deepseek-ai/dsh-client-connection\'',
    '  disabled: !!js probe-A',
    '- insert:',
    '  - id: trusted-connection',
  ].join('\n')
  const patchB = [
    '# header',
    '- id: telemetry',
    '  config: {}',
    '- id: connection',
    '  name: \'@deepseek-ai/dsh-client-connection\'',
    '  disabled: !!js probe-A',
    '- insert:',
    '  - id: trusted-connection',
  ].join('\n')
  const patchRowDrift = patchA.replace('probe-A', 'probe-CHANGED')
  // 官方 patch 的 connection 行是带缩进的嵌套行（2026-09-29 审计脚本修正）。
  const indentedA = patchA.split('\n').map((l) => (l.startsWith('- ') ? `    ${l}` : l)).join('\n')
  const indentedB = patchB.split('\n').map((l) => (l.startsWith('- ') ? `    ${l}` : l)).join('\n')
  assert.equal(extractConnectionRow(patchA), extractConnectionRow(patchB)) // 非连接行可进出（§5.6）
  assert.equal(extractConnectionRow(indentedA), extractConnectionRow(indentedB)) // 缩进形态同样可截取
  assert.notEqual(extractConnectionRow(patchA), extractConnectionRow(patchRowDrift)) // connection 行漂移 = 阻断
})
