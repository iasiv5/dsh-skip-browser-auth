// connection-runtime 的 loader 契约回归（2026-09-10 崩溃事故）：
// loadRuntimeConnectionModule 必须按 cordis-plugin-loader 的产品契约
// internal.import(name, baseUrl, options) 三参调用，禁止单参/缺 baseUrl；
// 有 loader 服务时不得静默回退到插件自带 pinned 副本。
import test from 'node:test'
import assert from 'node:assert/strict'
import { CONNECTION_PACKAGE } from '../lib/gate.js'
import { loadRuntimeConnectionModule } from '../lib/connection-runtime.js'

const BASE_URL = 'file:///home/u/.dsh/profiles/web/'
const VALID_MODULE = {
  HostConnectionService: function HostConnectionService() {},
  API_PATH: '/api',
}

function ctxWith(loader, baseUrl = BASE_URL) {
  return { baseUrl, get: (name) => (name === 'loader' ? loader : undefined) }
}

test('product loader path imports via the cordis-plugin-loader contract (name, baseUrl, options)', async () => {
  const calls = []
  const loader = {
    internal: {
      import: async (...args) => {
        calls.push(args)
        return VALID_MODULE
      },
    },
  }
  const loaded = await loadRuntimeConnectionModule(ctxWith(loader))
  assert.equal(loaded, VALID_MODULE)
  assert.deepEqual(calls, [[CONNECTION_PACKAGE, BASE_URL, {}]])
})

test('a single-argument import call signature is never used (crash regression)', async () => {
  // 复刻事故形态：internal.import 只接受三参，单参调用会拿到 undefined baseUrl。
  const loader = {
    internal: {
      import: async (name, baseUrl, options) => {
        if (typeof baseUrl !== 'string' || baseUrl === '') {
          throw new TypeError("Cannot read properties of undefined (reading 'getOrCreateModuleJob')")
        }
        if (options === undefined) throw new TypeError('options is required')
        return VALID_MODULE
      },
    },
  }
  // 修复后的实现必须带全三参：该 fake 在缺参时会抛出事故同款 TypeError。
  await assert.doesNotReject(loadRuntimeConnectionModule(ctxWith(loader)))
})

test('import failure is wrapped with the plugin prefix and the original message', async () => {
  const loader = {
    internal: {
      import: async () => {
        throw new TypeError("Cannot read properties of undefined (reading 'getOrCreateModuleJob')")
      },
    },
  }
  await assert.rejects(
    loadRuntimeConnectionModule(ctxWith(loader)),
    (error) => {
      assert.match(error.message, /failed to import runtime module @deepseek-ai\/dsh-client-connection/)
      assert.match(error.message, /getOrCreateModuleJob/)
      return true
    },
  )
})

test('a present loader without internal.import fails loud instead of using the pinned copy', async () => {
  await assert.rejects(
    loadRuntimeConnectionModule(ctxWith({ internal: {} })),
    /loader\.internal\.import is unavailable; refusing to fall back/,
  )
  await assert.rejects(
    loadRuntimeConnectionModule(ctxWith({})),
    /loader\.internal\.import is unavailable; refusing to fall back/,
  )
})

test('a present loader without a usable context baseUrl fails loud (crash regression)', async () => {
  const loader = { internal: { import: async () => VALID_MODULE } }
  // 直接构造无 baseUrl 属性的 ctx，绕过 helper 默认参数。
  await assert.rejects(loadRuntimeConnectionModule({ get: () => loader }), /requires the plugin context baseUrl/)
  await assert.rejects(loadRuntimeConnectionModule(ctxWith(loader, '')), /requires the plugin context baseUrl/)
})

test('a loader-imported module with an incompatible export shape fails loud', async () => {
  const loader = { internal: { import: async () => ({ apply: () => {} }) } }
  await assert.rejects(loadRuntimeConnectionModule(ctxWith(loader)), /incompatible export shape/)
})

test('only a loader-less direct unit context falls back to the pinned dev copy', async () => {
  const loaded = await loadRuntimeConnectionModule({ baseUrl: BASE_URL, get: () => undefined })
  assert.equal(typeof loaded.HostConnectionService, 'function')
  assert.equal(loaded.API_PATH, '/api')
})
