import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { embedOpenAiCompatible } from '../embedding-http.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('KE-P01: deduplicates prepared text within a call and restores independent vectors in order', async () => {
  const requests: string[][] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { input: string[] };
    requests.push(body.input);
    return new Response(JSON.stringify({ data: body.input.map(text => ({ embedding: [Number(text), 1] })) }));
  };
  const config = { baseUrl: 'https://dedup.test/v1', apiKey: '', model: 'embed', maxBatch: 2, maxInputChars: 1 };
  const result = await embedOpenAiCompatible(config, ['1a', '2', '1b', '3', '2']);
  assert.deepEqual(requests, [['1', '2'], ['3']]);
  assert.deepEqual(result.vectors.map(row => row[0]), [1, 2, 1, 3, 2]);
  result.vectors[0][0] = 99;
  assert.equal(result.vectors[2][0], 1);
  await embedOpenAiCompatible(config, ['1']);
  assert.equal(requests.length, 3, 'no cache across calls or credentials');
});

test('KE-P01: duplicate inputs do not conceal provider failure or cross-batch dimension mismatch', async () => {
  const config = { baseUrl: 'https://dedup-errors.test/v1', apiKey: '', model: 'embed', maxBatch: 1 };
  globalThis.fetch = async () => new Response('unavailable', { status: 503 });
  await assert.rejects(embedOpenAiCompatible(config, ['a', 'a']), /503/);
  let count = 0;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ embedding: ++count === 1 ? [1, 2] : [1] }] }));
  await assert.rejects(embedOpenAiCompatible(config, ['a', 'a', 'b']), /dimensions changed/);
});

test('embedding honors configured batches and preserves vector order', async () => {
  const batchSizes: number[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { input: string[] };
    batchSizes.push(body.input.length);
    return new Response(JSON.stringify({ model: 'embed', data: body.input.map((text) => ({ embedding: [Number(text), 1] })) }), { status: 200 });
  };
  const result = await embedOpenAiCompatible({ baseUrl: 'https://example.test/v1', apiKey: 'key', model: 'embed', maxBatch: 2 }, ['1', '2', '3', '4', '5']);
  assert.deepEqual(batchSizes, [2, 2, 1]);
  assert.deepEqual(result.vectors.map((row) => row[0]), [1, 2, 3, 4, 5]);
});

test('embedding learns an upstream batch limit and retries without losing inputs', async () => {
  const batchSizes: number[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { input: string[] };
    batchSizes.push(body.input.length);
    if (body.input.length > 10) {
      return new Response(JSON.stringify({ error: { message: 'Value error, batch size is invalid, it should not be larger than 10.: input.contents' } }), { status: 400 });
    }
    return new Response(JSON.stringify({ data: body.input.map((text) => ({ embedding: [Number(text), 1] })) }), { status: 200 });
  };
  const inputs = Array.from({ length: 23 }, (_, index) => String(index));
  const config = { baseUrl: 'https://limit.example.test/v1', apiKey: 'key', model: 'embed', maxBatch: 32 };
  const result = await embedOpenAiCompatible(config, inputs);
  assert.deepEqual(batchSizes, [23, 10, 10, 3]);
  assert.deepEqual(result.vectors.map((row) => row[0]), Array.from({ length: 23 }, (_, index) => index));
  batchSizes.length = 0;
  await embedOpenAiCompatible(config, inputs.slice(0, 12));
  assert.deepEqual(batchSizes, [10, 2], 'learned provider limit should prevent another rejected request');
});

test('embedding applies the configured per-input character bound', async () => {
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { input: string[] };
    assert.deepEqual(body.input, ['abcd']);
    return new Response(JSON.stringify({ data: [{ embedding: [1, 2] }] }), { status: 200 });
  };
  await embedOpenAiCompatible({ baseUrl: 'https://example.test/v1', apiKey: '', model: 'embed', maxInputChars: 4 }, ['abcdefgh']);
});
