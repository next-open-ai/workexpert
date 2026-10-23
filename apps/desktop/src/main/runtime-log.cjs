const fs = require('node:fs');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const { randomUUID } = require('node:crypto');

const fields = new Set(['version', 'platform', 'arch', 'electron', 'node', 'packaged', 'pid', 'exitCode', 'signal',
  'port', 'durationMs', 'attempt', 'reqId', 'method', 'statusCode', 'responseTime', 'errorCode', 'causeCode',
  'errorName', 'reason', 'bytes', 'stream', 'line', 'module']);
const knownMessages = new Map([
  ['incoming request', 'request.started'], ['request completed', 'request.completed'],
  ['request errored', 'request.failed'], ['knowledge.ingest.failed', 'knowledge.ingest.failed'],
]);

function errorDetails(error) {
  return { errorName: error?.name, errorCode: error?.code, causeCode: error?.cause?.code };
}

function createRuntimeLog(directory, { maxBytes = 5_000_000, backups = 3, settingsFile = path.join(directory, 'diagnostics.json'), warn = (text) => process.stderr.write(text + '\n') } = {}) {
  const file = path.join(directory, 'runtime.log');
  let warned = false;
  let enabled = true;
  let revision = 0;
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    if (settings.version !== 1 || typeof settings.enabled !== 'boolean') throw new Error('Invalid diagnostics settings');
    enabled = settings.enabled;
  } catch (error) {
    if (error.code !== 'ENOENT') enabled = false;
  }
  function setEnabled(value) {
    if (typeof value !== 'boolean') throw new TypeError('运行日志开关必须为布尔值。');
    const temporary = `${settingsFile}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(settingsFile), { recursive: true, mode: 0o700 });
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, enabled: value }), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, settingsFile);
    } catch {
      throw new Error('运行日志设置保存失败，请检查本机目录权限后重试。');
    } finally {
      try { fs.rmSync(temporary, { force: true }); } catch {}
    }
    enabled = value;
    revision++;
    if (enabled) write('desktop', 'info', 'logging.enabled');
    return { enabled };
  }
  function write(source, level, event, detail = {}) {
    if (!enabled) return;
    try {
      const data = {};
      for (const [key, value] of Object.entries(detail)) {
        if (!fields.has(key)) continue;
        if (typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean') data[key] = value;
        // No free-form text: callers may pass an Error or raw request object.
        else if (typeof value === 'string' && /^[\w@./:+-]{1,160}$/.test(value)) data[key] = value;
      }
      const row = JSON.stringify({ schema: 1, time: new Date().toISOString(), source, level, event, ...data }) + '\n';
      if (Buffer.byteLength(row) > maxBytes) return;
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (fs.existsSync(file) && fs.statSync(file).size + Buffer.byteLength(row) > maxBytes) {
        for (let index = backups; index >= 1; index--) {
          const target = `${file}.${index}`;
          if (index === backups) fs.rmSync(target, { force: true });
          const previous = index === 1 ? file : `${file}.${index - 1}`;
          if (fs.existsSync(previous)) fs.renameSync(previous, target);
        }
      }
      fs.appendFileSync(file, row, { mode: 0o600 });
    } catch {
      if (!warned) { warned = true; try { warn('[diagnostics] Unable to write local runtime log.'); } catch {} }
    }
  }
  return { file, directory, write, setEnabled, getSettings: () => ({ enabled }), getRevision: () => revision };
}

function attachChildLog(child, logger, source = 'api', { mirror = false } = {}) {
  for (const streamName of ['stdout', 'stderr']) {
    const stream = child[streamName];
    if (!stream) continue;
    let decoder = new StringDecoder('utf8');
    let buffer = '';
    let discarding = false;
    let revision = logger.getRevision();
    function line(text) {
      if (!text.trim()) return;
      try {
        const row = JSON.parse(text);
        const event = knownMessages.get(row.msg) || 'process.structured-output';
        logger.write(source, Number(row.level) >= 50 ? 'error' : Number(row.level) >= 40 ? 'warn' : 'info', event, {
          reqId: row.reqId, method: row.req?.method, statusCode: row.res?.statusCode,
          responseTime: row.responseTime, errorCode: row.code ?? row.err?.code, causeCode: row.causeCode ?? row.err?.cause?.code,
          errorName: row.err?.name, stream: streamName,
        });
      } catch {
        const module = text.match(/^Error: Cannot find (?:module|package) ['"](@lancedb\/[\w.-]+)['"]/);
        logger.write(source, streamName === 'stderr' ? 'error' : 'info', module ? 'dependency.missing' : 'process.unstructured-output', {
          stream: streamName, bytes: Buffer.byteLength(text), ...(module ? { module: module[1], errorCode: 'MODULE_NOT_FOUND' } : {}),
        });
      }
    }
    function consume(text) {
      for (const part of text.split(/(?<=\n)/)) {
        if (!discarding) buffer += part;
        if (buffer.length > 16_384) {
          logger.write(source, 'warn', 'process.output-omitted', { stream: streamName, bytes: Buffer.byteLength(buffer) });
          buffer = ''; discarding = true;
        }
        if (part.endsWith('\n')) {
          if (!discarding) line(buffer);
          buffer = ''; discarding = false;
        }
      }
    }
    stream.on('data', (chunk) => {
      if (mirror) (streamName === 'stderr' ? process.stderr : process.stdout).write(chunk);
      if (revision !== logger.getRevision() || !logger.getSettings().enabled) {
        decoder = new StringDecoder('utf8'); buffer = ''; discarding = false; revision = logger.getRevision();
      }
      if (!logger.getSettings().enabled) return;
      consume(decoder.write(chunk));
    });
    stream.once('end', () => {
      if (!logger.getSettings().enabled || revision !== logger.getRevision()) return;
      consume(decoder.end()); if (!discarding && buffer) line(buffer);
    });
  }
}

function registerRuntimeLogIpc(ipcMain, { logger, getWindow, openLogs }) {
  function requireMainWindow(event) {
    const window = getWindow();
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('仅主窗口可操作运行日志。');
  }
  ipcMain.handle('workexpert:get-runtime-log-settings', (event) => { requireMainWindow(event); return logger.getSettings(); });
  ipcMain.handle('workexpert:set-runtime-log-enabled', (event, enabled) => { requireMainWindow(event); return logger.setEnabled(enabled); });
  ipcMain.handle('workexpert:open-runtime-logs', async (event, directory) => {
    requireMainWindow(event);
    if (typeof directory !== 'boolean') throw new TypeError('Invalid log target');
    await openLogs(directory);
  });
}

module.exports = { createRuntimeLog, attachChildLog, errorDetails, registerRuntimeLogIpc };
