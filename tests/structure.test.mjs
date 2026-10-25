// 结构守卫（fixture-registry 表驱动化的防回潮层，实施计划 Task 6）：
// ① 禁止 tests/composition/ 再出现逐版本拷贝文件（active-rcNXX / npm-flat-rcNXX
//    命名模式）——收编新版本的正确触点是 tests/fixtures/registry.mjs 加一行；
// ② registry ↔ COMPATIBILITY_PROFILES 双向完备：版本集合与全局序完全一致，
//    每个条目解析到 active profile 且 profileId 吻合（漏一行/错一行直接红）；
// ③ 别名后缀唯一，且三件别名一律以 -<suffix> 结尾（防后缀串行漂移）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { GATE_VERSIONS, resolveCompatibilityProfile } from '../lib/gate.js'
import { VERSION_FIXTURES } from './fixtures/registry.mjs'

const compositionDir = join(dirname(fileURLToPath(import.meta.url)), 'composition')

test('composition suite must not grow per-version copy files (active-rcNXX / npm-flat-rcNXX)', () => {
  const offenders = readdirSync(compositionDir)
    .filter((name) => /^(?:active|npm-flat)-rc\d+\.test\.mjs$/.test(name))
  assert.deepEqual(offenders, [], `per-version copy files are forbidden; add one row to tests/fixtures/registry.mjs instead: ${offenders.join(', ')}`)
})

test('registry mirrors the compatibility whitelist exactly (same versions, same global order, active profile ids)', () => {
  assert.deepEqual(
    VERSION_FIXTURES.map((entry) => entry.version),
    [...GATE_VERSIONS],
  )
  for (const entry of VERSION_FIXTURES) {
    const profile = resolveCompatibilityProfile(entry.version, entry.version)
    assert.ok(profile !== undefined, `${entry.version} must resolve to a compatibility profile`)
    assert.equal(profile.status, 'active', `${entry.version} must map to an active profile`)
    assert.equal(profile.id, entry.profileId, `${entry.version} registry profileId mismatch`)
  }
})

test('fixture alias suffixes are unique and suffix every alias name', () => {
  const suffixes = VERSION_FIXTURES
    .filter((entry) => entry.aliasSuffix !== null)
    .map((entry) => entry.aliasSuffix)
  assert.equal(new Set(suffixes).size, suffixes.length, 'alias suffixes must be unique')
  for (const entry of VERSION_FIXTURES) {
    if (entry.aliasSuffix === null) {
      assert.equal(entry.aliases, null, `${entry.version} null suffix must pair null aliases`)
      continue
    }
    for (const [kind, alias] of Object.entries(entry.aliases)) {
      assert.ok(
        typeof alias === 'string' && alias.endsWith(`-${entry.aliasSuffix}`),
        `${entry.version} ${kind} alias ${String(alias)} must end with -${entry.aliasSuffix}`,
      )
    }
  }
})
