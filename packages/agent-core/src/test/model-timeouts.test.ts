import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_MODEL_TURN_IDLE_MS } from '../pi-runtime.js';

test('one provider turn may remain silent for three minutes before the idle guard aborts it', () => {
  assert.equal(DEFAULT_MODEL_TURN_IDLE_MS, 180_000);
});
