import test from 'node:test';
import assert from 'node:assert/strict';
import { knowledgeStorageWriteError } from '../knowledge-storage-error.js';

test('DK-T03: missing and incompatible LanceDB components give actionable safe errors', () => {
  for (const [code, message] of [
    ['MODULE_NOT_FOUND', "Cannot find module '@lancedb/lancedb-darwin-arm64'"],
    ['ERR_MODULE_NOT_FOUND', "Cannot find package '@lancedb/lancedb'"],
    ['ERR_DLOPEN_FAILED', '/private/user/node_deps/@lancedb/lancedb-darwin-arm64/lancedb.darwin-arm64.node: incompatible architecture'],
  ]) {
    const cause = Object.assign(new Error(message), { code });
    for (const source of [cause, new Error('Failed to load native binding', { cause })]) {
      const error = knowledgeStorageWriteError(source);
      assert.equal((error as Error & { code: string }).code, 'KNOWLEDGE_STORAGE_COMPONENT_UNAVAILABLE');
      assert.match(error.message, /安装修复版本/);
      assert.doesNotMatch(error.message, /private|darwin|node_deps/);
      assert.equal(error.cause, source);
    }
  }
});

test('DK-T03: dimensions and ordinary write failures retain existing semantics', () => {
  const dimension = Object.assign(new Error('维度不一致'), { code: 'EMBEDDING_DIMENSION_MISMATCH' });
  assert.equal(knowledgeStorageWriteError(dimension), dimension);
  for (const source of [new Error('permission denied'), Object.assign(new Error("Cannot find module 'other-module'"), { code: 'MODULE_NOT_FOUND' })]) {
    const error = knowledgeStorageWriteError(source);
    assert.match(error.message, /检索数据写入失败/);
    assert.equal(error.cause, source);
  }
  const cyclic = new Error('cyclic');
  cyclic.cause = cyclic;
  assert.match(knowledgeStorageWriteError(cyclic).message, /检索数据写入失败/);
});
