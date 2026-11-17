// Sessions: OnlineSession talks to the Node/ws server; DemoSession runs the same
// game logic locally (clearly labelled LOCAL DEMO — no networking pretended).

import {
  createRoom, blankPlayer, applyAction, tick, viewFor, slotForRole, otherSlot,
} from './shared/game.js';

const EDIT_TYPES = new Set(['editMelody', 'editDrum', 'setInstrument', 'setKit']);

/** Apply an optimistic edit to a view (client-side prediction). */
export function predict(view, a) {
  const c = view.composition;
  if (a.type === 'editMelody' && c.melody) c.melody.notes[a.step] = a.pitch;
  if (a.type === 'editDrum' && c.drums) c.drums.pattern[a.row][a.step] = a.on;
  if (a.type === 'setInstrument' && c.melody) c.melody.instrument = a.instrument;
  if (a.type === 'setKit' && c.drums) c.drums.kit = a.kit;
}

export class OnlineSession {
  constructor(url, handlers) {
    this.url = url;
    this.h = handlers; // { onState, onError, onStatus, onJoined }
    this.mode = 'online';
    this.offset = 0; // serverNow - Date.now()
    this.cid = 0;
    this.pending = [];
    this.status = 'connecting';
    this.closedByUser = false;
    this.retry = 0;
    this.code = null; this.slot = null; this.token = null;
    this.intent = null;
  }

  _setStatus(s) { this.status = s; this.h.onStatus?.(s); }

  _open() {
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { return reject(e); }
      this.ws = ws;
      const failTimer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 8000);
      ws.onopen = () => {
        clearTimeout(failTimer);
        this.retry = 0;
        this._setStatus('online');
        this._sync();
        resolve();
      };
      ws.onerror = () => {};
      ws.onclose = () => {
        clearTimeout(failTimer);
        if (this.closedByUser) return;
        if (this.status === 'connecting') return reject(new Error('closed'));
        this._setStatus('reconnecting');
        this._reconnectLater();
      };
      ws.onmessage = e => this._onMessage(JSON.parse(e.data));
    });
  }

  _reconnectLater() {
    const wait = Math.min(8000, 600 * 2 ** this.retry++);
    setTimeout(async () => {
      if (this.closedByUser) return;
      try {
        await this._open();
        if (this.code && this.token) this._send({ type: 'join', code: this.code, token: this.token });
      } catch { this._reconnectLater(); }
    }, wait);
  }

  _sync() { // estimate clock offset (NTP-lite)
    for (let i = 0; i < 3; i++) setTimeout(() => this._send({ type: 'ping', t: Date.now() }), i * 300);
  }

  _send(m) { if (this.ws?.readyState === 1) { this.ws.send(JSON.stringify(m)); return true; } return false; }

  _onMessage(m) {
    if (m.type === 'pong') {
      const now = Date.now(), rtt = now - m.t;
      const est = m.serverNow + rtt / 2 - now;
      if (this._bestRtt == null || rtt <= this._bestRtt) { this._bestRtt = rtt; this.offset = est; }
      return;
    }
    if (m.type === 'joined') {
      this.code = m.code; this.slot = m.slot; this.token = m.token;
      try { sessionStorage.setItem('blindsync.session', JSON.stringify({ code: m.code, token: m.token, url: this.url })); } catch {}
      this.h.onJoined?.(m);
      return;
    }
    if (m.type === 'error') {
      if (m.code === 'invalid_room' || m.code === 'room_full') {
        try { sessionStorage.removeItem('blindsync.session'); } catch {}
      }
      this.h.onError?.(m);
      return;
    }
    if (m.type === 'state') {
      const v = m.state;
      if (this._bestRtt == null) this.offset = v.serverNow - Date.now();
      this.pending = this.pending.filter(p => p.cid > v.ackSeq);
      for (const p of this.pending) predict(v, p.action);
      this.h.onState?.(v);
    }
  }

  async create(name) {
    await this._open();
    this._send({ type: 'create', name });
  }
  async join(code, name, token) {
    await this._open();
    this._send({ type: 'join', code, name, token });
  }
  act(action) {
    const cid = ++this.cid;
    if (EDIT_TYPES.has(action.type)) this.pending.push({ cid, action });
    if (!this._send({ type: 'action', cid, action })) this.h.onError?.({ code: 'offline', message: 'Not connected — your change was not sent.' });
  }
  leave() {
    this.closedByUser = true;
    this._send({ type: 'leave' });
    try { sessionStorage.removeItem('blindsync.session'); } catch {}
    setTimeout(() => this.ws?.close(), 50);
  }
}

/** One person, both seats, same rules. */
export class DemoSession {
  constructor(handlers) {
    this.h = handlers;
    this.mode = 'demo';
    this.offset = 0;
    this.status = 'online';
    const now = Date.now();
    this.room = createRoom('DEMO', now);
    this.room.players.A = blankPlayer('You', 'A');
    this.room.players.B = blankPlayer('You (seat 2)', 'B');
    this.seat = 'A';
    this.code = 'DEMO';
    this.slot = 'A';
    this.timer = null;
  }
  start() { this._emit(); }
  _emit() {
    this.slot = this.seat;
    this.h.onState?.(viewFor(this.room, this.seat, Date.now()));
    clearTimeout(this.timer);
    if (this.room.deadline != null) {
      this.timer = setTimeout(() => { if (tick(this.room, Date.now())) this._emit(); else this._emit(); }, Math.max(0, this.room.deadline - Date.now()) + 5);
    }
  }
  switchSeat() { this.seat = otherSlot(this.seat); this._emit(); }
  act(a) {
    const r = this.room, now = Date.now();
    const both = ['setReady', 'doneCreating', 'skipReveal', 'doneRemix', 'agreeName', 'continue', 'newPrompt'];
    let res;
    if (both.includes(a.type)) {
      res = applyAction(r, 'A', a, now);
      if (!res.error && !(a.type === 'setReady' && r.phase !== 'lobby' && r.phase !== 'roles')) applyAction(r, 'B', a, now);
    } else if (a.type === 'proposeSwap') {
      res = applyAction(r, 'A', a, now);
      if (!res.error) res = applyAction(r, 'B', { type: 'respondSwap', accept: true }, now);
    } else if (['editMelody', 'setInstrument'].includes(a.type)) {
      res = applyAction(r, slotForRole(r, 'melody'), a, now);
    } else if (['editDrum', 'setKit'].includes(a.type)) {
      res = applyAction(r, slotForRole(r, 'drums'), a, now);
    } else if (a.type === 'resetTrack') {
      res = applyAction(r, slotForRole(r, a.role || r.roles[this.seat]), a, now);
    } else {
      res = applyAction(r, this.seat, a, now);
    }
    if (res?.error) this.h.onError?.({ code: 'action', message: res.error });
    this._emit();
  }
  leave() { clearTimeout(this.timer); }
}
