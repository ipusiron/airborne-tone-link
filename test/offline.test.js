'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../codec-core.js');
const audio = require('../audio-io.js');

function wav(samples, rate = 48000, bits = 16, channels = 1, code = 1) {
  const align = bits / 8 * channels, buffer = new ArrayBuffer(44 + samples.length * align);
  const view = new DataView(buffer), bytes = new Uint8Array(buffer);
  const tag = (offset, value) => bytes.set(new TextEncoder().encode(value), offset);
  tag(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, code, true); view.setUint16(22, channels, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * align, true);
  view.setUint16(32, align, true); view.setUint16(34, bits, true); tag(36, 'data');
  view.setUint32(40, samples.length * align, true);
  samples.forEach((value, i) => {
    for (let channel = 0; channel < channels; channel++) {
      const offset = 44 + i * align + channel * bits / 8;
      if (code === 3) view.setFloat32(offset, value, true);
      else if (bits === 16) view.setInt16(offset, Math.round(value * 32767), true);
      else if (bits === 32) view.setInt32(offset, Math.round(value * 2147483647), true);
      else {
        const raw = Math.round(value * 8388607);
        for (let b = 0; b < 3; b++) view.setUint8(offset + b, (raw >> (8 * b)) & 255);
      }
    }
  });
  return buffer;
}

test('Offline: FFT agrees with an independent direct DFT at selected bins', () => {
  const samples = Float32Array.from({ length: 2048 }, (_, i) =>
    0.02 * Math.sin(2 * Math.PI * 37.3 * i / 2048) + 0.01 * Math.cos(2 * Math.PI * 701 * i / 2048));
  const actual = c.spectrumOf(samples);
  for (const bin of [0, 36, 37, 38, 699, 700, 701, 702]) {
    let real = 0, imaginary = 0;
    for (let i = 0; i < 2048; i++) {
      const window = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / 2048) + 0.08 * Math.cos(4 * Math.PI * i / 2048);
      real += samples[i] * window * Math.cos(2 * Math.PI * bin * i / 2048);
      imaginary -= samples[i] * window * Math.sin(2 * Math.PI * bin * i / 2048);
    }
    const expected = 10 * Math.log10(Math.max(1e-30, (real * real + imaginary * imaginary) / 2048 ** 2));
    assert.ok(Math.abs(actual[bin] - expected) < 0.0001, `${bin}: ${actual[bin]} vs ${expected}`);
  }
  assert.throws(() => c.spectrumOf(samples, 1), /invalidWindow/);
});

test('Offline diagnostics: delayed sound can leave visible data but prevent reading the length', async () => {
  const cfg = c.config('reliable', 48000, { timing: 'long', repeats: 2 });
  const tx = c.transmission('HELLO', cfg, -30).samples, delay = 4608;
  const samples = Float32Array.from(tx, (value, i) => 0.25 * (value + 0.7 * (tx[i - delay] || 0)));
  const buffer = wav(samples), events = [], io = audio.create();
  await assert.rejects(io.offline({ size: buffer.byteLength, arrayBuffer: async () => buffer }, 'reliable',
    event => events.push(event), { timing: 'long', repeats: 2 }), /noFrame/);
  const d = events.filter(e => e.type === 'diagnostics').at(-1).value;
  assert.ok(d.dataWindows > 100);
  assert.equal(d.syncs, 2);
  assert.equal(d.lengthErrors, 2);
  assert.equal(d.headers, 0);
  assert.equal(d.maxReadable, 0);
  assert.equal(d.validFrames, 0);
  await io.close();
});

for (const [bits, code] of [[16, 1], [24, 1], [32, 1], [32, 3]]) {
  test(`Offline: WAV ${bits}-bit format ${code} decodes mono and stereo PCM without altering the file`, () => {
    const samples = Float32Array.from({ length: 2048 }, (_, i) => [-0.5, 0, 0.5][i % 3]);
    for (const channels of [1, 2]) {
      const file = wav(samples, 48000, bits, channels, code), before = file.slice(0), actual = c.decodeWav(file);
      assert.equal(actual.rate, 48000);
      assert.equal(actual.channels, channels);
      assert.equal(actual.samples.length, 2048);
      assert.deepEqual(file, before);
      samples.forEach((value, i) => assert.ok(Math.abs(actual.samples[i] - value) < 1 / 32767));
    }
  });
}

test('Offline: malformed, oversized, non-PCM and non-finite WAVs are rejected', () => {
  assert.throws(() => c.decodeWav(new ArrayBuffer(c.MAX_WAV_BYTES + 1)), /invalidWav/);
  assert.throws(() => c.decodeWav(wav(new Float32Array(10))), /wavDuration/);
  const original = wav(new Float32Array(2048));
  for (const [offset, value, width] of [[0, 0, 4], [4, 0, 4], [20, 99, 2], [22, 3, 2], [28, 0, 4], [40, 999999, 4]]) {
    const broken = original.slice(0), view = new DataView(broken);
    if (width === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
    assert.throws(() => c.decodeWav(broken), /invalidWav/);
  }
  const floating = wav(new Float32Array(2048), 48000, 32, 1, 3);
  new DataView(floating).setFloat32(44, NaN, true);
  assert.throws(() => c.decodeWav(floating), /invalidWav/);
  assert.throws(() => c.decodeWav(wav(new Float32Array(8000 * 60 + 1), 8000)), /wavDuration/);
});

for (const rate of [44100, 48000]) {
  for (const mode of ['reliable', 'ultrasonic']) {
    for (const timing of ['short', 'long', 'longer']) for (const repeats of [1, 2]) {
    test(`Offline: ${mode} ${rate} Hz ${timing} x${repeats} PCM restores HELLO and CRC`, () => {
      const cfg = c.config(mode, rate, { timing, repeats }), wave = c.transmission('HELLO', cfg, -30);
      const { samples } = c.decodeWav(wav(wave.samples, rate));
      const decoder = c.createDecoder(cfg), frames = [], partial = [];
      for (let offset = 0; offset + c.FFT_SIZE <= samples.length; offset += Math.round(rate * 0.008)) {
        const decision = c.demodulate(c.spectrumOf(samples, offset), cfg);
        for (const event of decoder.push((offset + c.FFT_SIZE / 2) / rate, decision)) {
          if (event.type === 'frame') frames.push(event);
          if (event.type === 'byte') partial.push(event.text);
        }
      }
      assert.equal(frames.length, cfg.repeats);
      assert.ok(frames.every(frame => frame.valid && frame.text === 'HELLO'));
      assert.ok(partial.includes('H') && partial.includes('HELL'));
    });
    }
  }
}

test('Offline: cancellation during file reading rejects without creating audio or a microphone', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const io = audio.create({ setTimeout, clearTimeout });
  const task = io.offline({ size: 100, arrayBuffer: () => pending }, 'reliable');
  io.stop();
  resolve(wav(new Float32Array(2048)));
  await assert.rejects(task, /cancelled/);
  await io.close();
});

test('Offline: a failed file and a good file do not share a decoder or input data', async () => {
  const io = audio.create({ setTimeout, clearTimeout });
  await assert.rejects(io.offline({ size: 4, arrayBuffer: async () => new ArrayBuffer(4) }, 'reliable'), /invalidWav/);
  const buffer = wav(c.transmission('A', c.config('ultrasonic', 48000)).samples);
  const events = [];
  const result = await io.offline({ size: buffer.byteLength, arrayBuffer: async () => buffer }, 'ultrasonic', e => events.push(e));
  assert.equal(result.text, 'A');
  assert.equal(result.valid, true);
  assert.ok(events.some(e => e.type === 'byte' && e.text === 'A'));
  assert.equal(events.find(e => e.type === 'environment').value.session, 'offlineSession');
  await io.close();
});
