// legacy-web-v1 RPC regression: 0.1.2 dedicated channel remains usable while
// carrier-neutral workaround is isolated to the 0.1.5 adapter.
import test from 'node:test'
import assert from 'node:assert/strict'
import { compose, rawRequest } from '../helpers/compose.mjs'
import * as RpcProbe from '../fixtures/rpc-probe.mjs'

const ROWS = [
  { name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
  { id: 'frontend', name: '@deepseek-ai/dsh-host-frontend-static', config: { distIndex: '{{ROOT}}/dist/index.html' } },
  { id: 'connection', name: '@deepseek-ai/dsh-client-connection' },
  { id: 'rpc-probe', name: 'dsh-skip-browser-auth-rpc-probe' },
]

test('0.1.2 legacy profile: dedicated RPC stays reachable', async (t) => {
  const { port } = await compose(t, {
    probeVersion: '0.1.2-rc.1',
    webRuntime: { lanAddresses: [], trustedHosts: [] },
    modules: { 'dsh-skip-browser-auth-rpc-probe': RpcProbe },
    rows: ROWS,
  })
  const response = await rawRequest(port, {
    path: '/dsh-sba-rpc-probe/hello',
    method: 'POST',
    headers: { host: '127.0.0.1', 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'probe', method: 'hello', payload: {} }),
  })
  assert.equal(response.status, 200)
})
