// BLIND SYNC — app controller: routing between screens, header, audio orchestration.
import { h, $, svg, motif, toast, confirmDialog, toggle, setText } from './ui/dom.js';
import { audio } from './audio.js';
import { OnlineSession, DemoSession } from './net.js';
import { serverURL } from './config.js';
import { ROUND_TYPES, otherSlot } from './shared/game.js';
import { homeScreen } from './screens/home.js';
import { gateScreen, lobbyScreen, introScreen, resultsScreen, keepScreen, connectingScreen } from './screens/room.js';
import { workspaceScreen } from './screens/workspace.js';
import { replayScreen } from './screens/replay.js';

export const app = {
  route: 'home',          // home | gate | replay | room
  gate: { mode: 'create', code: '', error: null, busy: false },
  replay: null,
  session: null,
  state: null,
  screen: null,
  screenKey: null,
  userPaused: false,
  audioOwner: 'game',     // 'game' | 'local' (tutorial / replay / previews own the loop)
  lastEpoch: null,

  serverNow() { return Date.now() + (this.session?.offset || 0); },
  get me() { return this.state?.you; },
  get myRole() { return this.state ? this.state.roles[this.state.you] : null; },
  get partner() { return this.state ? this.state.players[otherSlot(this.state.you)] : null; },
  get demo() { return this.session?.mode === 'demo'; },
  act(a) { this.session?.act(a); },

  go(route, extra = {}) {
    Object.assign(this, extra);
    this.route = route;
    if (route !== 'room') { this.audioOwner = 'local'; audio.stop(); }
    render();
    window.scrollTo({ top: 0 });
  },

  async createRoom(name) {
    await ensureSound();
    this.gate.busy = true; this.gate.error = null; render();
    const s = this._newSession();
    try { await s.create(name); }
    catch { this._connectFailed(); }
  },
  async joinRoom(code, name, token) {
    await ensureSound();
    this.gate.busy = true; this.gate.error = null; render();
    const s = this._newSession();
    try { await s.join(code.toUpperCase().trim(), name, token); }
    catch { this._connectFailed(); }
  },
  async startDemo() {
    await ensureSound();
    this.session?.leave();
    this.session = new DemoSession(handlers);
    this.route = 'room';
    this.audioOwner = 'game';
    this.session.start();
  },
  async leave(ask = true) {
    if (ask && this.session) {
      const midGame = this.state && !['lobby'].includes(this.state.phase);
      const ok = await confirmDialog({
        title: 'Leave the room?',
        body: midGame ? 'Your current round will stop for both of you, and unsaved music will be lost.' : 'Your partner will be left waiting in the room.',
      });
      if (!ok) return;
    }
    this.session?.leave();
    this.session = null; this.state = null; this.lastEpoch = null;
    this.gate = { mode: 'create', code: '', error: null, busy: false };
    history.replaceState(null, '', location.pathname);
    this.go('home');
  },
  _newSession() {
    this.session?.leave();
    this.session = new OnlineSession(serverURL(), handlers);
    return this.session;
  },
  _connectFailed() {
    this.session = null;
    this.gate.busy = false;
    this.gate.error = "Can't reach the BLIND SYNC server. If it's hosted on Render's free tier it may be waking up — try again in 30 seconds, or use Local Demo.";
    this.route = 'gate';
    render();
  },
};

const handlers = {
  onJoined(m) {
    app.route = 'room';
    app.audioOwner = 'game';
    app.gate.busy = false;
    const url = new URL(location.href);
    url.searchParams.set('room', m.code);
    history.replaceState(null, '', url);
    if (m.rejoined) toast('Reconnected to your room');
  },
  onState(v) {
    const prev = app.state;
    app.state = v;
    if (app.route !== 'room') app.route = 'room';
    if (prev && prev.phase !== v.phase) app.userPaused = false;
    render();
    syncAudio();
  },
  onError(m) {
    if (['invalid_room', 'room_full'].includes(m.code)) {
      app.session?.leave();
      app.session = null;
      app.gate.busy = false;
      app.gate.mode = 'join';
      app.gate.error = m.code === 'room_full'
        ? 'That room is full — BLIND SYNC rooms are for exactly two players.'
        : "That room code doesn't exist (or the room has closed). Check the code with your partner.";
      app.route = 'gate';
      render();
    } else toast(m.message, 'warn');
  },
  onStatus(s) {
    renderHeader();
    if (s === 'reconnecting') toast('Connection lost — reconnecting…', 'warn');
  },
};

// ------------------------------------------------------------------ audio
export async function ensureSound() {
  if (!audio.available) { toast('Sound engine failed to load (check your internet connection).', 'warn'); return false; }
  const ok = await audio.start();
  if (audio.muted) audio.setMuted(false);
  renderHeader();
  return ok;
}

function syncAudio() {
  const v = app.state;
  if (!v || app.route !== 'room' || app.audioOwner !== 'game') return;
  audio.setComposition(v.composition);
  const playPhases = ['create', 'reveal', 'remix', 'results'];
  if (v.phase !== 'reveal') audio.setTracks({ melody: true, drums: true, harmony: true });
  const shouldPlay = playPhases.includes(v.phase) && audio.started && !app.userPaused;
  if (shouldPlay) {
    if (!audio.playing || app.lastEpoch !== v.loopEpoch) {
      audio.play(v.loopEpoch, app.session.offset);
      app.lastEpoch = v.loopEpoch;
    }
  } else if (audio.playing) {
    audio.stop();
    app.lastEpoch = null;
  }
}
export function setUserPaused(p) {
  app.userPaused = p;
  if (p) audio.pause();
  else { app.lastEpoch = null; syncAudio(); }
}
export function takeAudio(owner) { // 'local' for tutorial/replay, 'game' to give it back
  app.audioOwner = owner;
  if (owner === 'game') { app.lastEpoch = null; syncAudio(); }
}

// ------------------------------------------------------------------ header
const header = $('#site-header');
function renderHeader() {
  const inRoom = app.route === 'room' && app.state;
  const v = app.state;
  header.replaceChildren(
    h('a', {
      class: 'wordmark-sm', href: '#', 'aria-label': 'BLIND SYNC home',
      onclick: e => { e.preventDefault(); inRoom || app.session ? app.leave() : app.go('home'); },
    }, 'BLIND SYNC', h('span', { class: 'dot' }, '.')),
    inRoom ? h('div', { class: 'hdr-chips' },
      app.demo ? h('span', { class: 'chip chip-demo', title: 'Local Demo: one person plays both seats. No networking.' }, 'LOCAL DEMO') :
        h('span', { class: 'chip chip-code' }, 'ROOM ', h('b', {}, v.code)),
      v.roundType ? h('span', { class: 'chip' }, `ROUND ${v.roundIndex + 1}`) : null,
      h('span', { class: `chip chip-role role-${app.myRole}` }, app.myRole === 'melody' ? 'You: Melody Maker' : 'You: Beat Maker'),
      !app.demo && app.partner?.connected === false ? h('span', { class: 'chip chip-partner-off', role: 'status' }, 'Partner offline — waiting for them to rejoin') : null,
      !app.demo && !app.partner ? h('span', { class: 'chip' }, 'Waiting for partner') : null,
      !app.demo ? h('span', { class: `conn conn-${app.session?.status}`, title: `Connection: ${app.session?.status}` },
        h('i', {}), app.session?.status === 'online' ? 'Online' : 'Reconnecting…') : null,
    ) : h('nav', { class: 'hdr-nav' },
      h('a', { href: '#how', onclick: navTo('how') }, 'How to Play'),
      h('a', { href: '#about', onclick: navTo('about') }, 'About'),
    ),
    h('div', { class: 'hdr-right' },
      soundButton(),
      inRoom ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => app.leave() }, 'Leave') : null,
    ),
  );
}
function navTo(id) {
  return e => {
    e.preventDefault();
    const go = () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    if (app.route !== 'home') { app.go('home'); setTimeout(go, 50); } else go();
  };
}
function soundButton() {
  const on = audio.started && !audio.muted;
  return h('button', {
    class: `btn btn-sound btn-sm ${on ? 'on' : 'off'}`,
    'aria-pressed': on ? 'true' : 'false',
    onclick: async () => {
      if (!audio.started) await ensureSound();
      else audio.setMuted(!audio.muted);
      renderHeader();
      syncAudio();
    },
  }, svg(motif.speaker(on)), on ? 'Sound on' : audio.started ? 'Muted' : 'Turn sound on');
}
audio.onState(() => { renderHeader(); document.body.classList.toggle('is-muted', audio.muted); });

// ------------------------------------------------------------------ routing
function keyFor() {
  if (app.route !== 'room') return app.route;
  const v = app.state;
  if (!v) return 'connecting';
  switch (v.phase) {
    case 'lobby': case 'roles': return 'lobby';
    case 'intro': return `intro:${v.roundIndex}`;
    case 'create': case 'reveal': case 'remix': return `ws:${v.roundIndex}`;
    case 'results': return `results:${v.roundIndex}`;
    case 'keep': return 'keep';
  }
  return v.phase;
}
const factories = {
  home: homeScreen, gate: gateScreen, replay: replayScreen, connecting: connectingScreen,
  lobby: lobbyScreen, intro: introScreen, ws: workspaceScreen, results: resultsScreen, keep: keepScreen,
};

const root = $('#app');
export function render() {
  renderHeader();
  const key = keyFor();
  const base = key.split(':')[0];
  if (key !== app.screenKey) {
    app.screen?.destroy?.();
    app.screenKey = key;
    app.screen = factories[base](app);
    const el = app.screen.el;
    el.classList.add('screen', 'screen-enter');
    root.replaceChildren(el);
    requestAnimationFrame(() => el.classList.remove('screen-enter'));
    document.body.dataset.screen = base;
    const focusTarget = el.querySelector('h1, h2');
    if (focusTarget) { focusTarget.setAttribute('tabindex', '-1'); focusTarget.focus({ preventScroll: true }); }
  }
  app.screen.update?.(app);
  document.body.dataset.phase = app.state?.phase || '';
}

// ------------------------------------------------------------------ boot
(function boot() {
  document.body.classList.toggle('no-audio', !audio.available);
  const params = new URLSearchParams(location.search);
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem('blindsync.session') || 'null'); } catch {}
  const room = params.get('room');
  if (saved && (!room || room === saved.code)) {
    // Page refresh: quietly rejoin the same seat.
    app.route = 'room';
    render();
    app.session = new OnlineSession(saved.url || serverURL(), handlers);
    app.session.join(saved.code, '', saved.token).catch(() => app._connectFailed());
    return;
  }
  if (room) { app.gate.mode = 'join'; app.gate.code = room.toUpperCase(); app.route = 'gate'; }
  render();
})();
