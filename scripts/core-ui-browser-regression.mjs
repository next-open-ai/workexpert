import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { choosePort } from './lib/web-launcher.mjs';

const root = process.cwd();
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'workexpert-core-ui-'));
const port = await choosePort(4477);
const origin = `http://127.0.0.1:${port}`;
const api = spawn(process.execPath, ['apps/api/dist/main.cjs'], {
  cwd: root,
  env: {
    ...process.env,
    WORKEXPERT_API_PORT: String(port),
    WORKEXPERT_DATA_DIR: dataDir,
    WORKEXPERT_ORCH_RUNNER: 'memory-echo',
    WORKEXPERT_WEB_STATIC_DIR: path.join(root, 'apps/renderer/dist'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
api.stdout.on('data', (chunk) => { logs += chunk; });
api.stderr.on('data', (chunk) => { logs += chunk; });

async function browserExecutable() {
  const candidates = [
    process.env.WORKEXPERT_BROWSER_EXECUTABLE,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch {}
  }
  throw new Error('No supported Chrome/Chromium executable. Set WORKEXPERT_BROWSER_EXECUTABLE.');
}

async function waitForApi() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${origin}/api/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`API did not become ready\n${logs.slice(-3000)}`);
}

let browser;
try {
  await waitForApi();
  browser = await chromium.launch({ headless: true, executablePath: await browserExecutable() });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  const unauthorized = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() === 401) {
      const headers = response.request().headers();
      unauthorized.push(`${response.url()} session=${headers['x-workexpert-session'] ? 'present' : 'missing'}`);
    }
  });
  await page.goto(origin);
  await page.getByRole('heading', { name: '初始化本地管理员' }).waitFor();
  await page.getByPlaceholder('orgId，例如 local-org').fill('e2e-org');
  await page.getByPlaceholder('显示名称').fill('验收管理员');
  await page.getByPlaceholder('用户名').fill('e2e-admin');
  await page.getByPlaceholder('密码（至少 6 位）').fill('e2e-password');
  await page.getByRole('button', { name: '创建管理员并进入 WorkExpert' }).click();
  await page.getByText('WorkExpert', { exact: true }).waitFor();

  async function dismissStartupDialogs() {
    let idle = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      let dismissed = false;
      for (const label of ['稍后安装', '以后再说', '关闭']) {
        const button = page.getByRole('button', { name: label, exact: true }).last();
        if (await button.isVisible().catch(() => false)) {
          await button.click();
          dismissed = true;
          break;
        }
      }
      if (dismissed) idle = 0;
      else {
        idle += 1;
        if (idle >= 2) break;
        await page.waitForTimeout(150);
      }
    }
  }
  // Environment probing is asynchronous and may open the dsh prompt after
  // authentication has already rendered the workspace.
  await page.waitForTimeout(3_000);
  await dismissStartupDialogs();

  const journeys = [
    ['数字员工', /数字员工|员工/],
    ['技能与连接', /技能|Skills|MCP/],
    ['混合知识库', /混合知识库/],
    ['自动化与任务', /自动化|任务/],
    ['资产库', /资产/],
    ['远程办公', /远程|Telegram|飞书/],
    ['用户手册', /用户手册|WorkExpert/],
  ];
  for (const hiddenNavigation of ['项目', '数据工作台']) {
    assert.equal(
      await page.getByRole('button', { name: hiddenNavigation, exact: true }).count(),
      0,
      `${hiddenNavigation} should remain hidden from primary navigation`,
    );
  }
  for (const [navigation, expected] of journeys) {
    await dismissStartupDialogs();
    await page.getByRole('button', { name: navigation, exact: true }).click();
    await page.waitForFunction((pattern) => new RegExp(pattern).test(document.querySelector('main')?.innerText || ''), expected.source);
  }

  await page.getByRole('button', { name: '打开账户与设置菜单' }).click();
  await page.getByRole('menuitem', { name: '设置' }).click();
  await page.getByText(/模型|Provider|账户/).first().waitFor();
  assert.deepEqual(pageErrors, [], `browser page errors: ${pageErrors.join('\n')}\n401 responses: ${unauthorized.join('\n')}`);
  console.log('[core-ui] bootstrap, session, lazy navigation, settings and empty-state journeys: PASS');
} finally {
  await browser?.close();
  if (api.exitCode === null) {
    const exited = once(api, 'exit');
    api.kill('SIGTERM');
    await exited;
  }
  await rm(dataDir, { recursive: true, force: true });
}
