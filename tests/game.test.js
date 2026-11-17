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
assert.equal(G.viewFor(r, 'B', t).composition.melody.notes[1], 4, 'revealed after time is up');
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
console.log('✓ game logic: all checks passed');
