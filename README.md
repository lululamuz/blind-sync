# BLIND SYNC

**Create separately. Listen together.**

A **CoreLabSystems:CT** project by **Lulu**.

BLIND SYNC is a two-player music game that runs in the browser. One player makes the **melody** and the other makes the **drums**. It starts blind, opens up into live collaboration, and ends with both players interpreting the same one-word prompt through sound.

- **Frontend:** plain HTML, CSS and JavaScript ES modules, with no build step. [Tone.js](https://tonejs.github.io/) makes the sound. Hosted on **GitHub Pages**.
- **Backend:** Node.js and WebSockets (`ws`). The server holds one authoritative game state per room. Hosted on **Render**.
- **Sound is never streamed.** Only composition data is synced, and each browser makes its own audio from the same notes.

---

## Run it locally

You need Node 18 or newer. From the project folder:

```bash
npm install
npm start            # → http://localhost:8080
```

Open it in two browser windows, create a room in one and join with the code in the other.
`TIME_SCALE=0.1 npm start` makes every round 10× shorter for testing. **Try Local Demo** on the homepage needs no server.
Tests: `npm test`.

---

## Deploy (all from the browser)

### 1. Server → Render
New → Web Service → connect this GitHub repo. Build command `npm install`, start command `npm start`, free plan. Copy the URL Render gives you.

### 2. Website → GitHub Pages
1. Edit `docs/js/config.js` on GitHub: set `PRODUCTION_SERVER` to your Render URL, starting with `wss://` (e.g. `wss://blind-sync-xxxx.onrender.com`).
2. Repo **Settings → Pages → Deploy from a branch → main / docs**.

Render's free tier sleeps when idle; the first connection can take ~30 s.

---

## Project structure

```
docs/                       → the website (GitHub Pages serves this folder)
  index.html
  css/styles.css            design system: tokens, gradients, halftone, grain, components
  js/
    main.js                 app controller: routing, header, audio orchestration
    config.js               server URL logic
    net.js                  OnlineSession (WebSocket) + DemoSession (local)
    audio.js                Tone.js engine: 4 instruments, 3 kits, harmony, synced loop
    shared/game.js          ★ the game rules: a pure state machine shared by server + demo
    ui/dom.js               DOM helper, SVG motif library, toasts, dialog, download
    ui/sequencer.js         melody + drum step-sequencer grids, timeline
    screens/
      home.js               landing page (animated halftone hero, how-to, roles, rounds)
      room.js               create/join, lobby + role negotiation, tutorial, intro, results, keep creating
      workspace.js          solo editor → reveal → shared remix, chat, reactions
      replay.js             play an imported JSON track
server/
  server.js                 rooms, timers, filtered state per player, reconnects
package.json                start script + ws dependency (used by Render)
tests/game.test.js          plays a full 3-round game through the rules
render.yaml                 optional Render blueprint
```

### How multiplayer works
- `docs/js/shared/game.js` holds every rule: phases, timers, roles, swaps, edit permissions and naming. The **server** runs it as the single source of truth. The **Local Demo** runs the same code in the browser.
- Clients send small actions such as `{type: "editMelody", step: 3, pitch: 2}`. The server checks each one, applies it and broadcasts the new state.
- **Blind privacy:** `viewFor(room, player)` removes the partner's track before the state is sent. During Rounds 1 and 3, the other browser **never receives** the hidden notes. They are not just hidden with CSS.
- **Timing:** the server owns every deadline and moves the round forward when time is up. Clients estimate the server clock offset (a ping/pong exchange) and line up their loop to a shared `loopEpoch`, so both browsers play the same step at roughly the same time.
- **Disconnects:** a dropped player has 90 seconds to come back. Refreshing the page rejoins the same seat automatically, using a token stored in `sessionStorage`. If a player leaves for good, the room drops back to the lobby and an unfinished round is replayed.
- **Optimistic edits:** your clicks show up right away. Each action carries an ID, and the server acknowledges it, so late server updates never undo a click you just made.

### Game flow
`lobby → intro → create → (reveal) → remix → results → roles → … → keep`

| Round | Time | Workspace | Notes |
|---|---|---|---|
| 1 · Blind Creation | 90 s | solo | partner's track hidden; reveal → live remix |
| 2 · Communicate | 90 s | shared | stacked tracks, chat, quick messages, reactions |
| 3 · Prompt Challenge | 120 s | solo | same random word for both; reveal → final remix |
| ∞ · Keep Creating | 120 s | solo | New Prompt / Swap Roles / Save / Home |

Both players have to agree before roles swap, before a round starts, before a track name is locked in, and before moving on. In blind rounds, pressing "I'm done" on both sides starts the reveal early.

### Music
- 100 BPM, a 16-step loop, C major pentatonic (do re mi sol la), so any combination of notes sounds fine.
- Melody: 5 pitch rows and at most one note per step. Sounds: **Soft Keys** (FM), **Bright Synth** (detuned saw), **Pluck** (Karplus-Strong), **Dreamy Synth** (AM, chorus, long reverb).
- Drums: BOOM / CLAP / TSS, with any number of hits per step. Kits: **Acoustic**, **Electronic** (808-style), **Soft Percussion** (conga, woodblock, shaker).
- System harmony: a quiet pad and bass playing C–Am–F–G across 4 bars, under the 1-bar loop.
- Changing instrument or kit never stops the loop. All sounds are built at startup, so switching just changes which one is used.

---

## What's implemented

✅ Everything in the brief's "initial prototype" list works for real:
- Designed homepage, Create/Join with room code and invite link, room-full and invalid-code states
- Lobby with role cards, agreed role swaps, both-players-ready, and a 20-second interactive sound tutorial
- Melody and drum sequencers with real Tone.js sound, instant preview, auto loop, visible playhead, starter pattern, reset and clear
- 4 melody instruments and 3 drum kits, switchable live
- System harmony layer
- All three rounds plus endless Prompt mode, with server-controlled timers and a 10-second warning
- Reveal sequence (time's up → melody alone → beat alone → particles merge → together), with Skip
- Live remix with synced edits, chat, quick messages and reactions (collapsible)
- Naming that both players agree on, a session track collection, JSON download, JSON import and replay
- Partner offline and reconnecting states, a leave confirmation, keyboard focus states, notes that don't rely on colour alone, and support for reduced-motion settings

🟡 Not implemented yet (future work):
- WAV/MP3 audio export. JSON saving works.
- Voice chat. There is deliberately no fake microphone button.
- Saving across sessions. Session tracks stay in server memory until the room closes, so download the JSON to keep them.
- The mobile layout works but is secondary. The design targets laptops.

## Notes on the design system
- **Colour roles:** paper, mint and pale yellow for surfaces · fuchsia → indigo = **Melody** · mint → cyber lime = **Drums** · graphite for outlines and type.
- **Type:** Syne (display wordmark), Space Grotesk (UI), DM Sans (body and instructions), Instrument Serif italic (expressive accents only, never instructions).
- **Texture:** CSS halftone dot fields with fading masks, SVG noise grain (lighter in the editor), and canvas halftone waves in the hero and the reveal.
- **Shape:** 1.5px black outlines, hard offset sticker shadows, and uneven corner radii, so not every element is the same rounded rectangle.
- The homepage is loud on purpose. The editor is calmer, so the grid stays the focus.
