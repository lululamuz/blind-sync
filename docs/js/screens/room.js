import { h, svg, motif, deco, copy, toast, toggle, setText, download, slug, fmtTime } from '../ui/dom.js';
import { createMelodyGrid, createDrumGrid, createTimeline } from '../ui/sequencer.js';
import { audio, INSTRUMENT_INFO, KIT_INFO } from '../audio.js';
import {
  ROUND_TYPES, otherSlot, compositionToJSON, starterMelody, starterDrums, STEPS, MELODY_INSTRUMENTS, DRUM_KITS,
} from '../shared/game.js';
import { ensureSound, takeAudio, setUserPaused } from '../main.js';

const roleTitle = r => (r === 'melody' ? 'MELODY MAKER' : 'BEAT MAKER');
const roleLine = r => (r === 'melody' ? 'Create the tune.' : 'Make the rhythm.');
const nameOf = (v, s) => v.players[s]?.name || (s === v.you ? 'You' : 'Partner');

// =================================================================== GATE (create / join)
export function gateScreen(app) {
  const g = app.gate;
  const nameIn = h('input', { class: 'input', id: 'nick', maxlength: 18, placeholder: 'e.g. Lulu', autocomplete: 'nickname' });
  const codeIn = h('input', {
    class: 'input input-code', id: 'code', maxlength: 5, placeholder: 'ABCDE', value: g.code || '',
    autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'code-help',
    oninput: e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); },
  });
  const tabs = ['create', 'join'];
  let mode = g.mode;
  const err = h('p', { class: 'form-error', role: 'alert' }, g.error || '');
  const createBtn = h('button', { class: 'btn btn-xl btn-fuchsia', type: 'submit' }, g.busy ? 'Opening room…' : 'CREATE A ROOM');
  const joinBtn = h('button', { class: 'btn btn-xl btn-lime', type: 'submit' }, g.busy ? 'Joining…' : 'JOIN ROOM');

  const createPanel = h('form', {
    class: 'gate-panel', onsubmit: e => { e.preventDefault(); if (!g.busy) app.createRoom(nameIn.value.trim()); },
  },
    h('h2', {}, 'Start a ', h('em', { class: 'serif' }, 'new room')),
    h('p', {}, "You'll get a room code and a link to send your partner. No account needed."),
    createBtn);
  const joinPanel = h('form', {
    class: 'gate-panel', onsubmit: e => {
      e.preventDefault();
      if (g.busy) return;
      const c = codeIn.value.trim();
      if (c.length < 5) { err.textContent = 'Room codes have 5 characters.'; codeIn.focus(); return; }
      app.joinRoom(c, nameIn.value.trim());
    },
  },
    h('h2', {}, 'Got a ', h('em', { class: 'serif' }, 'code?')),
    h('label', { for: 'code', class: 'label' }, 'Room code'), codeIn,
    h('p', { id: 'code-help', class: 'hint' }, 'Your partner can see it at the top of their screen.'),
    joinBtn);

  const tabBtns = tabs.map(t => h('button', {
    class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(t === mode),
    onclick: () => { mode = t; g.mode = t; paint(); },
  }, t === 'create' ? 'Create' : 'Join'));
  const panelWrap = h('div', { class: 'gate-panels' });
  function paint() {
    tabBtns.forEach((b, i) => b.setAttribute('aria-selected', String(tabs[i] === mode)));
    panelWrap.replaceChildren(mode === 'create' ? createPanel : joinPanel);
  }
  paint();

  const el = h('main', { class: 'gate' },
    deco('sparkle', { x: '8%', y: '18%', size: 54, rot: 10, cls: 'float' }),
    deco('flower', { x: '84%', y: '64%', size: 70, fill: 'var(--menthe)', cls: 'spin' }),
    h('div', { class: 'gate-card sticker-card' },
      h('div', { class: 'tabs', role: 'tablist' }, tabBtns),
      h('label', { for: 'nick', class: 'label' }, 'Your name ', h('span', { class: 'muted' }, '(optional)')), nameIn,
      panelWrap, err,
      h('button', { class: 'link-btn', type: 'button', onclick: () => app.go('home') }, '← Back home')),
  );
  setTimeout(() => (mode === 'join' && !codeIn.value ? codeIn : nameIn).focus(), 50);
  return { el };
}

export function connectingScreen() {
  return { el: h('main', { class: 'center-screen' }, h('div', { class: 'loader' }, h('i'), h('i'), h('i')), h('h2', {}, 'Finding your room…')) };
}

// =================================================================== LOBBY / ROLE NEGOTIATION
export function lobbyScreen(app) {
  const title = h('h2', { class: 'lobby-title' });
  const sub = h('p', { class: 'lobby-sub' });
  const codeCard = h('div', { class: 'code-card' });
  const players = h('div', { class: 'players' });
  const actions = h('div', { class: 'lobby-actions' });
  const tutorial = tutorialBlock(app);
  const collection = h('div', { class: 'collection-mini' });

  const el = h('main', { class: 'lobby' },
    deco('star', { x: '3%', y: '10%', size: 46, rot: -8, cls: 'float slow' }),
    deco('sparkle', { x: '92%', y: '20%', size: 40, fill: 'var(--fuchsia)', cls: 'float' }),
    h('div', { class: 'lobby-head' }, h('div', {}, title, sub), codeCard),
    players, actions, collection, tutorial.el);

  function update() {
    const v = app.state, me = v.you, ot = otherSlot(me);
    const partner = v.players[ot];
    const isRoles = v.phase === 'roles';
    const next = ROUND_TYPES[v.nextRoundType];

    if (isRoles) {
      title.replaceChildren('Up next: ', h('em', { class: 'serif' }, `Round ${v.roundIndex + 2}`), ` — ${next.title}`);
      setText(sub, `${next.concept} Keep your roles, or swap? You both have to agree.`);
    } else {
      title.replaceChildren('The ', h('em', { class: 'serif' }, 'room'));
      setText(sub, partner ? 'Pick who makes the melody and who makes the beat, then both press Ready.' : 'Send the code or link to one friend. BLIND SYNC is for exactly two players.');
    }

    // room code
    if (app.demo) {
      codeCard.replaceChildren(h('span', { class: 'label' }, 'LOCAL DEMO'), h('p', { class: 'small' }, 'You are playing both seats on this screen. Nothing is sent over the network.'));
    } else {
      const invite = `${location.origin}${location.pathname}?room=${v.code}`;
      codeCard.replaceChildren(
        h('span', { class: 'label' }, 'ROOM CODE'),
        h('div', { class: 'code-tiles', 'aria-label': `Room code ${v.code.split('').join(' ')}` }, v.code.split('').map((c, i) => h('span', { style: { '--i': i } }, c))),
        h('div', { class: 'row gap-sm' },
          h('button', { class: 'btn btn-sm', onclick: () => copy(v.code, 'Room code') }, 'Copy code'),
          h('button', { class: 'btn btn-sm btn-mint', onclick: () => copy(invite, 'Invite link') }, 'Copy invite link')),
      );
    }

    players.replaceChildren(
      playerCard(v, me, true),
      swapControl(app, v),
      partner ? playerCard(v, ot, false) : waitingCard(v, app));

    const meReady = v.ready[me], otReady = v.ready[ot];
    const canReady = !!partner && !v.swapRequest;
    actions.replaceChildren(
      h('button', {
        class: `btn btn-xl ${meReady ? 'btn-ready-on' : 'btn-lime'}`, disabled: !canReady,
        'aria-pressed': String(meReady),
        onclick: async () => { await ensureSound(); app.act({ type: 'setReady', ready: !meReady }); },
      }, meReady ? '✓ READY — tap to undo' : (app.demo ? "WE'RE READY" : "I'M READY")),
      h('p', { class: 'ready-status', 'aria-live': 'polite' },
        !partner ? 'Waiting for your partner to join…'
          : v.swapRequest ? 'Settle the role swap first.'
            : app.demo ? 'Demo: one click readies both seats.'
              : meReady && !otReady ? `Waiting for ${nameOf(v, ot)} to be ready…`
                : !meReady && otReady ? `${nameOf(v, ot)} is ready!` : 'Both players must be ready to start.'),
    );

    if (v.collection?.length) {
      collection.replaceChildren(h('span', { class: 'label' }, 'MADE THIS SESSION'),
        v.collection.map(c => h('span', { class: 'chip' }, `♪ ${c.name}`)));
    } else collection.replaceChildren();
    tutorial.setRole(v.roles[me]);
  }
  return { el, update, destroy: tutorial.destroy };
}

function playerCard(v, slot, isMe) {
  const p = v.players[slot], role = v.roles[slot];
  return h('article', { class: `player-card role-${role} ${p?.connected === false ? 'is-away' : ''}` },
    h('div', { class: 'pc-top' },
      h('span', { class: 'label' }, isMe ? 'YOU' : 'PARTNER'),
      h('span', { class: `presence ${p?.connected === false ? 'off' : 'on'}` }, p?.connected === false ? 'connection lost' : 'connected')),
    h('div', { class: 'pc-name' }, p?.name || (isMe ? 'You' : 'Partner')),
    h('div', { class: 'pc-role' }, roleTitle(role)),
    h('p', { class: 'pc-line' }, h('em', {}, roleLine(role))),
    v.ready[slot] ? h('span', { class: 'ready-stamp' }, 'READY!') : null,
    svg(role === 'melody' ? motif.note('var(--lime)') : motif.burst('var(--fuchsia)'), 'pc-icon'));
}

function waitingCard(v, app) {
  return h('article', { class: 'player-card waiting' },
    h('div', { class: 'loader' }, h('i'), h('i'), h('i')),
    h('div', { class: 'pc-name' }, 'Waiting for partner'),
    h('p', {}, 'They\'ll be the ', h('b', {}, roleTitle(v.roles[otherSlot(v.you)])), '.'));
}

function swapControl(app, v) {
  const me = v.you, partner = v.players[otherSlot(me)];
  let inner;
  if (!partner) inner = h('span', { class: 'swap-icon muted' }, '⇄');
  else if (v.swapRequest === me && !app.demo) {
    inner = [h('p', { class: 'small' }, 'Asked to swap…'), h('button', { class: 'btn btn-sm btn-ghost', onclick: () => app.act({ type: 'cancelSwap' }) }, 'Cancel')];
  } else if (v.swapRequest && v.swapRequest !== me) {
    inner = [h('p', { class: 'small strong' }, `${nameOf(v, v.swapRequest)} wants to swap roles`),
      h('button', { class: 'btn btn-sm btn-lime', onclick: () => app.act({ type: 'respondSwap', accept: true }) }, 'Swap'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => app.act({ type: 'respondSwap', accept: false }) }, 'Keep roles')];
  } else {
    inner = h('button', { class: 'btn btn-swap', onclick: () => app.act({ type: 'proposeSwap' }), title: app.demo ? 'Swap roles' : 'Ask your partner to swap roles' },
      h('span', { class: 'swap-icon' }, '⇄'), app.demo ? 'Swap roles' : 'Ask to swap');
  }
  return h('div', { class: 'swap' }, inner);
}

/** Interactive 20-second sound tutorial (local, does not touch the shared game). */
function tutorialBlock(app) {
  let open = false, playing = false, role = 'melody';
  const comp = {
    melody: { notes: [0, -1, 2, -1, 4, -1, -1, -1, 3, -1, 2, -1, -1, -1, -1, -1], instrument: 'softKeys' },
    drums: { pattern: { boom: Array(STEPS).fill(false).map((_, i) => i % 8 === 0), clap: Array(STEPS).fill(false).map((_, i) => i === 4 || i === 12), tss: Array(STEPS).fill(false) }, kit: 'acoustic' },
  };
  const mel = createMelodyGrid({
    editable: true,
    onToggle: (s, p) => { comp.melody.notes[s] = p; mel.set(comp.melody.notes); audio.previewMelody(p, comp.melody.instrument); tick('note'); },
  });
  const drm = createDrumGrid({
    editable: true,
    onToggle: (r, s, on) => { comp.drums.pattern[r][s] = on; drm.set(comp.drums.pattern); if (on) audio.previewDrum(r, comp.drums.kit); tick('note'); },
  });
  mel.set(comp.melody.notes); drm.set(comp.drums.pattern);
  const tl = createTimeline();
  const offStep = audio.onStep(s => { if (playing) { mel.setPlayhead(s); drm.setPlayhead(s); tl.setPlayhead(s); } });
  const done = new Set();
  const tipEls = {};
  const tips = [
    ['note', 'Tap a dot to add a note. Tap it again to remove it.'],
    ['sound', 'Try another sound.'],
    ['play', 'Press play to hear the loop.'],
  ];
  function tick(k) { done.add(k); tipEls[k]?.classList.add('done'); }
  const soundChips = h('div', { class: 'chip-row' });
  function paintChips() {
    soundChips.replaceChildren(...(role === 'melody'
      ? MELODY_INSTRUMENTS.map(i => h('button', { class: `chip-btn ${comp.melody.instrument === i ? 'sel' : ''}`, onclick: async () => { await ensureSound(); comp.melody.instrument = i; audio.previewInstrument(i); tick('sound'); paintChips(); } }, INSTRUMENT_INFO[i].label))
      : DRUM_KITS.map(k => h('button', { class: `chip-btn ${comp.drums.kit === k ? 'sel' : ''}`, onclick: async () => { await ensureSound(); comp.drums.kit = k; audio.previewKit(k); tick('sound'); paintChips(); } }, KIT_INFO[k].label))));
  }
  const playBtn = h('button', { class: 'btn btn-sm btn-play' });
  function paintPlay() { playBtn.replaceChildren(svg(playing ? motif.pause() : motif.play()), playing ? 'Pause' : 'Play loop'); }
  playBtn.onclick = async () => {
    if (!(await ensureSound())) return;
    if (playing) { audio.stop(); playing = false; takeAudio('game'); }
    else { takeAudio('local'); audio.setComposition(comp); audio.setTracks({ melody: true, drums: true, harmony: true }); audio.play(); playing = true; tick('play'); }
    paintPlay();
  };
  paintPlay();
  const gridWrap = h('div', { class: 'tut-grid' });
  const body = h('div', { class: 'tut-body', hidden: true },
    h('div', { class: 'tut-explain' },
      h('p', {}, h('b', {}, 'MELODY'), ' = the tune you could hum. ', h('b', {}, 'DRUMS'), ' = the beat you could tap.'),
      h('ol', { class: 'tips' }, tips.map(([k, t]) => (tipEls[k] = h('li', {}, t)))),
      soundChips, playBtn),
    gridWrap);
  const toggleBtn = h('button', {
    class: 'btn btn-sm btn-ghost', 'aria-expanded': 'false',
    onclick: () => { open = !open; body.hidden = !open; toggleBtn.setAttribute('aria-expanded', String(open)); toggleBtn.textContent = open ? 'Hide tutorial' : 'New here? 20-second sound tutorial'; if (!open && playing) playBtn.click(); },
  }, 'New here? 20-second sound tutorial');
  const el = h('section', { class: 'tutorial sticker-card' }, toggleBtn, body);
  return {
    el,
    setRole(r) {
      if (r === role && gridWrap.childElementCount) return;
      role = r;
      gridWrap.replaceChildren(tl.el, r === 'melody' ? mel.el : drm.el);
      paintChips();
    },
    destroy() { offStep(); if (playing) { audio.stop(); takeAudio('game'); } },
  };
}

// =================================================================== INTRO
export function introScreen(app) {
  const v = app.state;
  const info = ROUND_TYPES[v.roundType];
  const role = v.roles[v.you];
  const count = h('div', { class: 'intro-count', 'aria-live': 'polite' });
  const el = h('main', { class: `intro intro-${v.roundType}` },
    h('div', { class: 'intro-bg halftone-fade' }),
    deco('sparkle', { x: '12%', y: '20%', size: 60, cls: 'float' }),
    deco('star', { x: '80%', y: '70%', size: 64, fill: 'var(--pink)', cls: 'spin' }),
    h('div', { class: 'intro-inner' },
      h('span', { class: 'kicker sticker' }, `ROUND ${String(v.roundIndex + 1).padStart(2, '0')}${v.roundIndex >= 3 ? ' · BONUS' : ''}`),
      v.prompt
        ? [h('h1', { class: 'intro-title' }, h('span', { class: 'small-cap' }, 'YOUR PROMPT:'), h('span', { class: 'prompt-word' }, v.prompt)),
          h('p', { class: 'intro-concept serif' }, `What does ${v.prompt.toLowerCase()} sound like to you?`)]
        : [h('h1', { class: 'intro-title' }, info.title), h('p', { class: 'intro-concept serif' }, info.concept)],
      h('p', { class: `intro-role role-${role}` }, 'You are the ', h('b', {}, roleTitle(role)), ' — ', role === 'melody' ? 'make your melody.' : 'build your beat.'),
      h('p', { class: 'intro-rule' }, info.shared ? 'You can both see and hear everything this round.' : 'Your partner can\'t see or hear what you make until the reveal.'),
      count));
  let t;
  function update() {
    const left = app.state.deadline - app.serverNow();
    setText(count, left > 0 ? `starts in ${Math.ceil(left / 1000)}` : 'go!');
  }
  t = setInterval(update, 200);
  return { el, update, destroy: () => clearInterval(t) };
}

// =================================================================== RESULTS
export function resultsScreen(app) {
  const v0 = app.state;
  const tl = createTimeline();
  const mel = createMelodyGrid({ editable: false });
  const drm = createDrumGrid({ editable: false });
  const offStep = audio.onStep(s => { mel.setPlayhead(s); drm.setPlayhead(s); tl.setPlayhead(s); });
  const nameIn = h('input', { class: 'input input-name', id: 'track-name', maxlength: 40, placeholder: 'e.g. Rainy Bus Window', autocomplete: 'off' });
  let debounce;
  nameIn.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => app.act({ type: 'setTrackName', name: nameIn.value }), 220);
  });
  const agreeRow = h('div', { class: 'agree-row' });
  const credits = h('p', { class: 'credits' });
  const playBtn = h('button', { class: 'btn btn-sm btn-play' });
  const cont = h('div', { class: 'results-actions' });
  const isLastScripted = v0.roundIndex >= 2;

  const el = h('main', { class: 'results' },
    deco('flower', { x: '4%', y: '58%', size: 64, cls: 'spin' }),
    deco('sparkle', { x: '90%', y: '8%', size: 52, fill: 'var(--fuchsia)', cls: 'float' }),
    h('div', { class: 'results-head' },
      h('h1', { class: 'made' }, 'MADE', h('em', { class: 'serif' }, ' together.')),
      v0.prompt ? h('span', { class: 'chip chip-prompt' }, `PROMPT: ${v0.prompt}`) : h('span', { class: 'chip' }, ROUND_TYPES[v0.roundType].title)),
    h('div', { class: 'results-grid' },
      h('section', { class: 'result-viz sticker-card' },
        h('div', { class: 'row space' }, credits, playBtn),
        h('div', { class: 'tracks' }, tl.el,
          h('div', { class: 'track track-melody' }, mel.el),
          h('div', { class: 'track track-drums' }, drm.el))),
      h('section', { class: 'result-name sticker-card' },
        h('label', { for: 'track-name', class: 'name-label' }, 'Give your creation a name.'),
        nameIn,
        h('p', { class: 'hint' }, 'You both see the same name box. Both of you agree to lock it in.'),
        agreeRow,
        h('div', { class: 'row gap-sm wrap' },
          h('button', {
            class: 'btn btn-sm', onclick: () => {
              const j = compositionToJSON(app.state);
              download(`blind-sync-${slug(j.trackName)}.json`, j);
            },
          }, '↓ Download JSON')),
        cont)));

  function update() {
    const v = app.state, me = v.you, ot = otherSlot(me);
    mel.set(v.composition.melody.notes); drm.set(v.composition.drums.pattern);
    const mSlot = v.roles.A === 'melody' ? 'A' : 'B';
    credits.replaceChildren('Melody by ', h('b', {}, nameOf(v, mSlot)), ` · ${INSTRUMENT_INFO[v.composition.melody.instrument].label}`, h('br'),
      'Drums by ', h('b', {}, nameOf(v, otherSlot(mSlot))), ` · ${KIT_INFO[v.composition.drums.kit].label}`);
    if (document.activeElement !== nameIn && nameIn.value !== v.trackName) nameIn.value = v.trackName;
    const agreed = v.nameAgree.A && v.nameAgree.B;
    agreeRow.replaceChildren(
      h('button', {
        class: `btn btn-sm ${v.nameAgree[me] ? 'btn-ready-on' : 'btn-mint'}`,
        disabled: !v.trackName.trim(),
        onclick: () => { clearTimeout(debounce); if (nameIn.value !== v.trackName) app.act({ type: 'setTrackName', name: nameIn.value }); app.act({ type: 'agreeName', agree: !v.nameAgree[me] }); },
      }, v.nameAgree[me] ? '✓ You agreed' : 'I like this name'),
      app.demo ? null : h('span', { class: `agree-status ${v.nameAgree[ot] ? 'yes' : ''}` }, v.nameAgree[ot] ? `${nameOf(v, ot)} agreed ✓` : `${nameOf(v, ot)} hasn't agreed yet`),
      agreed ? h('span', { class: 'chip chip-ok' }, `“${v.trackName}” — locked in`) : null);
    cont.replaceChildren(
      h('button', {
        class: 'btn btn-lg btn-fuchsia', disabled: v.acks[me],
        onclick: () => app.act({ type: 'continue' }),
      }, v.acks[me] ? 'Waiting for partner…' : isLastScripted ? 'Finish & keep creating →' : `On to Round ${v.roundIndex + 2} →`),
      !app.demo && v.acks[ot] && !v.acks[me] ? h('span', { class: 'hint' }, `${nameOf(v, ot)} is ready to continue.`) : null,
      !agreed && v.trackName.trim() === '' ? h('span', { class: 'hint' }, 'No name? It will be saved as "Untitled".') : null);
    playBtn.replaceChildren(svg(audio.playing ? motif.pause() : motif.play()), audio.playing ? 'Pause' : 'Play');
  }
  playBtn.onclick = async () => { await ensureSound(); setUserPaused(audio.playing); update(); };
  return { el, update, destroy: offStep };
}

// =================================================================== KEEP CREATING
export function keepScreen(app) {
  const list = h('div', { class: 'collection' });
  const opts = h('div', { class: 'keep-options' });
  const el = h('main', { class: 'keep' },
    h('div', { class: 'keep-bg halftone-fade' }),
    deco('star', { x: '6%', y: '12%', size: 58, cls: 'spin' }),
    deco('sparkle', { x: '88%', y: '62%', size: 64, fill: 'var(--sky)', cls: 'float' }),
    h('h1', { class: 'keep-title' }, 'KEEP', h('br'), h('em', { class: 'serif' }, 'creating?')),
    opts,
    h('section', { class: 'collection-wrap' }, h('h2', {}, 'This session\'s tracks'), list));
  let playingIdx = null;

  function update() {
    const v = app.state, me = v.you, ot = otherSlot(me);
    const last = v.collection[v.collection.length - 1];
    opts.replaceChildren(
      h('button', { class: 'opt opt-prompt', disabled: v.acks[me], onclick: () => app.act({ type: 'newPrompt' }) },
        h('b', {}, 'New Prompt'), h('span', {}, v.acks[me] ? 'Waiting for partner…' : !app.demo && v.acks[ot] ? `${nameOf(v, ot)} wants another!` : 'A fresh word, a fresh track.')),
      v.swapRequest && v.swapRequest !== me
        ? h('div', { class: 'opt opt-swap' }, h('b', {}, 'Swap roles?'), h('span', {}, `${nameOf(v, v.swapRequest)} asked.`),
          h('div', { class: 'row gap-sm' }, h('button', { class: 'btn btn-sm btn-lime', onclick: () => app.act({ type: 'respondSwap', accept: true }) }, 'Swap'), h('button', { class: 'btn btn-sm btn-ghost', onclick: () => app.act({ type: 'respondSwap', accept: false }) }, 'No thanks')))
        : h('button', { class: 'opt opt-swap', disabled: v.swapRequest === me, onclick: () => app.act({ type: 'proposeSwap' }) },
          h('b', {}, 'Swap Roles'), h('span', {}, v.swapRequest === me ? 'Asked — waiting…' : `Try being the ${v.roles[me] === 'melody' ? 'Beat Maker' : 'Melody Maker'}.`)),
      h('button', { class: 'opt opt-save', onclick: () => last && saveEntry(last) }, h('b', {}, 'Save Composition'), h('span', {}, last ? `Download “${last.name}”.` : 'Nothing yet.')),
      h('button', { class: 'opt opt-home', onclick: () => app.leave() }, h('b', {}, 'Return Home'), h('span', {}, 'End the session.')));

    list.replaceChildren(...v.collection.map((c, i) => h('article', { class: 'col-item' },
      h('span', { class: 'col-n' }, String(i + 1).padStart(2, '0')),
      h('div', { class: 'col-meta' }, h('b', {}, c.name), h('small', {}, `${ROUND_TYPES[c.roundType]?.title || ''}${c.prompt ? ` · ${c.prompt}` : ''} · ${c.players.melody} + ${c.players.drums}`)),
      h('button', {
        class: 'btn btn-sm btn-play', onclick: async () => {
          await ensureSound();
          if (playingIdx === i) { audio.stop(); playingIdx = null; takeAudio('game'); }
          else { takeAudio('local'); audio.setComposition(c.composition); audio.setTracks({ melody: true, drums: true, harmony: true }); audio.play(); playingIdx = i; }
          update();
        },
      }, svg(playingIdx === i ? motif.pause() : motif.play()), playingIdx === i ? 'Stop' : 'Play'),
      h('button', { class: 'btn btn-sm', onclick: () => saveEntry(c) }, '↓ JSON'))));
  }
  return { el, update, destroy() { if (playingIdx != null) { audio.stop(); takeAudio('game'); } } };
}

function saveEntry(c) {
  download(`blind-sync-${slug(c.name)}.json`, {
    app: 'BLIND SYNC', version: 1, savedAt: new Date().toISOString(),
    trackName: c.name, roundType: c.roundType, round: c.round, prompt: c.prompt, players: c.players,
    tempo: c.composition.bpm, steps: STEPS,
    settings: { scale: c.composition.scale, harmony: c.composition.harmony, pitchRows: 5 },
    melody: c.composition.melody, drums: c.composition.drums,
  });
}
