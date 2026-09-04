// lib/client.js 产物断言（计划 Task 8 Step 1）：wrapper 形态 + 精确 re-ID 结果。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('client artifact keeps the wrapper shape and carries only the new registration id', () => {
  assert.equal(client.startsWith('window.__ModuleLoader__.load({'), true)
  assert.equal(client.includes('id: "dsh-skip-browser-auth"'), true)
  assert.equal(client.includes('id: "@deepseek-ai/dsh-client-connection"'), false)
  assert.equal(client.includes('return module.exports'), true)
})
