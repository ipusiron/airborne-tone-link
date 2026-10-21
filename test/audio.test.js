'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../codec-core.js');
const { create } = require('../audio-io.js');

function setup(options = {}) {
  let now = 0, timerId = 0, permissionResolve;
  const timers = new Set(), contexts = [], requested = [], sources = [];
  let stoppedTracks = 0, reads = 0;
  const track = new EventTarget();
  Object.assign(track, { muted: Boolean(options.muted), readyState: 'live', enabled: true,
    getSettings: () => ({ sampleRate: 44100, channelCount: 1, echoCancellation: false,
      noiseSuppression: false, autoGainControl: false, ...options.settings }),
    stop() { this.readyState = 'ended'; stoppedTracks++; } });
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  class Context extends EventTarget {
    constructor() {
      super();
      this.sampleRate = 48000;
      this.state = 'suspended';
      this.destination = { kind: 'destination' };
      this.outputLatency = 0.02;
      this.analysers = [];
      contexts.push(this);
    }
    get currentTime() { return options.frozen ? 0 : now / 1000; }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createAnalyser() {
      const node = { kind: 'analyser', frequencyBinCount: 1024, targets: [],
        connect(target) { this.targets.push(target); }, disconnect() { this.disconnected = true; },
        getFloatFrequencyData(values) { reads++; values.fill(-120); if (options.spectrum) options.spectrum(values, now, this); } };
      this.analysers.push(node);
      if (!this.analyser) this.analyser = node;
      return node;
    }
    createMediaStreamSource(received) {
      assert.equal(received, stream);
      const node = { targets: [], connect(target) { this.targets.push(target); }, disconnect() { this.disconnected = true; } };
      this.input = node;
      return node;
    }
    createBuffer(channels, count, rate) {
      return { channels, count, rate, copyToChannel(samples) { this.samples = samples.slice(); } };
    }
    createBufferSource() {
      const node = new EventTarget();
      Object.assign(node, { targets: [], stops: [], connect(target) { this.targets.push(target); },
        disconnect() { this.disconnected = true; }, start(time) { this.startTime = time; }, stop(time) { this.stops.push(time); } });
      sources.push(node);
      return node;
    }
  }
  const host = {
    AudioContext: Context, performance: { now: () => now },
    setTimeout(callback, ms) {
      const id = ++timerId;
      timers.add(id);
      queueMicrotask(() => {
        if (!timers.has(id)) return;
        now += ms;
        if (options.tick) options.tick(now, track);
        if (!timers.has(id)) return;
        timers.delete(id);
        callback();
      });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    navigator: {
      audioSession: { type: 'auto' },
      mediaDevices: {
        getSupportedConstraints: () => ({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: true }),
        getUserMedia(request) {
          requested.push(request);
          if (options.denied) return Promise.reject(new Error('Denied'));
          if (options.pending) return new Promise(resolve => { permissionResolve = resolve; });
          return Promise.resolve(stream);
        }
      }
    }
  };
  return { host, track, contexts, requested, sources, audio: create(host), release: () => permissionResolve(stream),
    metrics: () => ({ now, stoppedTracks, reads, timers: timers.size }) };
}

test('Audio: no context, output or microphone is created before an action', () => {
  const f = setup();
  assert.equal(f.contexts.length, 0);
  assert.equal(f.requested.length, 0);
  assert.equal(f.sources.length, 0);
});
for (const role of ['send', 'receive', 'loopback']) {
  test(`Audio: ${role} selects the correct session, input constraints and graph`, async () => {
    const f = setup();
    const info = await f.audio.open(role);
    const microphone = role !== 'send';
    assert.equal(f.requested.length, microphone ? 1 : 0);
    assert.equal(info.session, microphone ? 'play-and-record' : 'playback');
    assert.equal(f.contexts[0].analyser.fftSize, 2048);
    assert.equal(f.contexts[0].analyser.smoothingTimeConstant, 0);
    if (microphone) {
      assert.deepEqual(f.requested[0].audio.echoCancellation, { ideal: false });
      assert.deepEqual(f.requested[0].audio.noiseSuppression, { ideal: false });
      assert.deepEqual(f.requested[0].audio.autoGainControl, { ideal: false });
      assert.equal(info.sampleRate, 48000);
      assert.equal(info.inputSampleRate, 44100);
      assert.equal(f.contexts[0].input.targets[0], f.contexts[0].analyser);
      assert.equal(f.contexts[0].analyser.targets.length, 0);
    } else assert.equal(f.contexts[0].analyser.targets[0], f.contexts[0].destination);
    if (role === 'loopback') {
      assert.equal(f.contexts[0].analysers.length, 2);
      const [receive, transmit] = f.contexts[0].analysers;
      assert.notEqual(receive, transmit);
      assert.deepEqual(transmit.targets, [f.contexts[0].destination]);
      assert.equal(transmit.fftSize, 2048);
      assert.equal(transmit.smoothingTimeConstant, 0);
    }
    await f.audio.close();
    assert.ok(f.contexts[0].analysers.every(node => node.disconnected));
    assert.equal(f.contexts[0].state, 'closed');
    assert.equal(f.metrics().stoppedTracks, microphone ? 1 : 0);
  });
}
test('Audio: initial muted input is rejected and released', async () => {
  const f = setup({ muted: true });
  await assert.rejects(f.audio.open('receive'), /inputInterrupted/);
  assert.equal(f.metrics().stoppedTracks, 1);
});
test('Audio: denied microphone is reported without emitting sound', async () => {
  const f = setup({ denied: true });
  await assert.rejects(f.audio.open('receive'), /microphoneError/);
  assert.equal(f.sources.length, 0);
  await f.audio.close();
});
test('Audio: stopping a pending permission request releases the eventual track', async () => {
  const f = setup({ pending: true });
  const opening = f.audio.open('receive');
  await Promise.resolve();
  f.audio.stop();
  f.release();
  await assert.rejects(opening, /cancelled/);
  assert.equal(f.metrics().stoppedTracks, 1);
  assert.equal(f.sources.length, 0);
});
for (const event of ['mute', 'ended']) {
  test(`Audio: ${event} interrupts input and unmute does not resume`, async () => {
    const f = setup({ tick: (now, track) => {
      if (now === 24) {
        if (event === 'mute') track.muted = true;
        else track.readyState = 'ended';
        track.dispatchEvent(new Event(event));
      }
    } });
    const interruptions = [];
    f.audio.onInterrupted(reason => interruptions.push(reason));
    await f.audio.open('receive');
    await assert.rejects(f.audio.run('receive', '', 'reliable', -30), /inputInterrupted/);
    f.track.muted = false;
    f.track.dispatchEvent(new Event('unmute'));
    assert.deepEqual(interruptions, ['inputInterrupted']);
    assert.equal(f.requested.length, 1);
    assert.equal(f.metrics().timers, 0);
    assert.equal(f.metrics().stoppedTracks, 1);
  });
}
test('Audio: per-read muted checks also handle a missing event', async () => {
  const f = setup({ tick: (now, track) => { if (now === 24) track.muted = true; } });
  await f.audio.open('receive');
  await assert.rejects(f.audio.run('receive', '', 'reliable', -30), /inputInterrupted/);
  await f.audio.close();
});
test('Audio: receive has a wall-clock deadline and does not read overdue frames', async () => {
  const f = setup();
  await f.audio.open('receive');
  await assert.rejects(f.audio.run('receive', '', 'reliable', -30), /noFrame/);
  assert.equal(f.metrics().now, 60000);
  assert.equal(f.metrics().reads, 7499);
  await f.audio.close();
});
test('Audio: a frozen audio clock terminates instead of waiting forever', async () => {
  const f = setup({ frozen: true });
  await f.audio.open('receive');
  await assert.rejects(f.audio.run('receive', '', 'reliable', -30), /audioInterrupted/);
  assert.ok(f.metrics().now < 1100);
  await f.audio.close();
});
test('Audio: finite source stop is scheduled before polling and immediate stop cancels timers', async () => {
  let stop;
  const f = setup({ tick: now => { if (now === 24) stop(); } });
  stop = () => f.audio.stop();
  await f.audio.open('send');
  await assert.rejects(f.audio.run('send', 'A', 'reliable', 20), /cancelled/);
  const source = f.sources[0];
  assert.ok(source.stops[0] > source.startTime);
  assert.equal(source.stops[1], undefined);
  assert.ok(source.disconnected);
  const peak = source.buffer.samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  assert.ok(peak <= core.gain(-12) + 1e-8);
  assert.equal(f.metrics().timers, 0);
});
test('Audio: suspended context interrupts an active session', async () => {
  const f = setup(), reasons = [];
  f.audio.onInterrupted(reason => reasons.push(reason));
  await f.audio.open('receive');
  f.contexts[0].state = 'suspended';
  f.contexts[0].dispatchEvent(new Event('statechange'));
  assert.deepEqual(reasons, ['audioInterrupted']);
  assert.equal(f.metrics().stoppedTracks, 1);
});
test('Audio: failed physical loopback self-check prevents transmission', async () => {
  const f = setup();
  await f.audio.open('loopback');
  await assert.rejects(f.audio.run('loopback', 'HELLO', 'reliable', -30), /selfCheckFailed/);
  assert.equal(f.sources.length, 1);
  assert.equal(f.sources[0].targets[0], f.contexts[0].destination);
  assert.equal(f.sources[0].buffer.count, 12000);
  await f.audio.close();
});

test('Audio: loopback emits separate synchronous spectra and never decodes the outgoing graph as microphone data', async () => {
  const events = [], cfg = core.config('reliable', 48000);
  const f = setup({ spectrum(values, now, node) {
    if (now > 200 && now < 400) values[core.frequencyBin(1000, 48000)] = -30;
    if (now > 500 && node === f.contexts[0].analysers[1]) {
      for (const frequency of core.byteTones(65, cfg)) values[core.frequencyBin(frequency, 48000)] = -30;
    }
  } });
  await f.audio.open('loopback');
  await assert.rejects(f.audio.run('loopback', 'A', 'reliable', -30, event => {
    events.push(event);
    if (event.type === 'spectrum' && event.side === 'receive') f.audio.stop();
  }), /cancelled/);
  const spectra = events.filter(event => event.type === 'spectrum');
  assert.deepEqual(spectra.map(event => event.side), ['transmit', 'receive']);
  assert.equal(spectra[0].time, spectra[1].time);
  assert.equal(spectra[0].decision.value, 65);
  assert.equal(spectra[1].decision.value, null);
  assert.equal(events.some(event => ['byte', 'frame'].includes(event.type)), false);
  assert.equal(f.sources[1].targets[0], f.contexts[0].analysers[1]);
  assert.ok(f.contexts[0].analysers.every(node => node.disconnected));
  await f.audio.close();
});

for (const rate of [44100, 48000]) {
  for (const mode of ['reliable', 'ultrasonic']) {
    test(`Audio: ${mode} buffer at ${rate} Hz stays capped and has finite repeated frames`, () => {
      const cfg = core.config(mode, rate), wave = core.transmission('日本語', cfg, 100);
      const peak = wave.samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
      assert.ok(peak <= core.gain(-12) + 1e-8);
      assert.equal(wave.timeline.length, (9 + 8) * cfg.repeats);
      assert.equal(wave.samples[0], 0);
      assert.equal(wave.samples.at(-1), 0);
      assert.ok(Math.abs(wave.duration - core.duration(9, mode)) < 0.001);
      assert.deepEqual(wave.timeline[5].frequencies, core.byteTones(core.bytesOf('日')[0], cfg));
    });
  }
}
test('Audio: unsafe frequencies, invalid gain and unsupported bands are rejected', () => {
  assert.throws(() => core.toneSamples([22000], 44100, 0.1, -30), /invalidTone/);
  assert.throws(() => core.toneSamples([1000], 48000, 0.01, -30), /invalidTone/);
  assert.throws(() => core.gain(NaN), /invalidGain/);
  assert.throws(() => core.transmission('A', core.config('ultrasonic', 32000)), /unsupportedBand/);
});
