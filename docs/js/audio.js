// BLIND SYNC — audio engine (Tone.js, loaded globally from CDN as window.Tone).
// Every browser generates its own sound from the shared composition data.

import { STEPS, DRUM_ROWS, normalizeNote } from './shared/game.js';

export const PITCH_NOTES = ['C4', 'D4', 'E4', 'G4', 'A4']; // index 0 = lowest row (C major pentatonic)
export const PITCH_LABELS = ['do', 're', 'mi', 'sol', 'la'];

export const INSTRUMENT_INFO = {
  softKeys: { label: 'Soft Keys', blurb: 'warm, round, piano-ish' },
  brightSynth: { label: 'Bright Synth', blurb: 'buzzy & sparkly' },
  pluck: { label: 'Pluck', blurb: 'tiny plucked strings' },
  dreamy: { label: 'Dreamy Synth', blurb: 'slow, floaty, wide' },
};
export const KIT_INFO = {
  acoustic: { label: 'Acoustic Kit', blurb: 'real-room thump' },
  electronic: { label: 'Electronic Kit', blurb: '808 boom & claps' },
  soft: { label: 'Soft Percussion', blurb: 'congas, wood & shaker' },
};
export const DRUM_INFO = {
  boom: { label: 'BOOM', hint: 'kick · low' },
  clap: { label: 'CLAP', hint: 'snare · middle' },
  tss: { label: 'TSS', hint: 'hi-hat · high' },
  // Expanded mode
  open: { label: 'OPEN', hint: 'open hat · airy' },
  tom: { label: 'TOM', hint: 'tom · deep' },
  shake: { label: 'SHAKE', hint: 'shaker · texture' },
};

// System harmony: a quiet 4-bar progression under the 1-bar player loop.
const CHORDS = [['C3', 'E3', 'G3'], ['A2', 'C3', 'E3'], ['F2', 'A2', 'C3'], ['G2', 'B2', 'D3']];
const BASS = ['C2', 'A1', 'F1', 'G1'];
const OCTAVE_SHIFT = { softKeys: 0, brightSynth: 1, pluck: 0, dreamy: 0 };
const LOOP_SECONDS = (60 / 100) * 4 * 4; // 4 bars at 100 BPM = 9.6 s

function shift(note, oct) {
  if (!oct) return note;
  const m = note.match(/^([A-G]#?)(\d)$/);
  const o = Number(m[2]);
  return m[1] + (o + oct > 5 ? o : o + oct); // Bright Synth sits an octave up, but never above octave 5
}

class AudioEngine {
  constructor() {
    this.available = typeof window !== 'undefined' && !!window.Tone;
    this.started = false;
    this.playing = false;
    this.muted = false;
    this.comp = null;
    this.trackOn = { melody: true, drums: true, harmony: true };
    this.stepListeners = new Set();
    this.stateListeners = new Set();
    this.currentStep = -1;
  }

  onStep(fn) { this.stepListeners.add(fn); return () => this.stepListeners.delete(fn); }
  onState(fn) { this.stateListeners.add(fn); return () => this.stateListeners.delete(fn); }
  _emitState() { this.stateListeners.forEach(f => f(this)); }

  /** Must be called from a user gesture (browser autoplay rules). */
  async start() {
    if (!this.available) return false;
    if (!this.started) {
      await Tone.start();
      this._build();
      this.started = true;
    }
    this._emitState();
    return true;
  }

  _build() {
    const T = Tone;
    T.Transport.bpm.value = 100;
    T.Transport.loop = true;
    T.Transport.loopStart = 0;
    T.Transport.loopEnd = '4m';

    const limiter = new T.Limiter(-1).toDestination();
    const master = new T.Compressor({ threshold: -20, ratio: 3, attack: 0.01, release: 0.2 }).connect(limiter);
    const reverb = new T.Reverb({ decay: 3.2, wet: 0.28 }).connect(master);
    const bigVerb = new T.Reverb({ decay: 6, wet: 0.5 }).connect(master);
    this.master = master;

    // ---- melody instruments (all built up front so switching never interrupts the loop)
    const brightFilter = new T.Filter(3200, 'lowpass').connect(reverb);
    const chorus = new T.Chorus(3, 2.5, 0.6).connect(bigVerb).start();
    this.inst = {
      softKeys: new T.PolySynth(T.FMSynth, {
        harmonicity: 2, modulationIndex: 1.6,
        oscillator: { type: 'sine' }, modulation: { type: 'triangle' },
        envelope: { attack: 0.004, decay: 0.7, sustain: 0.12, release: 1.1 },
        modulationEnvelope: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.4 },
        volume: -7,
      }).connect(reverb),
      brightSynth: new T.PolySynth(T.Synth, {
        oscillator: { type: 'fatsawtooth', count: 3, spread: 22 },
        envelope: { attack: 0.008, decay: 0.18, sustain: 0.25, release: 0.35 },
        volume: -17,
      }).connect(brightFilter),
      pluck: new T.PluckSynth({ attackNoise: 1.4, dampening: 4200, resonance: 0.93, volume: 0 }).connect(reverb),
      dreamy: new T.PolySynth(T.AMSynth, {
        harmonicity: 1.5, oscillator: { type: 'sine' }, modulation: { type: 'triangle' },
        envelope: { attack: 0.09, decay: 0.5, sustain: 0.55, release: 2.2 },
        volume: -9,
      }).connect(chorus),
    };

    // ---- drum kits
    const hp = f => new T.Filter(f, 'highpass').connect(master);
    const bp = (f, q = 1) => new T.Filter({ frequency: f, type: 'bandpass', Q: q }).connect(master);
    const noise = (type, decay, out, vol, attack = 0.001) =>
      new T.NoiseSynth({ noise: { type }, envelope: { attack, decay, sustain: 0, release: 0.02 }, volume: vol }).connect(out);
    const membrane = (opts, out = master) => new T.MembraneSynth(opts).connect(out);

    const ac = {
      kick: membrane({ pitchDecay: 0.03, octaves: 5, envelope: { attack: 0.001, decay: 0.38, sustain: 0, release: 0.1 }, volume: -2 }),
      snare: noise('white', 0.17, hp(1300), -9),
      body: membrane({ pitchDecay: 0.01, octaves: 1.5, envelope: { attack: 0.001, decay: 0.09, sustain: 0 }, volume: -12 }),
      hat: noise('white', 0.045, hp(7500), -15),
      open: noise('white', 0.38, hp(6500), -17),
      tom: membrane({ pitchDecay: 0.02, octaves: 2.5, envelope: { attack: 0.001, decay: 0.32, sustain: 0 }, volume: -5 }),
      shake: noise('white', 0.06, bp(5200, 0.9), -19, 0.012),
    };
    const el = {
      kick: membrane({ pitchDecay: 0.09, octaves: 7, envelope: { attack: 0.001, decay: 0.85, sustain: 0.02, release: 0.5 }, volume: -1 }),
      clap: noise('pink', 0.2, bp(1500, 1.1), -4),
      hat: noise('white', 0.028, hp(9500), -11),
      open: noise('white', 0.26, hp(8500), -14),
      tom: membrane({ pitchDecay: 0.07, octaves: 4, envelope: { attack: 0.001, decay: 0.45, sustain: 0 }, volume: -4 }),
      shake: noise('pink', 0.05, hp(7000), -13, 0.004),
    };
    const so = {
      conga: membrane({ pitchDecay: 0.012, octaves: 1.6, envelope: { attack: 0.001, decay: 0.32, sustain: 0 }, volume: -6 }),
      wood: new T.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.06, sustain: 0, release: 0.03 }, volume: -8 }).connect(reverb),
      shaker: noise('white', 0.07, bp(6500, 0.8), -17, 0.012),
      brush: noise('white', 0.32, bp(4200, 0.6), -21, 0.03),
      highConga: membrane({ pitchDecay: 0.01, octaves: 1.4, envelope: { attack: 0.001, decay: 0.22, sustain: 0 }, volume: -8 }),
      tamb: noise('pink', 0.11, bp(3400, 1.2), -16, 0.02),
    };
    this.kits = {
      acoustic: {
        boom: (t, v) => ac.kick.triggerAttackRelease('C2', '8n', t, v),
        clap: (t, v) => { ac.snare.triggerAttackRelease('16n', t, v); ac.body.triggerAttackRelease('G3', '32n', t, v); },
        tss: (t, v) => ac.hat.triggerAttackRelease('32n', t, v),
        open: (t, v) => ac.open.triggerAttackRelease('8n', t, v),
        tom: (t, v) => ac.tom.triggerAttackRelease('A2', '8n', t, v),
        shake: (t, v) => ac.shake.triggerAttackRelease('32n', t, v),
      },
      electronic: {
        boom: (t, v) => el.kick.triggerAttackRelease('C1', '4n', t, v),
        clap: (t, v) => { [0, 0.011, 0.023].forEach((d, i) => el.clap.triggerAttackRelease(i < 2 ? 0.01 : '16n', t + d, v)); },
        tss: (t, v) => el.hat.triggerAttackRelease('32n', t, v),
        open: (t, v) => el.open.triggerAttackRelease('8n', t, v),
        tom: (t, v) => el.tom.triggerAttackRelease('E2', '8n', t, v),
        shake: (t, v) => el.shake.triggerAttackRelease('32n', t, v),
      },
      soft: {
        boom: (t, v) => so.conga.triggerAttackRelease('G2', '8n', t, v),
        clap: (t, v) => so.wood.triggerAttackRelease('E5', '32n', t, v),
        tss: (t, v) => so.shaker.triggerAttackRelease('32n', t, v),
        open: (t, v) => so.brush.triggerAttackRelease('8n', t, v),
        tom: (t, v) => so.highConga.triggerAttackRelease('D3', '8n', t, v),
        shake: (t, v) => so.tamb.triggerAttackRelease('16n', t, v),
      },
    };

    // ---- system harmony (quiet pad + soft bass)
    const padFilter = new T.Filter(900, 'lowpass').connect(bigVerb);
    this.pad = new T.PolySynth(T.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.5, decay: 0.6, sustain: 0.5, release: 1.4 },
      volume: -25,
    }).connect(padFilter);
    this.bass = new T.MonoSynth({
      oscillator: { type: 'sine' }, filter: { Q: 1, type: 'lowpass' },
      envelope: { attack: 0.02, decay: 0.4, sustain: 0.4, release: 0.6 },
      filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.3, baseFrequency: 120, octaves: 2 },
      volume: -18,
    }).connect(master);

    T.Transport.scheduleRepeat(time => this._tick(time), '16n', 0);
  }

  _tick(time) {
    const T = Tone;
    const sixteenth = T.Transport.PPQ / 4;
    const n = Math.round(T.Transport.getTicksAtTime(time) / sixteenth);
    const step = ((n % STEPS) + STEPS) % STEPS;
    const bar = Math.floor(n / STEPS) % 4;
    const c = this.comp;

    if (this.trackOn.harmony) {
      if (step === 0) {
        this.pad.triggerAttackRelease(CHORDS[bar], 2.1, time, 0.6);
        this.bass.triggerAttackRelease(BASS[bar], '4n', time, 0.7);
      } else if (step === 8) {
        this.bass.triggerAttackRelease(BASS[bar], '8n', time, 0.45);
      }
    }
    if (c?.melody && this.trackOn.melody) {
      const n = normalizeNote(c.melody.notes[step]);
      if (n) this._melodyNote(c.melody.instrument, n, time, 0.85);
    }
    if (c?.drums && this.trackOn.drums) {
      const kit = this.kits[c.drums.kit] || this.kits.acoustic;
      for (const r of DRUM_ROWS) {
        // every row plays, including OPEN / TOM / SHAKE when they are hidden in Simple mode
        if (c.drums.pattern[r]?.[step]) kit[r](time, r === 'tss' || r === 'shake' ? (step % 4 === 0 ? 0.9 : 0.55) : 0.95);
      }
    }
    T.Draw.schedule(() => {
      this.currentStep = step;
      this.stepListeners.forEach(f => f(step, bar));
    }, time);
  }

  _melodyNote(instrument, noteName, time, vel = 0.85) {
    const inst = this.inst[instrument] || this.inst.softKeys;
    const note = shift(noteName, OCTAVE_SHIFT[instrument] || 0);
    const dur = instrument === 'dreamy' ? '4n' : '8n';
    try { inst.triggerAttackRelease(note, dur, time, vel); } catch (e) { /* overlapping retrigger: ignore */ }
  }

  // ---------------------------------------------------------------- public API

  setComposition(comp) { this.comp = comp; }
  setTracks(on) { Object.assign(this.trackOn, on); }

  /** Start (or re-align) the loop. epochMs is in server time; offsetMs = serverNow - localNow. */
  play(epochMs = null, offsetMs = 0) {
    if (!this.started) return;
    const T = Tone;
    let pos = 0;
    if (epochMs != null) {
      const elapsed = (Date.now() + offsetMs - epochMs) / 1000;
      pos = ((elapsed % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS;
    }
    if (T.Transport.state === 'started') T.Transport.seconds = pos;
    else T.Transport.start('+0.05', pos);
    this.playing = true;
    this._emitState();
  }

  pause() {
    if (!this.started) return;
    Tone.Transport.pause();
    this.playing = false;
    this.currentStep = -1;
    this.stepListeners.forEach(f => f(-1, 0));
    this._emitState();
  }

  stop() {
    if (!this.started) return;
    Tone.Transport.stop();
    this.playing = false;
    this.currentStep = -1;
    this.stepListeners.forEach(f => f(-1, 0));
    this._emitState();
  }

  setMuted(m) {
    this.muted = m;
    if (this.started) Tone.Destination.mute = m;
    this._emitState();
  }

  previewMelody(note, instrument) {
    const n = normalizeNote(note);
    if (!this.started || this.muted || !n) return;
    this._melodyNote(instrument, n, Tone.now() + 0.01, 0.8);
  }
  previewDrum(row, kit) {
    if (!this.started || this.muted) return;
    (this.kits[kit] || this.kits.acoustic)[row](Tone.now() + 0.01, 0.9);
  }
  previewInstrument(instrument) {
    if (!this.started || this.muted) return;
    const t = Tone.now() + 0.02;
    ['C4', 'E4', 'A4'].forEach((n, i) => this._melodyNote(instrument, n, t + i * 0.13, 0.75));
  }
  previewKit(kit) {
    if (!this.started || this.muted) return;
    const t = Tone.now() + 0.02, k = this.kits[kit];
    k.boom(t, 0.9); k.tss(t + 0.15, 0.6); k.clap(t + 0.3, 0.9); k.tss(t + 0.45, 0.6);
  }
}

export const audio = new AudioEngine();
