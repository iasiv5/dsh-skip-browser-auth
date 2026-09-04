// gate 绑定负向用例：name mismatch、后续层强制 disabled、路径/manifest 版本漂移。
// 三者共同证明：任何绑定破坏都让 Replacement 保持 dormant 或 fail loud，
// 且 backstop 只在组合期判据被欺骗时才作为最后防线触发。
import test from 'node:test'
import assert from 'node:assert/strict'
import { compose } from '../helpers/compose.mjs'

test('gate binding negative: name-matched id but drifted name keeps both rows alive normally', async (t) => {
  const { context } = await compose(t, {
    probeVersion: '0.1.2-rc.1',
    webRuntime: { lanAddresses: [], trustedHosts: [] },
    rows: [
      { name: '@deepseek-ai/dsh-credentials-local', config: { path: '{{ROOT}}/.credentials.yaml', watch: false } },
      { name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
      { id: 'frontend', name: '@deepseek-ai/dsh-host-frontend-static', config: { distIndex: '{{ROOT}}/dist/index.html' } },
      { id: 'connection', name: '@deepseek-ai/dsh-client-connection-wrong' },
    ],
    modules: {
      '@deepseek-ai/dsh-client-connection-wrong': await import('@deepseek-ai/dsh-client-connection'),
    },
  })

  // 第一行 patch 被 name-guard 跳过：官方行 disabled === false 且活跃；
  // 插件行 dormant；loader.await() 正常完成（无冲突，即本 compose 正常返回）。
  const entries = [...context.loader.entries()]
  const connection = entries.find(e => e.options.id === 'connection')
  const trusted = entries.find(e => e.options.id === 'trusted-connection')
  assert.equal(connection.disabled, false)
  assert.notEqual(connection.fiber, undefined)
  assert.equal(trusted.disabled, true)
  assert.equal(trusted.fiber, undefined)
})

test('gate binding negative: a later layer forcing disabled: true cannot revive the replacement', async (t) => {
  const { context } = await compose(t, {
    probeVersion: '9.9.9',
    webRuntime: { lanAddresses: [], trustedHosts: [] },
    extraPatches: [{ id: 'connection', disabled: true }],
    rows: [
      { name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
      { id: 'frontend', name: '@deepseek-ai/dsh-host-frontend-static', config: { distIndex: '{{ROOT}}/dist/index.html' } },
      { id: 'connection', name: '@deepseek-ai/dsh-client-connection' },
    ],
  })

  // 官方行被后续层强制 disabled === true，但行绑定内的探针拦截：
  // trusted-connection 仍 dormant。
  const entries = [...context.loader.entries()]
  const connection = entries.find(e => e.options.id === 'connection')
  const trusted = entries.find(e => e.options.id === 'trusted-connection')
  assert.equal(connection.disabled, true)
  assert.equal(connection.fiber, undefined)
  assert.equal(trusted.disabled, true)
  assert.equal(trusted.fiber, undefined)
})

test('gate binding negative: path/manifest version drift fails loud via the whitelist backstop', async (t) => {
  // 探针只读路径段会误判 true，Replacement 进入 apply 后由 backstop 读
  // manifest 拦截——loader.await() 以 whitelist 诊断 reject。
  await assert.rejects(
    compose(t, {
      probeVersion: '0.1.2-rc.1',
      manifestVersion: '9.9.9',
      webRuntime: { lanAddresses: [], trustedHosts: [] },
      rows: [
        { name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
        { id: 'frontend', name: '@deepseek-ai/dsh-host-frontend-static', config: { distIndex: '{{ROOT}}/dist/index.html' } },
        { id: 'connection', name: '@deepseek-ai/dsh-client-connection' },
      ],
    }),
    /whitelist/,
  )
})
