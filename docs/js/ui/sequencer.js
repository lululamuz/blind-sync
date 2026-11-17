// Step-sequencer grids for the Melody and Drum tracks.
import { h, toggle } from './dom.js';
import { STEPS, PITCH_COUNT, DRUM_ROWS } from '../shared/game.js';
import { PITCH_LABELS, DRUM_INFO } from '../audio.js';

/** Step-number timeline shared by stacked tracks. */
export function createTimeline() {
  const cells = [];
  const el = h('div', { class: 'timeline', 'aria-hidden': 'true' },
    h('span', { class: 'row-label' }, ''),
    Array.from({ length: STEPS }, (_, i) => {
      const c = h('span', { class: `tl-cell ${i % 4 === 0 ? 'beat' : ''}` }, i % 4 === 0 ? String(i / 4 + 1) : '·');
      cells.push(c);
      return c;
    }));
  return {
    el,
    setPlayhead(step) { cells.forEach((c, i) => toggle(c, 'now', i === step)); },
  };
}

/**
 * Melody grid: 5 pitch rows (top = highest) × 16 steps, one note per step.
 * opts: { editable, onToggle(step, pitch) }
 */
export function createMelodyGrid(opts = {}) {
  let notes = Array(STEPS).fill(-1);
  let editable = !!opts.editable;
  const cells = []; // cells[pitch][step]
  const rows = [];
  for (let p = PITCH_COUNT - 1; p >= 0; p--) {
    const rowCells = [];
    const label = h('span', { class: 'row-label pitch-label' },
      h('span', { class: 'pitch-bar', style: { height: `${30 + p * 15}%` } }), PITCH_LABELS[p]);
    for (let s = 0; s < STEPS; s++) {
      const b = h('button', {
        class: `cell mcell ${s % 4 === 0 ? 'beat' : ''}`,
        type: 'button',
        'data-step': s, 'data-pitch': p,
        'aria-label': `Step ${s + 1}, ${PITCH_LABELS[p]}`,
        'aria-pressed': 'false',
        onclick: () => {
          if (!editable) return;
          const next = notes[s] === p ? -1 : p;
          opts.onToggle?.(s, next);
        },
      });
      rowCells[s] = b;
    }
    cells[p] = rowCells;
    rows.push(h('div', { class: 'grid-row', role: 'row' }, label, rowCells));
  }
  const el = h('div', { class: 'grid grid-melody', role: 'grid', 'aria-label': 'Melody grid. Higher rows are higher notes.' }, rows);

  function paint() {
    for (let p = 0; p < PITCH_COUNT; p++) for (let s = 0; s < STEPS; s++) {
      const on = notes[s] === p;
      const c = cells[p][s];
      toggle(c, 'on', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
      c.disabled = !editable;
    }
  }
  paint();
  return {
    el,
    set(n) { notes = n ? n.slice() : Array(STEPS).fill(-1); paint(); },
    setEditable(v) { editable = v; paint(); },
    setPlayhead(step) {
      for (let p = 0; p < PITCH_COUNT; p++) for (let s = 0; s < STEPS; s++) {
        const c = cells[p][s];
        const now = s === step;
        toggle(c, 'now', now);
        toggle(c, 'hit', now && notes[s] === p);
      }
    },
  };
}

/** Drum grid: BOOM / CLAP / TSS × 16 steps; many hits per step allowed. */
export function createDrumGrid(opts = {}) {
  let pattern = Object.fromEntries(DRUM_ROWS.map(r => [r, Array(STEPS).fill(false)]));
  let editable = !!opts.editable;
  const cells = {};
  const rows = DRUM_ROWS.map(r => {
    cells[r] = [];
    const label = h('span', { class: `row-label drum-label dl-${r}` },
      h('b', {}, DRUM_INFO[r].label), h('small', {}, DRUM_INFO[r].hint));
    for (let s = 0; s < STEPS; s++) {
      cells[r][s] = h('button', {
        class: `cell dcell d-${r} ${s % 4 === 0 ? 'beat' : ''}`,
        type: 'button',
        'aria-label': `${DRUM_INFO[r].label}, step ${s + 1}`,
        'aria-pressed': 'false',
        onclick: () => { if (editable) opts.onToggle?.(r, s, !pattern[r][s]); },
      });
    }
    return h('div', { class: 'grid-row', role: 'row' }, label, cells[r]);
  });
  const el = h('div', { class: 'grid grid-drums', role: 'grid', 'aria-label': 'Drum grid' }, rows);
  function paint() {
    for (const r of DRUM_ROWS) for (let s = 0; s < STEPS; s++) {
      const c = cells[r][s], on = !!pattern[r][s];
      toggle(c, 'on', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
      c.disabled = !editable;
    }
  }
  paint();
  return {
    el,
    set(p) { if (p) pattern = JSON.parse(JSON.stringify(p)); paint(); },
    setEditable(v) { editable = v; paint(); },
    setPlayhead(step) {
      for (const r of DRUM_ROWS) for (let s = 0; s < STEPS; s++) {
        toggle(cells[r][s], 'now', s === step);
        toggle(cells[r][s], 'hit', s === step && pattern[r][s]);
      }
    },
  };
}
