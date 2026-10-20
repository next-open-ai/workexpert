import test from 'node:test';
import assert from 'node:assert/strict';
import type { KeyValueStore } from '@workexpert/orchestrator';
import { authorizeRunMcp, resolveEmployeeMcpConnections } from './context-assembler.js';

function fixture() {
  const data = new Map<string, string>();
  const store: KeyValueStore = {
    get: async key => data.get(key) ?? null,
    set: async (key, value) => { data.set(key, value); },
    delete: async key => { data.delete(key); },
    keys: async prefix => [...data.keys()].filter(key => key.startsWith(prefix ?? '')),
    flush: async () => {},
    close: async () => {},
  };
  const put = (key: string, value: unknown) => data.set(key, JSON.stringify(value));
  const connector = (id: string, extra = {}) => ({ id, name: id, enabled: true, transport: 'stdio', command: 'fixture-never-executed', args: [], ...extra });
  return { store, put, connector };
}

test('CB-R01: absent/empty employee selection loads no MCP; explicit healthy enabled choices only', async () => {
  const { store, put, connector } = fixture();
  put('user:alice:capabilities.mcp', [connector('akshare'), connector('disabled', { enabled: false }), connector('failed', { lastTestStatus: 'failed' })]);
  assert.deepEqual(await resolveEmployeeMcpConnections(store, 'general', 'alice'), []);
  put('user:alice:workspace.employee-runtime-prefs', { general: { mcpIds: [] } });
  assert.deepEqual(await resolveEmployeeMcpConnections(store, 'general', 'alice'), []);
  put('user:alice:workspace.employee-runtime-prefs', { general: { mcpIds: ['akshare', 'disabled', 'failed', 'missing'] } });
  assert.deepEqual((await resolveEmployeeMcpConnections(store, 'general', 'alice'))?.map(c => c.id), ['akshare']);
});

test('CB-R01: known owner never inherits global or another user MCP preferences/catalog', async () => {
  const { store, put, connector } = fixture();
  put('capabilities.mcp', [connector('akshare')]);
  put('workspace.employee-runtime-prefs', { general: { mcpIds: ['akshare'] } });
  put('user:bob:workspace.employee-runtime-prefs', { general: { mcpIds: ['akshare'] } });
  put('user:alice:capabilities.mcp', [connector('akshare')]);
  assert.deepEqual(await resolveEmployeeMcpConnections(store, 'general', 'alice'), []);
  put('user:alice:workspace.employee-runtime-prefs', { general: { mcpIds: ['akshare'] } });
  put('user:alice:capabilities.mcp', []);
  assert.deepEqual(await resolveEmployeeMcpConnections(store, 'general', 'alice'), []);
  await store.delete('user:alice:capabilities.mcp');
  assert.deepEqual(await resolveEmployeeMcpConnections(store, 'general', 'alice'), []);
  assert.equal((await resolveEmployeeMcpConnections(store, 'general'))?.length, 1);
  await store.delete('workspace.employee-runtime-prefs');
  assert.deepEqual(await resolveEmployeeMcpConnections(store, 'general'), []);
});

test('CB-R01: execution replaces stale/client connectors with current saved selection', async () => {
  const { store, put, connector } = fixture();
  const request = { profile: { id: 'general', name: 'General', instructions: '', toolIds: [] },
    mcpConnections: [{ id: 'injected', name: 'Injected', transport: 'stdio' as const, command: 'never-execute', args: [], enabled: true }] };
  assert.deepEqual((await authorizeRunMcp(store, request, 'alice')).mcpConnections, []);
  put('user:alice:capabilities.mcp', [connector('chosen')]);
  put('user:alice:workspace.employee-runtime-prefs', { general: { mcpIds: ['chosen'] } });
  assert.deepEqual((await authorizeRunMcp(store, request, 'alice')).mcpConnections.map(c => c.id), ['chosen']);
  assert.deepEqual((await authorizeRunMcp(store, request)).mcpConnections, []);
  assert.equal(request.mcpConnections[0].id, 'injected');
});
