import { h, svg, motif, deco, reducedMotion, toast, fitText } from '../ui/dom.js';
import { audio, INSTRUMENT_INFO } from '../audio.js';
import { parseCompositionJSON, starterMelody, starterDrums, emptyDrums, emptyMelody, noteDegree, STEPS } from '../shared/game.js';
import { ensureSound, takeAudio } from '../main.js';

export function homeScreen(app) {
  let raf;
  const canvas = h('canvas', { class: 'hero-canvas', 'aria-hidden': 'true' });

  const fileInput = h('input', {
    type: 'file', accept: 'application/json,.json', class: 'sr-only', id: 'import-json',
    onchange: async e => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const data = parseCompositionJSON(JSON.parse(await f.text()));
        app.go('replay', { replay: data });
      } catch (err) { toast(`Couldn't open that file: ${err.message}`, 'warn'); }
      e.target.value = '';
    },
  });

  // ---- "hear an example" buttons on the role cards
  let demoPlaying = null;
  function hearExample(which, btn) {
    return async () => {
      if (!(await ensureSound())) return;
      document.querySelectorAll('.role-card .btn-hear').forEach(b => b.classList.remove('playing'));
      if (demoPlaying === which) { audio.stop(); demoPlaying = null; return; }
      takeAudio('local');
      audio.setComposition(which === 'melody'
        ? { melody: { notes: starterMelody(), instrument: 'softKeys' }, drums: { pattern: emptyDrums(), kit: 'acoustic' } }
        : { melody: { notes: emptyMelody(), instrument: 'softKeys' }, drums: { pattern: starterDrums(), kit: 'electronic' } });
      audio.setTracks({ melody: true, drums: true, harmony: true });
      audio.play();
      demoPlaying = which;
      btn().classList.add('playing');
    };
  }
  const hearMel = h('button', { class: 'btn btn-sm btn-hear', onclick: hearExample('melody', () => hearMel) }, svg(motif.play()), 'Hear a melody');
  const hearDrm = h('button', { class: 'btn btn-sm btn-hear', onclick: hearExample('drums', () => hearDrm) }, svg(motif.play()), 'Hear a beat');

  const miniMelody = h('div', { class: 'mini-grid mini-melody', 'aria-hidden': 'true' },
    starterMelody().map(n => h('span', { class: n ? 'on' : '', style: { '--p': noteDegree(n) } })));
  const miniDrums = h('div', { class: 'mini-grid mini-drums', 'aria-hidden': 'true' },
    ['boom', 'clap', 'tss'].map(r => h('div', {}, starterDrums()[r].map(on => h('span', { class: on ? `on d-${r}` : '' })))));

  const el = h('main', { class: 'home' },
    // ------------------------------------------------ HERO
    h('section', { class: 'hero' },
      h('div', { class: 'hero-bg halftone-fade' }),
      deco('sparkle', { x: '6%', y: '14%', size: 44, rot: 8, fill: 'var(--lime)', cls: 'float' }),
      deco('star', { x: '46%', y: '6%', size: 38, rot: -12, fill: 'var(--butter)', cls: 'float slow' }),
      deco('flower', { x: '90%', y: '72%', size: 56, rot: 10, fill: 'var(--pink)', cls: 'spin' }),
      h('div', { class: 'hero-copy' },
        h('p', { class: 'kicker sticker tilt-l' }, 'a two-player music game ✳'),
        h('h1', { class: 'wordmark', 'aria-label': 'BLIND SYNC' },
          h('span', { class: 'wm-row' }, fitText(h('span', { class: 'wm-line wm-1' }, 'BLIND'), { min: 48 })),
          h('span', { class: 'wm-row' }, fitText(h('span', { class: 'wm-line wm-2' }, 'SYNC', h('span', { class: 'wm-dot' }, '.')), { min: 48 })),
          h('span', { class: 'wm-serif' }, 'make music, together')),
        h('p', { class: 'tagline' }, 'Two minds. Two sounds. ', h('em', {}, 'One unexpected composition.')),
        window.BLIND_SYNC_DEMO_ONLY
          ? h('div', { class: 'cta-row' },
            h('button', { class: 'btn btn-xl btn-fuchsia', onclick: () => app.startDemo() }, 'PLAY THE DEMO'),
            h('p', { class: 'demo-note' }, 'This online preview runs in Local Demo mode: you play both seats on one screen. Two-player rooms need the Node server (see README).'))
          : h('div', { class: 'cta-row' },
            h('button', { class: 'btn btn-xl btn-fuchsia', onclick: () => app.go('gate', { gate: { mode: 'create', code: '', error: null } }) }, 'CREATE A ROOM'),
            h('button', { class: 'btn btn-xl btn-lime', onclick: () => app.go('gate', { gate: { mode: 'join', code: '', error: null } }) }, 'JOIN A ROOM')),
        h('div', { class: 'sub-row' },
          window.BLIND_SYNC_DEMO_ONLY ? null : h('button', { class: 'link-btn', onclick: () => app.startDemo() }, 'Try Local Demo (one screen) →'),
          h('label', { class: 'link-btn', for: 'import-json' }, 'Open a saved track'),
          fileInput)),
      h('p', { class: 'credit-tag' }, h('span', { class: 'chip' }, 'CoreLabSystems:CT'), 'a creative technology project by ', h('b', {}, 'Lulu')),
      h('div', { class: 'hero-visual' },
        canvas,
        h('span', { class: 'pill pill-melody tilt-r' }, '♪ MELODY'),
        h('span', { class: 'pill pill-drums tilt-l' }, '● DRUMS'),
        h('div', { class: 'hero-sticker' }, svg(motif.burst('var(--lime)')), h('span', {}, 'Create', h('br'), 'separately.', h('br'), h('em', {}, 'Listen'), h('br'), h('em', {}, 'together.'))),
      ),
    ),

    // ------------------------------------------------ HOW TO PLAY
    h('section', { class: 'how', id: 'how' },
      h('div', { class: 'section-head' },
        h('h2', {}, 'How to play ', h('em', { class: 'serif' }, 'in three moves')),
        h('p', {}, 'One of you makes the tune, the other makes the rhythm. You won\'t always know what your partner is doing — that\'s the fun.')),
      h('ol', { class: 'steps' },
        stepCard('01', 'Create your sound', 'Tap dots on a grid. Each dot is a note or a drum hit. No music theory needed.', 'note', 'var(--fuchsia)', 'c-pink'),
        stepCard('02', "Reveal your partner's sound", 'When time runs out, hear your two halves play together for the first time.', 'sparkle', 'var(--lime)', 'c-mint'),
        stepCard('03', 'Remix together', 'Now both of you can see and hear everything. Tweak it until it clicks.', 'flower', 'var(--sky)', 'c-yellow'),
      ),
    ),

    // ------------------------------------------------ ROLES
    h('section', { class: 'roles' },
      h('article', { class: 'role-card role-melody' },
        h('div', { class: 'role-top' }, h('span', { class: 'role-tag' }, 'ROLE A'), svg(motif.note('var(--lime)'), 'role-icon')),
        fitText(h('h3', {}, 'MELODY')), h('p', { class: 'role-line' }, h('em', {}, 'Create the tune.')),
        h('p', {}, 'Five notes, sixteen steps. Higher rows sound higher. Pick from ',
          Object.values(INSTRUMENT_INFO).map(i => i.label).join(', ').replace(/, ([^,]*)$/, ' or $1'), '.'),
        miniMelody, hearMel),
      h('div', { class: 'roles-plus', 'aria-hidden': 'true' }, '+'),
      h('article', { class: 'role-card role-drums' },
        h('div', { class: 'role-top' }, h('span', { class: 'role-tag' }, 'ROLE B'), svg(motif.burst('var(--fuchsia)'), 'role-icon')),
        fitText(h('h3', {}, 'DRUMS')), h('p', { class: 'role-line' }, h('em', {}, 'Make the rhythm.')),
        h('p', {}, 'BOOM, CLAP and TSS. Stack them, space them out, break the pattern. Three kits to try.'),
        miniDrums, hearDrm),
    ),

    // ------------------------------------------------ ROUNDS
    h('section', { class: 'rounds' },
      h('div', { class: 'section-head' }, h('h2', {}, 'Three rounds, ', h('em', { class: 'serif' }, 'then keep going'))),
      h('div', { class: 'round-strip' },
        roundCard('1', 'Blind Creation', '1:30', 'Create without knowing what your partner is making.', 'r-blind'),
        roundCard('2', 'Communicate', '1:30', 'Same grid, both tracks, live chat. Build it together.', 'r-comm'),
        roundCard('3', 'Prompt Challenge', '2:00', 'One word — RAIN, CHAOS, MIDNIGHT… — two blind interpretations.', 'r-prompt'),
        roundCard('∞', 'Keep Creating', 'endless', 'New prompts, swapped roles, as many tracks as you like.', 'r-endless'),
      ),
    ),

    // ------------------------------------------------ ABOUT
    h('section', { class: 'about', id: 'about' },
      h('div', { class: 'about-card sticker-card' },
        h('h2', {}, 'About ', h('em', { class: 'serif' }, 'BLIND SYNC')),
        h('p', {}, 'BLIND SYNC is an experiment in collaboration, interpretation and happy accidents. Two people, two screens, one loop. It starts blind, opens up into conversation, and ends with both of you translating the same word into sound.'),
        h('p', {}, 'Every browser makes its own sound from the same shared notes, so nothing is streamed — only ideas travel between you.'),
        h('p', { class: 'small' }, 'Designed and built by ', h('b', {}, 'Lulu'), ' for ', h('b', {}, 'CoreLabSystems:CT'), '. Made with Tone.js, Node.js and WebSockets.')),
      svg(motif.arrow(), 'about-arrow'),
    ),
    h('footer', { class: 'footer' },
      h('span', { class: 'wordmark-sm' }, 'BLIND SYNC', h('span', { class: 'dot' }, '.')),
      h('span', {}, 'Made by Lulu · CoreLabSystems:CT'),
      h('span', {}, 'Create separately. Listen together.')),
  );

  // ---- hero canvas: two halftone sound-wave systems that drift into each other
  function draw(t) {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(r.width * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
    const ctx = canvas.getContext('2d');
    const W = r.width, H = r.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'multiply';
    const gap = 10, time = t / 1000;
    const systems = [
      { c1: [255, 46, 154], c2: [93, 0, 255], phase: 0, amp: 0.22, freq: 1.6, y0: 0.42, side: 0 },
      { c1: [53, 200, 180], c2: [207, 255, 4], phase: 2, amp: 0.2, freq: 2.3, y0: 0.58, side: 1 },
    ];
    for (const s of systems) {
      for (let x = gap / 2; x < W; x += gap) {
        const u = x / W;
        const weight = s.side === 0 ? 1 - u * 0.65 : 0.35 + u * 0.65;
        const cy = H * (s.y0 + s.amp * Math.sin(u * Math.PI * s.freq + time * (s.side ? -1.1 : 0.9) + s.phase) * weight);
        const col = s.c1.map((v, i) => Math.round(v + (s.c2[i] - v) * u));
        ctx.fillStyle = `rgb(${col.join(',')})`;
        for (let y = gap / 2; y < H; y += gap) {
          const d = (y - cy) / (H * 0.16);
          const rad = 4.6 * Math.exp(-d * d) * (0.55 + 0.45 * weight);
          if (rad < 0.45) continue;
          ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    if (!reducedMotion()) raf = requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  return {
    el,
    destroy() { cancelAnimationFrame(raf); if (demoPlaying) audio.stop(); },
  };
}

function stepCard(num, title, text, icon, fill, cls) {
  return h('li', { class: `step-card ${cls}` },
    h('span', { class: 'step-num' }, num),
    svg(motif[icon](fill), 'step-icon'),
    h('h3', {}, title), h('p', {}, text));
}
function roundCard(n, title, time, text, cls) {
  return h('div', { class: `round-card ${cls}` },
    h('div', { class: 'rc-top' }, h('span', { class: 'rc-n' }, n), h('span', { class: 'rc-time' }, time)),
    h('h3', {}, title), h('p', {}, text));
}
