import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, log2Odds, newId } from '../api/src/store.js';

test('ids sort newest first and are url-safe', () => {
  const a = newId(1_000_000);
  const b = newId(2_000_000);
  assert.ok(b < a, 'later id sorts before earlier id');
  assert.match(a, /^[a-z0-9]{15}$/);
  assert.notEqual(newId(5), newId(5));
});

test('log2Odds unifies the two probability forms', () => {
  assert.equal(log2Odds({ exponent: 276709 }), 276709);
  assert.ok(Math.abs(log2Odds({ mantissa: 1024 }) - 10) < 1e-9);
  assert.equal(log2Odds({}), 0);
});

test('memory store round-trips and lists newest first', async () => {
  const store = createMemoryStore();
  const older = { id: newId(1_000), mode: 'random', event: 'older', probability: { mantissa: 8 }, stamp: 'A', date: '2026-08-21' };
  const newer = { id: newId(2_000), mode: 'random', event: 'newer', probability: { exponent: 5 }, stamp: 'B', date: '2026-08-22' };
  await store.put(older);
  await store.put(newer);
  assert.deepEqual(await store.get(older.id), older);
  assert.equal(await store.get('nope'), null);
  const recent = await store.recent(10);
  assert.deepEqual(recent.map((r) => r.event), ['newer', 'older']);
  assert.equal(recent[0].log2Odds, 5);
  assert.equal(recent[1].log2Odds, 3);
  assert.equal((await store.recent(1)).length, 1);
});
