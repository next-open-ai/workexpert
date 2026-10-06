import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${command} ${args.join(' ')} exited ${code}\n${stdout}\n${stderr}`)));
  });
}

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), 'workexpert-npm-package-'));
try {
  const packed = await run('npm', ['pack', '--json', '--pack-destination', temp], { cwd: root });
  const [manifest] = JSON.parse(packed.stdout);
  assert.ok(manifest?.filename, 'npm pack must return a tarball');
  const paths = manifest.files.map((file) => file.path);
  assert.ok(paths.includes('bin/workexpert.mjs'));
  assert.ok(paths.includes('apps/api/dist/main.cjs'));
  assert.ok(paths.includes('apps/renderer/dist/index.html'));
  assert.equal(paths.some((file) => file.includes('__pycache__') || file.endsWith('.pyc')), false, 'Python caches must not ship');
  assert.equal(paths.some((file) => /\/dist\/test\//.test(file)), false, 'compiled tests must not ship');
  assert.equal(paths.some((file) => file.endsWith('.map')), false, 'source maps must not ship in the npm launcher');

  const tarball = path.join(temp, manifest.filename);
  const prefix = path.join(temp, 'install');
  await run('npm', ['install', '--ignore-scripts', '--prefix', prefix, tarball], { cwd: root });
  const cli = process.platform === 'win32'
    ? path.join(prefix, 'node_modules', '.bin', 'workexpert.cmd')
    : path.join(prefix, 'node_modules', '.bin', 'workexpert');
  const doctor = await run(cli, ['doctor'], { cwd: temp });
  assert.match(doctor.stdout, /WorkExpert/);
  assert.match(doctor.stdout, /runtimeSource: .*\(ok\)/);
  console.log(`[npm-package] ${manifest.entryCount} entries, ${(manifest.size / 1_000_000).toFixed(2)} MB, installed CLI doctor: PASS`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
