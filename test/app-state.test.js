'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../codec-core.js');
const messages = require('../messages.js');
const root = path.join(__dirname, '..');

function app(run, plot = null) {
  const element = () => ({
    textContent: '', value: '', dataset: {}, hidden: false, files: [], listeners: {},
    addEventListener(type, handler) { this.listeners[type] = handler; }
  });
  const nodes = Object.fromEntries([...fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], element()]));
  const modes = [element(), element()];
  modes[0].value = 'reliable';
  modes[1].value = 'ultrasonic';
  let mode = modes[0];
  nodes.role.value = 'loopback';
  nodes['text-input'].value = 'SECRET';
  nodes.gain.value = '-30';
  nodes.timing.value = 'short';
  nodes['repeat-count'].value = '2';
  for (const id of ['spectrogram', 'transmit-spectrogram']) {
    nodes[id].getContext = () => plot && plot.pen;
    nodes[id].clientWidth = plot ? 320 : 0;
    nodes[id].clientHeight = plot ? 220 : 0;
  }
  const document = {
    documentElement: { dataset: {} }, body: { dataset: {} }, addEventListener() {},
    getElementById: id => nodes[id],
    querySelector: () => mode,
    querySelectorAll: selector => selector.startsWith('input[name="mode"]') ? modes : []
  };
  const audio = {
    open: async () => ({ sampleRate: 48000, processing: {} }),
    run, close: async () => {}, onInterrupted() {}
  };
  const window = { AirborneCodec: core, AirborneMessages: messages, listeners: {},
    AirborneAudio: { create: () => audio }, addEventListener(type, handler) { this.listeners[type] = handler; } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), {
    window, document, navigator: { language: 'en' }, location: { search: '?lang=en' },
    URLSearchParams, TextEncoder, devicePixelRatio: 1, matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({ getPropertyValue: () => plot.color }),
    ResizeObserver: class { observe() {} }, localStorage: { getItem() { return null; }, setItem() {} }
  });
  return {
    nodes, start: () => nodes.start.listeners.click(), loaded: () => window.listeners.load(),
    changeRole(value) { nodes.role.value = value; nodes.role.listeners.change(); },
    changeMode() { mode = modes[1]; mode.listeners.change(); },
    changeTiming(value) { nodes.timing.value = value; nodes.timing.listeners.change(); },
    changeRepeats(value) { nodes['repeat-count'].value = String(value); nodes['repeat-count'].listeners.change(); }
  };
}
const byte = (bytes, text) => ({ type: 'byte', bytes, text });
const frame = (bytes, text, valid) => ({ type: 'frame', bytes, text, valid, crcOk: valid,
  endOk: valid, utf8Ok: valid, confidences: bytes.map(() => 30) });

test('UI: no input events never copies send text into recovered text', async () => {
  const view = app(async () => { throw Error('noFrame'); });
  await view.start();
  assert.equal(view.nodes['live-text'].textContent, messages.en.noRecoveredText);
  assert.equal(view.nodes['live-state'].textContent, messages.en.liveEmpty);
  assert.equal(view.nodes['result-content'].hidden, true);
  assert.equal(view.nodes['live-source'].textContent, messages.en.sourceMic);
});

test('UI: only unreadable payload slots do not appear as recovered question marks', async () => {
  const unknown = frame([null, null], '??', false);
  const view = app(async (_role, _text, _mode, _db, emit) => {
    emit(byte([null], '?'));
    assert.equal(view.nodes['live-text'].textContent, messages.en.noRecoveredText);
    emit(unknown);
    return unknown;
  });
  await view.start();
  assert.equal(view.nodes['live-text'].textContent, messages.en.noRecoveredText);
  assert.equal(view.nodes['received-text'].textContent, messages.en.noRecoveredText);
  assert.equal(view.nodes['live-count'].textContent, 'Readable payload bytes: 0 / Unreadable payload bytes: 2');
  assert.equal(view.nodes['live-state'].textContent, messages.en.liveInvalid);
});

test('UI: partial acquired text remains unverified when the frame is truncated', async () => {
  const view = app(async (_role, _text, _mode, _db, emit) => {
    emit(byte([0x48, null], 'H?'));
    assert.equal(view.nodes['live-state'].textContent, messages.en.livePending);
    throw Error('noFrame');
  });
  await view.start();
  assert.equal(view.nodes['live-text'].textContent, 'H?');
  assert.equal(view.nodes['live-state'].textContent, messages.en.liveUnverified);
  assert.equal(view.nodes['live-count'].textContent, 'Readable payload bytes: 1 / Unreadable payload bytes: 1');
  assert.equal(view.nodes['result-content'].hidden, true);
});

test('UI: incomplete UTF-8 bytes are not reported as a recovered character', async () => {
  const view = app(async (_role, _text, _mode, _db, emit) => {
    emit(byte([0xe6], ''));
    throw Error('noFrame');
  });
  await view.start();
  assert.equal(view.nodes['live-text'].textContent, messages.en.incompleteCharacter);
  assert.equal(view.nodes['live-state'].textContent, messages.en.liveUnverified);
});

test('UI: an actual question-mark byte is preserved and verified', async () => {
  const result = frame([0x3f], '?', true);
  const view = app(async () => result);
  await view.start();
  assert.equal(view.nodes['live-text'].textContent, '?');
  assert.equal(view.nodes['live-state'].textContent, messages.en.liveVerified);
  assert.equal(view.nodes['live-count'].textContent, 'Readable payload bytes: 1 / Unreadable payload bytes: 0');
});

test('UI: switching mode or role clears previous text and verification', async () => {
  const view = app(async () => frame([0x41], 'A', true));
  await view.start();
  view.changeMode();
  assert.equal(view.nodes['live-text'].textContent, messages.en.noRecoveredText);
  assert.equal(view.nodes['result-content'].hidden, true);
  await view.start();
  view.changeRole('receive');
  assert.equal(view.nodes['live-text'].textContent, messages.en.noRecoveredText);
  assert.equal(view.nodes['result-content'].hidden, true);
});

test('UI: outgoing waveform and WAV origins are distinguished from microphone input', () => {
  const view = app(async () => {});
  view.changeRole('send');
  assert.equal(view.nodes['live-source'].textContent, messages.en.sourceSend);
  view.changeRole('offline');
  assert.equal(view.nodes['live-source'].textContent, messages.en.sourceWav);
});

test('UI: unavailable computed plot colors do not crash initialization and load redraws the graph', () => {
  let fills = 0;
  const plot = { color: '', pen: new Proxy({}, { get: (_target, key) =>
    key === 'fillRect' ? () => { fills++; } : () => {} }) };
  const view = app(async () => {}, plot);
  assert.equal(fills, 0);
  assert.equal(view.nodes['live-text'].textContent, messages.en.noRecoveredText);
  plot.color = '#f6f5f0';
  view.loaded();
  assert.ok(fills > 0);
});

test('UI: changing band preserves common timing and count and forwards them to audio', async () => {
  const seen = [];
  const view = app(async (_role, _text, mode, _db, _emit, options) => {
    seen.push({ mode, ...options });
    return frame([0x41], 'A', true);
  });
  await view.start();
  view.changeTiming('long');
  view.changeRepeats(1);
  view.changeMode();
  assert.equal(view.nodes.timing.value, 'long');
  assert.equal(view.nodes['repeat-count'].value, '1');
  await view.start();
  assert.deepEqual(seen, [{ mode: 'reliable', timing: 'short', repeats: 2 },
    { mode: 'ultrasonic', timing: 'long', repeats: 1 }]);
  view.changeRole('receive');
  assert.equal(view.nodes['repeat-count'].disabled, true);
  assert.equal(view.nodes['transmit-source'].textContent, messages.en.noTransmitSource);
  view.changeRole('send');
  assert.equal(view.nodes['receive-source'].textContent, messages.en.noReceiveSource);
});
