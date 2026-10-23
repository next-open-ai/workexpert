import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const rendererRequire = createRequire(new URL('../../renderer/package.json', import.meta.url));
const vueRequire = createRequire(rendererRequire.resolve('vue'));
const { parse, compileScript } = vueRequire('@vue/compiler-sfc');
const { transformSync } = createRequire(rendererRequire.resolve('vite'))('esbuild');
const contractsRequire = createRequire(new URL('../../../packages/contracts/package.json', import.meta.url));

function compile(source, require) {
  const module = { exports: {} };
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, { module, exports: module.exports, require });
  return module.exports;
}
const schemaSource = fs.readFileSync(new URL('../../../packages/contracts/src/desktop-diagnostics.ts', import.meta.url), 'utf8');
const contracts = compile(schemaSource, contractsRequire);
const source = fs.readFileSync(new URL('../../renderer/src/features/settings/RuntimeLogSettingsCard.vue', import.meta.url), 'utf8');
const { descriptor } = parse(source);
const script = transformSync(compileScript(descriptor, { id: 'runtime-log-test' }).content, { loader: 'ts', format: 'cjs' }).code;

function setup(desktop) {
  const mounted = [];
  const module = { exports: {} };
  vm.runInNewContext(script, { module, exports: module.exports, window: { workexpertDesktop: desktop }, require(name) {
    if (name === '@workexpert/contracts') return contracts;
    if (name === 'vue') return { defineComponent: (value) => value, ref: (value) => ({ value }), onMounted: (callback) => mounted.push(callback) };
    throw new Error(`Unexpected dependency ${name}`);
  } });
  const state = module.exports.default.setup({}, { expose() {} });
  return { state, load: () => mounted[0]() };
}

test('DL-T06 UI: loading and saving keep accurate state and reject repeated clicks', async () => {
  let resolveLoad;
  let resolveSave;
  let saves = 0;
  const { state, load } = setup({ getRuntimeLogSettings: () => new Promise((resolve) => { resolveLoad = resolve; }),
    setRuntimeLogEnabled: () => { saves++; return new Promise((resolve) => { resolveSave = resolve; }); } });
  const pending = load();
  assert.equal(state.busy.value, true);
  assert.equal(state.enabled.value, null);
  resolveLoad({ enabled: true });
  await pending;
  const saving = state.toggle();
  await state.toggle();
  assert.equal(saves, 1);
  assert.equal(state.enabled.value, true);
  assert.equal(state.busy.value, true);
  resolveSave({ enabled: false });
  await saving;
  assert.equal(state.enabled.value, false);
  assert.equal(state.busy.value, false);
  assert.match(state.feedback.value, /历史日志保留/);
});

test('DL-T06 UI: failed load can retry; failed save retains last confirmed state', async () => {
  let fail = true;
  const { state, load } = setup({ getRuntimeLogSettings: async () => { if (fail) throw new Error('offline'); return { enabled: false }; },
    setRuntimeLogEnabled: async () => { throw new Error('disk'); } });
  await load();
  assert.equal(state.enabled.value, null);
  assert.match(state.error.value, /读取/);
  fail = false;
  await state.load();
  assert.equal(state.enabled.value, false);
  await state.toggle();
  assert.equal(state.enabled.value, false);
  assert.match(state.error.value, /状态未改变/);
});

test('DL-T06 UI: browser-only mode and strict settings schema', async () => {
  const { state, load } = setup(undefined);
  assert.equal(state.available, false);
  await load();
  assert.equal(state.busy.value, false);
  assert.equal(contracts.RuntimeLogSettingsSchema.safeParse({ enabled: 'false' }).success, false);
  assert.equal(contracts.RuntimeLogSettingsSchema.safeParse({ enabled: true, secret: 'x' }).success, false);
  assert.match(descriptor.template.content, /role="switch"/);
  assert.match(descriptor.template.content, /aria-checked/);
});
