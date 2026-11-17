// The music workspace. One screen that lives through create → reveal → remix,
// transforming from a private (solo) editor into the shared two-track editor.
import { h, svg, motif, toggle, setText, fmtTime, reducedMotion, reactionGlyph, reactionLabel } from '../ui/dom.js';
import { createMelodyGrid, createDrumGrid, createTimeline } from '../ui/sequencer.js';
import { audio, INSTRUMENT_INFO, KIT_INFO } from '../audio.js';
import { predict } from '../net.js';
import {
  ROUND_TYPES, REVEAL_STAGES, otherSlot, MELODY_INSTRUMENTS, DRUM_KITS, QUICK_MESSAGES, REACTIONS,
} from '../shared/game.js';
import { ensureSound, setUserPaused } from '../main.js';

const nameOf = (v, s) => v.players[s]?.name || (s === v.you ? 'You' : 'Partner');
const slotOf = (v, role) => (v.roles.A === role ? 'A' : 'B');

export function workspaceScreen(app) {
  let mode = null, layoutKey = null;
  let grids = {};
  let localSkip = false, lastStage = null, particlesDone = false;
  const seenReactions = new Set();

  // ---------- top bar
  const roundChip = h('span', { class: 'chip chip-round' });
  const modeChip = h('span', { class: 'chip chip-mode' });
  const promptChip = h('span', { class: 'chip chip-prompt', hidden: true });
  const timer = h('div', { class: 'timer', role: 'timer', 'aria-live': 'off' });
  const loopBtn = h('button', { class: 'btn btn-sm btn-play loop-btn' });
  const loopInd = h('span', { class: 'loop-ind' }, h('i'), 'AUTO LOOP');
  const bar = h('div', { class: 'ws-bar' }, roundChip, modeChip, promptChip, h('span', { class: 'spacer' }), loopInd, loopBtn, timer);

  // ---------- stage
  const title = h('h2', { class: 'ws-title' });
  const sub = h('p', { class: 'ws-sub' });
  const tracks = h('div', { class: 'tracks' });
  const pickers = h('div', { class: 'pickers' });
  const stage = h('section', { class: 'ws-stage' }, h('div', { class: 'ws-head' }, title, sub), tracks, pickers);
  const side = h('aside', { class: 'ws-side' });
  const foot = h('div', { class: 'ws-foot' });
  const reactLayer = h('div', { class: 'react-layer', 'aria-hidden': 'true' });
  const chat = chatPanel(app);

  // ---------- reveal overlay
  const ovText = h('div', { class: 'ov-text', 'aria-live': 'assertive' });
  const ovCanvas = h('canvas', { class: 'ov-canvas', 'aria-hidden': 'true' });
  const skipBtn = h('button', { class: 'btn btn-sm btn-ghost skip-btn', onclick: () => { localSkip = true; app.act({ type: 'skipReveal' }); tickUI(); } }, 'Skip animation →');
  const overlay = h('div', { class: 'reveal-ov', hidden: true }, ovCanvas, ovText, skipBtn);

  const el = h('main', { class: 'ws' }, bar, h('div', { class: 'ws-main' }, stage, side), foot, overlay, reactLayer);

  loopBtn.onclick = async () => {
    if (!audio.started) { await ensureSound(); setUserPaused(false); return paintLoop(); }
    setUserPaused(audio.playing);
    paintLoop();
  };
  function paintLoop() {
    const on = audio.playing;
    loopBtn.replaceChildren(svg(on ? motif.pause() : motif.play()), !audio.started ? 'Turn on sound' : on ? 'Pause' : 'Play');
    loopBtn.setAttribute('aria-label', on ? 'Pause loop' : 'Play loop');
    toggle(loopInd, 'live', on);
  }
  const offState = audio.onState(paintLoop);
  const offStep = audio.onStep(s => {
    grids.melody?.setPlayhead(s); grids.drums?.setPlayhead(s); grids.timeline?.setPlayhead(s);
    if (s % 4 === 0 && s >= 0) { loopInd.classList.remove('beat'); void loopInd.offsetWidth; loopInd.classList.add('beat'); }
  });

  // ---------- editing
  function edit(a) {
    predict(app.state, a);
    app.act(a);
    update();
  }
  function canEdit(v, role) {
    if (!['create', 'remix'].includes(v.phase)) return false;
    if (role === v.roles[v.you]) return true;
    return app.demo && !v.blind;
  }

  function trackBlock(v, role) {
    const owner = slotOf(v, role);
    const isMine = owner === v.you;
    const grid = role === 'melody'
      ? createMelodyGrid({ onToggle: (step, pitch) => { edit({ type: 'editMelody', step, pitch }); if (pitch >= 0) audio.previewMelody(pitch, app.state.composition.melody.instrument); } })
      : createDrumGrid({ onToggle: (row, step, on) => { edit({ type: 'editDrum', row, step, on }); if (on) audio.previewDrum(row, app.state.composition.drums.kit); } });
    grids[role] = grid;
    const sound = h('span', { class: 'track-sound' });
    const badge = h('span', { class: 'track-badge' });
    const head = h('div', { class: 'track-head' },
      h('span', { class: 'track-name' }, role === 'melody' ? 'MELODY' : 'DRUMS'),
      badge, sound);
    const block = h('div', { class: `track track-${role}` }, head, grid.el);
    block._paint = vv => {
      const o = slotOf(vv, role);
      badge.replaceChildren(app.demo ? 'demo seat' : `${nameOf(vv, o)}${o === vv.you ? ' (you)' : ''}`);
      toggle(badge, 'mine', o === vv.you);
      const c = vv.composition[role];
      setText(sound, c ? (role === 'melody' ? INSTRUMENT_INFO[c.instrument].label : KIT_INFO[c.kit].label) : '');
      const editable = canEdit(vv, role);
      grid.setEditable(editable);
      toggle(block, 'readonly', !editable);
      if (c) grid.set(role === 'melody' ? c.notes : c.pattern);
    };
    return block;
  }

  function picker(v, role) {
    const c = v.composition[role];
    const items = role === 'melody' ? MELODY_INSTRUMENTS : DRUM_KITS;
    const info = role === 'melody' ? INSTRUMENT_INFO : KIT_INFO;
    const cur = role === 'melody' ? c.instrument : c.kit;
    return h('div', { class: `picker picker-${role}`, role: 'radiogroup', 'aria-label': role === 'melody' ? 'Melody sound' : 'Drum kit' },
      h('span', { class: 'picker-label' }, role === 'melody' ? 'Try another sound' : 'Try another kit'),
      items.map((k, i) => h('button', {
        class: `pick ${k === cur ? 'sel' : ''} pick-${i}`, role: 'radio', 'aria-checked': String(k === cur),
        disabled: !canEdit(v, role) && v.phase !== 'create',
        onclick: async () => {
          await ensureSound();
          if (role === 'melody') { edit({ type: 'setInstrument', instrument: k }); audio.previewInstrument(k); }
          else { edit({ type: 'setKit', kit: k }); audio.previewKit(k); }
        },
      }, h('b', {}, info[k].label), h('small', {}, info[k].blurb))));
  }

  // ---------- layout (rebuilt when mode / role changes)
  function layout(v) {
    const myRole = v.roles[v.you];
    const newMode = v.blind ? 'solo' : 'shared';
    const key = `${newMode}:${myRole}`;
    if (key === layoutKey) return;
    const wasSolo = mode === 'solo';
    mode = newMode; layoutKey = key;
    grids = {};
    el.dataset.mode = mode;
    el.dataset.role = myRole;
    if (mode === 'solo') {
      grids.timeline = createTimeline();
      tracks.replaceChildren(grids.timeline.el, trackBlock(v, myRole));
    } else {
      grids.timeline = createTimeline();
      tracks.replaceChildren(grids.timeline.el, trackBlock(v, 'melody'), trackBlock(v, 'drums'));
      if (wasSolo) { tracks.classList.remove('unfold'); void tracks.offsetWidth; tracks.classList.add('unfold'); }
    }
  }

  // ---------- per-state update
  function update() {
    const v = app.state;
    if (!v) return;
    const info = ROUND_TYPES[v.roundType];
    const me = v.you, ot = otherSlot(me), myRole = v.roles[me];
    const partner = v.players[ot];
    layout(v);
    el.dataset.phase = v.phase;

    setText(roundChip, `ROUND ${v.roundIndex + 1} · ${info.title.toUpperCase()}`);
    modeChip.replaceChildren(h('i'), v.blind ? 'Blind mode — only you can hear this' : v.phase === 'remix' ? 'Live remix — you both hear this' : 'Shared — you both hear this');
    toggle(modeChip, 'blind', v.blind);
    promptChip.hidden = !v.prompt;
    if (v.prompt) setText(promptChip, `PROMPT: ${v.prompt}`);

    // headings
    if (v.phase === 'create' && v.blind) {
      title.replaceChildren(myRole === 'melody' ? 'Make your ' : 'Build your ', h('em', { class: 'serif' }, myRole === 'melody' ? 'melody.' : 'beat.'));
      setText(sub, v.prompt ? `What does ${v.prompt.toLowerCase()} sound like to you? Tap the grid — it loops automatically.` : 'Tap the grid to add or remove sounds. It loops automatically.');
    } else if (v.phase === 'create') {
      title.replaceChildren('Make it ', h('em', { class: 'serif' }, 'together.'));
      setText(sub, `You edit the ${myRole === 'melody' ? 'melody' : 'drums'}; ${nameOf(v, ot)} edits the ${myRole === 'melody' ? 'drums' : 'melody'}. Talk it out in the chat.`);
    } else if (v.phase === 'reveal') {
      title.replaceChildren('The ', h('em', { class: 'serif' }, 'reveal.'));
      setText(sub, 'Listen: first the melody, then the beat, then both together.');
    } else {
      title.replaceChildren("Let's ", h('em', { class: 'serif' }, 'remix it.'));
      setText(sub, 'Both tracks are live. Change yours and hear it together, right now.');
    }

    tracks.querySelectorAll('.track').forEach(t => t._paint?.(v));

    // pickers
    const editableRoles = (app.demo && !v.blind ? ['melody', 'drums'] : [myRole]).filter(r => v.composition[r]);
    const pickSig = editableRoles.map(r => `${r}:${r === 'melody' ? v.composition.melody.instrument : v.composition.drums.kit}:${canEdit(v, r)}`).join('|') + v.phase;
    if (pickSig !== pickers.dataset.sig) {
      const focusedIdx = [...pickers.querySelectorAll('button')].indexOf(document.activeElement);
      pickers.dataset.sig = pickSig;
      pickers.replaceChildren(...editableRoles.map(r => picker(v, r)));
      if (focusedIdx >= 0) pickers.querySelectorAll('button')[focusedIdx]?.focus();
    }
    toggle(pickers, 'compact', editableRoles.length > 1);

    // side + foot
    if (mode === 'solo') {
      side.replaceChildren(soloSide(v));
    } else {
      const chatOpen = (v.phase === 'create' && info.shared) || v.phase === 'remix';
      if (chatOpen) { if (side.firstChild !== chat.el) side.replaceChildren(chat.el); }
      else side.replaceChildren(revealSide(v));
      if (chatOpen) chat.update(v);
    }
    foot.replaceChildren(...footer(v));

    // reactions
    for (const r of v.reactions || []) {
      if (seenReactions.has(r.id)) continue;
      seenReactions.add(r.id);
      floatReaction(r);
    }
    tickUI();
    paintLoop();
  }

  function soloSide(v) {
    const me = v.you, ot = otherSlot(me), p = v.players[ot];
    const away = p?.connected === false;
    return h('div', { class: 'side-stack' },
      h('div', { class: `partner-card ${away ? 'away' : ''}` },
        h('div', { class: 'blob-anim', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
        h('p', { class: 'strong' }, app.demo ? 'Demo mode' : away ? `${nameOf(v, ot)}'s connection dropped` : `${nameOf(v, ot)} is creating something…`),
        h('p', { class: 'small' }, app.demo ? 'Switch seats to make the other half. Each seat only sees its own track.' : away ? 'The timer keeps running. They can rejoin with the same link.' : 'You can\'t see or hear it yet. That\'s the point.'),
        !app.demo ? h('div', { class: 'status-row' },
          h('span', { class: `presence ${away ? 'off' : 'on'}` }, away ? 'offline' : 'connected'),
          h('span', { class: `presence ${v.acks[ot] ? 'on' : 'idle'}` }, v.acks[ot] ? 'done ✓' : 'still making')) : null,
        app.demo ? h('button', { class: 'btn btn-sm btn-mint', onclick: () => app.session.switchSeat() }, `Switch to ${v.roles[me] === 'melody' ? 'Beat Maker' : 'Melody Maker'} seat ⇄`) : null),
      h('div', { class: 'side-tools' },
        h('button', { class: 'btn btn-sm', disabled: v.phase !== 'create', onclick: () => app.act({ type: 'resetTrack', role: v.roles[me] }) }, '↺ Starter pattern'),
        h('button', { class: 'btn btn-sm btn-ghost', disabled: v.phase !== 'create', onclick: () => app.act({ type: 'resetTrack', clear: true, role: v.roles[me] }) }, 'Clear grid')),
      h('button', {
        class: `btn btn-lg ${v.acks[me] ? 'btn-ready-on' : 'btn-fuchsia'}`, disabled: v.phase !== 'create',
        'aria-pressed': String(!!v.acks[me]),
        onclick: () => app.act({ type: 'doneCreating', done: !v.acks[me] }),
      }, v.acks[me] ? '✓ Done — tap to keep going' : app.demo ? 'Both done — reveal!' : "I'm done"),
      h('p', { class: 'hint' }, app.demo ? '' : 'When you\'re both done, the reveal starts early.'));
  }

  function revealSide(v) {
    const m = slotOf(v, 'melody');
    return h('div', { class: 'side-stack' },
      h('div', { class: 'credit-card melody' }, h('span', { class: 'label' }, 'MELODY'), h('b', {}, nameOf(v, m))),
      h('div', { class: 'credit-card drums' }, h('span', { class: 'label' }, 'DRUMS'), h('b', {}, nameOf(v, otherSlot(m)))));
  }

  function footer(v) {
    const me = v.you, ot = otherSlot(me);
    if (v.phase === 'remix') {
      return [
        h('p', { class: 'foot-msg' }, 'Happy with it?'),
        h('button', {
          class: `btn btn-lg ${v.acks[me] ? 'btn-ready-on' : 'btn-lime'}`, 'aria-pressed': String(!!v.acks[me]),
          onclick: () => app.act({ type: 'doneRemix', done: !v.acks[me] }),
        }, v.acks[me] ? '✓ Done — tap to undo' : 'Done remixing →'),
        !app.demo ? h('span', { class: `agree-status ${v.acks[ot] ? 'yes' : ''}` }, v.acks[ot] ? `${nameOf(v, ot)} is done ✓` : `${nameOf(v, ot)} is still remixing`) : null,
      ];
    }
    if (v.phase === 'create' && !v.blind) {
      return [
        h('button', { class: `btn ${v.acks[me] ? 'btn-ready-on' : 'btn-mint'}`, onclick: () => app.act({ type: 'doneCreating', done: !v.acks[me] }) }, v.acks[me] ? '✓ Finished early' : "We're happy — finish early"),
        !app.demo ? h('span', { class: `agree-status ${v.acks[ot] ? 'yes' : ''}` }, v.acks[ot] ? `${nameOf(v, ot)} wants to finish` : '') : null,
      ];
    }
    return [];
  }

  // ---------- timer + reveal choreography (runs on an interval)
  function stageFor(v) {
    if (localSkip) return 'done';
    let t = app.serverNow() - v.phaseStartedAt;
    for (const s of REVEAL_STAGES) { if (t < s.ms) return s.key; t -= s.ms; }
    return 'done';
  }

  function tickUI() {
    const v = app.state;
    if (!v) return;
    if (v.phase === 'create') {
      const left = v.deadline - app.serverNow();
      setText(timer, fmtTime(left));
      toggle(timer, 'warn', left <= 10_000);
      toggle(timer, 'pulse', left <= 10_000 && !reducedMotion());
      timer.setAttribute('aria-label', `${Math.ceil(left / 1000)} seconds left`);
      if (Math.ceil(left / 1000) === 10) timer.setAttribute('aria-live', 'polite');
    } else {
      setText(timer, v.phase === 'reveal' ? 'REVEAL' : 'LIVE');
      timer.classList.remove('warn', 'pulse');
    }

    const inReveal = v.phase === 'reveal';
    const stg = inReveal ? stageFor(v) : 'done';
    overlay.hidden = !inReveal || stg === 'done';
    el.dataset.reveal = inReveal ? stg : '';
    if (inReveal && stg !== lastStage) {
      lastStage = stg;
      const mName = nameOf(v, slotOf(v, 'melody')), dName = nameOf(v, slotOf(v, 'drums'));
      if (app.audioOwner === 'game') {
        audio.setTracks({
          timesup: { melody: false, drums: false, harmony: false },
          melody: { melody: true, drums: false, harmony: true },
          drums: { melody: false, drums: true, harmony: true },
        }[stg] || { melody: true, drums: true, harmony: true });
      }
      ovText.className = `ov-text ov-${stg}`;
      if (stg === 'timesup') ovText.replaceChildren(h('span', { class: 'big' }, "TIME'S UP."), h('span', { class: 'serif' }, 'Ready to hear what you made?'));
      else if (stg === 'melody') ovText.replaceChildren(h('span', { class: 'tag tag-melody' }, '01 — THE MELODY'), h('span', { class: 'serif' }, `by ${mName}`));
      else if (stg === 'drums') ovText.replaceChildren(h('span', { class: 'tag tag-drums' }, '02 — THE BEAT'), h('span', { class: 'serif' }, `by ${dName}`));
      else if (stg === 'together') {
        ovText.replaceChildren(h('span', { class: 'big' }, 'TOGETHER.'));
        if (!particlesDone) { particlesDone = true; runParticles(ovCanvas); }
      }
      if (stg === 'done' && app.audioOwner === 'game') audio.setTracks({ melody: true, drums: true, harmony: true });
    }
    toggle(skipBtn, 'hidden', localSkip);
  }
  const iv = setInterval(tickUI, 150);

  function floatReaction(r) {
    if (reducedMotion()) return;
    const f = h('span', { class: `react-float r-${r.kind} ${r.from === app.state.you ? 'mine' : ''}`, style: { left: `${15 + Math.random() * 70}%` } }, reactionGlyph[r.kind]);
    reactLayer.append(f);
    setTimeout(() => f.remove(), 2400);
  }

  return {
    el, update,
    destroy() { clearInterval(iv); offStep(); offState(); chat.destroy?.(); },
  };
}

// ======================================================================= chat
function chatPanel(app) {
  let collapsed = false, unread = 0, lastCount = -1;
  const list = h('ol', { class: 'chat-list', 'aria-live': 'polite' });
  const input = h('input', { class: 'input', placeholder: 'Say something…', maxlength: 140, 'aria-label': 'Chat message' });
  const countEl = h('span', { class: 'chat-count', hidden: true });
  const toggleBtn = h('button', { class: 'chat-toggle', 'aria-expanded': 'true' }, 'Team chat ', countEl, h('span', { class: 'caret' }, '▾'));
  const body = h('div', { class: 'chat-body' },
    list,
    h('div', { class: 'quick' }, QUICK_MESSAGES.map(q => h('button', { class: 'chip-btn', onclick: () => app.act({ type: 'chat', text: q, quick: true }) }, q))),
    h('div', { class: 'reacts' }, REACTIONS.map(k => h('button', { class: `react-btn r-${k}`, 'aria-label': `Send reaction: ${reactionLabel[k]}`, title: reactionLabel[k], onclick: () => app.act({ type: 'react', kind: k }) }, reactionGlyph[k]))),
    h('form', {
      class: 'chat-form',
      onsubmit: e => { e.preventDefault(); const t = input.value.trim(); if (t) { app.act({ type: 'chat', text: t }); input.value = ''; } },
    }, input, h('button', { class: 'btn btn-sm btn-fuchsia', type: 'submit' }, 'Send')));
  const el = h('aside', { class: 'chat sticker-card' }, toggleBtn, body);
  toggleBtn.onclick = () => {
    collapsed = !collapsed;
    el.classList.toggle('collapsed', collapsed);
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
    if (!collapsed) { unread = 0; countEl.hidden = true; }
  };
  return {
    el,
    update(v) {
      const msgs = v.chat || [];
      if (msgs.length !== lastCount) {
        if (collapsed && lastCount >= 0) { unread += Math.max(0, msgs.length - lastCount); countEl.hidden = !unread; countEl.textContent = unread; }
        lastCount = msgs.length;
        list.replaceChildren(...msgs.map(m => h('li', { class: `msg ${m.from === v.you ? 'me' : 'them'} ${m.quick ? 'quick' : ''}` },
          h('span', { class: 'who' }, m.from === v.you ? 'You' : (v.players[m.from]?.name || 'Partner')), h('span', { class: 'txt' }, m.text))));
        if (!msgs.length) list.append(h('li', { class: 'msg-empty' }, 'Say hi — or tap a quick message below.'));
        list.scrollTop = list.scrollHeight;
      }
    },
  };
}

// ======================================================================= reveal particles
function runParticles(canvas) {
  if (reducedMotion()) return;
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = r.width * dpr; canvas.height = r.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = r.width, H = r.height, cx = W / 2, cy = H / 2;
  const N = 170;
  const colsA = ['#FF2E9A', '#5D00FF', '#EF3D8B'], colsB = ['#35C8B4', '#CFFF04', '#A4CF4A'];
  const ps = [];
  for (let i = 0; i < N * 2; i++) {
    const a = i < N;
    const ring = Math.floor(Math.sqrt(i) * 1.2);
    const ang = i * 2.39996; // golden angle → sunflower halftone
    const rad = Math.sqrt(i) * Math.min(W, H) * 0.019;
    ps.push({
      x: a ? -40 - Math.random() * W * 0.3 : W + 40 + Math.random() * W * 0.3,
      y: Math.random() * H,
      tx: cx + Math.cos(ang) * rad, ty: cy + Math.sin(ang) * rad,
      r: 2 + (1 - ring / 40) * 6 * Math.random() + 1.5,
      c: (a ? colsA : colsB)[i % 3],
      d: Math.random() * 0.25,
    });
  }
  const start = performance.now(), dur = 2600;
  (function frame(now) {
    const t = Math.min(1, (now - start) / dur);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'multiply';
    for (const p of ps) {
      const k = Math.max(0, Math.min(1, (t - p.d) / 0.6));
      const e = 1 - Math.pow(1 - k, 3);
      const x = p.x + (p.tx - p.x) * e, y = p.y + (p.ty - p.y) * e;
      const fade = t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
      ctx.globalAlpha = fade;
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(x, y, p.r * (0.6 + 0.4 * e), 0, Math.PI * 2); ctx.fill();
    }
    if (t < 1) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
  })(start);
}
