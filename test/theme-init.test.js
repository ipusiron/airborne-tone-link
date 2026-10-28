'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('theme-init.js');

/* Runs theme-init.js in a stand-in window and returns the data-theme it sets on <html>. */
function run({ saved = null, prefersDark = false, storageThrows = false } = {}) {
  const dataset = {};
  const window = {
    localStorage: {
      getItem(key) {
        if (storageThrows) throw new Error('blocked');
        assert.equal(key, 'airborne-tone-link.theme');
        return saved;
      }
    },
    matchMedia: () => ({ matches: prefersDark }),
    document: { documentElement: { dataset } }
  };
  vm.runInNewContext(source, { window });
  return dataset.theme;
}

test('Theme: without a saved choice the OS setting decides', () => {
  assert.equal(run({ prefersDark: true }), 'dark');
  assert.equal(run({ prefersDark: false }), 'light');
});
test('Theme: a saved choice wins over the OS setting', () => {
  assert.equal(run({ saved: 'light', prefersDark: true }), 'light');
  assert.equal(run({ saved: 'dark', prefersDark: false }), 'dark');
});
test('Theme: unexpected saved values are ignored and the OS setting decides', () => {
  assert.equal(run({ saved: 'blue', prefersDark: true }), 'dark');
  assert.equal(run({ saved: '', prefersDark: false }), 'light');
});
test('Theme: unavailable storage does not throw and the OS setting decides', () => {
  assert.equal(run({ storageThrows: true, prefersDark: true }), 'dark');
  assert.equal(run({ storageThrows: true, prefersDark: false }), 'light');
});
test('Theme: index.html loads theme-init.js in <head> after style.css, without defer', () => {
  const html = read('index.html');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(head.includes('<script src="theme-init.js"></script>'), 'theme-init.js is in <head> without defer, async or type');
  assert.ok(head.indexOf('style.css') < head.indexOf('theme-init.js'));
  assert.ok(head.indexOf('theme-init.js') < head.indexOf('app.js'));
  assert.match(read('app.js'), /let theme = document\.documentElement\.dataset\.theme === 'dark' \? 'dark' : 'light';/);
});
