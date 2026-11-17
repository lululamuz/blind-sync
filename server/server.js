// BLIND SYNC — authoritative multiplayer server (Node.js + ws).
// - Holds one game state per room (max two players).
// - Runs all round timers; clients only display them.
// - Sends each player a filtered view, so hidden partner data never reaches the other browser.
// - Also serves ../docs for local development (http://localhost:8080).

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import {
  createRoom, blankPlayer, applyAction, tick, viewFor, onPresenceChange, SLOTS,
} from '../docs/js/shared/game.js';

const PORT = Number(process.env.PORT) || 8080;
const TIME_SCALE = Number(process.env.TIME_SCALE) || 1; // e.g. 0.1 for fast testing
const RECONNECT_GRACE_MS = 90_000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(__dirname, '../docs');

/** @type {Map<string, {room: any, sockets: {A: any, B: any}, tokens: {A: string|null, B: string|null}, timer: any, gone: {A:any,B:any}}>} */
const rooms = new Map();

// ------------------------------------------------------------ static files (dev convenience)
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon',
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
  }
  let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let file = path.join(CLIENT_DIR, p || 'index.html');
  if (!file.startsWith(CLIENT_DIR)) { res.writeHead(403); return res.end(); }
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('BLIND SYNC server is running. Not found.');
  }
});

// ------------------------------------------------------------ helpers
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeCode() {
  let code;
  do {
    code = Array.from(crypto.randomBytes(5), b => CODE_CHARS[b % CODE_CHARS.length]).join('');
  } while (rooms.has(code));
  return code;
}
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

function broadcast(entry) {
  const now = Date.now();
  for (const s of SLOTS) send(entry.sockets[s], { type: 'state', state: viewFor(entry.room, s, now) });
}

function schedule(entry) {
  clearTimeout(entry.timer);
  const dl = entry.room.deadline;
  if (dl == null) return;
  entry.timer = setTimeout(() => {
    if (tick(entry.room, Date.now(), { timeScale: TIME_SCALE })) broadcast(entry);
    schedule(entry);
  }, Math.max(0, dl - Date.now()) + 5);
}

function attach(ws, entry, slot) {
  ws.roomCode = entry.room.code;
  ws.slot = slot;
  const prev = entry.sockets[slot];
  if (prev && prev !== ws) { prev.roomCode = null; try { prev.close(4000, 'Replaced by a new connection'); } catch {} }
  entry.sockets[slot] = ws;
  clearTimeout(entry.gone[slot]);
  entry.room.players[slot].connected = true;
}

/** A player left for good: free their seat. Mid-game, the room falls back to the lobby. */
function freeSeat(entry, s) {
  const room = entry.room;
  clearTimeout(entry.gone[s]);
  room.players[s] = null;
  entry.tokens[s] = null;
  entry.sockets[s] = null;
  if (room.phase !== 'lobby') {
    // An unfinished round is discarded and will be replayed.
    if (['intro', 'create', 'reveal', 'remix', 'results'].includes(room.phase)) {
      room.nextRoundType = room.roundType;
      room.roundIndex -= 1;
    }
    room.phase = 'lobby';
    room.deadline = null;
    room.phaseStartedAt = Date.now();
    room.swapRequest = null;
    clearTimeout(entry.timer);
  }
  room.ready = { A: false, B: false };
  room.acks = { A: false, B: false };
  onPresenceChange(room);
  broadcast(entry);
  destroyIfEmpty(entry);
}

function destroyIfEmpty(entry) {
  const anyone = SLOTS.some(s => entry.room.players[s]);
  if (!anyone) { clearTimeout(entry.timer); rooms.delete(entry.room.code); }
}

// ------------------------------------------------------------ websocket protocol
const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const now = Date.now();

    if (msg.type === 'ping') return send(ws, { type: 'pong', t: msg.t, serverNow: now });

    if (msg.type === 'create') {
      const code = makeCode();
      const entry = { room: createRoom(code, now), sockets: { A: null, B: null }, tokens: { A: null, B: null }, timer: null, gone: {} };
      rooms.set(code, entry);
      entry.room.players.A = blankPlayer(msg.name, 'A');
      entry.tokens.A = crypto.randomUUID();
      attach(ws, entry, 'A');
      send(ws, { type: 'joined', code, slot: 'A', token: entry.tokens.A });
      return broadcast(entry);
    }

    if (msg.type === 'join') {
      const code = String(msg.code || '').toUpperCase().trim();
      const entry = rooms.get(code);
      if (!entry) return send(ws, { type: 'error', code: 'invalid_room', message: "We couldn't find that room code." });
      // Rejoin with token (refresh / dropped connection)
      if (msg.token) {
        const slot = SLOTS.find(s => entry.tokens[s] === msg.token);
        if (slot && entry.room.players[slot]) {
          attach(ws, entry, slot);
          onPresenceChange(entry.room);
          send(ws, { type: 'joined', code, slot, token: msg.token, rejoined: true });
          return broadcast(entry);
        }
      }
      const slot = SLOTS.find(s => !entry.room.players[s]);
      if (!slot) return send(ws, { type: 'error', code: 'room_full', message: 'This room already has two players.' });
      entry.room.players[slot] = blankPlayer(msg.name, slot);
      entry.tokens[slot] = crypto.randomUUID();
      attach(ws, entry, slot);
      onPresenceChange(entry.room);
      send(ws, { type: 'joined', code, slot, token: entry.tokens[slot] });
      return broadcast(entry);
    }

    const entry = ws.roomCode && rooms.get(ws.roomCode);
    if (!entry) return send(ws, { type: 'error', code: 'no_room', message: 'You are not in a room.' });

    if (msg.type === 'leave') {
      freeSeat(entry, ws.slot);
      ws.roomCode = null;
      return;
    }

    if (msg.type === 'action') {
      const res = applyAction(entry.room, ws.slot, msg.action || {}, now, { timeScale: TIME_SCALE });
      entry.room.ackSeq = { ...(entry.room.ackSeq || {}), [ws.slot]: Number(msg.cid) || 0 };
      if (res.error) send(ws, { type: 'error', code: 'action', message: res.error });
      broadcast(entry);
      schedule(entry);
    }
  });

  ws.on('close', () => {
    const entry = ws.roomCode && rooms.get(ws.roomCode);
    if (!entry || entry.sockets[ws.slot] !== ws) return;
    const s = ws.slot;
    entry.sockets[s] = null;
    if (entry.room.players[s]) entry.room.players[s].connected = false;
    onPresenceChange(entry.room);
    broadcast(entry);
    // Free the seat if they don't come back.
    entry.gone[s] = setTimeout(() => {
      if (!entry.sockets[s]) freeSeat(entry, s);
    }, RECONNECT_GRACE_MS);
  });
});

// Heartbeat: drop dead sockets so "connection lost" shows up promptly.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15_000);

server.listen(PORT, () => {
  console.log(`BLIND SYNC server on http://localhost:${PORT}  (ws on same port${TIME_SCALE !== 1 ? `, TIME_SCALE=${TIME_SCALE}` : ''})`);
});
