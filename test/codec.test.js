'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../codec-core.js');

function spectrum(symbol, cfg, shift = 0) {
  const bins = new Float32Array(c.FFT_SIZE / 2).fill(-120);
  if (!symbol) return bins;
  const frequencies = symbol.kind === 'marker' ? [cfg.markers[symbol.value]] : c.byteTones(symbol.value, cfg);
  for (const f of frequencies) bins[c.frequencyBin(f, cfg.rate) + shift] = -35;
  return bins;
}

function decodeSymbols(symbols, cfg, offset = 0.27, report = false) {
  const decoder = c.createDecoder(cfg), events = [];
  const step = 0.008;
  for (let i = 0; i * step < offset + (symbols.length + 2) * cfg.symbol; i++) {
    const time = i * step;
    const index = Math.floor((time - offset) / cfg.symbol);
    const symbol = symbols[index];
    events.push(...decoder.push(time, c.demodulate(spectrum(symbol, cfg), cfg)));
  }
  return report ? { events, diagnostics: decoder.diagnostics() } : events;
}

test('Diagnostics: visible data without a preamble does not imply payload recovery', () => {
  const cfg = c.config('reliable', 48000, { timing: 'long' });
  const { diagnostics: d } = decodeSymbols(c.frame('HELLO').slice(4, -2), cfg, 0.27, true);
  assert.ok(d.dataWindows > 0);
  assert.equal(d.markerMask, 0);
  assert.equal(d.syncs, 0);
  assert.equal(d.headers, 0);
  assert.equal(d.maxReadable, 0);
  assert.equal(d.frames, 0);
});

test('Diagnostics: markers are not a valid start sequence and bad length is a separate failure', () => {
  const cfg = c.config('reliable', 48000), wrong = c.frame('HELLO');
  wrong[1].value = 0;
  const noSync = decodeSymbols(wrong, cfg, 0.27, true).diagnostics;
  assert.equal(noSync.markerMask, 3);
  assert.equal(noSync.syncs, 0);
  const invalid = c.frame('HELLO');
  invalid[4].value = 255;
  const d = decodeSymbols(invalid, cfg, 0.27, true).diagnostics;
  assert.equal(d.syncs, 1);
  assert.equal(d.lengthErrors, 1);
  assert.equal(d.headers, 0);
  assert.equal(d.maxReadable, 0);
  assert.equal(d.frames, 0);
});

test('Diagnostics: incomplete repeats do not combine readable bytes or claim verification', () => {
  const cfg = c.config('reliable', 48000), first = c.frame('HELLO'), second = c.frame('HELLO');
  first[9] = null;
  for (let i = 5; i < 9; i++) second[i] = null;
  const d = decodeSymbols([...first, null, null, ...second], cfg, 0.27, true).diagnostics;
  assert.equal(d.syncs, 2);
  assert.equal(d.headers, 2);
  assert.equal(d.maxReadable, 4);
  assert.equal(d.readableLength, 5);
  assert.equal(d.frames, 2);
  assert.equal(d.validFrames, 0);
  assert.equal(d.crcFailures, 2);
});

test('Diagnostics: success and polling gaps are measured and snapshots cannot change decoder state', () => {
  const cfg = c.config('reliable', 48000);
  const d = decodeSymbols(c.frame('HELLO'), cfg, 0.27, true).diagnostics;
  assert.equal(d.validFrames, 1);
  assert.equal(d.maxReadable, 5);
  assert.equal(d.lengthErrors + d.crcFailures + d.endFailures + d.utf8Failures, 0);
  const decoder = c.createDecoder(cfg), quiet = c.demodulate(spectrum(null, cfg), cfg);
  decoder.push(0, quiet); decoder.push(0.096, quiet);
  assert.equal(decoder.diagnostics().maxGap, 0.096);
  const copy = decoder.diagnostics(); copy.validFrames = 99;
  assert.equal(decoder.diagnostics().validFrames, 0);
});

for (const text of ['', 'HELLO', '1234567890123456', '日本語', '😀😀😀😀', '<script>']) {
  test(`A: UTF-8 round trip for ${JSON.stringify(text)}`, () => {
    assert.equal(c.textOf(c.bytesOf(text)).text, text);
    assert.ok(c.textOf(c.bytesOf(text)).valid);
  });
}
test('A: byte limit counts UTF-8 and rejects broken surrogate pairs', () => {
  assert.equal(c.bytesOf('日本語').length, 9);
  assert.throws(() => c.bytesOf('a'.repeat(17)), /tooLong/);
  assert.throws(() => c.bytesOf('😀'.repeat(5)), /tooLong/);
  for (const bad of ['\ud800', '\udc00', '\ud800x']) assert.throws(() => c.bytesOf(bad), /invalidUnicode/);
});
test('A: CRC-8/SMBUS published check value is F4 for 123456789', () => {
  assert.equal(c.crc8(new TextEncoder().encode('123456789')), 0xf4);
  assert.equal(c.crc8([]), 0);
  assert.throws(() => c.crc8([256]), /invalidByte/);
});
test('A: all 256 bytes map to two distinct block frequencies and back', () => {
  const cfg = c.config('reliable', 48000);
  for (let byte = 0; byte <= 255; byte++) {
    const tones = c.byteTones(byte, cfg);
    assert.equal(tones[0], cfg.tones[byte >> 4]);
    assert.equal(tones[1], cfg.tones[16 + (byte & 15)]);
    assert.notEqual(tones[0], tones[1]);
    assert.equal(c.demodulate(spectrum({ kind: 'data', value: byte }, cfg), cfg).value, byte);
  }
});
test('A: frame contains alternating preamble, byte length, payload, CRC and two end markers', () => {
  const frame = c.frame('A');
  assert.deepEqual(frame.slice(0, 4).map(s => s.value), [0, 1, 0, 1]);
  assert.deepEqual(frame.slice(4, 6).map(s => s.value), [1, 65]);
  // Independent polynomial long division, not the implementation's byte-wise loop.
  let polynomial = (1n << 16n) | (65n << 8n);
  for (let bit = 23n; bit >= 8n; bit--) {
    if (polynomial & (1n << bit)) polynomial ^= 0x107n << (bit - 8n);
  }
  assert.equal(frame[6].value, Number(polynomial));
  assert.deepEqual(frame.slice(-2), [{ kind: 'marker', value: 0 }, { kind: 'marker', value: 1 }]);
});
test('A: live UTF-8 text waits for all bytes of a character and marks unknown bytes', () => {
  const bytes = c.bytesOf('日A');
  assert.equal(c.partialText(bytes.slice(0, 2)), '');
  assert.equal(c.partialText(bytes.slice(0, 3)), '日');
  assert.equal(c.partialText([65, null, 66]), 'A?B');
  assert.equal(c.textOf([0xff]).valid, false);
});

for (const rate of [44100, 48000]) {
  for (const mode of ['reliable', 'ultrasonic']) {
    const cfg = c.config(mode, rate);
    test(`B: synchronize and decode repeated bytes at ${rate} Hz in ${mode}`, () => {
      const events = decodeSymbols(c.frame('AAAA日'), cfg);
      const frames = events.filter(e => e.type === 'frame');
      assert.equal(frames.length, 1);
      assert.equal(frames[0].text, 'AAAA日');
      assert.equal(frames[0].valid, true);
      assert.equal(events.filter(e => e.type === 'byte').length, 7);
    });
    test(`C: nearest-bin leakage is accepted at ${rate} Hz in ${mode}`, () => {
      for (const shift of [-1, 0, 1]) {
        assert.equal(c.demodulate(spectrum({ kind: 'data', value: 0xa5 }, cfg, shift), cfg).value, 0xa5);
      }
    });
    test(`D: fixed physical grid remains below the ceiling at ${rate} Hz in ${mode}`, () => {
      assert.ok(cfg.supported);
      assert.ok(cfg.tones.at(-1) <= rate * 0.45);
      assert.equal(cfg.tones[1] - cfg.tones[0], 94);
      assert.ok(Math.abs(c.frequencyBin(cfg.tones[7], rate) * rate / c.FFT_SIZE - cfg.tones[7]) <= rate / c.FFT_SIZE / 2);
    });
  }
}
test('B: silence, data without a preamble and wrong alternation do not synchronize', () => {
  const cfg = c.config('reliable', 48000);
  assert.equal(decodeSymbols(Array(20).fill(null), cfg).length, 0);
  assert.equal(decodeSymbols(c.frame('HELLO').slice(4), cfg).length, 0);
  const wrong = c.frame('A');
  wrong[2] = { kind: 'marker', value: 1 };
  assert.equal(decodeSymbols(wrong, cfg).some(e => e.type === 'frame'), false);
});
test('B: damaged length stops the frame and does not allocate an oversized payload', () => {
  const cfg = c.config('reliable', 48000), symbols = c.frame('A');
  symbols[4].value = 255;
  const events = decodeSymbols(symbols, cfg);
  assert.ok(events.some(e => e.reason === 'invalidLength'));
  assert.equal(events.some(e => e.type === 'frame'), false);
});
test('B: a changed payload is displayed as unverified and fails CRC', () => {
  const cfg = c.config('reliable', 48000), symbols = c.frame('HELLO');
  symbols[5].value = 74;
  const result = decodeSymbols(symbols, cfg).find(e => e.type === 'frame');
  assert.equal(result.text, 'JELLO');
  assert.equal(result.crcOk, false);
  assert.equal(result.valid, false);
});
test('B: missing end marker prevents a valid frame even when CRC matches', () => {
  const cfg = c.config('reliable', 48000), symbols = c.frame('HELLO');
  symbols[symbols.length - 1] = null;
  const result = decodeSymbols(symbols, cfg).find(e => e.type === 'frame');
  assert.equal(result.crcOk, true);
  assert.equal(result.endOk, false);
  assert.equal(result.valid, false);
});
test('B: non-increasing times are rejected and cancellation clears partial data', () => {
  const cfg = c.config('reliable', 48000), decoder = c.createDecoder(cfg);
  const quiet = c.demodulate(spectrum(null, cfg), cfg);
  decoder.push(1, quiet);
  assert.throws(() => decoder.push(1, quiet), /nonIncreasingTime/);
  decoder.reset();
  assert.equal(decoder.state().synchronized, false);
});
test('C: missing one block, competing peaks and noise are uncertain', () => {
  const cfg = c.config('reliable', 48000);
  const one = spectrum({ kind: 'data', value: 65 }, cfg);
  one[c.frequencyBin(cfg.tones[17], cfg.rate)] = -120;
  assert.equal(c.demodulate(one, cfg).value, null);
  const conflict = spectrum({ kind: 'data', value: 65 }, cfg);
  conflict[c.frequencyBin(cfg.tones[5], cfg.rate)] = -36;
  assert.equal(c.demodulate(conflict, cfg).value, null);
  assert.equal(c.demodulate(new Float32Array(1024).fill(-90), cfg).value, null);
  assert.equal(c.demodulate(spectrum(null, cfg), cfg).value, null);
});
test('C: confidence is a power ratio in dB, not a probability', () => {
  assert.equal(c.deltaDb(1e-4, 1e-5), 10);
  assert.equal(c.deltaDb(0, 0), 0);
  const powers = Array(32).fill(1e-12);
  powers[4] = 1e-4;
  powers[5] = 1e-5;
  powers[17] = 1e-4;
  assert.equal(c.classifyPowers(powers, [0, 0]).confidence, 10);
});
test('D: unsupported bands are rejected as a whole without changing individual tones', () => {
  assert.equal(c.config('ultrasonic', 32000).supported, false);
  assert.equal(c.config('reliable', 32000).supported, true);
  assert.equal(c.config('reliable', 8000).supported, false);
  assert.throws(() => c.createDecoder(c.config('ultrasonic', 32000)), /unsupportedBand/);
  assert.deepEqual(c.config('reliable', 44100).tones, c.config('reliable', 48000).tones);
  assert.throws(() => c.config('x', 48000), /invalidMode/);
  assert.throws(() => c.config('reliable', NaN), /invalidRate/);
});
for (const [a, b, expected] of [['ABC', 'ABC', 100], ['ABC', 'AXC', 200 / 3], ['A😀', 'A?', 50], ['', '', 100], ['AB', 'A', 50]]) {
  test(`E: character agreement for ${JSON.stringify(a)} and ${JSON.stringify(b)}`, () => {
    assert.equal(c.matchRate(a, b, 'loopback'), expected);
    assert.equal(c.matchRate(a, b, 'receive'), null);
  });
}
test('E: unknown expected content never receives an agreement percentage', () => {
  assert.equal(c.matchRate(null, 'HELLO', 'offline'), null);
});
test('E: duration includes the frame overhead, repeat gap and silence', () => {
  assert.equal(c.duration(16, 'reliable'), 0.75 + 48 * 0.192);
  assert.equal(c.duration(16, 'ultrasonic'), 0.75 + 48 * 0.192);
  assert.throws(() => c.duration(17, 'reliable'), /invalidLength/);
});
for (const timing of ['short', 'long', 'longer']) {
  for (const repeats of [1, 2]) {
    test(`E: ${timing}, ${repeats} transmissions have equal timing in both bands`, () => {
      const options = { timing, repeats }, seconds = { short: 0.085, long: 0.192, longer: 0.384 }[timing];
      const a = c.config('reliable', 48000, options), b = c.config('ultrasonic', 48000, options);
      assert.equal(a.symbol, seconds);
      assert.equal(b.symbol, seconds);
      assert.equal(a.repeats, repeats);
      assert.equal(b.repeats, repeats);
      const expected = 0.5 + 24 * seconds * repeats + 0.25 * (repeats - 1);
      assert.equal(c.duration(16, 'reliable', options), expected);
      assert.equal(c.duration(16, 'ultrasonic', options), expected);
      assert.equal(b.tones[0] - a.tones[0], 14500);
    });
  }
}
test('E: timing defaults and invalid controls are enforced', () => {
  const cfg = c.config('ultrasonic', 48000);
  assert.equal(cfg.timing, 'long');
  assert.equal(cfg.repeats, 2);
  for (const options of [{ timing: 'medium' }, { timing: 'constructor' }, { repeats: 0 }, { repeats: 3 }, { repeats: '2' }]) {
    assert.throws(() => c.config('reliable', 48000, options), /invalidSettings/);
  }
});
test('E: requested processing values are not substituted for unreported values', () => {
  assert.deepEqual(c.processing({ echoCancellation: false, noiseSuppression: true }),
    { echoCancellation: 'off', noiseSuppression: 'on', autoGainControl: 'unreported' });
});
