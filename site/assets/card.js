/**
 * Rendering a report. Shared by the Drive page and the permalink page.
 * Everything here builds DOM from data; no HTML strings are assembled from
 * model output.
 */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `2026-08-22` -> `22 AUG 2026` */
export function shortDate(iso) {
  const [y, m, d] = String(iso ?? '').split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** `2026-08-22` -> `22 August 2026` */
export function longDate(iso) {
  const [y, m, d] = String(iso ?? '').split('-').map(Number);
  if (!y || !m || !d) return '';
  return `${d} ${MONTHS_LONG[m - 1]} ${y}`;
}

const fmt = (n) => Number(n).toLocaleString('en-GB');

/** A small element helper. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** The big figure: `2^276,709 to 1 against` or `440,921 to 1 against`. */
export function probabilityFigure(probability) {
  const p = el('p', { class: 'prob-figure' });
  if (probability?.exponent > 0) {
    p.append('2', el('sup', { text: fmt(probability.exponent) }), ' to 1 ');
  } else {
    p.append(fmt(probability?.mantissa ?? 1), ' to 1 ');
  }
  p.append(el('span', { class: 'against', text: 'against' }));
  return p;
}

/** A plain-text form, for share sheets and titles. */
export function probabilityText(probability) {
  return probability?.exponent > 0
    ? `2^${fmt(probability.exponent)} to 1 against`
    : `${fmt(probability?.mantissa ?? 1)} to 1 against`;
}

/**
 * The full report card.
 * @param {object} report
 * @param {{onAgain?: () => void, permalink?: string, compact?: boolean}} opts
 */
export function renderCard(report, { onAgain, permalink, compact = false } = {}) {
  const calc = report.mode === 'calculate';
  const card = el('article', { class: `card${calc ? ' is-calc' : ''}${compact ? ' is-compact' : ''}`, 'aria-label': 'Improbability report' });

  card.append(
    el('div', { class: 'card-head' }, [
      el('span', { text: `${calc ? 'SUBMITTED FOR ASSESSMENT · ' : 'IMPROBABILITY REPORT '}Nº ${report.reportNo ?? ''}` }),
      el('span', { text: compact && permalink ? permalink.replace(/^https?:\/\//, '') : shortDate(report.date) }),
    ]),
  );

  if (calc && report.scenario) {
    card.append(
      el('div', {}, [
        el('p', { class: 'event', text: `“${report.scenario}”` }),
        el('p', { class: 'event-note', text: 'As described by the applicant. The Drive accepts no responsibility for outcomes.' }),
      ]),
    );
    if (!compact) card.append(el('p', { class: 'aside', text: report.event }));
  } else {
    card.append(el('p', { class: 'event', text: report.event }));
  }

  if (compact) {
    card.append(el('div', { class: 'prob' }, [probabilityFigure(report.probability)]));
    card.append(
      el('div', { class: 'card-foot' }, [
        el('p', { class: 'comparison', text: report.comparison }),
        el('span', { class: 'stamp', text: report.stamp }),
      ]),
    );
    return card;
  }

  card.append(
    el('div', { class: 'prob' }, [el('span', { class: 'label', text: 'Probability' }), probabilityFigure(report.probability)]),
  );

  if (report.factors?.length) {
    card.append(
      el('div', { class: 'factors' }, [
        el('span', { class: 'label', text: 'Contributing factors' }),
        el('ul', {}, report.factors.map((f) => el('li', {}, [el('span', { text: f.label }), el('span', { class: 'weight', text: f.weight })]))),
      ]),
    );
  }

  card.append(el('p', { class: 'comparison', text: report.comparison }));
  if (report.filedUnder) card.append(el('p', { class: 'filed', text: `Filed under: ${report.filedUnder}` }));

  const again = el('button', { class: 'btn-again', type: 'button', text: 'Engage again' });
  again.addEventListener('click', () => onAgain?.());

  const copy = el('button', { class: 'btn-quiet', type: 'button', text: 'Copy link' });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(permalink);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = permalink;
    }
    setTimeout(() => { copy.textContent = 'Copy link'; }, 1800);
  });

  const pair = el('div', { class: 'pair' }, [copy]);
  if (navigator.share) {
    const share = el('button', { class: 'btn-quiet', type: 'button', text: 'Share' });
    share.addEventListener('click', () => {
      navigator.share({ title: 'The Improbability Drive', text: `${report.event} ${probabilityText(report.probability)}.`, url: permalink }).catch(() => {});
    });
    pair.append(share);
  }

  card.append(
    el('div', { class: 'card-foot' }, [
      el('div', { class: 'actions' }, [again, pair]),
      el('span', { class: 'stamp', text: report.stamp }),
    ]),
  );
  return card;
}

/** The in-card refusal. */
export function renderDeclined({ onAgain }) {
  const again = el('button', { class: 'btn-again', type: 'button', text: 'Engage again' });
  again.addEventListener('click', () => onAgain?.());
  return el('article', { class: 'card is-note', 'aria-label': 'Assessment declined' }, [
    el('div', { class: 'note-head' }, [
      el('span', { class: 'card-head', text: 'ASSESSMENT DECLINED' }),
      el('span', { class: 'stamp is-tilt', text: 'Unthinkable' }),
    ]),
    el('p', { class: 'event', text: 'The Drive respectfully declines to contemplate that.' }),
    el('p', { class: 'note-body', text: 'Some improbabilities are best left unexamined. This is one. No record has been kept, out of politeness.' }),
    again,
  ]);
}

/** The in-card rate-limit. Counts down, then re-enables. */
export function renderResting({ seconds, onReady }) {
  const btn = el('button', { class: 'btn-again', type: 'button', text: 'Engage', disabled: true });
  const clock = el('span', { class: 'mono' });
  let left = Math.max(1, Math.round(seconds));
  const tick = () => {
    clock.textContent = `READY IN ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (left <= 0) {
      btn.disabled = false;
      clock.textContent = 'READY';
      return;
    }
    left -= 1;
    setTimeout(tick, 1000);
  };
  tick();
  btn.addEventListener('click', () => onReady?.());
  return el('article', { class: 'card is-note', 'aria-label': 'The Drive is resting' }, [
    el('div', { class: 'note-head' }, [
      el('span', { class: 'card-head', text: 'TEMPORARILY UNAVAILABLE' }),
      el('span', { class: 'stamp is-guide', text: 'Back shortly, probably' }),
    ]),
    el('p', { class: 'event', text: 'The Drive is resting.' }),
    el('p', { class: 'note-body', text: 'Improbability reserves replenish at roughly one absurdity per minute. Yours will be ready shortly. Do put the kettle on.' }),
    el('div', { class: 'countdown' }, [btn, clock]),
  ]);
}

/** Anything else that went wrong. */
export function renderNormality({ message, onAgain }) {
  const again = el('button', { class: 'btn-again', type: 'button', text: 'Engage again' });
  again.addEventListener('click', () => onAgain?.());
  return el('article', { class: 'card is-note', 'aria-label': 'A period of normality' }, [
    el('div', { class: 'note-head' }, [
      el('span', { class: 'card-head', text: 'PERIOD OF NORMALITY' }),
      el('span', { class: 'stamp is-guide', text: 'Regrettable' }),
    ]),
    el('p', { class: 'event', text: 'Nothing improbable occurred.' }),
    el('p', { class: 'note-body', text: message || 'The instrument reports a fault. This is, statistically, the most probable outcome, and therefore the least interesting.' }),
    again,
  ]);
}
