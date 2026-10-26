import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
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
  const staged = [];
  assert.equal(stageProductionDependencies(f.manifestPath, f.destination, { onPackage: (row) => staged.push(row) }), 3);
  assert.deepEqual(staged.map((row) => row.name).sort(), ['child', 'engine', 'native']);
  assert.ok(staged.every((row) => row.bytes > 0));
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
  const api = path.join(f.root, 'staged-api');
  const dependencies = path.join(api, 'node_modules');
  assert.ok(stageProductionDependencies(apiManifest, dependencies) > 0);
  assert.match(verifyStagedKnowledge(api), /Electron .* ESM import.*write\/update\/recall: OK/);
  const lanceManifest = JSON.parse(readFileSync(path.join(dependencies, '@lancedb/lancedb/package.json'), 'utf8'));
  for (const name of Object.keys(lanceManifest.optionalDependencies)) {
    const native = path.join(dependencies, name);
    if (existsSync(native)) rmSync(native, { recursive: true, force: true });
  }
  assert.throws(() => verifyStagedKnowledge(api), /runtime is incomplete or incompatible/);
});

test('DK-T05: reject legacy node_deps layout even when NODE_PATH lets require succeed', { timeout: 120_000 }, (t) => {
  const f = fixture(t);
  const api = path.join(f.root, 'legacy-api');
  const dependencies = path.join(api, 'node_deps');
  stageProductionDependencies(fileURLToPath(new URL('../../api/package.json', import.meta.url)), dependencies);
  const executable = createRequire(import.meta.url)('electron');
  const result = spawnSync(executable, ['-e', 'console.log(typeof require("@lancedb/lancedb").connect)'], {
    cwd: api, env: { ...process.env, NODE_PATH: dependencies, NODE_OPTIONS: '', ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /function/);
  assert.throws(() => verifyStagedKnowledge(api), /ERR_MODULE_NOT_FOUND/);
});
