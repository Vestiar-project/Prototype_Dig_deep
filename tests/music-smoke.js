'use strict';

const assert = require('node:assert/strict');
const {
  CalmMineScore,
  MUSIC_META,
  BAR_SCORE,
  CHORDS,
} = require('../js/music.js');

class AudioParamMock {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }

  cancelScheduledValues(time) {
    this.events.push(['cancel', time]);
  }

  setValueAtTime(value, time) {
    this.value = value;
    this.events.push(['set', value, time]);
  }

  exponentialRampToValueAtTime(value, time) {
    this.value = value;
    this.events.push(['ramp', value, time]);
  }
}

class AudioNodeMock {
  constructor(kind = 'node') {
    this.kind = kind;
    this.connections = [];
    this.started = [];
    this.stopped = [];
    this.listeners = new Map();
    this.gain = new AudioParamMock(1);
    this.frequency = new AudioParamMock(440);
    this.Q = new AudioParamMock(0);
    this.detune = new AudioParamMock(0);
    this.threshold = new AudioParamMock(0);
    this.knee = new AudioParamMock(0);
    this.ratio = new AudioParamMock(1);
    this.attack = new AudioParamMock(0);
    this.release = new AudioParamMock(0);
    this.pan = new AudioParamMock(0);
    this.type = '';
    this.buffer = null;
    this.loop = false;
  }

  connect(target) {
    this.connections.push(target);
    return target;
  }

  disconnect() {
    this.connections.length = 0;
  }

  start(...args) {
    this.started.push(args);
  }

  stop(...args) {
    this.stopped.push(args);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }
}

class AudioBufferMock {
  constructor(numberOfChannels, length) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.channels = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length),
    );
  }

  getChannelData(index) {
    return this.channels[index];
  }
}

class AudioContextMock {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 12;
    this.sampleRate = 8_000;
    this.destination = new AudioNodeMock('destination');
    this.nodes = [];
  }

  resume() {
    this.state = 'running';
    return Promise.resolve();
  }

  createNode(kind) {
    const node = new AudioNodeMock(kind);
    this.nodes.push(node);
    return node;
  }

  createGain() { return this.createNode('gain'); }
  createBiquadFilter() { return this.createNode('filter'); }
  createConvolver() { return this.createNode('convolver'); }
  createDynamicsCompressor() { return this.createNode('compressor'); }
  createBufferSource() { return this.createNode('buffer-source'); }
  createOscillator() { return this.createNode('oscillator'); }
  createStereoPanner() { return this.createNode('stereo-panner'); }

  createBuffer(numberOfChannels, length) {
    return new AudioBufferMock(numberOfChannels, length);
  }
}

function createRootMock() {
  const stored = new Map();
  const timeouts = [];
  const intervals = new Map();
  let nextTimerId = 1;

  return {
    AudioContext: AudioContextMock,
    localStorage: {
      getItem(key) { return stored.has(key) ? stored.get(key) : null; },
      setItem(key, value) { stored.set(key, String(value)); },
    },
    setInterval(callback) {
      const id = nextTimerId++;
      intervals.set(id, callback);
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    setTimeout(callback) {
      const id = nextTimerId++;
      timeouts.push({ id, callback });
      return id;
    },
    flushTimeouts() {
      while (timeouts.length > 0) timeouts.shift().callback();
    },
    intervalCount() {
      return intervals.size;
    },
    storedValue(key) {
      return stored.has(key) ? stored.get(key) : null;
    },
  };
}

async function main() {
  assert.equal(MUSIC_META.durationSeconds, 150, 'the score must be exactly 150 seconds');
  assert.equal(MUSIC_META.bars, 40, 'metadata must expose 40 bars');
  assert.equal(BAR_SCORE.length, 40, 'the score must contain 40 bars');
  assert.equal(BAR_SCORE[0], 'Dadd9', 'the seamless loop must begin on Dadd9');
  assert.equal(BAR_SCORE.at(-1), 'Dadd9', 'the seamless loop must resolve to Dadd9');

  for (const [barIndex, chordName] of BAR_SCORE.entries()) {
    assert.ok(CHORDS[chordName], `bar ${barIndex + 1} references unknown chord ${chordName}`);
  }
  for (const [chordName, notes] of Object.entries(CHORDS)) {
    assert.ok(notes.length >= 4, `${chordName} must have at least four notes`);
    assert.ok(notes.every(Number.isFinite), `${chordName} must contain only finite MIDI notes`);
    assert.ok(notes.every((note, index) => index === 0 || note >= notes[index - 1]), `${chordName} notes must be ordered`);
  }

  const root = createRootMock();
  const music = new CalmMineScore({ root });
  assert.equal(music.getState().playing, false, 'construction must not autoplay before a gesture');

  assert.equal(await music.start({ fadeSeconds: 0.05 }), true, 'music must start with Web Audio available');
  assert.equal(music.getState().playing, true, 'music must report playing after start');
  assert.equal(music.context.state, 'running', 'start must resume a suspended AudioContext');
  assert.ok(music.nextBeat >= 4, 'scheduler must fill its initial lookahead');
  assert.ok(music.activeSources.size >= 10, 'the first bar must schedule audible sources');
  assert.equal(root.intervalCount(), 1, 'only one scheduler interval may run');

  // Re-enabling during the mute fade used to be a risky race: its stale
  // timeout must not dispose the newly restored graph.
  await music.setEnabled(false, { fadeSeconds: 0.05 });
  assert.equal(root.storedValue('depth-zero-music-enabled'), 'false', 'mute preference must persist');
  assert.equal(await music.setEnabled(true, { fadeSeconds: 0.05 }), true);
  assert.equal(root.storedValue('depth-zero-music-enabled'), 'true', 're-enable preference must persist');
  root.flushTimeouts();
  assert.equal(music.getState().playing, true, 'quick re-enable must survive the old fade timeout');
  assert.equal(root.intervalCount(), 1, 'quick re-enable must not duplicate the scheduler');

  await music.setEnabled(false, { fadeSeconds: 0.05 });
  root.flushTimeouts();
  assert.equal(music.getState().playing, false, 'mute must dispose the graph after its fade');
  assert.equal(root.intervalCount(), 0, 'mute must clear the scheduler');

  assert.equal(await music.setEnabled(true, { fadeSeconds: 0.05 }), true);
  assert.equal(music.getState().playing, true, 'music must restart after a completed mute');
  assert.ok(music.activeSources.size >= 10, 'restart must schedule a fresh first bar');
  assert.equal(root.intervalCount(), 1, 'restart must create exactly one scheduler');

  root.localStorage.setItem('depth-zero-save-v1', JSON.stringify({ sound: false }));
  await music.syncWithGameSave();
  root.flushTimeouts();
  assert.equal(music.getState().enabled, false, 'the main game save must be able to mute the soundtrack');
  assert.equal(music.getState().playing, false, 'save synchronization must stop an already playing score');
  root.localStorage.setItem('depth-zero-save-v1', JSON.stringify({ sound: true }));
  assert.equal(await music.syncWithGameSave(), true, 'restoring the game audio preference must restart the score');
  assert.equal(music.getState().playing, true);

  music.stop({ fadeSeconds: 0.05 });
  root.flushTimeouts();

  console.log(JSON.stringify({
    ok: true,
    title: MUSIC_META.title,
    durationSeconds: MUSIC_META.durationSeconds,
    bars: BAR_SCORE.length,
    chords: Object.keys(CHORDS).length,
    scheduledSourcesOnStart: true,
    muteReenable: true,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
