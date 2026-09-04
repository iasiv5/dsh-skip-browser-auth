import test from 'node:test';
import assert from 'node:assert/strict';
test('host entry loads', async () => {
  const mod = await import('../lib/host.js');
  assert.equal(typeof mod.apply, 'function');
  assert.equal(mod.name, 'dsh-skip-browser-auth');
});
