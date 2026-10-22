import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { copyDereferenced, stageProductionDependencies } from './stage-dependencies.mjs';
import { verifyStagedKnowledge } from './verify-staged-knowledge.mjs';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appsRoot = path.resolve(desktopRoot, '..');
const projectRoot = path.resolve(appsRoot, '..');
const stageRoot = path.join(desktopRoot, 'stage');
const runtimeRoot = path.join(projectRoot, 'runtimes', 'agentscope-runtime');
const sqlJsDist = path.dirname(createRequire(path.join(desktopRoot, 'package.json')).resolve('sql.js/dist/sql-wasm.js'));
const sources = [
  { from: path.join(appsRoot, 'renderer', 'dist'), to: path.join(stageRoot, 'renderer') },
  { from: path.join(appsRoot, 'api', 'dist'), to: path.join(stageRoot, 'api') },
];

rmSync(stageRoot, { recursive: true, force: true });
for (const source of sources) {
  if (!existsSync(source.from)) throw new Error(`Missing build output: ${source.from}`);
  cpSync(source.from, source.to, { recursive: true, dereference: true });
}
mkdirSync(path.join(stageRoot, 'sqljs'), { recursive: true });
for (const file of ['sql-wasm.js', 'sql-wasm.wasm']) cpSync(path.join(sqlJsDist, file), path.join(stageRoot, 'sqljs', file));

// pi-coding-agent resolves its package root by walking up from main.cjs and
// reading package.json. Packaged API lives under Resources/api/, so the
// manifest must sit next to the bundle or the child exits on startup.
const apiPackageJson = path.join(appsRoot, 'api', 'package.json');
cpSync(apiPackageJson, path.join(stageRoot, 'api', 'package.json'));

// Electron Builder must never follow pnpm workspace links into the repository
// root. Stage the API's production dependency closure explicitly instead.
const stagedDeps = path.join(stageRoot, 'api', 'node_deps');
console.log(`Staged ${stageProductionDependencies(apiPackageJson, stagedDeps)} API production packages.`);
console.log(verifyStagedKnowledge(stagedDeps));

const stagedRuntime = path.join(stageRoot, 'agentscope-runtime');
mkdirSync(stagedRuntime, { recursive: true });
for (const entry of ['src', 'pyproject.toml', 'requirements.txt', 'python']) {
  const source = path.join(runtimeRoot, entry);
  if (!existsSync(source)) continue;
  copyDereferenced(source, path.join(stagedRuntime, entry));
}
console.log(`Staged AgentScope runtime from ${runtimeRoot}.`);
