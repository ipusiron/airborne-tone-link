/* Airborne Tone Link - MIT (c) 2026 ipusiron.
 * Power/bin helpers adapted from Ultrasonic Reach Meter by the same author. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AirborneCodec = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FFT_SIZE = 2048;
  const MAX_BYTES = 256;
  const MAX_SECONDS = 300;
  const MAX_DB = -12;
  const RECEIVE_POWER_FLOOR = 1e-12;
  const CONFIDENCE_DB = 6;
  // Physical frequencies are shared across devices, not derived from the receiver rate.
  // Verified using native offline rendering at 44.1/48 kHz, including resampling.
  const MODES = Object.freeze({
    reliable: Object.freeze({ f0: 1500, spacing: 94 }),
    ultrasonic: Object.freeze({ f0: 16000, spacing: 94 })
  });
  const TIMINGS = Object.freeze({ short: 0.085, long: 0.192, longer: 0.384 });
  const PREAMBLE = Object.freeze([0, 1, 0, 1]);
  const END = Object.freeze([0, 1]);

  function rateValue(rate) {
    if (!Number.isFinite(rate) || rate < 3000 || rate > 768000) throw new RangeError('invalidRate');
    return rate;
  }

  function config(mode, rate, options = {}) {
    const preset = MODES[mode];
    if (!Object.hasOwn(MODES, mode)) throw new RangeError('invalidMode');
    const timing = options.timing === undefined ? 'long' : options.timing;
    const repeats = options.repeats === undefined ? 2 : options.repeats;
    if (!Object.hasOwn(TIMINGS, timing) || ![1, 2].includes(repeats)) throw new RangeError('invalidSettings');
    const symbol = TIMINGS[timing];
    rateValue(rate);
    const tones = Array.from({ length: 32 }, (_, i) => preset.f0 + i * preset.spacing);
    const markers = [preset.f0 - 2 * preset.spacing, preset.f0 - preset.spacing];
    const upper = 0.45 * rate;
    return { ...preset, mode, rate, tones, markers, upper, timing, symbol, repeats,
      supported: tones[31] <= upper && FFT_SIZE / rate + 0.014 < symbol };
  }

  function bytesOf(text) {
    if (typeof text !== 'string') throw new TypeError('invalidText');
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new RangeError('invalidUnicode');
      } else if (code >= 0xdc00 && code <= 0xdfff) throw new RangeError('invalidUnicode');
    }
    const bytes = Array.from(new TextEncoder().encode(text));
    if (bytes.length > MAX_BYTES) throw new RangeError('tooLong');
    return bytes;
  }

  function validByte(value) {
    return Number.isInteger(value) && value >= 0 && value <= 255;
  }

  function crc8(bytes) {
    let crc = 0;
    for (const byte of bytes) {
      if (!validByte(byte)) throw new RangeError('invalidByte');
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ ((crc & 0x80) ? 0x07 : 0)) & 255;
    }
    return crc;
  }

  function byteTones(byte, settings) {
    if (!validByte(byte)) throw new RangeError('invalidByte');
    return [settings.tones[byte >> 4], settings.tones[16 + (byte & 15)]];
  }

  function frame(text) {
    const payload = bytesOf(text);
    // FF introduces a two-byte, big-endian length for 255 and 256 bytes.
    // Short frames retain their original one-byte length and CRC input.
    const header = payload.length < 255 ? [payload.length] : [255, payload.length >> 8, payload.length & 255];
    const body = [...header, ...payload];
    return [...PREAMBLE.map(value => ({ kind: 'marker', value })),
      ...[...body, crc8(body)].map(value => ({ kind: 'data', value })),
      ...END.map(value => ({ kind: 'marker', value }))];
  }

  function partialText(bytes) {
    let output = '', segment = [];
    const flush = () => {
      output += new TextDecoder('utf-8').decode(Uint8Array.from(segment), { stream: true });
      segment = [];
    };
    for (const byte of bytes) {
      if (byte === null) { flush(); output += '?'; }
      else segment.push(byte);
    }
    flush();
    return output;
  }

  function textOf(bytes) {
    if (!bytes.every(validByte)) return { text: partialText(bytes), valid: false };
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes)), valid: true }; }
    catch (_) { return { text: new TextDecoder().decode(Uint8Array.from(bytes)), valid: false }; }
  }

  function frequencyBin(frequency, rate, size = FFT_SIZE) {
    return Math.round(frequency * size / rateValue(rate));
  }

  function bandPower(spectrum, frequency, rate) {
    const center = frequencyBin(frequency, rate);
    let maximum = 0;
    // One adjacent bin covers the peak at either rate without sharing the midpoint
    // with the next candidate tone (roughly four bins away).
    for (let bin = Math.max(0, center - 1); bin <= Math.min(spectrum.length - 1, center + 1); bin++) {
      if (Number.isFinite(spectrum[bin])) maximum = Math.max(maximum, 10 ** (spectrum[bin] / 10));
    }
    return maximum;
  }

  function deltaDb(signal, background) {
    return 10 * Math.log10(Math.max(signal, RECEIVE_POWER_FLOOR) / Math.max(background, RECEIVE_POWER_FLOOR));
  }

  function peak(values) {
    const ordered = values.map((power, index) => ({ power, index })).sort((a, b) => b.power - a.power);
    const first = ordered[0], second = ordered[1];
    const confidence = deltaDb(first.power, second.power);
    return { value: first.index, power: first.power, confidence,
      valid: first.power > RECEIVE_POWER_FLOOR && confidence >= CONFIDENCE_DB };
  }

  function classifyPowers(powers, markers) {
    if (powers.length !== 32 || markers.length !== 2 ||
        [...powers, ...markers].some(power => !Number.isFinite(power) || power < 0)) {
      throw new RangeError('invalidPowers');
    }
    const a = peak(powers.slice(0, 16)), b = peak(powers.slice(16));
    const marker = peak(markers);
    if (marker.valid && deltaDb(marker.power, Math.max(a.power, b.power)) >= CONFIDENCE_DB) {
      return { kind: 'marker', value: marker.value, confidence: marker.confidence, powers, markers };
    }
    return { kind: 'data', value: a.valid && b.valid ? (a.value << 4) | b.value : null,
      confidence: Math.min(a.confidence, b.confidence), powers, markers };
  }

  function demodulate(spectrum, settings) {
    return classifyPowers(settings.tones.map(f => bandPower(spectrum, f, settings.rate)),
      settings.markers.map(f => bandPower(spectrum, f, settings.rate)));
  }

  function averageDecision(samples) {
    if (!samples.length) return { kind: 'data', value: null, confidence: 0 };
    const average = key => samples[0][key].map((_, index) =>
      samples.reduce((sum, sample) => sum + sample[key][index], 0) / samples.length);
    return classifyPowers(average('powers'), average('markers'));
  }

  function createDecoder(settings) {
    if (!settings.supported) throw new RangeError('unsupportedBand');
    const period = settings.symbol;
    const gate = Math.min(period * 0.18, (period - FFT_SIZE / settings.rate) / 2 - 0.007);
    let history = [], markerValue = null, lastMarkerTime = -Infinity, previousTime = -Infinity;
    let start = null, slot = 0, samples = [], length = null, headerSize = 1, body = [], confidences = [], endings = [];
    const diagnostics = { windows: 0, dataWindows: 0, markerMask: 0, syncs: 0, headers: 0, lengthErrors: 0,
      maxReadable: 0, readableLength: 0, frames: 0, validFrames: 0, crcFailures: 0, endFailures: 0, utf8Failures: 0, maxGap: 0 };

    function reset() {
      history = [];
      markerValue = null;
      start = null;
      slot = 0;
      samples = [];
      length = null;
      headerSize = 1;
      body = [];
      confidences = [];
      endings = [];
    }

    function finishSlot(events) {
      const decision = averageDecision(samples);
      samples = [];
      if (length === null) {
        if (decision.kind === 'data' && validByte(decision.value)) {
          body.push(decision.value);
          if (slot === 0) {
            if (decision.value === 255) headerSize = 3;
            else length = decision.value;
          } else if (slot === 2) length = body[1] * 256 + body[2];
        } else length = -1;
        if (length !== null && (length < 0 || length > MAX_BYTES || (headerSize === 3 && length < 255))) {
          diagnostics.lengthErrors++;
          events.push({ type: 'error', reason: 'invalidLength' });
          reset();
          return;
        }
        if (length !== null) {
          diagnostics.headers++;
          if (!diagnostics.maxReadable) diagnostics.readableLength = length;
        }
      } else if (slot <= length + headerSize) {
        body.push(decision.kind === 'data' ? decision.value : null);
        if (slot < length + headerSize) {
          const readable = body.slice(headerSize).filter(validByte).length;
          if (readable >= diagnostics.maxReadable) {
            diagnostics.maxReadable = readable;
            diagnostics.readableLength = length;
          }
          confidences.push(decision.confidence);
          events.push({ type: 'byte', bytes: body.slice(headerSize), confidences: [...confidences],
            text: partialText(body.slice(headerSize)), index: slot - headerSize });
        }
      } else {
        endings.push(decision.kind === 'marker' ? decision.value : null);
        if (endings.length === 2) {
          const payload = body.slice(headerSize, -1), decoded = textOf(payload);
          const crcOk = body.every(validByte) && crc8(body.slice(0, -1)) === body.at(-1);
          const endOk = endings.every((value, i) => value === END[i]);
          diagnostics.frames++;
          if (crcOk && endOk && decoded.valid) diagnostics.validFrames++;
          if (!crcOk) diagnostics.crcFailures++;
          if (!endOk) diagnostics.endFailures++;
          if (!decoded.valid) diagnostics.utf8Failures++;
          events.push({ type: 'frame', bytes: payload, text: decoded.text, confidences: [...confidences],
            crcOk, endOk, utf8Ok: decoded.valid, valid: crcOk && endOk && decoded.valid });
          reset();
          return;
        }
      }
      slot++;
    }

    function push(time, decision) {
      if (!Number.isFinite(time) || time <= previousTime) throw new RangeError('nonIncreasingTime');
      if (Number.isFinite(previousTime)) diagnostics.maxGap = Math.max(diagnostics.maxGap, time - previousTime);
      previousTime = time;
      diagnostics.windows++;
      if (decision.kind === 'marker') diagnostics.markerMask |= 1 << decision.value;
      else if (decision.value !== null) diagnostics.dataWindows++;
      const events = [];
      if (start !== null) {
        while (start !== null && time > start + (slot + 0.5) * period + gate) finishSlot(events);
        if (start !== null && Math.abs(time - (start + (slot + 0.5) * period)) <= gate) samples.push(decision);
      }
      if (decision.kind !== 'marker') {
        if (time - lastMarkerTime > period * 0.5) { history = []; markerValue = null; }
        return events;
      }
      lastMarkerTime = time;
      if (decision.value === markerValue) return events;
      markerValue = decision.value;
      history.push({ value: markerValue, time });
      history = history.slice(-4);
      if (history.length !== 4 || !history.every((entry, i) => entry.value === PREAMBLE[i])) return events;
      // The first observed onset may be clipped. Use the three later transitions;
      // keep the protocol period fixed so polling jitter cannot accumulate as drift.
      if (![2, 3].every(i => Math.abs(history[i].time - history[i - 1].time - period) <= period * 0.25)) return events;
      const nextStart = history.slice(1).reduce((sum, entry, i) => sum + entry.time - (i + 1) * period, 0) / 3 + 4 * period;
      // A fresh preamble also recovers from a corrupt but plausible long length.
      reset();
      start = nextStart;
      diagnostics.syncs++;
      events.push({ type: 'sync' });
      return events;
    }
    return { push, reset, state: () => ({ synchronized: start !== null, slot, length }), diagnostics: () => ({ ...diagnostics }) };
  }

  function matchRate(expected, actual, role) {
    if (role === 'receive' || typeof expected !== 'string') return null;
    const a = Array.from(expected), b = Array.from(actual);
    const total = Math.max(a.length, b.length);
    return total === 0 ? 100 : 100 * a.filter((character, i) => character === b[i]).length / total;
  }

  function duration(length, mode, options = {}) {
    if (!Number.isInteger(length) || length < 0 || length > MAX_BYTES || !MODES[mode]) throw new RangeError('invalidLength');
    const { symbol, repeats } = config(mode, 48000, options);
    return 0.5 + (length + 8 + (length >= 255 ? 2 : 0)) * symbol * repeats + (repeats - 1) * 0.25;
  }

  function processing(settings = {}) {
    return Object.fromEntries(['echoCancellation', 'noiseSuppression', 'autoGainControl'].map(key =>
      [key, settings[key] === true ? 'on' : settings[key] === false ? 'off' : 'unreported']));
  }

  function gain(db) {
    if (!Number.isFinite(db)) throw new RangeError('invalidGain');
    return 10 ** (Math.max(-60, Math.min(MAX_DB, db)) / 20);
  }

  function toneSamples(frequencies, rate, seconds, db) {
    rateValue(rate);
    if (!Number.isInteger(rate) || !frequencies.length || frequencies.length > 2 ||
        frequencies.some(f => !Number.isInteger(f) || f <= 0 || f > rate * 0.45) ||
        !Number.isFinite(seconds) || seconds < 0.04 || seconds > 1) throw new RangeError('invalidTone');
    const count = Math.round(seconds * rate), ramp = Math.round(0.006 * rate);
    const samples = new Float32Array(count), amplitude = gain(db) / frequencies.length;
    for (let i = 0; i < count; i++) {
      const envelope = Math.min(1, i / ramp, (count - 1 - i) / ramp);
      samples[i] = frequencies.reduce((sum, f) => sum + amplitude * Math.sin(2 * Math.PI * f * i / rate), 0) * envelope;
    }
    return samples;
  }

  function transmission(text, settings, db = -30) {
    if (!settings.supported) throw new RangeError('unsupportedBand');
    const symbols = frame(text), rate = settings.rate;
    const count = Math.round(settings.symbol * rate);
    const lead = Math.round(0.25 * rate), gap = Math.round(0.25 * rate);
    const size = lead * 2 + symbols.length * count * settings.repeats + gap * (settings.repeats - 1);
    const samples = new Float32Array(size), timeline = [];
    let offset = lead;
    for (let pass = 0; pass < settings.repeats; pass++) {
      for (const [index, symbol] of symbols.entries()) {
        const frequencies = symbol.kind === 'marker' ? [settings.markers[symbol.value]] : byteTones(symbol.value, settings);
        samples.set(toneSamples(frequencies, rate, settings.symbol, db), offset);
        timeline.push({ ...symbol, frequencies, start: offset / rate, end: (offset + count) / rate, pass, index });
        offset += count;
      }
      if (pass + 1 < settings.repeats) offset += gap;
    }
    return { samples, timeline, rate, duration: samples.length / rate };
  }

  // Radix-2 FFT with the periodic Blackman window used by AnalyserNode.
  // Offline input is local PCM; no output node or microphone is required.
  const blackman = Float64Array.from({ length: FFT_SIZE }, (_, i) =>
    0.42 - 0.5 * Math.cos(2 * Math.PI * i / FFT_SIZE) + 0.08 * Math.cos(4 * Math.PI * i / FFT_SIZE));

  function spectrumOf(samples, offset = 0) {
    if (!Number.isInteger(offset) || offset < 0 || offset + FFT_SIZE > samples.length) throw new RangeError('invalidWindow');
    const real = new Float64Array(FFT_SIZE), imaginary = new Float64Array(FFT_SIZE);
    for (let i = 0, j = 0; i < FFT_SIZE; i++) {
      const value = samples[offset + i];
      real[j] = (Number.isFinite(value) ? value : 0) * blackman[i];
      let bit = FFT_SIZE >> 1;
      while (j & bit) { j ^= bit; bit >>= 1; }
      j ^= bit;
    }
    for (let size = 2; size <= FFT_SIZE; size *= 2) {
      const half = size / 2, angle = -2 * Math.PI / size;
      for (let start = 0; start < FFT_SIZE; start += size) {
        for (let j = 0; j < half; j++) {
          const a = start + j, b = a + half, cosine = Math.cos(angle * j), sine = Math.sin(angle * j);
          const r = real[b] * cosine - imaginary[b] * sine, im = real[b] * sine + imaginary[b] * cosine;
          real[b] = real[a] - r; imaginary[b] = imaginary[a] - im;
          real[a] += r; imaginary[a] += im;
        }
      }
    }
    return Float32Array.from({ length: FFT_SIZE / 2 }, (_, i) =>
      10 * Math.log10(Math.max(1e-30, (real[i] ** 2 + imaginary[i] ** 2) / FFT_SIZE ** 2)));
  }

  const MAX_WAV_BYTES = 128 * 1024 * 1024;
  function decodeWav(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 44 || buffer.byteLength > MAX_WAV_BYTES) {
      throw new RangeError('invalidWav');
    }
    const view = new DataView(buffer);
    const tag = at => String.fromCharCode(...new Uint8Array(buffer, at, 4));
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== buffer.byteLength) {
      throw new RangeError('invalidWav');
    }
    let format = null, data = null;
    for (let at = 12; at + 8 <= buffer.byteLength;) {
      const name = tag(at), length = view.getUint32(at + 4, true), start = at + 8, end = start + length;
      if (end > buffer.byteLength) throw new RangeError('invalidWav');
      if (name === 'fmt ') {
        if (length < 16 || format) throw new RangeError('invalidWav');
        format = { code: view.getUint16(start, true), channels: view.getUint16(start + 2, true),
          rate: view.getUint32(start + 4, true), byteRate: view.getUint32(start + 8, true),
          align: view.getUint16(start + 12, true), bits: view.getUint16(start + 14, true) };
      }
      if (name === 'data') {
        if (data) throw new RangeError('invalidWav');
        data = { start, length };
      }
      at = end + length % 2;
    }
    if (!format || !data) throw new RangeError('invalidWav');
    const { code, channels, rate, byteRate, align, bits } = format;
    const valid = (code === 1 && [16, 24, 32].includes(bits)) || (code === 3 && bits === 32);
    if (!valid || ![1, 2].includes(channels) || rate < 8000 || rate > 96000 ||
        align !== channels * bits / 8 || byteRate !== rate * align || data.length % align) throw new RangeError('invalidWav');
    const count = data.length / align;
    if (count < FFT_SIZE || count > rate * MAX_SECONDS) throw new RangeError('wavDuration');
    const samples = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      let sum = 0;
      for (let channel = 0; channel < channels; channel++) {
        const at = data.start + i * align + channel * bits / 8;
        let value;
        if (code === 3) value = view.getFloat32(at, true);
        else if (bits === 16) value = view.getInt16(at, true) / 32768;
        else if (bits === 24) {
          const raw = view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16);
          value = ((raw << 8) >> 8) / 8388608;
        } else value = view.getInt32(at, true) / 2147483648;
        if (!Number.isFinite(value) || Math.abs(value) > 1) throw new RangeError('invalidWav');
        sum += value;
      }
      samples[i] = sum / channels;
    }
    return { samples, rate, channels };
  }

  return Object.freeze({ FFT_SIZE, MAX_BYTES, MAX_SECONDS, MAX_DB, RECEIVE_POWER_FLOOR, CONFIDENCE_DB, MODES, TIMINGS, PREAMBLE, END,
    config, bytesOf, textOf, partialText, crc8, byteTones, frame, frequencyBin, bandPower, deltaDb,
    classifyPowers, demodulate, createDecoder, matchRate, duration, processing, gain, toneSamples, transmission,
    MAX_WAV_BYTES, spectrumOf, decodeWav });
}));
