'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('F: exact restrictive CSP, no-referrer and classic local scripts', () => {
  const html = read('index.html');
  const policy = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'";
  assert.ok(html.includes(`content="${policy}"`));
  assert.ok(html.includes('<meta name="referrer" content="no-referrer">'));
  assert.doesNotMatch(html, /style\s*=|\bon\w+\s*=|type="module"|frame-ancestors/);
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    assert.match(script[1], /src="[\w-]+\.js"/);
    assert.equal(script[2].trim(), '');
  }
  assert.ok(html.includes('name="viewport"'));
  assert.ok(html.includes('<dialog'));
});
test('F: Japanese and English dictionaries have identical keys and all UI keys exist', () => {
  const messages = require('../messages.js');
  assert.deepEqual(Object.keys(messages.ja).sort(), Object.keys(messages.en).sort());
  for (const match of read('index.html').matchAll(/data-(?:i18n|label)="([^"]+)"/g)) {
    assert.equal(typeof messages.ja[match[1]], 'string', match[1]);
    assert.equal(typeof messages.en[match[1]], 'string', match[1]);
  }
});
test('F: runtime uses neither dynamic HTML nor network or compiled processing dependencies', () => {
  const files = fs.readdirSync(root).filter(file => /\.(js|html)$/.test(file));
  for (const file of files) {
    assert.doesNotMatch(read(file), /innerHTML|outerHTML|insertAdjacentHTML|\beval\s*\(|fetch\s*\(|XMLHttpRequest/);
    assert.doesNotMatch(read(file), /AudioWorklet|WebAssembly|\.wasm\b|OscillatorNode|createOscillator/);
    assert.doesNotMatch(read(file), /MediaRecorder|indexedDB|sessionStorage|document\.cookie/);
  }
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.private);
  assert.equal(pkg.engines.node, '>=22');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});
test('F: public copy avoids forbidden claims and phrases', () => {
  for (const file of ['messages.js', 'index.html']) {
    assert.doesNotMatch(read(file), /盗聴の検知|乗っ取り|追跡の判定|照合|突き合わせ|効く|走る/);
  }
});
test('F: only language and theme are persisted', () => {
  const app = read('app.js');
  assert.deepEqual([...app.matchAll(/save\('([^']+)'/g)].map(m => m[1]).sort(), ['lang', 'theme']);
});
test('F: source keeps readable line lengths', () => {
  const files = [...fs.readdirSync(root).filter(file => /\.(js|css|html)$/.test(file)),
    ...fs.readdirSync(__dirname).filter(file => file.endsWith('.js')).map(file => 'test/' + file)];
  for (const file of files) {
    const maximum = file.endsWith('.html') ? 250 : 160;
    read(file).split(/\r?\n/).forEach((line, i) => assert.ok(line.length <= maximum, `${file}:${i + 1} (${line.length})`));
  }
});

function luminance(hex) {
  const channels = hex.match(/\w\w/g).map(v => parseInt(v, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
test('F: light and dark text, controls and focus meet contrast thresholds', () => {
  const css = read('style.css');
  for (const block of [css.match(/:root\s*\{([^}]+)}/)[1], css.match(/:root\[data-theme="dark"\]\s*\{([^}]+)}/)[1]]) {
    const colors = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*#([a-f0-9]{6})/g)].map(m => [m[1], m[2]]));
    const contrast = (a, b) => {
      const pair = [luminance(colors[a]), luminance(colors[b])].sort((x, y) => y - x);
      return (pair[0] + 0.05) / (pair[1] + 0.05);
    };
    for (const foreground of ['fg', 'muted', 'accent', 'warning']) {
      for (const background of ['bg', 'surface']) assert.ok(contrast(foreground, background) >= 4.5, `${foreground}/${background}`);
    }
    assert.ok(contrast('on-accent', 'accent') >= 4.5);
    for (const foreground of ['border', 'focus']) assert.ok(contrast(foreground, 'surface') >= 3);
  }
});
