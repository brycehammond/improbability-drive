/**
 * POST /api/drive
 *
 * validate -> rate-limit -> ask the model -> finish the report -> JSON.
 *
 * The Anthropic client is injected so the handler can be tested with a stub
 * and so `npm run dev` works without a key (see createMockClient).
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  DECLINED,
  LIMITS,
  RESULT_SCHEMA,
  formatProbability,
  pickVector,
  reportNumber,
  systemPrompt,
  userMessage,
} from './prompts.js';
import { clientKey, createRateLimiter } from './ratelimit.js';
import { createMemoryStore, newId } from './store.js';

const MODEL = process.env.MODEL || 'claude-opus-5';

const json = (status, body, headers = {}) => ({
  status,
  jsonBody: body,
  headers: { 'cache-control': 'no-store', ...headers },
});

/** Parses and bounds the request body. Returns an error response or the input. */
async function readInput(request) {
  /** @type {any} */ let body;
  try {
    body = await request.json();
  } catch {
    return { error: json(400, { error: 'The Drive requires JSON.' }) };
  }
  const mode = body?.mode === 'calculate' ? 'calculate' : body?.mode === 'random' ? 'random' : null;
  if (!mode) return { error: json(400, { error: 'mode must be "random" or "calculate".' }) };

  let scenario = '';
  if (mode === 'calculate') {
    scenario = typeof body.scenario === 'string' ? body.scenario.replace(/\s+/g, ' ').trim() : '';
    if (!scenario) return { error: json(400, { error: 'Describe something first.' }) };
    if (scenario.length > LIMITS.scenarioMaxChars) {
      return { error: json(400, { error: `Keep it under ${LIMITS.scenarioMaxChars} characters. The Drive has a short attention span.` }) };
    }
  }
  return { input: { mode, scenario } };
}

/**
 * Turns the model's structured answer into the report the page renders.
 * Exported for the tests.
 */
export function finishReport(parsed, { mode, scenario, vector, random = Math.random, today = new Date(), id = newId(today.getTime()) }) {
  return {
    id,
    mode,
    scenario: mode === 'calculate' ? scenario : undefined,
    event: parsed.event,
    probability: formatProbability(parsed.probability ?? {}),
    factors: (parsed.factors ?? []).slice(0, 4).map((f) => ({
      label: String(f.label ?? '').trim(),
      weight: String(f.weight ?? '').trim(),
    })),
    comparison: parsed.comparison,
    verdict: parsed.verdict,
    stamp: String(parsed.stamp ?? '').toUpperCase(),
    filedUnder: String(parsed.filedUnder ?? '').toUpperCase(),
    reportNo: reportNumber(random),
    date: today.toISOString().slice(0, 10),
    vector: vector?.key,
  };
}

/**
 * Builds the handler. `client` needs only `messages.create`; `store` is a
 * Store from store.js (memory by default).
 */
export function createDriveHandler({ client, store = createMemoryStore(), limiter = createRateLimiter(), random = Math.random } = {}) {
  return async function drive(request, context) {
    const { error, input } = await readInput(request);
    if (error) return error;

    const gate = limiter.take(clientKey(request));
    if (!gate.ok) {
      return json(
        429,
        { error: 'The Drive is resting.', retryAfterSeconds: gate.retryAfterSeconds },
        { 'retry-after': String(gate.retryAfterSeconds) },
      );
    }

    const vector = input.mode === 'random' ? pickVector(random) : undefined;

    /** @type {any} */ let response;
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: LIMITS.maxTokens,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: RESULT_SCHEMA } },
        system: [{ type: 'text', text: systemPrompt(input.mode), cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMessage({ ...input, vector }) }],
      });
    } catch (err) {
      context?.error?.('drive: model call failed', err);
      if (err instanceof Anthropic.RateLimitError) {
        return json(429, { error: 'The Drive is resting.', retryAfterSeconds: 30 }, { 'retry-after': '30' });
      }
      return json(502, { error: 'The Drive is experiencing a period of normality. Try again shortly.' });
    }

    if (response.stop_reason === 'refusal') {
      return json(200, { mode: input.mode, ...DECLINED });
    }

    const text = response.content?.find((b) => b.type === 'text')?.text ?? '';
    /** @type {any} */ let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      context?.error?.('drive: unparseable model output', text);
      return json(502, { error: 'The Drive produced something, but not a number.' });
    }

    const report = finishReport(parsed, { ...input, vector, random });
    try {
      await store.put(report);
    } catch (err) {
      // History is a nicety. The person pressing the button still gets their report.
      context?.error?.('drive: store.put failed', err);
    }
    return json(200, report);
  };
}

/** GET /api/reports/{id}: one report, for the permalink page. */
export function createReportHandler({ store }) {
  return async function report(request) {
    const id = request.params?.id ?? '';
    if (!/^[a-z0-9]{6,40}$/.test(id)) return json(404, { error: 'No such report.' });
    const found = await store.get(id);
    if (!found) return json(404, { error: 'No such report. It may never have occurred.' });
    return json(200, found, { 'cache-control': 'public, max-age=31536000, immutable' });
  };
}

/** GET /api/recent: the latest reports, newest first. */
export function createRecentHandler({ store }) {
  return async function recent(request) {
    const limit = Math.min(50, Math.max(1, Number(request.query?.get?.('limit')) || 20));
    return json(200, { reports: await store.recent(limit) }, { 'cache-control': 'public, max-age=60' });
  };
}

/**
 * A client that never leaves the machine. Used when ANTHROPIC_API_KEY is
 * unset so the whole site runs locally with no account at all.
 */
export function createMockClient() {
  return {
    messages: {
      async create({ messages }) {
        const calc = /<scenario>/.test(messages[0].content);
        const answer = calc
          ? {
              event: 'The applicant’s landlord returns the deposit in full, without being asked, and in the same decade.',
              probability: { exponent: 0, mantissa: 440921 },
              factors: [
                { label: 'Landlord benevolence coefficient', weight: '×310' },
                { label: '“Unprompted”, as a legal concept', weight: '×47' },
                { label: 'Condition of the oven, disputed', weight: '×30' },
              ],
              comparison: 'Roughly as likely as a pleasant experience at the Vogon planning office.',
              verdict: 'Do not spend it yet.',
              stamp: 'IMPROBABLE, BUT NOT INTERESTINGLY SO',
              filedUnder: 'TENANCY, MIRACLES OF · A COPY HAS BEEN SENT TO THE OVEN',
            }
          : {
              event: 'A bowl of petunias materialises 2 km above Slough and has just enough time to think “oh no, not again.”',
              probability: { exponent: 276709, mantissa: 0 },
              factors: [
                { label: 'Petunia spontaneity index', weight: '×10⁴' },
                { label: 'Slough airspace policy, 1974 revision', weight: '×88' },
                { label: 'Ambient tea temperature (suboptimal)', weight: '×2.6' },
                { label: 'It being a Thursday', weight: '×1.01' },
              ],
              comparison: 'Roughly as likely as a sperm whale appearing at 30,000 ft.',
              verdict: 'Mostly harmless.',
              stamp: 'HIGHLY IMPROBABLE — OCCURRED ANYWAY',
              filedUnder: 'THINGS THAT OUGHT NOT HAPPEN, VOL. XXIII · WITNESSED BY THREE PASSING DOLPHINS',
            };
        await new Promise((r) => setTimeout(r, 900));
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] };
      },
    },
  };
}

/** The client the deployed function uses: real if there is a key, mock otherwise. */
export function defaultClient() {
  if (process.env.ANTHROPIC_API_KEY) return new Anthropic();
  process.stderr.write('drive: ANTHROPIC_API_KEY is not set, using the mock client\n');
  return createMockClient();
}
