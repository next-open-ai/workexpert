import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
const { createRuntimeLog, attachChildLog, errorDetails, registerRuntimeLogIpc } = createRequire(import.meta.url)('../src/main/runtime-log.cjs');

function fixture(t, options) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workexpert-runtime-log-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return createRuntimeLog(path.join(root, 'logs'), options);
}
const rows = (logger) => fs.readFileSync(logger.file, 'utf8').trim().split('\n').map(JSON.parse);

test('DL-T02: private JSONL retains metadata, never free-form request/error content', (t) => {
  const logger = fixture(t);
  logger.write('desktop', 'info', 'app.started', { version: '0.2.7', body: 'PRIVATE_DOCUMENT', apiKey: 'SECRET', pid: 123,
    message: 'Bearer SECRET', errorCode: 'TOKEN WITH SPACE', ...errorDetails(Object.assign(new Error('PRIVATE_DOCUMENT'), { code: 'MODULE_NOT_FOUND' })) });
  const record = rows(logger)[0];
  assert.equal(record.schema, 1);
  assert.equal(record.version, '0.2.7');
  assert.equal(record.errorCode, 'MODULE_NOT_FOUND');
  assert.doesNotMatch(fs.readFileSync(logger.file, 'utf8'), /SECRET|PRIVATE_DOCUMENT|Bearer/);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(logger.file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(logger.directory).mode & 0o777, 0o700);
  }
});

test('DL-T02: rotation is bounded and write failure warns only once without throwing', (t) => {
  const logger = fixture(t, { maxBytes: 500, backups: 3 });
  for (let index = 0; index < 80; index++) logger.write('api', 'info', 'request.completed', { reqId: `req-${index}` });
  assert.equal(fs.readdirSync(logger.directory).length, 4);
  for (const name of fs.readdirSync(logger.directory)) assert.ok(fs.statSync(path.join(logger.directory, name)).size <= 500);
  assert.equal(rows(logger).at(-1).reqId, 'req-79');
  const blocker = path.join(logger.directory, 'not-a-directory');
  fs.writeFileSync(blocker, 'x');
  let warnings = 0;
  // Keep settings readable so this exercises log writing, not fail-closed config loading.
  const broken = createRuntimeLog(blocker, { settingsFile: path.join(logger.directory, 'separate-settings.json'), warn: () => warnings++ });
  assert.doesNotThrow(() => { broken.write('desktop', 'error', 'app.failed'); broken.write('desktop', 'error', 'app.failed'); });
  assert.equal(warnings, 1);
});

test('DL-T03: stream chunks, UTF-8, oversized lines and secrets are handled safely', async (t) => {
  const logger = fixture(t);
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  attachChildLog({ stdout, stderr }, logger);
  const data = Buffer.from(JSON.stringify({ level: 50, msg: 'knowledge.ingest.failed', reqId: 'req-1',
    code: 'KNOWLEDGE_STORAGE_COMPONENT_UNAVAILABLE', causeCode: 'MODULE_NOT_FOUND',
    body: '敏感文档', apiKey: 'SECRET', req: { method: 'POST', headers: { authorization: 'Bearer SECRET' }, url: '/?token=SECRET' } }) + '\n');
  for (const byte of data) stdout.write(Buffer.from([byte]));
  stdout.write('z'.repeat(40_000));
  stdout.write('\n');
  stdout.end(JSON.stringify({ level: 30, msg: 'request completed', reqId: 'req-2', res: { statusCode: 400 }, responseTime: 120.5 }));
  stderr.end("Error: Cannot find module '@lancedb/lancedb-darwin-arm64'\nPRIVATE_DOCUMENT sk-SECRET\n");
  await Promise.all([once(stdout, 'end'), once(stderr, 'end')]);
  const records = rows(logger);
  const failed = records.find((row) => row.event === 'knowledge.ingest.failed');
  assert.equal(failed.errorCode, 'KNOWLEDGE_STORAGE_COMPONENT_UNAVAILABLE');
  assert.equal(failed.causeCode, 'MODULE_NOT_FOUND');
  assert.equal(failed.method, 'POST');
  assert.equal(records.find((row) => row.reqId === 'req-2').responseTime, 120.5);
  assert.ok(records.some((row) => row.event === 'process.output-omitted'));
  assert.equal(records.find((row) => row.event === 'dependency.missing').module, '@lancedb/lancedb-darwin-arm64');
  assert.doesNotMatch(fs.readFileSync(logger.file, 'utf8'), /SECRET|敏感文档|PRIVATE_DOCUMENT|token=|zzzz/);
});

test('DL-T03: real child output survives exit without copying raw stderr', async (t) => {
  const logger = fixture(t);
  const child = spawn(process.execPath, ['-e', `process.stdout.write(JSON.stringify({level:30,msg:'request completed',reqId:'req-child',res:{statusCode:200}}));process.stderr.write('private error body');`], { stdio: ['ignore', 'pipe', 'pipe'] });
  attachChildLog(child, logger);
  await once(child, 'close');
  assert.ok(rows(logger).some((row) => row.reqId === 'req-child'));
  assert.doesNotMatch(fs.readFileSync(logger.file, 'utf8'), /private error body/);
});

test('DL-T04: native menu opens fixed diagnostic paths and packaged API output is captured', () => {
  const main = fs.readFileSync(new URL('../src/main/index.cjs', import.meta.url), 'utf8');
  assert.match(main, /label: '查看运行日志'/);
  assert.match(main, /label: '打开日志文件夹'/);
  assert.match(main, /shell\.openPath\(directory \? runtimeLog\.directory : runtimeLog\.file\)/);
  assert.match(main, /attachChildLog\(apiProcess, runtimeLog/);
});

test('DL-T06: switch immediately stops logging, retains history and survives restart', (t) => {
  const logger = fixture(t);
  logger.write('desktop', 'info', 'app.started');
  const before = fs.readFileSync(logger.file, 'utf8');
  assert.deepEqual(logger.setEnabled(false), { enabled: false });
  logger.write('desktop', 'error', 'must.not.persist');
  assert.equal(fs.readFileSync(logger.file, 'utf8'), before);
  const restarted = createRuntimeLog(logger.directory);
  assert.equal(restarted.getSettings().enabled, false);
  restarted.write('api', 'info', 'must.not.persist');
  assert.equal(fs.readFileSync(logger.file, 'utf8'), before);
  restarted.setEnabled(true);
  restarted.write('desktop', 'info', 'app.resumed');
  assert.equal(rows(logger).at(-1).event, 'app.resumed');
  assert.equal(createRuntimeLog(logger.directory).getSettings().enabled, true);
  assert.throws(() => logger.setEnabled('false'), TypeError);
  const fresh = fixture(t);
  fresh.setEnabled(false);
  fresh.write('desktop', 'info', 'no.file');
  assert.equal(fs.existsSync(fresh.file), false);
});

test('DL-T06: invalid config fails closed; failed save preserves memory and disk state', (t) => {
  const logger = fixture(t);
  fs.mkdirSync(logger.directory);
  const settings = path.join(logger.directory, 'diagnostics.json');
  fs.writeFileSync(settings, '{broken');
  const broken = createRuntimeLog(logger.directory);
  assert.equal(broken.getSettings().enabled, false);
  broken.write('desktop', 'info', 'no.file');
  assert.equal(fs.existsSync(broken.file), false);
  assert.equal(fs.readFileSync(settings, 'utf8'), '{broken');
  broken.setEnabled(true);
  assert.equal(JSON.parse(fs.readFileSync(settings, 'utf8')).enabled, true);
  const blocked = path.join(logger.directory, 'block');
  fs.writeFileSync(blocked, 'x');
  const failed = createRuntimeLog(logger.directory, { settingsFile: path.join(blocked, 'settings.json') });
  const previous = failed.getSettings();
  assert.throws(() => failed.setEnabled(!previous.enabled), /保存失败/);
  assert.deepEqual(failed.getSettings(), previous);
  assert.equal(fs.readFileSync(blocked, 'utf8'), 'x');
});

test('DL-T06: IPC rejects foreign frames and nonboolean targets', async (t) => {
  const logger = fixture(t);
  const handlers = new Map();
  const mainFrame = {};
  const window = { webContents: { mainFrame } };
  const event = { sender: window.webContents, senderFrame: mainFrame };
  const opened = [];
  registerRuntimeLogIpc({ handle: (name, handler) => handlers.set(name, handler) }, { logger, getWindow: () => window, openLogs: async (directory) => opened.push(directory) });
  const set = handlers.get('workexpert:set-runtime-log-enabled');
  assert.deepEqual(set(event, false), { enabled: false });
  assert.deepEqual(handlers.get('workexpert:get-runtime-log-settings')(event), { enabled: false });
  assert.throws(() => set({ ...event, senderFrame: {} }, true), /仅主窗口/);
  assert.throws(() => set({ ...event, sender: {} }, true), /仅主窗口/);
  assert.throws(() => set(event, { enabled: true }), TypeError);
  const open = handlers.get('workexpert:open-runtime-logs');
  await assert.rejects(open(event, '/etc/passwd'), TypeError);
  await open(event, true);
  assert.deepEqual(opened, [true]);
});

test('DL-T06: child logs discarded while disabled do not reappear on enable', async (t) => {
  const logger = fixture(t);
  logger.setEnabled(false);
  const stdout = new PassThrough();
  attachChildLog({ stdout }, logger);
  stdout.write('{"msg":"incoming request","reqId":"disabled"}\n');
  assert.equal(fs.existsSync(logger.file), false);
  logger.setEnabled(true);
  stdout.end('{"msg":"request completed","reqId":"enabled"}\n');
  await once(stdout, 'end');
  assert.doesNotMatch(fs.readFileSync(logger.file, 'utf8'), /"disabled"/);
  assert.ok(rows(logger).some((row) => row.reqId === 'enabled'));
});
