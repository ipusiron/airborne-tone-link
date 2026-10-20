/* Airborne Tone Link - MIT (c) 2026 ipusiron.
 * Power/bin helpers adapted from Ultrasonic Reach Meter by the same author. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AirborneCodec = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FFT_SIZE = 2048;
  const MAX_BYTES = 16;
  const MAX_DB = -12;
  const RECEIVE_POWER_FLOOR = 1e-12;
  const CONFIDENCE_DB = 6;
  // Physical frequencies are shared across devices, not derived from the receiver rate.
  // Candidate timings are verified with offline browser rendering before release.
  const MODES = Object.freeze({
    reliable: Object.freeze({ f0: 1500, spacing: 94, symbol: 0.192, repeats: 2 }),
    ultrasonic: Object.freeze({ f0: 16000, spacing: 94, symbol: 0.085, repeats: 1 })
  });
  const PREAMBLE = Object.freeze([0, 1, 0, 1]);
  const END = Object.freeze([0, 1]);

  function rateValue(rate) {
    if (!Number.isFinite(rate) || rate < 3000 || rate > 768000) throw new RangeError('invalidRate');
    return rate;
  }

  function config(mode, rate) {
    const preset = MODES[mode];
    if (!preset) throw new RangeError('invalidMode');
    rateValue(rate);
    const tones = Array.from({ length: 32 }, (_, i) => preset.f0 + i * preset.spacing);
    const markers = [preset.f0 - 2 * preset.spacing, preset.f0 - preset.spacing];
    const upper = 0.45 * rate;
    return { ...preset, mode, rate, tones, markers, upper,
      supported: tones[31] <= upper && FFT_SIZE / rate + 0.014 < preset.symbol };
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
    const body = [payload.length, ...payload];
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
    let start = null, slot = 0, samples = [], length = null, body = [], confidences = [], endings = [];

    function reset() {
      history = [];
      markerValue = null;
      start = null;
      slot = 0;
      samples = [];
      length = null;
      body = [];
      confidences = [];
      endings = [];
    }

    function finishSlot(events) {
      const decision = averageDecision(samples);
      samples = [];
      if (slot === 0) {
        if (decision.kind !== 'data' || decision.value === null || decision.value > MAX_BYTES) {
          events.push({ type: 'error', reason: 'invalidLength' });
          reset();
          return;
        }
        length = decision.value;
        body.push(length);
      } else if (slot <= length + 1) {
        body.push(decision.kind === 'data' ? decision.value : null);
        if (slot <= length) {
          confidences.push(decision.confidence);
          events.push({ type: 'byte', bytes: body.slice(1), confidences: [...confidences],
            text: partialText(body.slice(1)), index: slot - 1 });
        }
      } else {
        endings.push(decision.kind === 'marker' ? decision.value : null);
        if (endings.length === 2) {
          const payload = body.slice(1, -1), decoded = textOf(payload);
          const crcOk = body.every(validByte) && crc8(body.slice(0, -1)) === body.at(-1);
          const endOk = endings.every((value, i) => value === END[i]);
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
      previousTime = time;
      const events = [];
      if (start !== null) {
        while (start !== null && time > start + (slot + 0.5) * period + gate) finishSlot(events);
        if (start !== null && Math.abs(time - (start + (slot + 0.5) * period)) <= gate) samples.push(decision);
        return events;
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
      start = history.slice(1).reduce((sum, entry, i) => sum + entry.time - (i + 1) * period, 0) / 3 + 4 * period;
      events.push({ type: 'sync' });
      return events;
    }
    return { push, reset, state: () => ({ synchronized: start !== null, slot, length }) };
  }

  function matchRate(expected, actual, role) {
    if (role === 'receive' || typeof expected !== 'string') return null;
    const a = Array.from(expected), b = Array.from(actual);
    const total = Math.max(a.length, b.length);
    return total === 0 ? 100 : 100 * a.filter((character, i) => character === b[i]).length / total;
  }

  function duration(length, mode) {
    if (!Number.isInteger(length) || length < 0 || length > MAX_BYTES || !MODES[mode]) throw new RangeError('invalidLength');
    const { symbol, repeats } = MODES[mode];
    return 0.5 + (length + 8) * symbol * repeats + (repeats - 1) * 0.25;
  }

  function processing(settings = {}) {
    return Object.fromEntries(['echoCancellation', 'noiseSuppression', 'autoGainControl'].map(key =>
      [key, settings[key] === true ? 'on' : settings[key] === false ? 'off' : 'unreported']));
  }

  return Object.freeze({ FFT_SIZE, MAX_BYTES, MAX_DB, RECEIVE_POWER_FLOOR, CONFIDENCE_DB, MODES, PREAMBLE, END,
    config, bytesOf, textOf, partialText, crc8, byteTones, frame, frequencyBin, bandPower, deltaDb,
    classifyPowers, demodulate, createDecoder, matchRate, duration, processing });
}));
