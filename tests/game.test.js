// Plays a full 3-round game through the shared game logic (no browser, no server).
import assert from 'node:assert/strict';
import * as G from '../docs/js/shared/game.js';

let t = 0;
const r = G.createRoom('TEST', t);
r.players.A = G.blankPlayer('Lulu', 'A');
r.players.B = G.blankPlayer('Sam', 'B');
const act = (s, a) => G.applyAction(r, s, a, t);
const both = a => { act('A', a); act('B', a); };

both({ type: 'setReady', ready: true });
assert.equal(r.phase, 'intro'); assert.equal(r.roundType, 'blind');
t += 5000; G.tick(r, t); assert.equal(r.phase, 'create');

// Blind privacy: each player's view contains only their own track.
assert.equal(G.viewFor(r, 'A', t).composition.drums, null);
assert.equal(G.viewFor(r, 'B', t).composition.melody, null);
// Ownership: A (melody) cannot edit drums.
assert.ok(act('A', { type: 'editDrum', row: 'boom', step: 1, on: true }).error);
assert.ok(act('A', { type: 'editMelody', step: 1, pitch: 4 }).ok);

t += 91_000; G.tick(r, t); assert.equal(r.phase, 'reveal');
assert.equal(G.viewFor(r, 'B', t).composition.melody.notes[1], 'A4', 'revealed after time is up (v1 pitch index → A4)');
t += 20_000; G.tick(r, t); assert.equal(r.phase, 'remix');
both({ type: 'doneRemix', done: true }); assert.equal(r.phase, 'results');
act('A', { type: 'setTrackName', name: 'Rainy Bus Window' });
both({ type: 'continue' }); assert.equal(r.phase, 'roles'); assert.equal(r.collection[0].name, 'Rainy Bus Window');

// Swap needs agreement
act('B', { type: 'proposeSwap' }); act('A', { type: 'respondSwap', accept: true });
assert.deepEqual(r.roles, { A: 'drums', B: 'melody' });

both({ type: 'setReady', ready: true }); t += 5000; G.tick(r, t);
assert.equal(r.roundType, 'communicate'); assert.equal(G.viewFor(r, 'A', t).blind, false);
assert.ok(act('A', { type: 'chat', text: 'hi' }).ok);
t += 91_000; G.tick(r, t); assert.equal(r.phase, 'remix');
both({ type: 'doneRemix', done: true }); both({ type: 'continue' });
both({ type: 'setReady', ready: true });
assert.equal(r.roundType, 'prompt'); assert.ok(G.PROMPTS.includes(r.prompt));
t += 7000; G.tick(r, t);
assert.ok(act('A', { type: 'chat', text: 'no peeking' }).error, 'chat closed in blind rounds');
both({ type: 'doneCreating', done: true }); assert.equal(r.phase, 'reveal');
both({ type: 'skipReveal' }); assert.equal(r.phase, 'remix');
both({ type: 'doneRemix', done: true }); both({ type: 'continue' });
assert.equal(r.phase, 'keep'); assert.equal(r.collection.length, 3);
both({ type: 'newPrompt' }); assert.equal(r.phase, 'roles'); assert.equal(r.nextRoundType, 'prompt');

// Save → load round trip
const parsed = G.parseCompositionJSON(JSON.parse(JSON.stringify(G.compositionToJSON(r))));
assert.equal(parsed.composition.melody.notes.length, 16);

// ---------------- v1.2: octaves + six drum rows
const r2 = G.createRoom('V12', 0);
r2.players.A = G.blankPlayer('Mel', 'A'); r2.players.B = G.blankPlayer('Beat', 'B');
let t2 = 0;
const a2 = (s, a) => G.applyAction(r2, s, a, t2);
a2('A', { type: 'setReady', ready: true }); a2('B', { type: 'setReady', ready: true }); t2 += 5000; G.tick(r2, t2);
const notes = () => r2.composition.melody.notes;
// Melody test: MID note, then HIGH note on another step — both kept, nothing transposed
assert.ok(a2('A', { type: 'editMelody', step: 0, note: 'C4' }).ok);
assert.ok(a2('A', { type: 'editMelody', step: 1, note: 'G5' }).ok);
assert.ok(a2('A', { type: 'editMelody', step: 2, note: 'D3' }).ok);
assert.equal(notes()[0], 'C4'); assert.equal(notes()[1], 'G5'); assert.equal(notes()[2], 'D3');
// one note per step: a new pitch replaces; removing works
a2('A', { type: 'editMelody', step: 0, note: 'E5' }); assert.equal(notes()[0], 'E5');
a2('A', { type: 'editMelody', step: 0, note: null }); assert.equal(notes()[0], null);
assert.ok(a2('A', { type: 'editMelody', step: 3, note: 'B4' }).error, 'notes outside the scale are rejected');
// Beat test: all six rows, many per step
for (const row of ['boom', 'clap', 'tss', 'open', 'tom', 'shake']) assert.ok(a2('B', { type: 'editDrum', row, step: 5, on: true }).ok, row);
assert.ok(G.DRUM_ROWS.every(row => r2.composition.drums.pattern[row][5]));
// Blind privacy still holds for the new data
assert.equal(G.viewFor(r2, 'B', t2).composition.melody, null);
assert.equal(G.viewFor(r2, 'A', t2).composition.drums, null);
// Reveal: partner sees octave notes and hidden-row hits
a2('A', { type: 'doneCreating', done: true }); a2('B', { type: 'doneCreating', done: true });
assert.equal(G.viewFor(r2, 'B', t2).composition.melody.notes[1], 'G5');
assert.equal(G.viewFor(r2, 'A', t2).composition.drums.pattern.shake[5], true);
// Reset keeps six rows
a2('A', { type: 'skipReveal' }); a2('B', { type: 'skipReveal' });
a2('B', { type: 'resetTrack', clear: true });
assert.deepEqual(Object.keys(r2.composition.drums.pattern).sort(), [...G.DRUM_ROWS].sort());
// Save → load keeps octaves and rows
const back = G.parseCompositionJSON(JSON.parse(JSON.stringify(G.compositionToJSON(r2))));
assert.equal(back.composition.melody.notes[1], 'G5');
assert.equal(back.composition.melody.notes[2], 'D3');
// Old v1 save file: 0–4 indexes, -1 rests, three drum rows
const old = { trackName: 'old', tempo: 100, melody: { notes: [0, -1, 4, ...Array(13).fill(-1)], instrument: 'pluck' },
  drums: { pattern: { boom: Array(16).fill(true), clap: Array(16).fill(false), tss: Array(16).fill(false) }, kit: 'soft' } };
const up = G.parseCompositionJSON(old);
assert.deepEqual(up.composition.melody.notes.slice(0, 3), ['C4', null, 'A4']);
assert.equal(up.composition.drums.pattern.open.length, 16);
assert.equal(up.composition.drums.pattern.boom[3], true);
console.log('✓ game logic: all checks passed (incl. v1.2 octaves + six drum rows)');
