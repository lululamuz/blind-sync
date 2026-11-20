// Step-sequencer grids for the Melody and Drum tracks.
// v1.2: optional Simple / Expanded view.
//   Melody — Expanded adds LOW / MID / HIGH. The selector only changes which five pitches you
//            SEE; notes are stored as real pitch names, so nothing is ever transposed.
//   Drums  — Expanded reveals OPEN / TOM / SHAKE under BOOM / CLAP / TSS. Hidden rows keep playing.
// The view mode is a personal preference (saved in this browser), never synced to the partner.
import { h, toggle } from './dom.js';
import {
  STEPS, PITCH_COUNT, DRUM_ROWS, BASIC_DRUM_ROWS, EXTRA_DRUM_ROWS, OCTAVES,
  noteName, noteOctave, normalizeNote, normalizePattern,
} from '../shared/game.js';
import { PITCH_LABELS, DRUM_INFO } from '../audio.js';

const OCT_KEYS = ['low', 'mid', 'high'];
const OCT_LABEL = { low: 'LOW', mid: 'MID', high: 'HIGH' };
const octKeyOf = o => OCT_KEYS.find(k => OCTAVES[k] === o);

// ---------------------------------------------------------------- personal view prefs
const PREF_KEY = 'blindsync.editorPrefs';
const prefs = (() => {
  const d = { melodyExpanded: false, octave: 'mid', drumsExpanded: false };
  try { return { ...d, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { return d; }
})();
function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {} }

/** Small two/three-way segmented switch in the BLIND SYNC sticker style. */
function segmented(label, options, current, onPick, cls = '') {
  const btns = options.map(([value, text]) => h('button', {
    type: 'button', class: 'seg-btn', 'aria-pressed': String(value === current),
    onclick: () => onPick(value),
  }, text));
  const el = h('div', { class: `seg ${cls}`, role: 'group', 'aria-label': label }, btns);
  return {
    el,
    set(v, marks = {}) {
      btns.forEach((b, i) => {
        b.setAttribute('aria-pressed', String(options[i][0] === v));
        toggle(b, 'has-notes', !!marks[options[i][0]]);
      });
    },
  };
}

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
 * Melody grid: 5 visible pitch rows (top = highest) × 16 steps, one note per step.
 * opts: { editable, onToggle(step, noteNameOrNull), controls: show Simple/Expanded tools }
 */
export function createMelodyGrid(opts = {}) {
  const withControls = opts.controls !== false;
  let notes = Array(STEPS).fill(null);
  let editable = !!opts.editable;
  let expanded = withControls && prefs.melodyExpanded;
  let octKey = expanded ? prefs.octave : 'mid';
  const visOct = () => (expanded ? OCTAVES[octKey] : OCTAVES.mid);

  const cells = []; // cells[degree][step]
  const labels = [];
  const rows = [];
  for (let d = PITCH_COUNT - 1; d >= 0; d--) {
    const rowCells = [];
    const bar = h('span', { class: 'pitch-bar' });
    const oct = h('small', { class: 'pitch-oct' });
    labels[d] = { bar, oct };
    const label = h('span', { class: 'row-label pitch-label' }, bar, PITCH_LABELS[d], oct);
    for (let s = 0; s < STEPS; s++) {
      rowCells[s] = h('button', {
        class: `cell mcell ${s % 4 === 0 ? 'beat' : ''}`,
        type: 'button',
        'data-step': s, 'data-pitch': d,
        'aria-pressed': 'false',
        onclick: () => {
          if (!editable) return;
          const n = noteName(d, visOct());
          // same note again → remove; any other pitch (even in another range) → replace
          opts.onToggle?.(s, notes[s] === n ? null : n);
        },
      });
    }
    cells[d] = rowCells;
    rows.push(h('div', { class: 'grid-row', role: 'row' }, label, rowCells));
  }
  // Tiny markers under each column: ▲ / ▼ = this step has a note in a higher / lower range.
  const marks = Array.from({ length: STEPS }, (_, s) => h('button', {
    type: 'button', class: `oct-mark ${s % 4 === 0 ? 'beat' : ''}`, tabindex: '-1',
    onclick: () => { const o = noteOctave(notes[s]); if (o) showOctave(octKeyOf(o)); },
  }));
  const markRow = h('div', { class: 'grid-row oct-row', 'aria-hidden': 'true' }, h('span', { class: 'row-label' }), marks);
  const grid = h('div', { class: 'grid grid-melody', role: 'grid', 'aria-label': 'Melody grid. Higher rows are higher notes.' }, rows, markRow);

  const notice = h('p', { class: 'hidden-notice', 'aria-live': 'polite' });
  const modeSeg = segmented('Melody editor mode', [[false, 'SIMPLE'], [true, 'EXPANDED']], expanded, v => setExpanded(v));
  const octSeg = segmented('Note range', OCT_KEYS.map(k => [k, OCT_LABEL[k]]), octKey, k => showOctave(k), 'seg-oct');
  const tools = withControls ? h('div', { class: 'seq-tools' }, modeSeg.el, octSeg.el, notice) : null;
  const el = h('div', { class: 'seq seq-melody' }, tools, grid);

  function setExpanded(v) {
    expanded = v;
    prefs.melodyExpanded = v; savePrefs();
    octKey = v ? prefs.octave : 'mid';
    paint();
  }
  function showOctave(k) {
    if (!withControls) return;
    expanded = true; octKey = k;
    prefs.melodyExpanded = true; prefs.octave = k; savePrefs();
    paint();
  }

  function paint() {
    const o = visOct();
    const oi = OCT_KEYS.indexOf(octKeyOf(o));
    for (let d = 0; d < PITCH_COUNT; d++) {
      labels[d].bar.style.height = `${18 + (oi * 5 + d) * 5.5}%`;
      labels[d].oct.textContent = expanded ? String(o) : '';
      for (let s = 0; s < STEPS; s++) {
        const n = noteName(d, o);
        const on = notes[s] === n;
        const c = cells[d][s];
        toggle(c, 'on', on);
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
        c.setAttribute('aria-label', `Step ${s + 1}, ${PITCH_LABELS[d]} ${OCT_LABEL[octKeyOf(o)].toLowerCase()}`);
        c.disabled = !editable;
      }
    }
    let hidden = 0;
    const perOct = {};
    for (let s = 0; s < STEPS; s++) {
      const no = noteOctave(notes[s]);
      if (no) perOct[octKeyOf(no)] = (perOct[octKeyOf(no)] || 0) + 1;
      const away = no && no !== o;
      if (away) hidden++;
      marks[s].textContent = away ? (no > o ? '▲' : '▼') : '';
      marks[s].className = `oct-mark ${s % 4 === 0 ? 'beat' : ''} ${away ? (no > o ? 'up' : 'down') : ''}`;
      marks[s].title = away ? `Step ${s + 1} has a ${OCT_LABEL[octKeyOf(no)]} note — click to show` : '';
    }
    toggle(el, 'expanded', expanded);
    toggle(markRow, 'has-marks', hidden > 0);
    if (!withControls) return;
    modeSeg.set(expanded);
    octSeg.el.hidden = !expanded;
    octSeg.set(octKey, perOct);
    notice.hidden = hidden === 0;
    notice.replaceChildren(
      h('span', {}, `♪ ${hidden} note${hidden === 1 ? '' : 's'} in other ranges still playing`),
      expanded ? null : h('button', { type: 'button', class: 'link-btn', onclick: () => { const s = notes.findIndex(n => n && noteOctave(n) !== o); showOctave(octKeyOf(noteOctave(notes[s]))); } }, 'Show'));
  }
  paint();
  return {
    el,
    set(n) { notes = n ? n.map(normalizeNote) : Array(STEPS).fill(null); paint(); },
    setEditable(v) { editable = v; paint(); },
    setPlayhead(step) {
      const o = visOct();
      for (let d = 0; d < PITCH_COUNT; d++) for (let s = 0; s < STEPS; s++) {
        const c = cells[d][s];
        const now = s === step;
        toggle(c, 'now', now);
        toggle(c, 'hit', now && notes[s] === noteName(d, o));
      }
      marks.forEach((m, s) => toggle(m, 'hit', s === step && !!m.textContent));
    },
  };
}

/** Drum grid: BOOM / CLAP / TSS (+ OPEN / TOM / SHAKE in Expanded) × 16 steps; many hits per step. */
export function createDrumGrid(opts = {}) {
  const withControls = opts.controls !== false;
  let pattern = normalizePattern(null);
  let editable = !!opts.editable;
  let expanded = withControls && prefs.drumsExpanded;
  const cells = {};
  const rowEls = {};
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
    rowEls[r] = h('div', { class: `grid-row ${EXTRA_DRUM_ROWS.includes(r) ? 'extra-row' : ''}`, role: 'row' }, label, cells[r]);
    return rowEls[r];
  });
  const grid = h('div', { class: 'grid grid-drums', role: 'grid', 'aria-label': 'Drum grid' }, rows);
  const notice = h('p', { class: 'hidden-notice', 'aria-live': 'polite' });
  const modeSeg = segmented('Drum editor mode', [[false, 'SIMPLE'], [true, 'EXPANDED']], expanded, v => {
    expanded = v; prefs.drumsExpanded = v; savePrefs(); paint();
  });
  const tools = withControls ? h('div', { class: 'seq-tools' }, modeSeg.el, notice) : null;
  const el = h('div', { class: 'seq seq-drums' }, tools, grid);

  function paint() {
    for (const r of DRUM_ROWS) for (let s = 0; s < STEPS; s++) {
      const c = cells[r][s], on = !!pattern[r][s];
      toggle(c, 'on', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
      c.disabled = !editable;
    }
    for (const r of EXTRA_DRUM_ROWS) rowEls[r].hidden = !expanded;
    toggle(el, 'expanded', expanded);
    if (!withControls) return;
    modeSeg.set(expanded);
    const busy = EXTRA_DRUM_ROWS.filter(r => pattern[r].some(Boolean));
    notice.hidden = expanded || busy.length === 0;
    notice.replaceChildren(
      h('span', {}, `+ ${busy.map(r => DRUM_INFO[r].label).join(' · ')} still playing in hidden rows`),
      h('button', { type: 'button', class: 'link-btn', onclick: () => { expanded = true; prefs.drumsExpanded = true; savePrefs(); paint(); } }, 'Show'));
  }
  paint();
  return {
    el,
    set(p) { if (p) pattern = normalizePattern(p); paint(); },
    setEditable(v) { editable = v; paint(); },
    /** Results / replay: open the extra rows automatically if the track uses them. */
    autoExpand() { if (EXTRA_DRUM_ROWS.some(r => pattern[r].some(Boolean))) { expanded = true; paint(); } },
    setPlayhead(step) {
      for (const r of DRUM_ROWS) for (let s = 0; s < STEPS; s++) {
        toggle(cells[r][s], 'now', s === step);
        toggle(cells[r][s], 'hit', s === step && pattern[r][s]);
      }
    },
  };
}

export { BASIC_DRUM_ROWS };
