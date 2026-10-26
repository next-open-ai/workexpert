import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyStagedKnowledge } from './verify-staged-knowledge.mjs';

export function packagedKnowledgeTargets(releaseDirectory, platform = process.platform) {
  const targets = [];
  for (const entry of readdirSync(releaseDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const folder = path.join(releaseDirectory, entry.name);
    if (platform === 'darwin') {
      for (const app of readdirSync(folder).filter((name) => name.endsWith('.app'))) {
        const contents = path.join(folder, app, 'Contents');
        targets.push({ api: path.join(contents, 'Resources', 'api'), executable: path.join(contents, 'MacOS', app.slice(0, -4)) });
      }
    } else if (/unpacked/.test(entry.name)) {
      targets.push({ api: path.join(folder, 'resources', 'api'), executable: path.join(folder, platform === 'win32' ? 'WorkExpert.exe' : 'workexpert') });
    }
  }
  if (!targets.length) throw new Error(`No unpacked desktop application found in ${releaseDirectory}`);
  for (const target of targets) {
    if (!existsSync(target.executable) || !existsSync(path.join(target.api, 'package.json'))) {
      throw new Error(`Packaged runtime or API is missing: ${target.api}`);
    }
  }
  return targets;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const directory = path.resolve(process.argv[2] || 'apps/desktop/release');
  for (const target of packagedKnowledgeTargets(directory)) {
    console.log(`[packaged-knowledge] verifying ${target.api}`);
    console.log(verifyStagedKnowledge(target.api, { executable: target.executable }));
  }
}
