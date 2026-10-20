import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../apps/api/src/modules/orchestration/context-assembler.ts', import.meta.url), 'utf8');
assert.match(source, /user:\$\{ownerUserId\.trim\(\)\}:\$\{MCP_KEY\}/);
assert.doesNotMatch(source, /scopedRows\.length > 0/);
assert.match(source, /if \(!wanted\.has\(id\)\) continue/);
assert.doesNotMatch(source, /store\.keys\('user:'\)/);
assert.match(source, /mcpConnectionsFor\(store, prefs, ownerUserId\)/);
const renderer = readFileSync(new URL('../apps/renderer/src/app/mcp-config.ts', import.meta.url), 'utf8');
assert.match(renderer, /const rows = byIds\(ids \?\? \[\]\)/);
assert.doesNotMatch(renderer, /AUTO_SKIP/);
const baseline = readFileSync(new URL('../apps/renderer/src/app/baseline-mcps.ts', import.meta.url), 'utf8');
assert.match(baseline, /enabled: input\.enabled === true/);
for (const file of ['apps/renderer/src/app/workspace.ts', 'apps/api/src/modules/orchestration/context-assembler.ts', 'packages/agent-core/src/pi-runtime.ts']) {
  assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), /QuantumAI|QuantumMate/i);
}
console.log('CB-R03: explicit MCP selection, disabled baseline and WorkExpert source identity regression passed.');
