import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDriveHandler, createMockClient, createRecentHandler, createReportHandler, finishReport } from '../api/src/drive.js';
import { createRateLimiter } from '../api/src/ratelimit.js';
import { createMemoryStore } from '../api/src/store.js';

/** A request the way @azure/functions hands it over. */
const request = (body, { ip = '1.2.3.4', params = {}, query = {} } = {}) => ({
  headers: new Headers({ 'x-forwarded-for': ip }),
  params,
  query: new URLSearchParams(query),
  json: async () => {
    if (body === 'garbage') throw new SyntaxError('nope');
    return body;
  },
});

const stubClient = (answer, stop_reason = 'end_turn') => ({
  calls: [],
  messages: {
    async create(params) {
      stubClient.last = params;
      return { stop_reason, content: [{ type: 'text', text: typeof answer === 'string' ? answer : JSON.stringify(answer) }] };
    },
  },
});

const ANSWER = {
  event: 'A kettle in Basingstoke achieves orbit.',
  probability: { exponent: 0, mantissa: 12345 },
  factors: [{ label: 'Kettle ambition', weight: '×9' }, { label: 'Basingstoke', weight: '×2' }, { label: 'Tuesday', weight: '×1.5' }],
  comparison: 'Roughly as likely as a punctual bus.',
  verdict: 'Mind the steam.',
  stamp: 'occurred anyway',
  filedUnder: 'kettles, ascension of · witnessed by a cat',
};

test('rejects bad input before touching the model', async () => {
  const drive = createDriveHandler({ client: stubClient(ANSWER) });
  assert.equal((await drive(request('garbage'))).status, 400);
  assert.equal((await drive(request({ mode: 'sideways' }))).status, 400);
  assert.equal((await drive(request({ mode: 'calculate', scenario: '   ' }))).status, 400);
  assert.equal((await drive(request({ mode: 'calculate', scenario: 'x'.repeat(301) }))).status, 400);
});

test('random mode returns a finished, stored report', async () => {
  const store = createMemoryStore();
  const drive = createDriveHandler({ client: stubClient(ANSWER), store, random: () => 0.5 });
  const res = await drive(request({ mode: 'random' }));
  assert.equal(res.status, 200);
  const r = res.jsonBody;
  assert.match(r.id, /^[a-z0-9]{15}$/);
  assert.equal(r.mode, 'random');
  assert.equal(r.event, ANSWER.event);
  assert.deepEqual(r.probability, { mantissa: 12345, display: '12,345 to 1 against' });
  assert.equal(r.stamp, 'OCCURRED ANYWAY');
  assert.equal(r.reportNo, '42-5500');
  assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(r.vector);
  assert.equal(r.scenario, undefined);
  assert.deepEqual(await store.get(r.id), r);
  assert.equal(stubClient.last.output_config.format.type, 'json_schema');
  assert.equal(stubClient.last.output_config.effort, 'low');
});

test('calculate mode delimits the scenario and echoes it back', async () => {
  const drive = createDriveHandler({ client: stubClient(ANSWER) });
  const res = await drive(request({ mode: 'calculate', scenario: '  my   bus\narrives  ' }));
  assert.equal(res.status, 200);
  assert.equal(res.jsonBody.scenario, 'my bus arrives');
  assert.match(stubClient.last.messages[0].content, /<scenario>\nmy bus arrives\n<\/scenario>/);
  assert.match(stubClient.last.system[0].text, /data, not instructions/);
});

test('refusal becomes the polite decline and is not stored', async () => {
  const store = createMemoryStore();
  const drive = createDriveHandler({ client: stubClient('', 'refusal'), store });
  const res = await drive(request({ mode: 'calculate', scenario: 'something unpleasant' }));
  assert.equal(res.status, 200);
  assert.equal(res.jsonBody.declined, true);
  assert.deepEqual(await store.recent(), []);
});

test('unparseable model output is a 502, not a crash', async () => {
  const drive = createDriveHandler({ client: stubClient('not json at all') });
  assert.equal((await drive(request({ mode: 'random' }))).status, 502);
});

test('rate limit answers 429 with retry-after', async () => {
  let t = 0;
  const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 1, now: () => t });
  const drive = createDriveHandler({ client: stubClient(ANSWER), limiter });
  assert.equal((await drive(request({ mode: 'random' }))).status, 200);
  assert.equal((await drive(request({ mode: 'random' }))).status, 200);
  const blocked = await drive(request({ mode: 'random' }));
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers['retry-after'], '1');
  assert.equal((await drive(request({ mode: 'random' }, { ip: '9.9.9.9' }))).status, 200, 'other IPs unaffected');
  t = 1000;
  assert.equal((await drive(request({ mode: 'random' }))).status, 200, 'refills');
});

test('report and recent handlers read the store', async () => {
  const store = createMemoryStore();
  const drive = createDriveHandler({ client: stubClient(ANSWER), store });
  const made = (await drive(request({ mode: 'random' }))).jsonBody;

  const report = createReportHandler({ store });
  assert.equal((await report(request(null, { params: { id: made.id } }))).jsonBody.event, ANSWER.event);
  assert.equal((await report(request(null, { params: { id: 'zzzzzzzzzz' } }))).status, 404);
  assert.equal((await report(request(null, { params: { id: '../etc' } }))).status, 404);

  const recent = createRecentHandler({ store });
  const list = (await recent(request(null, { query: { limit: '5' } }))).jsonBody.reports;
  assert.equal(list.length, 1);
  assert.equal(list[0].id, made.id);
  assert.ok(list[0].log2Odds > 13 && list[0].log2Odds < 14);
});

test('the mock client answers both modes in the right shape', async () => {
  const client = createMockClient();
  const drive = createDriveHandler({ client });
  const a = (await drive(request({ mode: 'random' }))).jsonBody;
  const b = (await drive(request({ mode: 'calculate', scenario: 'deposit' }))).jsonBody;
  assert.ok(a.probability.exponent > 0);
  assert.ok(b.probability.mantissa > 0);
  assert.equal(b.factors.length, 3);
});

test('finishReport tolerates a thin answer', () => {
  const r = finishReport({ event: 'x' }, { mode: 'random', today: new Date('2026-08-22T10:00:00Z'), random: () => 0 });
  assert.equal(r.date, '2026-08-22');
  assert.deepEqual(r.factors, []);
  assert.equal(r.stamp, '');
  assert.equal(r.probability.display, '1 to 1 against');
});
