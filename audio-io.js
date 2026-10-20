/* Airborne Tone Link - MIT (c) 2026 ipusiron.
 * Input constraints, interruption and resource handling adapted from Day119. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./codec-core.js'));
  else root.AirborneAudio = factory(root.AirborneCodec);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  function create(host = globalThis) {
    const nav = host.navigator || {};
    let context = null, stream = null, track = null, input = null, analyser = null, source = null;
    let settings = {}, session = 'unreported', generation = 0, active = false, trackHandler = null;
    let interrupted = () => {};
    const pending = new Set();

    function available(microphone = false) {
      return Boolean((host.AudioContext || host.webkitAudioContext) &&
        (!microphone || (nav.mediaDevices && nav.mediaDevices.getUserMedia)));
    }

    function stopTone() {
      if (!source) return;
      const old = source;
      source = null;
      try { old.stop(); } catch (_) { /* Already finished. */ }
      old.disconnect();
    }

    function stop(reason = 'cancelled') {
      active = false;
      generation++;
      for (const cancel of [...pending]) cancel(reason);
      pending.clear();
      stopTone();
      if (track) {
        track.removeEventListener('mute', trackHandler);
        track.removeEventListener('ended', trackHandler);
      }
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (input) input.disconnect();
      if (analyser) analyser.disconnect();
      stream = track = input = analyser = trackHandler = null;
    }

    async function close() {
      stop();
      const old = context;
      context = null;
      if (old && old.state !== 'closed') {
        try { await old.close(); } catch (_) { /* Page may be leaving. */ }
      }
    }

    function wait(seconds, token = generation) {
      return new Promise((resolve, reject) => {
        if (token !== generation) { reject(new Error('cancelled')); return; }
        const cancel = reason => {
          host.clearTimeout(timer);
          pending.delete(cancel);
          reject(new Error(reason));
        };
        const timer = host.setTimeout(() => {
          pending.delete(cancel);
          if (token !== generation) reject(new Error('cancelled'));
          else resolve();
        }, seconds * 1000);
        pending.add(cancel);
      });
    }

    function checkInput() {
      if (track && (track.muted || track.readyState === 'ended' || track.enabled === false)) {
        throw new Error('inputInterrupted');
      }
    }

    function info() {
      return { sampleRate: context ? context.sampleRate : null, inputSampleRate: settings.sampleRate || null,
        channelCount: settings.channelCount || null, processing: core.processing(settings), session,
        outputLatency: context && Number.isFinite(context.outputLatency) ? Math.max(0, context.outputLatency) : 0 };
    }

    async function open(role, onState = () => {}) {
      stop();
      const token = generation, microphone = role === 'receive' || role === 'loopback';
      if (!available(microphone)) throw new Error('noAudio');
      const Audio = host.AudioContext || host.webkitAudioContext;
      if (!context || context.state === 'closed') {
        context = new Audio();
        const openedContext = context;
        context.addEventListener('statechange', () => {
          if (context === openedContext && active && context.state !== 'running') {
            stop('audioInterrupted');
            interrupted('audioInterrupted');
          }
        });
      }
      session = 'unreported';
      if (nav.audioSession) {
        try { nav.audioSession.type = microphone ? 'play-and-record' : 'playback'; session = nav.audioSession.type; }
        catch (_) { /* Optional browser feature. */ }
      }
      await context.resume();
      if (token !== generation) throw new Error('cancelled');
      settings = {};
      if (microphone) {
        onState('permission');
        const wanted = { echoCancellation: false, noiseSuppression: false,
          autoGainControl: false, voiceIsolation: false, channelCount: 1 };
        const supported = nav.mediaDevices.getSupportedConstraints ? nav.mediaDevices.getSupportedConstraints() : null;
        const audio = {};
        for (const [key, value] of Object.entries(wanted)) {
          if (!supported || supported[key]) audio[key] = { ideal: value };
        }
        let opened;
        try { opened = await nav.mediaDevices.getUserMedia({ audio, video: false }); }
        catch (_) { throw new Error('microphoneError'); }
        if (token !== generation) {
          opened.getTracks().forEach(t => t.stop());
          throw new Error('cancelled');
        }
        stream = opened;
        track = stream.getAudioTracks()[0];
        if (!track) { stop(); throw new Error('microphoneError'); }
        settings = track.getSettings ? track.getSettings() || {} : {};
        trackHandler = () => {
          if (token !== generation) return;
          stop('inputInterrupted');
          interrupted('inputInterrupted');
        };
        track.addEventListener('mute', trackHandler);
        track.addEventListener('ended', trackHandler);
        try { checkInput(); } catch (error) { stop(); throw error; }
      }
      try {
        analyser = context.createAnalyser();
        analyser.fftSize = core.FFT_SIZE;
        analyser.smoothingTimeConstant = 0;
        if (microphone) {
          input = context.createMediaStreamSource(stream);
          input.connect(analyser);
        } else if (role === 'send') analyser.connect(context.destination);
      } catch (_) { stop(); throw new Error('microphoneError'); }
      active = true;
      return info();
    }

    function emit(samples, destination) {
      if (!context || !active) throw new Error('cancelled');
      stopTone();
      const buffer = context.createBuffer(1, samples.length, context.sampleRate);
      buffer.copyToChannel(samples, 0);
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.connect(destination);
      const start = context.currentTime + 0.03, end = start + samples.length / context.sampleRate;
      source = node;
      node.start(start);
      node.stop(end);
      node.addEventListener('ended', () => {
        node.disconnect();
        node.buffer = null;
        if (source === node) source = null;
      });
      return { start, end };
    }

    function read() {
      checkInput();
      if (!context || !analyser) throw new Error('cancelled');
      const spectrum = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(spectrum);
      return { spectrum, time: context.currentTime - core.FFT_SIZE / (2 * context.sampleRate) };
    }

    async function selfCheck(db, onState) {
      const token = generation;
      onState('selfCheck');
      await wait(0.1, token);
      const background = core.bandPower(read().spectrum, 1000, context.sampleRate);
      const emitted = emit(core.toneSamples([1000], context.sampleRate, 0.25, db), context.destination);
      await wait(0.18, token);
      const current = read();
      // A delayed timer must not treat an FFT window outside the tone as a measurement.
      const inWindow = current.time >= emitted.start + 0.04 && current.time <= emitted.end - 0.04;
      const signal = core.bandPower(current.spectrum, 1000, context.sampleRate);
      await wait(0.15, token);
      stopTone();
      if (!inWindow || signal <= core.RECEIVE_POWER_FLOOR || core.deltaDb(signal, background) < 10) {
        throw new Error('selfCheckFailed');
      }
      await wait(0.1, token);
    }

    async function run(role, text, mode, db, onEvent = () => {}) {
      if (!active || !context) throw new Error('cancelled');
      const token = generation, cfg = core.config(mode, context.sampleRate);
      if (!cfg.supported) throw new Error('unsupportedBand');
      if (role === 'loopback') await selfCheck(db, key => onEvent({ type: 'status', key }));
      const decoder = core.createDecoder(cfg);
      let emitted = null, deadline = host.performance.now() + 60000;
      if (role !== 'receive') {
        const wave = core.transmission(text, cfg, db);
        // The loopback path deliberately has no direct connection to the analyser.
        emitted = emit(wave.samples, role === 'send' ? analyser : context.destination);
        deadline = host.performance.now() + Math.min(60000, (wave.duration + info().outputLatency + 0.6) * 1000);
      }
      onEvent({ type: 'status', key: role === 'receive' ? 'receiving' : 'transmitting' });
      let previous = -Infinity, lastAdvance = host.performance.now(), result = null;
      while (host.performance.now() < deadline) {
        await wait(0.008, token);
        if (host.performance.now() >= deadline) break;
        if (!context || context.state !== 'running') throw new Error('audioInterrupted');
        const current = read();
        if (current.time <= previous) {
          if (host.performance.now() - lastAdvance > 1000) throw new Error('audioInterrupted');
          continue;
        }
        previous = current.time;
        lastAdvance = host.performance.now();
        const decision = core.demodulate(current.spectrum, cfg);
        onEvent({ type: 'spectrum', ...current, decision, settings: cfg });
        for (const event of decoder.push(current.time, decision)) {
          onEvent(event);
          if (event.type === 'frame' && (!result || event.valid || !result.valid)) result = event;
        }
        if (role === 'receive' && result && result.valid) break;
        if (emitted && context.currentTime >= emitted.end + info().outputLatency + 0.2) break;
      }
      stopTone();
      if (!result) throw new Error('noFrame');
      return result;
    }

    async function offline(file, mode, onEvent = () => {}) {
      stop();
      active = true;
      const token = generation;
      if (!file || file.size > core.MAX_WAV_BYTES) throw new Error('invalidWav');
      let buffer = null, pcm = null;
      try {
        buffer = await file.arrayBuffer();
        if (token !== generation) throw new Error('cancelled');
        pcm = core.decodeWav(buffer);
        buffer = null;
        const cfg = core.config(mode, pcm.rate);
        if (!cfg.supported) throw new Error('unsupportedBand');
        onEvent({ type: 'environment', value: { sampleRate: pcm.rate, inputSampleRate: null, session: 'offlineSession',
          processing: core.processing(), channelCount: pcm.channels } });
        onEvent({ type: 'status', key: 'decoding' });
        const decoder = core.createDecoder(cfg), hop = Math.round(pcm.rate * 0.008);
        let result = null, frames = 0;
        for (let offset = 0; offset + core.FFT_SIZE <= pcm.samples.length; offset += hop) {
          if (token !== generation) throw new Error('cancelled');
          const spectrum = core.spectrumOf(pcm.samples, offset);
          const time = (offset + core.FFT_SIZE / 2) / pcm.rate, decision = core.demodulate(spectrum, cfg);
          onEvent({ type: 'spectrum', spectrum, time, decision, settings: cfg });
          for (const event of decoder.push(time, decision)) {
            onEvent(event);
            if (event.type === 'frame' && (!result || event.valid || !result.valid)) result = event;
          }
          if (++frames % 16 === 0) await wait(0.001, token);
        }
        if (!result) throw new Error('noFrame');
        return result;
      } finally {
        // Discard raw file and decoded PCM; only display results survive.
        buffer = pcm = null;
      }
    }

    return { available, open, info, run, offline, read, stop, close, onInterrupted: handler => { interrupted = handler; } };
  }
  return Object.freeze({ create });
}));
