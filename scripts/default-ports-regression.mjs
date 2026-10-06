import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = {
  rendererPackage: await readFile('apps/renderer/package.json', 'utf8'),
  vite: await readFile('apps/renderer/vite.config.ts', 'utf8'),
  desktopDev: await readFile('apps/desktop/scripts/dev.mjs', 'utf8'),
  desktopMain: await readFile('apps/desktop/src/main/index.cjs', 'utf8'),
  apiMain: await readFile('apps/api/src/main.ts', 'utf8'),
  rendererApi: await readFile('apps/renderer/src/services/api.ts', 'utf8'),
  gateway: await readFile('apps/gateway/src/main.ts', 'utf8'),
  docker: await readFile('Dockerfile', 'utf8'),
};

assert.match(files.rendererPackage, /--port 50831 --strictPort/);
assert.match(files.vite, /127\.0\.0\.1:50832/);
assert.match(files.desktopDev, /127\.0\.0\.1:50831/);
assert.match(files.desktopMain, /WORKEXPERT_API_PORT \|\| 50832/);
assert.match(files.apiMain, /WORKEXPERT_API_PORT \?\? 50832/);
assert.match(files.rendererApi, /127\.0\.0\.1:50832/);
assert.match(files.gateway, /127\.0\.0\.1:50832\/api\/orch/);
assert.match(files.docker, /WORKEXPERT_API_PORT=50832/);
assert.match(files.docker, /EXPOSE 50832/);
for (const [name, source] of Object.entries(files)) {
  assert.doesNotMatch(source, /(?:127\.0\.0\.1:|localhost:|--port |EXPOSE |WORKEXPERT_API_PORT=)(?:5173|4328)\b/, `${name} still contains an old default port`);
}
console.log('RUNTIME-PORTS-T1 PASS: WorkExpert defaults to renderer 50831 and API 50832.');
