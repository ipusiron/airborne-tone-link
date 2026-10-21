'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../codec-core.js');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const documents = ['README.md', 'README.en.md'].map(read);

test('README: hub metadata has the requested identifiers and block arrays', () => {
  const metadata = documents[0].match(/^<!--\r?\n---\r?\n([\s\S]+?)\r?\n---\r?\n-->/);
  assert.ok(metadata);
  const text = metadata[1];
  for (const [key, value] of Object.entries({ id: 'day120', slug: 'airborne-tone-link', hub: 'true' })) {
    assert.match(text, new RegExp(`^${key}: ${value}$`, 'm'));
  }
  for (const [key, expected] of [
    ['category_ja', ['プライバシー', '音響監視']], ['category_en', ['Privacy', 'Acoustic Surveillance']],
    ['tags', ['acoustic-channel', 'mfsk', 'spectrogram', 'air-gap', 'web-audio']]
  ]) {
    const block = text.match(new RegExp(`^${key}:\\r?\\n((?:  - [^\\r\\n]+\\r?\\n?)+)`, 'm'));
    assert.ok(block, key);
    assert.deepEqual([...block[1].matchAll(/  - ([^\r\n]+)/g)].map(match => match[1]), expected);
  }
  assert.match(text, /repo_url: "https:\/\/github.com\/ipusiron\/airborne-tone-link"/);
  assert.match(text, /demo_url: "https:\/\/ipusiron.github.io\/airborne-tone-link\/"/);
});

function cells(text, label) {
  const rows = text.split(/\r?\n/).filter(line => line.startsWith(`| ${label} |`));
  assert.equal(rows.length, 1, label);
  return rows[0].split('|').slice(2, 4).map(value => value.trim());
}
test('README: both speed tables recalculate from the protocol, including framing and repeats', () => {
  const labels = [
    ['F0', 'シンボル長', '全文の送信回数', '反復込み・付帯情報なし', '256バイトの送信時間', '256バイトの正味速度'],
    ['F0', 'Symbol duration', 'Full transmissions', 'With repeats, without framing', 'Time for 256 bytes', 'Net rate for 256 bytes']
  ];
  documents.forEach((text, language) => {
    const values = labels[language].map(label => cells(text, label));
    for (const [i, mode] of ['reliable', 'ultrasonic'].entries()) {
      const preset = core.config(mode, 48000), duration = core.duration(256, mode);
      const expected = [preset.f0, preset.symbol * 1000, preset.repeats,
        (1 / (preset.symbol * preset.repeats)).toFixed(2), duration.toFixed(3), (256 / duration).toFixed(2)];
      expected.forEach((number, row) => {
        const actual = values[row][i].replaceAll(',', '').match(/[\d.]+/);
        assert.ok(actual);
        assert.equal(Number(actual[0]), Number(number), `${mode} row ${row}`);
      });
    }
  });
  const html = read('index.html');
  for (const metric of ['symbol', 'repeats', 'nominal', 'duration', 'net']) {
    assert.equal(html.split(`data-metric="${metric}"`).length - 1, 2, metric);
  }
});
test('README: the six common timing/count settings have explicit reference rates in both languages', () => {
  const expected = [
    ['11.76B/s', '23.110s', '11.08B/s'], ['5.88B/s', '45.970s', '5.57B/s'],
    ['5.21B/s', '51.572s', '4.96B/s'], ['2.60B/s', '102.894s', '2.49B/s'],
    ['2.60B/s', '102.644s', '2.49B/s'], ['1.30B/s', '205.038s', '1.25B/s']
  ];
  for (const text of documents) {
    for (const row of expected) assert.ok(text.includes('| ' + row.join(' | ') + ' |'));
    assert.ok(text.includes('5.742'));
  }
});
test('README: byte, tone, duration and CRC examples have known values', () => {
  assert.deepEqual(core.bytesOf('HELLO'), [0x48, 0x45, 0x4c, 0x4c, 0x4f]);
  assert.equal(core.crc8([5, 0x48, 0x45, 0x4c, 0x4c, 0x4f]), 0xb8);
  assert.deepEqual(core.byteTones(0x41, core.config('reliable', 48000)), [1876, 3098]);
  assert.equal(core.bytesOf('HELLO日本語').length, 14);
  assert.equal(core.bytesOf('日本語').length, 9);
  assert.equal(core.bytesOf('😀😀😀😀').length, 16);
  for (const text of documents) {
    for (const value of ['48 45 4C 4C 4F', '`B8`', '1,876Hz', '3,098Hz']) assert.ok(text.includes(value), value);
  }
});
test('README: six physical channel categories, receiver-dependent rates and uncertainty notes are present', () => {
  for (const text of documents) {
    for (const name of ['LED-it-GO', 'MAGNETO', 'ODINI', 'BitWhisper', 'AirHopper', 'PowerHammer', 'ggwave']) {
      assert.ok(text.includes(name));
    }
    for (const value of ['4000bit/s', '15〜120bit/s', '0.2〜5bit/s', '1〜8bit/hour', '1000bit/s', '10bit/s']) {
      assert.ok(text.replaceAll('–', '〜').includes(value), value);
    }
    for (const source of ['1702.06715', '1802.02317', '1503.07919', '1804.04014']) assert.ok(text.includes(source));
  }
  assert.match(documents[0], /実験室条件/);
  assert.match(documents[0], /原論文未確認/);
  assert.match(documents[1], /laboratory reports/);
  assert.match(documents[1], /original paper not directly verified/);
});
test('README: both book pages, related tools, scope and matching section structures are documented', () => {
  for (const text of documents) {
    for (const link of ['?page_id=53563', '?page_id=53554', 'ultrasonic-reach-meter/', 'mic-gain-logger/', '?page_id=44607']) {
      assert.ok(text.includes(link), link);
    }
    assert.match(text, /Safari/);
    assert.match(text, /128MiB/);
    assert.match(text, /textContent/);
    assert.doesNotMatch(text, /盗聴の検知|乗っ取り|追跡の判定|照合|突き合わせ|効く|走る/);
  }
  const icons = text => [...text.matchAll(/^## (\S+)/gm)].map(match => match[1]);
  assert.deepEqual(icons(documents[0]), icons(documents[1]));
  assert.equal(icons(documents[0]).length, 19);
});
test('README: exactly eight referenced screenshots are 1280x800 PNGs below 300KB with captions', () => {
  const assets = fs.readdirSync(path.join(root, 'assets')).filter(name => name.endsWith('.png')).sort();
  const references = documents.flatMap(text => [...text.matchAll(/!\[[^\]]+]\(assets\/([^)]+)\)/g)].map(match => match[1])).sort();
  assert.equal(assets.length, 8);
  assert.deepEqual(references, assets);
  for (const text of documents) assert.equal([...text.matchAll(/^> \*[^*]+\*$/gm)].length, 4);
  for (const file of assets) {
    const buffer = fs.readFileSync(path.join(root, 'assets', file));
    assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(buffer.readUInt32BE(16), 1280);
    assert.equal(buffer.readUInt32BE(20), 800);
    assert.ok(buffer.length < 300000, file);
  }
});
test('README: directory trees list actual maintained files and CI covers both events', () => {
  for (const file of ['.nojekyll', 'CLAUDE.md', 'test/readme.test.js', '.github/workflows/test.yml']) {
    assert.ok(fs.existsSync(path.join(root, file)));
    documents.forEach(text => assert.ok(text.includes(path.basename(file)), file));
  }
  const workflow = read('.github/workflows/test.yml');
  const required = ['push:', 'pull_request:', 'timeout-minutes: 5', "node-version: '22'",
    'npm test', '-print0 | xargs -0 -n1 node --check'];
  for (const value of required) {
    assert.ok(workflow.includes(value), value);
  }
  for (const [file, minimum] of [['codec-core.js', 350], ['audio-io.js', 240], ['app.js', 250], ['index.html', 190], ['style.css', 100]]) {
    assert.ok(read(file).split(/\r?\n/).length >= minimum, file);
  }
});
