import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export function copyDereferenced(source, destination) {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) return copyDereferenced(realpathSync(source), destination);
  if (stat.isDirectory()) {
    if (['.bin', '.git', 'node_modules', '__pycache__', '.pytest_cache', '.mypy_cache'].includes(path.basename(source))) return;
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source)) copyDereferenced(path.join(source, entry), path.join(destination, entry));
  } else cpSync(source, destination);
}

export function supportsPlatform(manifest, platform = process.platform, arch = process.arch) {
  const matches = (values, value) => !values || (!values.includes(`!${value}`)
    && (values.every((item) => item.startsWith('!')) || values.includes(value) || values.includes('any')));
  return matches(manifest.os, platform) && matches(manifest.cpu, arch);
}

function resolvePackageDir(name, resolver) {
  let current = path.dirname(realpathSync(resolver.resolve(name)));
  while (true) {
    const manifestPath = path.join(current, 'package.json');
    if (existsSync(manifestPath) && JSON.parse(readFileSync(manifestPath, 'utf8')).name === name) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`Unable to find package manifest: ${name}`);
    current = parent;
  }
}

export function stageProductionDependencies(manifestPath, destination) {
  const seen = new Set();
  function stageDependency(name, resolver, optional = false) {
    if (seen.has(name) || name.startsWith('@workexpert/') || name.startsWith('@types/')) return;
    let source;
    try {
      source = resolvePackageDir(name, resolver);
    } catch (error) {
      // Only an absent optional package is skippable; a present package's broken
      // required dependency must still fail the build.
      if (optional && error.code === 'MODULE_NOT_FOUND') return;
      throw error;
    }
    const manifest = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'));
    if (optional && !supportsPlatform(manifest)) return;
    seen.add(name);
    stageManifest(manifest, createRequire(path.join(source, 'package.json')));
    const target = path.join(destination, name);
    if (name === 'sql.js') {
      mkdirSync(path.join(target, 'dist'), { recursive: true });
      cpSync(path.join(source, 'package.json'), path.join(target, 'package.json'));
      for (const file of ['sql-wasm.js', 'sql-wasm.wasm']) cpSync(path.join(source, 'dist', file), path.join(target, 'dist', file));
    } else copyDereferenced(source, target);
  }
  function stageManifest(manifest, resolver) {
    const optional = manifest.optionalDependencies ?? {};
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      if (!(name in optional)) stageDependency(name, resolver);
    }
    for (const name of Object.keys(optional)) stageDependency(name, resolver, true);
  }
  stageManifest(JSON.parse(readFileSync(manifestPath, 'utf8')), createRequire(manifestPath));
  return seen.size;
}
