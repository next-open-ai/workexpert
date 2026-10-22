import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageProductionDependencies, supportsPlatform } from './stage-dependencies.mjs';
import { verifyStagedKnowledge } from './verify-staged-knowledge.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'workexpert-dependency-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifestPath = path.join(root, 'package.json');
  const destination = path.join(root, 'output');
  const manifest = (value) => writeFileSync(manifestPath, JSON.stringify(value));
  const dependency = (name, extra = {}) => {
    const folder = path.join(root, 'node_modules', name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name, main: 'index.cjs', ...extra }));
    writeFileSync(path.join(folder, 'index.cjs'), 'module.exports = {};');
  };
  return { root, manifestPath, destination, manifest, dependency };
}

test('DK-T01: optional native dependencies are included recursively, absent/wrong-platform ones are skipped', (t) => {
  const f = fixture(t);
  f.manifest({ dependencies: { engine: '1' } });
  f.dependency('engine', { optionalDependencies: { native: '1', absent: '1', foreign: '1' } });
  f.dependency('native', { os: [process.platform], cpu: [process.arch], dependencies: { child: '1' } });
  f.dependency('child');
  f.dependency('foreign', { os: [`!${process.platform}`] });
  assert.equal(stageProductionDependencies(f.manifestPath, f.destination), 3);
  assert.ok(existsSync(path.join(f.destination, 'native', 'index.cjs')));
  assert.ok(existsSync(path.join(f.destination, 'child', 'index.cjs')));
  assert.equal(existsSync(path.join(f.destination, 'foreign')), false);
  assert.equal(existsSync(path.join(f.destination, 'engine', 'node_modules')), false);
  assert.equal(supportsPlatform({ cpu: [`!${process.arch}`] }), false);
});

test('DK-T01: absent required dependencies and broken optional dependency closures fail', (t) => {
  const f = fixture(t);
  f.manifest({ dependencies: { missing: '1' } });
  assert.throws(() => stageProductionDependencies(f.manifestPath, f.destination), { code: 'MODULE_NOT_FOUND' });
  f.manifest({ optionalDependencies: { native: '1' } });
  f.dependency('native', { dependencies: { missingChild: '1' } });
  assert.throws(() => stageProductionDependencies(f.manifestPath, f.destination), { code: 'MODULE_NOT_FOUND' });
});

test('DK-T02: shipped API closure works outside workspace; removing native binding fails', { timeout: 120_000 }, (t) => {
  const f = fixture(t);
  const apiManifest = fileURLToPath(new URL('../../api/package.json', import.meta.url));
  assert.ok(stageProductionDependencies(apiManifest, f.destination) > 0);
  assert.match(verifyStagedKnowledge(f.destination), /write\/update\/recall: OK/);
  const lanceManifest = JSON.parse(readFileSync(path.join(f.destination, '@lancedb/lancedb/package.json'), 'utf8'));
  for (const name of Object.keys(lanceManifest.optionalDependencies)) {
    const native = path.join(f.destination, name);
    if (existsSync(native)) rmSync(native, { recursive: true, force: true });
  }
  assert.throws(() => verifyStagedKnowledge(f.destination), /runtime is incomplete or incompatible/);
});
