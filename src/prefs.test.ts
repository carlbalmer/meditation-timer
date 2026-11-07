import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, parsePrefs } from './prefs.ts';

test('missing or corrupt storage yields defaults', () => {
  assert.deepEqual(parsePrefs(null), DEFAULTS);
  assert.deepEqual(parsePrefs('{nope'), DEFAULTS);
  assert.deepEqual(parsePrefs('null'), DEFAULTS);
});

test('valid values survive, invalid ones are replaced', () => {
  const prefs = parsePrefs(JSON.stringify({ minutes: 300, warmup: 30, water: false, bowl: 'deep', scene: 'bridge' }));
  assert.deepEqual(prefs, { minutes: 120, warmup: 30, water: false, bowl: 'deep', scene: 'bridge' });
  assert.equal(parsePrefs(JSON.stringify({ warmup: 20, minutes: 'x', water: 1 })).warmup, DEFAULTS.warmup);
});
