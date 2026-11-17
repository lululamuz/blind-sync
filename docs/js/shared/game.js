// BLIND SYNC — shared game logic.
// Pure state machine used by BOTH the Node server (authoritative multiplayer)
// and the in-browser Local Demo driver. No DOM, no Node APIs.

export const STEPS = 16;
export const PITCH_COUNT = 5;
export const DRUM_ROWS = ['boom', 'clap', 'tss'];
export const BPM = 100;
export const SLOTS = ['A', 'B'];

export const MELODY_INSTRUMENTS = ['softKeys', 'brightSynth', 'pluck', 'dreamy'];
export const DRUM_KITS = ['acoustic', 'electronic', 'soft'];

export const ROUND_TYPES = {
  blind: {
    key: 'blind', number: 1, title: 'Blind Creation', seconds: 90, shared: false,
    concept: "Create without knowing what your partner is making.",
  },
  communicate: {
    key: 'communicate', number: 2, title: 'Communicate', seconds: 90, shared: true,
    concept: 'Now you can see and hear each other.',
  },
  prompt: {
    key: 'prompt', number: 3, title: 'Prompt Challenge', seconds: 120, shared: false,
    concept: 'Same prompt. Different interpretations.',
  },
};
export const ROUND_SEQUENCE = ['blind', 'communicate', 'prompt'];

export const PROMPTS = [
  'RAIN', 'HAPPY', 'MONSTROUS', 'DREAM', 'CHAOS', 'NOSTALGIA', 'SPACE',
  'SUNSHINE', 'LONELY', 'MAGIC', 'OCEAN', 'MIDNIGHT',
];

export const INTRO_MS = 4500;
export const PROMPT_INTRO_MS = 6000;
// Reveal: "time's up" → melody alone → drums alone → together (each stage ≈ 1 loop)
export const REVEAL_STAGES = [
  { key: 'timesup', ms: 1600 },
  { key: 'melody', ms: 2400 * 1.5 },
  { key: 'drums', ms: 2400 * 1.5 },
  { key: 'together', ms: 3200 },
];
export const REVEAL_MS = REVEAL_STAGES.reduce((s, x) => s + x.ms, 0);
export const QUICK_MESSAGES = ['Love this!', 'More energy!', 'Try softer', "Let's change it", 'Keep this!', 'Nice!'];
export const REACTIONS = ['heart', 'spark', 'fire', 'wow'];

// ---------------------------------------------------------------- factories

export function starterMelody() {
  // pitch index per step (0 = lowest row), -1 = rest
  return [2, -1, 3, -1, 4, -1, 3, -1, 2, -1, -1, 1, 0, -1, -1, -1];
}
export function starterDrums() {
  const p = {};
  for (const r of DRUM_ROWS) p[r] = Array(STEPS).fill(false);
  [0, 8, 10].forEach(i => (p.boom[i] = true));
  [4, 12].forEach(i => (p.clap[i] = true));
  for (let i = 0; i < STEPS; i += 2) p.tss[i] = true;
  return p;
}
export function emptyDrums() {
  const p = {};
  for (const r of DRUM_ROWS) p[r] = Array(STEPS).fill(false);
  return p;
}

export function newComposition(prev) {
  return {
    bpm: BPM,
    scale: 'C major pentatonic',
    harmony: 'C – Am – F – G',
    melody: { notes: starterMelody(), instrument: prev?.melody?.instrument || 'softKeys' },
    drums: { pattern: starterDrums(), kit: prev?.drums?.kit || 'acoustic' },
  };
}

export function createRoom(code, now) {
  return {
    code,
    createdAt: now,
    players: { A: null, B: null },
    roles: { A: 'melody', B: 'drums' },
    phase: 'lobby',
    phaseStartedAt: now,
    deadline: null,
    roundIndex: -1, // index into game rounds played; 0,1,2 then endless prompt rounds
    roundType: null,
    nextRoundType: 'blind',
    prompt: null,
    usedPrompts: [],
    loopEpoch: now,
    composition: newComposition(),
    ready: { A: false, B: false },
    acks: { A: false, B: false },
    swapRequest: null,
    chat: [],
    reactions: [],
    trackName: '',
    nameAgree: { A: false, B: false },
    collection: [],
    seq: 0,
  };
}

export function blankPlayer(name, id) {
  return { id, name: (name || '').slice(0, 18) || null, connected: true };
}

export function otherSlot(s) { return s === 'A' ? 'B' : 'A'; }
export function slotForRole(room, role) { return room.roles.A === role ? 'A' : 'B'; }
export function bothPresent(room) { return !!(room.players.A && room.players.B); }
export function roundInfo(room) { return room.roundType ? ROUND_TYPES[room.roundType] : null; }

function resetFlags(room) {
  room.ready = { A: false, B: false };
  room.acks = { A: false, B: false };
}

function setPhase(room, phase, now, ms = null) {
  room.phase = phase;
  room.phaseStartedAt = now;
  room.deadline = ms == null ? null : now + ms;
  room.acks = { A: false, B: false };
}

function pickPrompt(room, rand) {
  let pool = PROMPTS.filter(p => !room.usedPrompts.includes(p));
  if (!pool.length) { room.usedPrompts = []; pool = PROMPTS.slice(); }
  const p = pool[Math.floor(rand() * pool.length)];
  room.usedPrompts.push(p);
  return p;
}

function startRound(room, now, rand, scale) {
  room.roundIndex += 1;
  room.roundType = room.nextRoundType;
  room.prompt = room.roundType === 'prompt' ? pickPrompt(room, rand) : null;
  room.composition = newComposition(room.composition);
  room.trackName = '';
  room.nameAgree = { A: false, B: false };
  room.chat = room.chat.slice(-40);
  resetFlags(room);
  setPhase(room, 'intro', now, (room.prompt ? PROMPT_INTRO_MS : INTRO_MS) * scale);
}

// ------------------------------------------------------------- transitions

/** Advance timed phases. Returns true if state changed. */
export function tick(room, now, opts = {}) {
  const scale = opts.timeScale ?? 1;
  if (room.deadline == null || now < room.deadline) return false;
  const info = roundInfo(room);
  switch (room.phase) {
    case 'intro':
      setPhase(room, 'create', now, info.seconds * 1000 * scale);
      room.loopEpoch = now;
      return true;
    case 'create':
      endCreate(room, now, scale);
      return true;
    case 'reveal':
      setPhase(room, 'remix', now, null);
      return true;
  }
  return false;
}

function endCreate(room, now, scale) {
  const info = roundInfo(room);
  if (info.shared) {
    setPhase(room, 'remix', now, null);
  } else {
    setPhase(room, 'reveal', now, REVEAL_MS * Math.max(scale, 0.25));
    room.loopEpoch = now + REVEAL_STAGES[0].ms; // melody starts on the downbeat of stage 2
  }
}

function archive(room) {
  const c = room.composition;
  room.collection.push({
    name: room.trackName.trim() || `Untitled #${room.roundIndex + 1}`,
    round: room.roundIndex + 1,
    roundType: room.roundType,
    prompt: room.prompt,
    players: {
      melody: room.players[slotForRole(room, 'melody')]?.name || 'Melody Maker',
      drums: room.players[slotForRole(room, 'drums')]?.name || 'Beat Maker',
    },
    composition: JSON.parse(JSON.stringify(c)),
  });
}

/**
 * Apply a player action. Returns { ok: true } or { error }.
 * Mutates room.
 */
export function applyAction(room, slot, a, now, opts = {}) {
  const scale = opts.timeScale ?? 1;
  const rand = opts.rand ?? Math.random;
  const role = room.roles[slot];
  const ph = room.phase;
  const info = roundInfo(room);
  const comp = room.composition;
  const err = e => ({ error: e });
  const canEditPhase = ph === 'create' || ph === 'remix';
  room.seq++;

  switch (a.type) {
    // ---------- lobby / role negotiation
    case 'setReady': {
      if (!['lobby', 'roles'].includes(ph)) return err('Not in a ready phase');
      room.ready[slot] = !!a.ready;
      if (room.ready.A && room.ready.B && bothPresent(room)) {
        room.swapRequest = null;
        startRound(room, now, rand, scale);
      }
      return { ok: true };
    }
    case 'proposeSwap': {
      if (!['lobby', 'roles', 'keep'].includes(ph)) return err('Roles can only change between rounds');
      if (!bothPresent(room)) return err('Wait for your partner first');
      room.swapRequest = slot;
      room.ready = { A: false, B: false };
      return { ok: true };
    }
    case 'cancelSwap': {
      if (room.swapRequest === slot) room.swapRequest = null;
      return { ok: true };
    }
    case 'respondSwap': {
      if (!room.swapRequest || room.swapRequest === slot) return err('No swap to answer');
      if (a.accept) room.roles = { A: room.roles.B, B: room.roles.A };
      room.swapRequest = null;
      room.ready = { A: false, B: false };
      if (ph === 'keep' && a.accept) { room.nextRoundType = 'prompt'; setPhase(room, 'roles', now); }
      return { ok: true };
    }

    // ---------- music editing
    case 'editMelody': {
      if (!canEditPhase) return err('Editing is locked');
      if (role !== 'melody') return err('Only the Melody Maker edits the melody');
      const s = a.step | 0, p = a.pitch | 0;
      if (s < 0 || s >= STEPS || p < -1 || p >= PITCH_COUNT) return err('Bad note');
      comp.melody.notes[s] = p;
      return { ok: true };
    }
    case 'editDrum': {
      if (!canEditPhase) return err('Editing is locked');
      if (role !== 'drums') return err('Only the Beat Maker edits the drums');
      if (!DRUM_ROWS.includes(a.row)) return err('Bad row');
      const s = a.step | 0;
      if (s < 0 || s >= STEPS) return err('Bad step');
      comp.drums.pattern[a.row][s] = !!a.on;
      return { ok: true };
    }
    case 'setInstrument': {
      if (role !== 'melody') return err('Not your track');
      if (!MELODY_INSTRUMENTS.includes(a.instrument)) return err('Unknown instrument');
      comp.melody.instrument = a.instrument;
      return { ok: true };
    }
    case 'setKit': {
      if (role !== 'drums') return err('Not your track');
      if (!DRUM_KITS.includes(a.kit)) return err('Unknown kit');
      comp.drums.kit = a.kit;
      return { ok: true };
    }
    case 'resetTrack': {
      if (!canEditPhase) return err('Editing is locked');
      if (role === 'melody') comp.melody.notes = a.clear ? Array(STEPS).fill(-1) : starterMelody();
      else comp.drums.pattern = a.clear ? emptyDrums() : starterDrums();
      return { ok: true };
    }

    // ---------- flow acks
    case 'doneCreating': { // "I'm done" during timed creation; both done → ends early
      if (ph !== 'create') return err('Not creating');
      room.acks[slot] = !!a.done;
      if (room.acks.A && room.acks.B) endCreate(room, now, scale);
      return { ok: true };
    }
    case 'skipReveal': {
      if (ph !== 'reveal') return { ok: true };
      room.acks[slot] = true;
      if (room.acks.A && room.acks.B) setPhase(room, 'remix', now, null);
      return { ok: true };
    }
    case 'doneRemix': {
      if (ph !== 'remix') return err('Not remixing');
      room.acks[slot] = !!a.done;
      if (room.acks.A && room.acks.B) {
        setPhase(room, 'results', now, null);
        room.nameAgree = { A: false, B: false };
      }
      return { ok: true };
    }
    case 'setTrackName': {
      if (ph !== 'results') return err('Not naming');
      const n = String(a.name || '').slice(0, 40);
      if (n !== room.trackName) room.nameAgree = { A: false, B: false };
      room.trackName = n;
      return { ok: true };
    }
    case 'agreeName': {
      if (ph !== 'results') return err('Not naming');
      room.nameAgree[slot] = !!a.agree && room.trackName.trim().length > 0;
      return { ok: true };
    }
    case 'continue': { // from results → role check (or keep-creating after round 3)
      if (ph !== 'results') return err('Not on results');
      room.acks[slot] = true;
      if (room.acks.A && room.acks.B) {
        archive(room);
        const nextIdx = room.roundIndex + 1;
        if (nextIdx < ROUND_SEQUENCE.length) {
          room.nextRoundType = ROUND_SEQUENCE[nextIdx];
          resetFlags(room);
          setPhase(room, 'roles', now);
        } else {
          resetFlags(room);
          setPhase(room, 'keep', now);
        }
      }
      return { ok: true };
    }
    case 'newPrompt': {
      if (ph !== 'keep') return err('Not now');
      room.acks[slot] = true;
      if (room.acks.A && room.acks.B) {
        room.nextRoundType = 'prompt';
        resetFlags(room);
        setPhase(room, 'roles', now);
      }
      return { ok: true };
    }

    // ---------- communication (shared phases only)
    case 'chat': {
      const sharedNow = (ph === 'create' && info?.shared) || ['remix', 'results', 'keep', 'roles', 'lobby'].includes(ph);
      if (!sharedNow) return err('Chat is closed during blind creation');
      const text = String(a.text || '').trim().slice(0, 140);
      if (!text) return err('Empty');
      room.chat.push({ id: room.seq, from: slot, text, at: now, quick: !!a.quick });
      if (room.chat.length > 80) room.chat.shift();
      return { ok: true };
    }
    case 'react': {
      if (!REACTIONS.includes(a.kind)) return err('Unknown reaction');
      const sharedNow = (ph === 'create' && info?.shared) || ['remix', 'results'].includes(ph);
      if (!sharedNow) return err('Not now');
      room.reactions.push({ id: room.seq, from: slot, kind: a.kind, at: now });
      room.reactions = room.reactions.filter(r => now - r.at < 4000);
      return { ok: true };
    }
  }
  return err('Unknown action');
}

/** Called when a player joins / leaves */
export function onPresenceChange(room) {
  if (!bothPresent(room) || !room.players.A?.connected || !room.players.B?.connected) {
    if (['lobby', 'roles'].includes(room.phase)) room.ready = { A: false, B: false };
  }
}

/**
 * What a given player is allowed to see.
 * During blind creation, the partner's track is removed entirely — it never leaves the server.
 */
export function viewFor(room, slot, now) {
  const v = JSON.parse(JSON.stringify(room));
  delete v.usedPrompts;
  for (const s of SLOTS) if (v.players[s]) delete v.players[s].id;
  const info = roundInfo(room);
  const blind = info && !info.shared && (room.phase === 'intro' || room.phase === 'create');
  if (blind) {
    const mine = room.roles[slot];
    if (mine === 'melody') v.composition.drums = null;
    else v.composition.melody = null;
  }
  v.blind = !!blind;
  v.you = slot;
  v.ackSeq = (room.ackSeq || {})[slot] || 0;
  v.serverNow = now;
  v.reactions = room.reactions.filter(r => now - r.at < 4000);
  return v;
}

export function compositionToJSON(room) {
  return {
    app: 'BLIND SYNC',
    version: 1,
    savedAt: new Date().toISOString(),
    trackName: room.trackName?.trim() || 'Untitled',
    roundType: room.roundType,
    round: room.roundIndex + 1,
    prompt: room.prompt,
    tempo: room.composition.bpm,
    steps: STEPS,
    settings: { scale: room.composition.scale, harmony: room.composition.harmony, pitchRows: PITCH_COUNT },
    melody: { notes: room.composition.melody.notes, instrument: room.composition.melody.instrument },
    drums: { pattern: room.composition.drums.pattern, kit: room.composition.drums.kit },
  };
}

/** Validates and normalises an imported composition JSON. Returns composition or throws. */
export function parseCompositionJSON(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Not a composition file');
  const notes = obj.melody?.notes;
  const pat = obj.drums?.pattern;
  if (!Array.isArray(notes) || notes.length !== STEPS) throw new Error('Melody is missing or the wrong length');
  if (!pat || !DRUM_ROWS.every(r => Array.isArray(pat[r]) && pat[r].length === STEPS)) throw new Error('Drum pattern is missing');
  return {
    trackName: String(obj.trackName || 'Untitled').slice(0, 40),
    prompt: obj.prompt || null,
    roundType: obj.roundType || null,
    composition: {
      bpm: Number(obj.tempo) || BPM,
      scale: obj.settings?.scale || 'C major pentatonic',
      harmony: obj.settings?.harmony || 'C – Am – F – G',
      melody: {
        notes: notes.map(n => Math.max(-1, Math.min(PITCH_COUNT - 1, n | 0))),
        instrument: MELODY_INSTRUMENTS.includes(obj.melody.instrument) ? obj.melody.instrument : 'softKeys',
      },
      drums: {
        pattern: Object.fromEntries(DRUM_ROWS.map(r => [r, pat[r].map(Boolean)])),
        kit: DRUM_KITS.includes(obj.drums.kit) ? obj.drums.kit : 'acoustic',
      },
    },
  };
}
