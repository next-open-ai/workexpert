import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKEXPERT_IDENTITY, runtimeToolInventory } from '../runtime-identity.js';
import { streamAgentReply, getExecutionBackend, registerExecutionBackend } from '../stream-reply.js';

test('CB-R02: WorkExpert identity and capability claims are tied to current tools, not history', () => {
  assert.match(WORKEXPERT_IDENTITY, /identify the product as WorkExpert/);
  assert.doesNotMatch(WORKEXPERT_IDENTITY, /QuantumAI|QuantumMate/i);
  assert.match(WORKEXPERT_IDENTITY, /obsolete product names/);
  assert.match(WORKEXPERT_IDENTITY, /actually provided in this execution/);
  assert.match(WORKEXPERT_IDENTITY, /not authorization/);
  assert.match(runtimeToolInventory([], []), /No callable tools/);
  assert.match(runtimeToolInventory(['read', 'read'], []), /No MCP connectors are loaded/);
  assert.equal(runtimeToolInventory(['read', 'read'], []).split('\n')[1], 'read');
  assert.match(runtimeToolInventory(['mcp_quotes'], ['Explicit connector']), /Loaded MCP connectors: Explicit connector/);
});

test('CB-R02: execution entry injects current identity without changing the saved role or history', async () => {
  const original = getExecutionBackend('pi')!;
  let received = '';
  registerExecutionBackend({ ...original, async *stream(input) { received = input.profile.instructions; } });
  const profile = { id: 'general', name: 'General', instructions: 'Keep the employee role.', toolIds: [] };
  try {
    for await (const _event of streamAgentReply({ profile,
      skills: [], searchProviders: [], mcpConnections: [], knowledgeBases: [],
      model: { provider: 'openai', chatModel: 'fixture-only', apiKey: '', baseUrl: 'http://127.0.0.1:1' },
      messages: [{ role: 'user', content: '你是谁？' }],
    }, { override: 'pi' })) { /* Stub makes no network calls. */ }
    assert.match(received, /Keep the employee role/);
    assert.ok(received.endsWith(WORKEXPERT_IDENTITY));
    assert.equal(profile.instructions, 'Keep the employee role.');
  } finally { registerExecutionBackend(original); }
});
