import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { copyDereferenced, stageProductionDependencies, directoryBytes } from './stage-dependencies.mjs';
import { verifyStagedKnowledge } from './verify-staged-knowledge.mjs';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appsRoot = path.resolve(desktopRoot, '..');
const projectRoot = path.resolve(appsRoot, '..');
const stageRoot = path.join(desktopRoot, 'stage');
const started = Date.now();
console.log(`[stage] started ${new Date().toISOString()} platform=${process.platform} arch=${process.arch} node=${process.versions.node}`);
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
  console.log(`[stage] copied ${path.basename(source.to)}: ${(directoryBytes(source.to) / 1_000_000).toFixed(2)} MB`);
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
// ESM import() ignores NODE_PATH: external native packages must live in the
// standard node_modules beside main.cjs, not a custom node_deps directory.
const stagedApi = path.join(stageRoot, 'api');
const stagedDeps = path.join(stagedApi, 'node_modules');
console.log(`Staged ${stageProductionDependencies(apiPackageJson, stagedDeps, {
  onPackage: ({ name, bytes }) => console.log(`[stage:dependency] ${name} ${(bytes / 1_000_000).toFixed(2)} MB`),
})} API production packages.`);
console.log(`[stage] verifying isolated local knowledge runtime after ${Date.now() - started}ms`);
console.log(verifyStagedKnowledge(stagedApi));

const stagedRuntime = path.join(stageRoot, 'agentscope-runtime');
mkdirSync(stagedRuntime, { recursive: true });
for (const entry of ['src', 'pyproject.toml', 'requirements.txt', 'python']) {
  const source = path.join(runtimeRoot, entry);
  if (!existsSync(source)) continue;
  copyDereferenced(source, path.join(stagedRuntime, entry));
}
console.log(`Staged AgentScope runtime from ${runtimeRoot}.`);
for (const name of ['api', 'renderer', 'agentscope-runtime']) {
  console.log(`[stage:summary] ${name} ${(directoryBytes(path.join(stageRoot, name)) / 1_000_000).toFixed(2)} MB`);
}
console.log(`[stage] completed in ${Date.now() - started}ms`);
