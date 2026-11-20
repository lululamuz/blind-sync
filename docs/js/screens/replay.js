// Replay an imported composition JSON (no server needed).
import { h, svg, motif, deco, download, slug } from '../ui/dom.js';
import { createMelodyGrid, createDrumGrid, createTimeline } from '../ui/sequencer.js';
import { audio, INSTRUMENT_INFO, KIT_INFO } from '../audio.js';
import { ROUND_TYPES, STEPS } from '../shared/game.js';
import { ensureSound, takeAudio } from '../main.js';

export function replayScreen(app) {
  const d = app.replay;
  const c = d.composition;
  const tl = createTimeline();
  const mel = createMelodyGrid({ editable: false });
  const drm = createDrumGrid({ editable: false });
  mel.set(c.melody.notes); drm.set(c.drums.pattern); drm.autoExpand();
  const offStep = audio.onStep(s => { mel.setPlayhead(s); drm.setPlayhead(s); tl.setPlayhead(s); });
  const playBtn = h('button', { class: 'btn btn-lg btn-fuchsia btn-play' });
  const paint = () => playBtn.replaceChildren(svg(audio.playing ? motif.pause() : motif.play()), audio.playing ? 'Pause' : 'Play track');
  playBtn.onclick = async () => {
    if (!(await ensureSound())) return;
    takeAudio('local');
    if (audio.playing) audio.stop();
    else { audio.setComposition(c); audio.setTracks({ melody: true, drums: true, harmony: true }); audio.play(); }
    paint();
  };
  paint();
  const el = h('main', { class: 'replay' },
    deco('sparkle', { x: '90%', y: '10%', size: 50, cls: 'float' }),
    h('div', { class: 'results-head' },
      h('span', { class: 'kicker sticker' }, 'SAVED TRACK'),
      h('h1', { class: 'made' }, d.trackName),
      h('p', {}, [d.roundType ? ROUND_TYPES[d.roundType]?.title : null, d.prompt ? `Prompt: ${d.prompt}` : null,
        `${INSTRUMENT_INFO[c.melody.instrument].label} + ${KIT_INFO[c.drums.kit].label}`, `${c.bpm} BPM`].filter(Boolean).join(' · '))),
    h('section', { class: 'result-viz sticker-card' },
      h('div', { class: 'tracks' }, tl.el, h('div', { class: 'track track-melody' }, mel.el), h('div', { class: 'track track-drums' }, drm.el))),
    h('div', { class: 'row gap' }, playBtn,
      h('button', { class: 'btn', onclick: () => download(`blind-sync-${slug(d.trackName)}.json`, { app: 'BLIND SYNC', version: 2, trackName: d.trackName, prompt: d.prompt, roundType: d.roundType, tempo: c.bpm, steps: STEPS, settings: { scale: c.scale, harmony: c.harmony, octaves: { low: 3, mid: 4, high: 5 } }, melody: c.melody, drums: c.drums }) }, '↓ Download JSON'),
      h('button', { class: 'btn btn-ghost', onclick: () => app.go('home') }, '← Home')));
  return { el, destroy() { offStep(); audio.stop(); } };
}
