(() => {
  'use strict';

  // "Полярная жила" — an original, deterministic 2:30 score for the mine.
  // Everything is synthesized in-browser so the game does not have to ship a
  // multi-megabyte recording. No note is borrowed from either of the mood
  // references; only their calm acoustic / wide-open-space vocabulary informs
  // the instrumentation.
  const BPM = 64;
  const BEATS_PER_BAR = 4;
  const BAR_COUNT = 40;
  const BEAT_SECONDS = 60 / BPM;
  const LOOP_SECONDS = BAR_COUNT * BEATS_PER_BAR * BEAT_SECONDS;
  const LOOKAHEAD_SECONDS = 3.2;
  const SCHEDULER_INTERVAL_MS = 240;
  const MUSIC_PREFERENCE_KEY = 'depth-zero-music-enabled';
  const GAME_SAVE_KEY = 'depth-zero-save-v1';

  const MUSIC_META = Object.freeze({
    id: 'polar-vein',
    title: 'Полярная жила',
    composer: 'Original procedural score for ГЛУБИНА: НУЛЬ',
    bpm: BPM,
    beatsPerBar: BEATS_PER_BAR,
    bars: BAR_COUNT,
    durationSeconds: LOOP_SECONDS,
    loop: true,
  });

  const CHORDS = Object.freeze({
    Dadd9: Object.freeze([38, 45, 50, 52, 54, 57]),
    G6: Object.freeze([43, 50, 55, 57, 59, 64]),
    Bm7: Object.freeze([35, 42, 47, 50, 54, 57]),
    Asus2: Object.freeze([33, 40, 45, 47, 52, 57]),
    Aadd9: Object.freeze([33, 40, 45, 47, 49, 52]),
    A7sus4: Object.freeze([33, 40, 43, 45, 50, 52]),
    Em7: Object.freeze([40, 47, 52, 55, 59, 62]),
    DoverFSharp: Object.freeze([42, 45, 50, 52, 54, 57]),
    Gmaj7: Object.freeze([43, 50, 54, 55, 59, 62]),
  });

  // Five gently developing eight-bar passages. The final Dadd9 overlaps the
  // opening Dadd9, making the 150-second wrap musically and sonically seamless.
  const BAR_SCORE = Object.freeze([
    'Dadd9', 'G6', 'Bm7', 'Asus2', 'Dadd9', 'G6', 'Em7', 'Asus2',
    'Bm7', 'G6', 'Dadd9', 'Aadd9', 'Bm7', 'G6', 'Em7', 'A7sus4',
    'G6', 'DoverFSharp', 'Em7', 'Bm7', 'G6', 'Dadd9', 'Em7', 'Asus2',
    'Bm7', 'Aadd9', 'Gmaj7', 'Dadd9', 'Bm7', 'Aadd9', 'Em7', 'A7sus4',
    'Dadd9', 'G6', 'DoverFSharp', 'Asus2', 'Bm7', 'G6', 'Asus2', 'Dadd9',
  ]);

  const SECTION_INTENSITY = Object.freeze([0.72, 0.82, 0.92, 1, 0.78]);
  const PLUCK_PATTERNS = Object.freeze([
    Object.freeze([0, 1.5, 2.5, 3.25]),
    Object.freeze([0, 0.75, 1.75, 2.5, 3.35]),
    Object.freeze([0, 0.75, 1.5, 2.25, 3, 3.55]),
  ]);
  const PLUCK_NOTE_ORDER = Object.freeze([2, 4, 3, 5, 4, 3]);
  const LEAD_MOTIFS = Object.freeze({
    7: Object.freeze([[0.45, 69, 1.1], [1.8, 66, 1.05], [3.05, 64, 0.75]]),
    15: Object.freeze([[0.7, 71, 1], [2.15, 69, 1.25]]),
    23: Object.freeze([[0.3, 67, 1.25], [1.8, 69, 1], [3.05, 74, 0.7]]),
    31: Object.freeze([[0.5, 66, 1.05], [2.05, 64, 1.2]]),
    38: Object.freeze([[0.65, 69, 1.15], [2.2, 66, 1.1]]),
  });

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const midiToFrequency = (midi) => 440 * (2 ** ((midi - 69) / 12));

  function makeSeededRandom(seed = 0x504f4c41) {
    let state = seed >>> 0;
    return () => {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function readStoredEnabled(root) {
    try {
      const ownPreference = root.localStorage?.getItem(MUSIC_PREFERENCE_KEY);
      const gameSave = JSON.parse(root.localStorage?.getItem(GAME_SAVE_KEY) || 'null');
      if (gameSave?.sound === false || ownPreference === 'false') return false;
      return ownPreference === 'true' || gameSave?.sound !== false;
    } catch {
      return true;
    }
  }

  class CalmMineScore {
    constructor(options = {}) {
      this.root = options.root || (typeof window !== 'undefined' ? window : globalThis);
      this.enabled = options.enabled ?? readStoredEnabled(this.root);
      this.volume = clamp(Number(options.volume) || 0.38, 0, 1);
      this.context = options.context || null;
      this.destination = options.destination || null;
      this.ownsContext = !options.context;
      this.playing = false;
      this.master = null;
      this.musicBus = null;
      this.ambientSource = null;
      this.schedulerId = null;
      this.nextBeat = 0;
      this.nextBeatTime = 0;
      this.activeSources = new Set();
      this.stopGeneration = 0;
      this.unlockTarget = null;
      this.unlockHandler = null;
      this.noiseBuffer = null;
      this.meta = MUSIC_META;
    }

    _ensureContext() {
      if (this.context) return this.context;
      const AudioContextClass = this.root.AudioContext || this.root.webkitAudioContext;
      if (!AudioContextClass) return null;
      try {
        this.context = new AudioContextClass({ latencyHint: 'playback' });
      } catch {
        // Older Safari versions implement AudioContext but reject options.
        this.context = new AudioContextClass();
      }
      this.ownsContext = true;
      return this.context;
    }

    _track(source) {
      this.activeSources.add(source);
      source.addEventListener?.('ended', () => this.activeSources.delete(source), { once: true });
      return source;
    }

    _createNoiseBuffer(seconds = 8) {
      const context = this.context;
      const frames = Math.max(1, Math.floor(context.sampleRate * seconds));
      const buffer = context.createBuffer(1, frames, context.sampleRate);
      const channel = buffer.getChannelData(0);
      const random = makeSeededRandom();
      let smooth = 0;
      for (let index = 0; index < frames; index += 1) {
        smooth = smooth * 0.78 + (random() * 2 - 1) * 0.22;
        channel[index] = smooth;
      }
      // Ease the tail into the first sample so the low wind bed does not click
      // at its loop point. The bed is deliberately quiet, so this tiny dip is
      // inaudible while preserving exact endpoint continuity.
      const crossfadeFrames = Math.min(Math.floor(context.sampleRate * 0.4), Math.floor(frames / 4));
      for (let index = 0; index < crossfadeFrames; index += 1) {
        const linear = index / Math.max(1, crossfadeFrames - 1);
        const amount = linear * linear * (3 - 2 * linear);
        const tailIndex = frames - crossfadeFrames + index;
        channel[tailIndex] = channel[tailIndex] * (1 - amount) + channel[0] * amount;
      }
      return buffer;
    }

    _createImpulse(seconds = 2.7) {
      const context = this.context;
      const frames = Math.max(1, Math.floor(context.sampleRate * seconds));
      const impulse = context.createBuffer(2, frames, context.sampleRate);
      const random = makeSeededRandom(0x44524946);
      for (let channelIndex = 0; channelIndex < impulse.numberOfChannels; channelIndex += 1) {
        const channel = impulse.getChannelData(channelIndex);
        let smooth = 0;
        for (let index = 0; index < frames; index += 1) {
          const progress = index / frames;
          const envelope = ((1 - progress) ** 2.8) * Math.min(1, index / (context.sampleRate * 0.018));
          smooth = smooth * 0.36 + (random() * 2 - 1) * 0.64;
          channel[index] = smooth * envelope * 0.55;
        }
      }
      return impulse;
    }

    _buildGraph() {
      if (this.master) return;
      const context = this.context;
      const destination = this.destination || context.destination;
      this.musicBus = context.createGain();

      const toneFilter = context.createBiquadFilter();
      toneFilter.type = 'lowpass';
      toneFilter.frequency.value = 4400;
      toneFilter.Q.value = 0.28;

      const dry = context.createGain();
      dry.gain.value = 0.84;
      const wet = context.createGain();
      wet.gain.value = 0.2;
      const reverb = context.createConvolver();
      reverb.buffer = this._createImpulse();

      this.master = context.createGain();
      this.master.gain.value = 0.0001;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value = 20;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.025;
      compressor.release.value = 0.55;

      this.musicBus.connect(toneFilter);
      toneFilter.connect(dry).connect(this.master);
      toneFilter.connect(reverb).connect(wet).connect(this.master);
      this.master.connect(compressor).connect(destination);

      this._startAmbience();
    }

    _startAmbience() {
      const context = this.context;
      this.noiseBuffer ||= this._createNoiseBuffer();
      const source = this._track(context.createBufferSource());
      source.buffer = this.noiseBuffer;
      source.loop = true;

      const highpass = context.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 115;
      const lowpass = context.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 1280;
      const gain = context.createGain();
      gain.gain.value = 0.006;

      const breathe = context.createOscillator();
      const breatheDepth = context.createGain();
      breathe.frequency.value = 0.035;
      breatheDepth.gain.value = 0.0022;
      breathe.connect(breatheDepth).connect(gain.gain);

      source.connect(highpass).connect(lowpass).connect(gain).connect(this.musicBus);
      source.start();
      breathe.start();
      this._track(breathe);
      this.ambientSource = source;
    }

    _scheduleEnvelope(gain, time, attack, holdUntil, end, peak) {
      gain.cancelScheduledValues(time);
      gain.setValueAtTime(0.0001, time);
      gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + attack);
      gain.setValueAtTime(Math.max(0.0002, peak * 0.82), Math.max(time + attack, holdUntil));
      gain.exponentialRampToValueAtTime(0.0001, end);
    }

    _schedulePad(notes, time, intensity) {
      const context = this.context;
      const duration = BEAT_SECONDS * 4.65;
      const voiceNotes = notes.slice(1, 6);
      voiceNotes.forEach((midi, voiceIndex) => {
        const oscillator = this._track(context.createOscillator());
        const gain = context.createGain();
        const filter = context.createBiquadFilter();
        oscillator.type = voiceIndex % 2 === 0 ? 'sine' : 'triangle';
        oscillator.frequency.value = midiToFrequency(midi);
        oscillator.detune.value = (voiceIndex - 2) * 1.8;
        filter.type = 'lowpass';
        filter.frequency.value = 1250 + voiceIndex * 210;
        filter.Q.value = 0.3;
        const peak = (0.0082 * intensity) / (1 + voiceIndex * 0.09);
        this._scheduleEnvelope(
          gain.gain,
          time,
          0.72 + voiceIndex * 0.08,
          time + BEAT_SECONDS * 2.75,
          time + duration,
          peak,
        );
        oscillator.connect(filter).connect(gain).connect(this.musicBus);
        oscillator.start(time);
        oscillator.stop(time + duration + 0.05);
      });
    }

    _scheduleBass(rootMidi, time, intensity) {
      const context = this.context;
      const duration = BEAT_SECONDS * 4.45;
      const oscillator = this._track(context.createOscillator());
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      oscillator.type = 'sine';
      oscillator.frequency.value = midiToFrequency(rootMidi);
      filter.type = 'lowpass';
      filter.frequency.value = 240;
      filter.Q.value = 0.6;
      this._scheduleEnvelope(gain.gain, time, 0.5, time + BEAT_SECONDS * 2.8, time + duration, 0.016 * intensity);
      oscillator.connect(filter).connect(gain).connect(this.musicBus);
      oscillator.start(time);
      oscillator.stop(time + duration + 0.05);
    }

    _schedulePluck(midi, time, intensity, panValue = 0) {
      const context = this.context;
      const duration = 1.55;
      const frequency = midiToFrequency(midi);
      const gain = context.createGain();
      const body = context.createBiquadFilter();
      body.type = 'lowpass';
      body.frequency.setValueAtTime(Math.min(4600, frequency * 7.5), time);
      body.frequency.exponentialRampToValueAtTime(Math.max(620, frequency * 2.2), time + duration);
      body.Q.value = 0.65;
      this._scheduleEnvelope(gain.gain, time, 0.012, time + 0.018, time + duration, 0.026 * intensity);

      const panner = context.createStereoPanner?.();
      if (panner) panner.pan.value = clamp(panValue, -0.8, 0.8);
      const output = panner || gain;
      if (panner) gain.connect(panner);
      output.connect(this.musicBus);

      const fundamental = this._track(context.createOscillator());
      fundamental.type = 'triangle';
      fundamental.frequency.setValueAtTime(frequency * 1.006, time);
      fundamental.frequency.exponentialRampToValueAtTime(frequency, time + 0.12);
      fundamental.connect(body).connect(gain);
      fundamental.start(time);
      fundamental.stop(time + duration + 0.05);

      const harmonic = this._track(context.createOscillator());
      const harmonicGain = context.createGain();
      harmonic.type = 'sine';
      harmonic.frequency.value = frequency * 2;
      harmonicGain.gain.setValueAtTime(0.16, time);
      harmonicGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.42);
      harmonic.connect(harmonicGain).connect(body);
      harmonic.start(time);
      harmonic.stop(time + 0.46);

      // A tiny filtered noise transient supplies a soft finger-on-string edge.
      const pick = this._track(context.createBufferSource());
      const pickFilter = context.createBiquadFilter();
      const pickGain = context.createGain();
      pick.buffer = this.noiseBuffer;
      pickFilter.type = 'bandpass';
      pickFilter.frequency.value = Math.min(3900, frequency * 5);
      pickFilter.Q.value = 0.75;
      pickGain.gain.setValueAtTime(0.0045 * intensity, time);
      pickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
      pick.connect(pickFilter).connect(pickGain).connect(this.musicBus);
      const noiseOffset = ((midi * 0.173 + time * 0.071) % 6.5 + 6.5) % 6.5;
      pick.start(time, noiseOffset, 0.055);
    }

    _scheduleLead(midi, time, duration, intensity) {
      const context = this.context;
      const frequency = midiToFrequency(midi);
      const gain = context.createGain();
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1750;
      filter.Q.value = 0.45;
      this._scheduleEnvelope(gain.gain, time, 0.16, time + duration * 0.52, time + duration, 0.013 * intensity);

      const oscillator = this._track(context.createOscillator());
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(frequency * 0.975, time);
      oscillator.frequency.exponentialRampToValueAtTime(frequency, time + 0.22);
      oscillator.connect(filter).connect(gain).connect(this.musicBus);
      oscillator.start(time);
      oscillator.stop(time + duration + 0.05);

      const breath = this._track(context.createOscillator());
      const breathGain = context.createGain();
      breath.type = 'sine';
      breath.frequency.value = frequency * 2;
      breathGain.gain.value = 0.08;
      breath.connect(breathGain).connect(filter);
      breath.start(time);
      breath.stop(time + duration + 0.05);
    }

    _scheduleChime(midi, time, intensity) {
      const context = this.context;
      const frequency = midiToFrequency(midi);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.007 * intensity, time + 0.055);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 3.4);
      [1, 2.01, 3.98].forEach((ratio, index) => {
        const oscillator = this._track(context.createOscillator());
        const partialGain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency * ratio;
        partialGain.gain.value = [1, 0.24, 0.07][index];
        oscillator.connect(partialGain).connect(gain);
        oscillator.start(time);
        oscillator.stop(time + 3.45);
      });
      gain.connect(this.musicBus);
    }

    _scheduleBar(barIndex, time) {
      const chordName = BAR_SCORE[barIndex];
      const chord = CHORDS[chordName];
      const section = Math.floor(barIndex / 8);
      const intensity = SECTION_INTENSITY[section];
      const localBar = barIndex % 8;

      this._schedulePad(chord, time, intensity);
      this._scheduleBass(chord[0], time, intensity);

      const patternIndex = section === 0 || section === 4 ? 0 : section === 1 ? 1 : 2;
      const pattern = PLUCK_PATTERNS[patternIndex];
      pattern.forEach((beatOffset, noteIndex) => {
        // Resting bars keep the piece airy and prevent the loop feeling busy.
        if ((localBar === 3 || localBar === 7) && noteIndex === pattern.length - 1) return;
        const chordNote = chord[PLUCK_NOTE_ORDER[noteIndex] % chord.length] + 12;
        const pan = (noteIndex % 2 === 0 ? -0.22 : 0.24) + (section - 2) * 0.025;
        this._schedulePluck(chordNote, time + beatOffset * BEAT_SECONDS, intensity, pan);
      });

      const motif = LEAD_MOTIFS[barIndex];
      motif?.forEach(([beatOffset, midi, durationBeats]) => {
        this._scheduleLead(midi, time + beatOffset * BEAT_SECONDS, durationBeats * BEAT_SECONDS, intensity);
      });

      if (localBar === 4 && section > 0) {
        const highNote = chord[chord.length - 1] + (section % 2 === 0 ? 24 : 19);
        this._scheduleChime(highNote, time + 2.7 * BEAT_SECONDS, intensity);
      }
    }

    _schedulerTick() {
      if (!this.playing || !this.context) return;
      const now = this.context.currentTime;
      if (this.nextBeatTime < now - 0.12) {
        const skipped = Math.ceil((now - this.nextBeatTime) / BEAT_SECONDS);
        this.nextBeat += skipped;
        this.nextBeatTime += skipped * BEAT_SECONDS;
      }
      while (this.nextBeatTime < now + LOOKAHEAD_SECONDS) {
        const beatInLoop = this.nextBeat % (BAR_COUNT * BEATS_PER_BAR);
        if (beatInLoop % BEATS_PER_BAR === 0) {
          this._scheduleBar(Math.floor(beatInLoop / BEATS_PER_BAR), this.nextBeatTime);
        }
        this.nextBeat += 1;
        this.nextBeatTime += BEAT_SECONDS;
      }
    }

    start(options = {}) {
      if (!this.enabled) return Promise.resolve(false);
      const context = this._ensureContext();
      if (!context) return Promise.resolve(false);
      // Invalidate a delayed graph disposal when the user re-enables music
      // during its fade-out.
      this.stopGeneration += 1;

      // Calling resume here (rather than after a timeout) is essential on iOS:
      // start() is invoked directly by the first pointer/key gesture.
      let resumeResult;
      try {
        resumeResult = context.state === 'suspended' ? context.resume() : Promise.resolve();
      } catch {
        return Promise.resolve(false);
      }

      if (!this.playing) {
        this._buildGraph();
        this.playing = true;
        this.nextBeat = 0;
        this.nextBeatTime = context.currentTime + 0.08;
        this._schedulerTick();
        this.schedulerId = this.root.setInterval(() => this._schedulerTick(), SCHEDULER_INTERVAL_MS);
      }

      const now = context.currentTime;
      const fadeSeconds = clamp(Number(options.fadeSeconds) || 2.8, 0.05, 8);
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(Math.max(0.0001, this.master.gain.value), now);
      this.master.gain.exponentialRampToValueAtTime(Math.max(0.0001, this.volume), now + fadeSeconds);

      return Promise.resolve(resumeResult)
        .then(() => {
          this._removeAutoplayUnlock();
          return true;
        })
        .catch(() => false);
    }

    stop(options = {}) {
      if (!this.context || !this.playing) return;
      const generation = ++this.stopGeneration;
      const fadeSeconds = clamp(Number(options.fadeSeconds) || 1.2, 0.05, 8);
      const now = this.context.currentTime;
      this.master?.gain.cancelScheduledValues(now);
      this.master?.gain.setValueAtTime(Math.max(0.0001, this.master.gain.value), now);
      this.master?.gain.exponentialRampToValueAtTime(0.0001, now + fadeSeconds);
      this.root.setTimeout(() => {
        if (generation !== this.stopGeneration) return;
        this._disposeGraph();
      }, fadeSeconds * 1000 + 80);
    }

    _disposeGraph() {
      this.playing = false;
      if (this.schedulerId !== null) this.root.clearInterval(this.schedulerId);
      this.schedulerId = null;
      for (const source of this.activeSources) {
        try { source.stop(); } catch { /* Already ended. */ }
      }
      this.activeSources.clear();
      try { this.master?.disconnect(); } catch { /* Already disconnected. */ }
      try { this.musicBus?.disconnect(); } catch { /* Already disconnected. */ }
      this.master = null;
      this.musicBus = null;
      this.ambientSource = null;
    }

    setVolume(value, options = {}) {
      this.volume = clamp(Number(value) || 0, 0, 1);
      if (!this.context || !this.master) return this.volume;
      const now = this.context.currentTime;
      const fadeSeconds = clamp(Number(options.fadeSeconds) || 0.35, 0.02, 3);
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(Math.max(0.0001, this.master.gain.value), now);
      this.master.gain.exponentialRampToValueAtTime(Math.max(0.0001, this.volume), now + fadeSeconds);
      return this.volume;
    }

    setEnabled(enabled, options = {}) {
      this.enabled = Boolean(enabled);
      if (options.persist !== false) {
        try { this.root.localStorage?.setItem(MUSIC_PREFERENCE_KEY, String(this.enabled)); } catch { /* Optional. */ }
      }
      if (!this.enabled) {
        this.stop({ fadeSeconds: options.fadeSeconds ?? 0.7 });
        this.installAutoplayUnlock();
        return Promise.resolve(false);
      }
      this.installAutoplayUnlock();
      return this.start({ fadeSeconds: options.fadeSeconds ?? 1.4 });
    }

    toggle(options = {}) {
      return this.setEnabled(!this.enabled, options);
    }

    syncWithGameSave() {
      return this.setEnabled(readStoredEnabled(this.root), { persist: false });
    }

    installAutoplayUnlock(target = typeof document !== 'undefined' ? document : null) {
      if (!target || this.unlockHandler) return;
      this.unlockTarget = target;
      this.unlockHandler = () => {
        if (!this.enabled) return;
        // Do not await: AudioContext.resume must remain inside the trusted event.
        this.start().catch(() => {});
      };
      target.addEventListener('pointerdown', this.unlockHandler, { capture: true, passive: true });
      target.addEventListener('touchend', this.unlockHandler, { capture: true, passive: true });
      target.addEventListener('keydown', this.unlockHandler, { capture: true });
    }

    _removeAutoplayUnlock() {
      if (!this.unlockTarget || !this.unlockHandler) return;
      this.unlockTarget.removeEventListener('pointerdown', this.unlockHandler, true);
      this.unlockTarget.removeEventListener('touchend', this.unlockHandler, true);
      this.unlockTarget.removeEventListener('keydown', this.unlockHandler, true);
      this.unlockTarget = null;
      this.unlockHandler = null;
    }

    getState() {
      return Object.freeze({
        enabled: this.enabled,
        playing: this.playing,
        contextState: this.context?.state || 'unavailable',
        volume: this.volume,
        title: MUSIC_META.title,
        durationSeconds: MUSIC_META.durationSeconds,
      });
    }
  }

  const root = typeof window !== 'undefined' ? window : globalThis;
  const music = new CalmMineScore({ root });
  root.DepthZeroMusic = music;
  root.DepthZeroMusicClass = CalmMineScore;

  if (typeof document !== 'undefined') {
    music.installAutoplayUnlock(document);
    root.addEventListener?.('depthzero:audio-preference', (event) => {
      music.setEnabled(event.detail?.enabled !== false).catch(() => {});
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CalmMineScore, MUSIC_META, BAR_SCORE, CHORDS };
  }
})();
