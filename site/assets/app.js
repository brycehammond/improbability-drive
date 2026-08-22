/**
 * The Drive page. One state machine: idle -> engaging -> result (or a note).
 *
 * `?mock=1` answers from /assets/mock.json instead of the API, so the page
 * runs against the static preview with nothing behind it.
 */
import { renderCard, renderDeclined, renderNormality, renderResting } from './card.js';

const root = document.getElementById('drive');
const engageBtn = document.getElementById('engage');
const form = document.getElementById('calc');
const scenarioInput = document.getElementById('scenario');
const figure = document.getElementById('figure');
const progress = document.getElementById('progress');
const status = document.getElementById('status');
const reducedCopy = document.getElementById('reduced-copy');
const result = document.getElementById('result');

const MOCK = new URLSearchParams(location.search).has('mock');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

const STATUSES = [
  'Consulting the petunias…',
  'Borrowing certainty from Tuesday…',
  'Cross-referencing with the whale…',
  'Normality restored, mostly…',
  'Recalculating on the basis of tea…',
];

/** The minimum time the instrument is seen to work. The joke needs a beat. */
const MIN_ENGAGED_MS = 2400;

const setState = (s) => { root.dataset.state = s; };

const permalinkFor = (report) => `${location.origin}/r/${report.id}`;

/** A random improbability figure for the spinner. Tabular, commas, enormous. */
function spinFigure() {
  const digits = 10 + Math.floor(Math.random() * 6);
  let n = String(1 + Math.floor(Math.random() * 9));
  while (n.length < digits) n += Math.floor(Math.random() * 10);
  return `1 : ${n.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** Runs the counter, the progress rule and the status line until stopped. */
function startSpinner() {
  if (reduced.matches) {
    figure.textContent = '1 : — — — — —';
    figure.classList.add('is-static');
    status.textContent = 'Calculating';
    reducedCopy.hidden = false;
    progress.style.width = '0';
    return () => {};
  }
  figure.classList.remove('is-static');
  reducedCopy.hidden = true;
  let i = Math.floor(Math.random() * STATUSES.length);
  status.textContent = STATUSES[i];
  const started = performance.now();
  const spin = setInterval(() => { figure.textContent = spinFigure(); }, 70);
  const cycle = setInterval(() => { i = (i + 1) % STATUSES.length; status.textContent = STATUSES[i]; }, 1400);
  const bar = setInterval(() => {
    const t = (performance.now() - started) / 1000;
    progress.style.width = `${Math.min(92, 100 * (1 - Math.exp(-t / 2.2)))}%`;
  }, 200);
  return () => {
    clearInterval(spin); clearInterval(cycle); clearInterval(bar);
    progress.style.width = '100%';
  };
}

/** Asks the Drive. Resolves to {status, body}. */
async function ask(mode, scenario) {
  if (MOCK) {
    const all = await (await fetch('/assets/mock.json')).json();
    await new Promise((r) => setTimeout(r, 600));
    const body = structuredClone(all[mode]);
    if (mode === 'calculate') body.scenario = scenario;
    return { status: 200, body };
  }
  const res = await fetch('/api/drive', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(mode === 'calculate' ? { mode, scenario } : { mode }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* a non-JSON failure; handled below */ }
  return { status: res.status, body, retryAfter: Number(res.headers.get('retry-after')) || body?.retryAfterSeconds };
}

let busy = false;

async function engage(mode, scenario = '') {
  if (busy) return;
  busy = true;
  result.replaceChildren();
  engageBtn.classList.add('is-pressed');
  setState('engaging');
  const stop = startSpinner();
  const started = performance.now();

  let outcome;
  try {
    outcome = await ask(mode, scenario);
  } catch {
    outcome = { status: 0, body: null };
  }

  const elapsed = performance.now() - started;
  if (!reduced.matches && elapsed < MIN_ENGAGED_MS) await new Promise((r) => setTimeout(r, MIN_ENGAGED_MS - elapsed));
  stop();
  engageBtn.classList.remove('is-pressed');
  busy = false;

  const again = () => engage('random');
  const { status: code, body } = outcome;

  if (code === 200 && body?.declined) {
    result.replaceChildren(renderDeclined({ onAgain: again }));
  } else if (code === 200 && body?.event) {
    const report = body;
    result.replaceChildren(renderCard(report, { onAgain: again, permalink: permalinkFor(report) }));
    if (!MOCK && report.id) history.replaceState(null, '', `/r/${report.id}`);
    document.title = `${report.event} · The Improbability Drive`;
  } else if (code === 429) {
    result.replaceChildren(renderResting({ seconds: outcome.retryAfter || 60, onReady: again }));
  } else {
    result.replaceChildren(renderNormality({ message: body?.error, onAgain: again }));
  }
  setState('result');
  if (mode === 'calculate') scenarioInput.value = '';
  result.scrollIntoView({ block: 'nearest', behavior: reduced.matches ? 'auto' : 'smooth' });
}

engageBtn.addEventListener('click', () => engage('random'));
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const scenario = scenarioInput.value.trim();
  if (!scenario) { scenarioInput.focus(); return; }
  engage('calculate', scenario);
});

// Back from a permalink URL the page wrote: restore the button.
window.addEventListener('popstate', () => { setState('idle'); result.replaceChildren(); });
