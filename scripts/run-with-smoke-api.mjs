import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { choosePort } from './lib/web-launcher.mjs';

const target = process.argv[2];
const runner = process.argv[3] || 'memory-echo';
if (!target) throw new Error('usage: node scripts/run-with-smoke-api.mjs <script> [runner]');

const root = process.cwd();
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'workexpert-smoke-api-'));
const port = await choosePort(4410);
const secretsFile = path.join(dataDir, 'smoke-secrets.json');
await writeFile(secretsFile, JSON.stringify({
  model: {
    providerInstances: [{ id: 'smoke-ollama', type: 'ollama', name: 'Smoke Ollama', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '' }],
    models: [{ id: 'm1', providerInstanceId: 'smoke-ollama', capability: 'chat', modelId: 'smoke' }],
    activeChatModelId: 'm1',
  },
}));
const env = {
  ...process.env,
  WORKEXPERT_API_PORT: String(port),
  WORKEXPERT_DATA_DIR: dataDir,
  WORKEXPERT_ORCH_RUNNER: runner,
  WORKEXPERT_SECRETS_FILE: secretsFile,
};
const api = spawn(process.execPath, ['apps/api/dist/main.cjs'], {
  cwd: root,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
api.stdout.on('data', (chunk) => { logs += chunk; });
api.stderr.on('data', (chunk) => { logs += chunk; });

async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
}

try {
  const deadline = Date.now() + 20_000;
  while (true) {
    if (api.exitCode !== null) throw new Error(`smoke API exited early (${api.exitCode})\n${logs.slice(-3000)}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break;
    } catch {}
    if (Date.now() >= deadline) throw new Error(`smoke API did not become ready\n${logs.slice(-3000)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const bootstrap = await fetch(`http://127.0.0.1:${port}/api/auth/bootstrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'smoke-admin', displayName: 'Smoke Admin', password: 'smoke-admin-password' }),
  });
  if (!bootstrap.ok) throw new Error(`smoke auth bootstrap failed: ${bootstrap.status}`);
  const session = await bootstrap.json();
  env.WORKEXPERT_SMOKE_TOKEN = session.token;
  env.WORKEXPERT_GATEWAY_SESSION_TOKEN = session.token;

  const smoke = spawn(process.execPath, [target], { cwd: root, env, stdio: 'inherit' });
  const [code, signal] = await once(smoke, 'exit');
  if (signal || code !== 0) {
    console.error(`[smoke-api] target failed; API log tail:\n${logs.slice(-4000)}`);
    process.exitCode = typeof code === 'number' ? code : 1;
  }
} finally {
  await stop(api);
  await rm(dataDir, { recursive: true, force: true });
}
