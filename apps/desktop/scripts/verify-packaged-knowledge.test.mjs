import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { packagedKnowledgeTargets } from './verify-packaged-knowledge.mjs';

test('DK-T06: discover final macOS and Windows runtimes and fail on missing API', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'workexpert-final-package-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => packagedKnowledgeTargets(root, 'darwin'), /No unpacked/);
  const mac = path.join(root, 'mac-arm64', 'WorkExpert.app', 'Contents');
  mkdirSync(path.join(mac, 'MacOS'), { recursive: true });
  writeFileSync(path.join(mac, 'MacOS', 'WorkExpert'), 'fixture');
  assert.throws(() => packagedKnowledgeTargets(root, 'darwin'), /API is missing/);
  mkdirSync(path.join(mac, 'Resources', 'api'), { recursive: true });
  writeFileSync(path.join(mac, 'Resources', 'api', 'package.json'), '{}');
  assert.equal(packagedKnowledgeTargets(root, 'darwin')[0].api, path.join(mac, 'Resources', 'api'));
  const win = path.join(root, 'win-unpacked');
  mkdirSync(path.join(win, 'resources', 'api'), { recursive: true });
  writeFileSync(path.join(win, 'WorkExpert.exe'), 'fixture');
  writeFileSync(path.join(win, 'resources', 'api', 'package.json'), '{}');
  assert.equal(packagedKnowledgeTargets(root, 'win32')[0].executable, path.join(win, 'WorkExpert.exe'));
});
