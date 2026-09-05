// lib/client.js 产物断言（计划 Task 8 Step 1）：wrapper 形态 + 精确 re-ID 结果。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('client artifact keeps the wrapper shape and carries only the new registration id', () => {
  assert.equal(client.startsWith('window.__ModuleLoader__.load({'), true)
  assert.equal(client.includes('id: "@iasiv5/dsh-skip-browser-auth"'), true)
  assert.equal(client.includes('id: "@deepseek-ai/dsh-client-connection"'), false)
  assert.equal(client.includes('return module.exports'), true)
})

test('distribution view carries the upstream MIT license notice', () => {
  // 发布包完整复制官方 client bundle 并移植 substantial source，
  // 上游 MIT 的版权与许可声明必须随分发保留：NOTICE 携带 DeepSeek 的
  // 完整版权行 + MIT 许可文本，LICENSE 为本插件自身的标准 MIT。
  const license = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8')
  const notice = readFileSync(new URL('../NOTICE', import.meta.url), 'utf8')
  assert.ok(license.includes('Permission is hereby granted'))
  assert.ok(notice.includes('Copyright (c) 2026 DeepSeek'))
  assert.ok(notice.includes('Permission is hereby granted'))
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(manifest.files.includes('LICENSE'))
  assert.ok(manifest.files.includes('NOTICE'))
})
