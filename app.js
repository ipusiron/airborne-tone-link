/* Airborne Tone Link - MIT (c) 2026 ipusiron */
(function () {
  'use strict';
  const core = window.AirborneCodec, messages = window.AirborneMessages;
  const $ = id => document.getElementById(id);
  const stored = key => { try { return localStorage.getItem('airborne-tone-link.' + key); } catch (_) { return null; } };
  const save = (key, value) => { try { localStorage.setItem('airborne-tone-link.' + key, value); } catch (_) { /* Optional. */ } };
  const query = new URLSearchParams(location.search).get('lang');
  let language = [query, stored('lang'), navigator.language.startsWith('ja') ? 'ja' : 'en'].find(v => v === 'ja' || v === 'en');
  let theme = stored('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  let errorKey = '', inputError = '', statusKey = 'waiting', busy = false, generation = 0;
  let environment = null, result = null, resultRole = null, expected = null, live = null, confirmResolve = null;
  let diagnostics = null;
  let deviceInfo = { microphone: null, speaker: null }, deviceStatus = 'deviceWaiting', deviceTest = null, microphoneLevel = null;
  const audio = window.AirborneAudio.create();
  const t = key => messages[language][key] || key;
  const plots = Object.fromEntries([['transmit', 'transmit-spectrogram', 'transmit-tone-pair'],
    ['receive', 'spectrogram', 'tone-pair']].map(([side, id, pair]) => {
    const canvas = $(id);
    return [side, { side, canvas, pen: canvas.getContext('2d'), pair, columns: [], lastColumn: -Infinity, selectedTones: null }];
  }));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const options = () => ({ timing: $('timing').value, repeats: Number($('repeat-count').value) });
  let plotSettings = core.config('reliable', 48000), plotStart = null, lastPaint = -Infinity;

  function plotReset(mode) {
    for (const plot of Object.values(plots)) {
      plot.columns = []; plot.lastColumn = -Infinity; plot.selectedTones = null;
    }
    plotSettings = core.config(mode, 48000, options());
    plotStart = null;
    lastPaint = -Infinity;
    drawPlot();
  }

  function drawPlot() {
    for (const plot of Object.values(plots)) drawChannel(plot);
  }

  function drawChannel(plot) {
    const { canvas, pen, columns, selectedTones } = plot;
    const width = canvas.clientWidth, height = canvas.clientHeight, ratio = Math.min(devicePixelRatio || 1, 2);
    if (!width || !height || !pen) return;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    pen.setTransform(ratio, 0, 0, ratio, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const color = name => css.getPropertyValue('--' + name).trim();
    const rgb = hex => /^#[a-f\d]{6}$/i.test(hex) ? hex.slice(1).match(/../g).map(v => parseInt(v, 16)) : null;
    const low = rgb(color('plot-bg')), high = rgb(color('plot-ink'));
    // Computed colors can be unavailable during document/style initialization.
    if (!low || !high) return;
    const left = 58, top = 12, plotWidth = width - left - 10, plotHeight = height - top - 34;
    const rowHeight = plotHeight / 32, span = 12;
    const end = Math.max(...Object.values(plots).map(p => p.columns.at(-1)?.time || 0));
    const start = Math.max(0, end - span);
    const x = time => left + (time - start) / span * plotWidth;
    const y = index => top + (31 - index) * rowHeight;
    pen.fillStyle = color('plot-bg');
    pen.fillRect(0, 0, width, height);
    const visible = columns.filter(column => column.time >= start);
    for (const [index, column] of visible.entries()) {
      const next = visible[index + 1], cellWidth = Math.max(1, x(next ? next.time : column.time + 0.032) - x(column.time));
      for (let tone = 0; tone < 32; tone++) {
        const level = Math.max(0, Math.min(1, (column.db[tone] + 100) / 80));
        pen.fillStyle = `rgb(${low.map((v, i) => Math.round(v + (high[i] - v) * level)).join(',')})`;
        pen.fillRect(x(column.time), y(tone), cellWidth, rowHeight);
      }
    }
    pen.strokeStyle = color('line');
    pen.lineWidth = 0.5;
    for (let i = 0; i <= 32; i++) {
      pen.beginPath(); pen.moveTo(left, top + i * rowHeight); pen.lineTo(width - 10, top + i * rowHeight); pen.stroke();
    }
    const channelEnd = columns.at(-1)?.time || 0;
    const measuredEnd = Math.max(left, Math.min(width - 10, x(channelEnd + (columns.length ? 0.032 : 0))));
    const unmeasuredWidth = width - 10 - measuredEnd;
    if (unmeasuredWidth > 0) {
      pen.fillStyle = color('surface');
      pen.fillRect(measuredEnd, top, unmeasuredWidth, plotHeight);
      pen.strokeStyle = color('muted');
      pen.setLineDash([3, 3]);
      pen.beginPath(); pen.moveTo(measuredEnd, top); pen.lineTo(measuredEnd, top + plotHeight); pen.stroke();
      pen.setLineDash([]);
      if (unmeasuredWidth > 80) {
        pen.font = '12px system-ui'; pen.textAlign = 'center'; pen.fillStyle = color('muted');
        pen.fillText(t('unmeasured'), measuredEnd + unmeasuredWidth / 2, top + plotHeight / 2);
      }
    }
    const lastData = visible.findLast(column => column.selected);
    if (lastData) {
      pen.strokeStyle = color('fg'); pen.lineWidth = 2;
      for (const tone of lastData.selected) pen.strokeRect(x(lastData.time) - 2, y(tone), 5, rowHeight);
    }
    pen.font = '11px system-ui';
    pen.fillStyle = color('muted');
    pen.textAlign = 'right';
    for (const i of [0, 8, 16, 24, 31]) pen.fillText((plotSettings.tones[i] / 1000).toFixed(2), left - 8, y(i) + rowHeight);
    pen.fillText('kHz', left - 8, 10);
    pen.textAlign = 'center';
    for (let i = 0; i <= 3; i++) {
      const time = start + i * 4;
      pen.fillText(`${time.toFixed(0)}s`, Math.min(width - 16, x(time)), height - 8);
    }
    $(plot.pair).textContent = selectedTones ? `${t('selectedTones')}: ${selectedTones.join('Hz + ')}Hz` : t('noTone');
  }

  function plotSample(event) {
    const plot = plots[event.side || 'receive'];
    if (plotStart === null) plotStart = event.time;
    plotSettings = event.settings;
    if (event.time - plot.lastColumn < 0.032) return;
    plot.lastColumn = event.time;
    const value = event.decision.kind === 'data' ? event.decision.value : null;
    const selected = value === null ? null : [value >> 4, 16 + (value & 15)];
    if (selected) plot.selectedTones = selected.map(i => plotSettings.tones[i]);
    const db = event.decision.powers.map(power => 10 * Math.log10(Math.max(1e-12, power)));
    plot.columns.push({ time: event.time - plotStart, selected, db });
    if (plot.columns.length > 400) plot.columns.shift();
    const now = performance.now();
    if (now - lastPaint >= (reduced.matches ? 250 : 50)) { lastPaint = now; drawPlot(); }
  }

  function preview() {
    try {
      const bytes = core.bytesOf($('text-input').value);
      $('byte-count').textContent = `${bytes.length} / 16 ${t('unitsBytes')}`;
      $('byte-preview').textContent = bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
      inputError = '';
    } catch (error) {
      $('byte-count').textContent = `${new TextEncoder().encode($('text-input').value).length} / 16 ${t('unitsBytes')}`;
      $('byte-preview').textContent = '';
      inputError = error.message;
    }
    $('error').textContent = t(($('send-fields').hidden ? '' : inputError) || errorKey);
    renderSettings();
  }

  function renderSettings() {
    const mode = document.querySelector('input[name="mode"]:checked').value;
    const cfg = core.config(mode, 48000, options()), seconds = core.duration(16, mode, options());
    const values = { symbol: `${cfg.symbol * 1000}ms`, repeats: String(cfg.repeats),
      nominal: `${(1 / (cfg.symbol * cfg.repeats)).toFixed(2)}B/s`, duration: `${seconds.toFixed(3)}s`,
      net: `${(16 / seconds).toFixed(2)}B/s` };
    document.querySelectorAll('[data-metric]').forEach(node => { node.textContent = values[node.dataset.metric]; });
    const count = ['send', 'loopback'].includes($('role').value) ? `${t('repeatCount')}: ${cfg.repeats}` : t('countNotMeasured');
    $('comparison-settings').textContent = `${t(mode)} / ${t('timing')}: ${cfg.symbol * 1000}ms / ${count}`;
    const timingLabel = { short: 'shortTone', long: 'longTone', longer: 'longerTone' }[cfg.timing];
    $('timing-help-current').textContent = `${t('currentSelection')}: ${t(timingLabel)}`;
    $('repeat-help-current').textContent = `${t('currentSelection')}: ${t(cfg.repeats === 1 ? 'once' : 'twice')}`;
  }

  function renderState() {
    renderDevices();
    $('status').textContent = t(statusKey);
    $('error').textContent = t(($('send-fields').hidden ? '' : inputError) || errorKey);
    const role = resultRole || $('role').value;
    renderDiagnostics(role);
    $('transmit-source').textContent = t(['send', 'loopback'].includes(role) ? 'transmitSource' : 'noTransmitSource');
    $('receive-source').textContent = t(role === 'send' ? 'noReceiveSource' : role === 'offline' ? 'sourceWav' : 'receiveSource');
    $('live-source').textContent = t(role === 'send' ? 'sourceSend' : role === 'offline' ? 'sourceWav' : 'sourceMic');
    const known = live ? live.bytes.filter(byte => byte !== null).length : 0;
    $('live-text').textContent = known ? live.text || t('incompleteCharacter') : t('noRecoveredText');
    const state = live && live.type === 'frame' ? (live.valid ? 'liveVerified' : 'liveInvalid') :
      live ? (busy ? 'livePending' : 'liveUnverified') : 'liveEmpty';
    $('live-state').textContent = t(state);
    $('live-count').textContent = live ?
      `${t('readBytes')}: ${known} / ${t('unknownBytes')}: ${live.bytes.length - known}` : '';
    if (environment) {
      for (const key of ['sampleRate', 'inputSampleRate']) {
        $('env-' + key).textContent = environment[key] ? `${environment[key]}Hz` : t('unreported');
      }
      $('env-upper').textContent = `${(environment.sampleRate * 0.45).toFixed(0)}Hz`;
      $('env-session').textContent = t(environment.session);
      for (const [key, value] of Object.entries(environment.processing)) $('env-' + key).textContent = t(value);
      const warn = environment.processing.echoCancellation === 'on' || environment.processing.noiseSuppression === 'on';
      $('environment-warning').textContent = warn ? t('processingWarning') : '';
    }
    $('result-empty').hidden = Boolean(result);
    $('result-content').hidden = !result;
    if (result) {
      $('received-text').textContent = result.bytes.length && result.bytes.every(byte => byte === null) ?
        t('noRecoveredText') : result.text || (result.bytes.length ? '?' : '∅');
      $('crc-result').textContent = t(result.crcOk ? 'crcPass' : 'crcFail');
      $('confidence-result').textContent = `${Math.max(0, Math.min(...result.confidences, 120)).toFixed(1)}dB`;
      const agreement = core.matchRate(expected, result.text, resultRole);
      $('agreement-row').hidden = agreement === null;
      $('agreement-result').textContent = agreement === null ? '' : `${agreement.toFixed(1)}%`;
      const note = resultRole === 'send' ? 'sentFrame' : result.valid ? 'validFrame' :
        !result.endOk ? 'frameDamaged' : 'uncertainFrame';
      $('result-note').textContent = t(note);
    }
  }

  function renderDevices() {
    $('device-microphone').textContent = deviceInfo.microphone || t('deviceUnconfirmed');
    $('device-speaker').textContent = `${t('systemOutput')}` +
      (deviceInfo.speaker ? `: ${deviceInfo.speaker}` : ` (${t('deviceUnconfirmed')})`);
    $('device-status').textContent = t(deviceStatus) + (deviceStatus === 'deviceTestFailed' && errorKey ? ` ${t(errorKey)}` : '');
    $('microphone-level').hidden = !microphoneLevel;
    if (microphoneLevel) {
      $('microphone-meter').value = microphoneLevel.db;
      $('microphone-level-value').textContent = `${microphoneLevel.db.toFixed(1)}dBFS / ` +
        `${t('maximum')}: ${microphoneLevel.maximum.toFixed(1)}dBFS`;
    }
  }

  async function updateDevices(token) {
    const current = await audio.devices();
    if (token !== generation) return;
    deviceInfo = { microphone: current.microphoneActive ? current.microphone : deviceInfo.microphone, speaker: current.speaker };
    renderDevices();
  }

  async function runDeviceTest(kind) {
    if (busy) return;
    const token = ++generation;
    deviceTest = kind;
    deviceStatus = kind === 'speaker' ? 'speakerTesting' : 'devicesChecking';
    statusKey = 'deviceTesting'; errorKey = '';
    microphoneLevel = null;
    setBusy(true); renderState();
    try {
      await audio.open(kind === 'speaker' ? 'send' : 'receive');
      if (token !== generation) return;
      await updateDevices(token);
      if (token !== generation) return;
      if (kind === 'microphone') {
        deviceStatus = 'microphoneTesting'; renderDevices();
        await audio.testMicrophone(level => {
          if (token === generation) { microphoneLevel = level; renderDevices(); }
        });
      } else if (kind === 'speaker') await audio.testSpeaker();
      if (token !== generation) return;
      deviceStatus = kind === 'microphone' ? 'microphoneTestDone' : kind === 'speaker' ? 'speakerTestDone' : 'devicesChecked';
      statusKey = 'completed';
    } catch (error) {
      if (token !== generation || error.message === 'cancelled') return;
      errorKey = messages[language][error.message] ? error.message : 'unexpected';
      deviceStatus = 'deviceTestFailed'; statusKey = 'stopped';
    } finally {
      if (token === generation) {
        await audio.close();
        if (token !== generation) return;
        deviceTest = null; setBusy(false); renderState();
      }
    }
  }

  function renderDiagnostics(role) {
    $('receive-diagnostics').hidden = role === 'send';
    const d = diagnostics;
    if (!d || !d.windows) {
      $('diagnostic-summary').textContent = t('diagnosticWaiting');
      $('diagnostic-details').textContent = '';
      return;
    }
    const state = d.validFrames ? 'diagnosticSuccess' : d.frames ? 'diagnosticInvalid' :
      d.headers ? (d.maxReadable ? 'diagnosticIncomplete' : 'diagnosticNoBody') : d.syncs ? 'diagnosticNoHeader' :
        d.dataWindows || d.markerMask ? 'diagnosticNoSync' : 'diagnosticNoTone';
    $('diagnostic-summary').textContent = t(state);
    const markers = (d.markerMask & 1 ? 1 : 0) + (d.markerMask & 2 ? 1 : 0);
    const lines = [
      `${t('diagnosticTones')}: ${t(d.dataWindows ? 'detected' : 'notDetected')}`,
      `${t('diagnosticMarkers')}: ${markers}/2 / ${t('diagnosticSyncs')}: ${d.syncs}`,
      `${t('diagnosticHeader')}: ${d.syncs ? `${t('diagnosticRead')}${d.headers} / ` +
        `${t('diagnosticFailed')}${d.lengthErrors}` : t('notReached')}`,
      `${t('diagnosticPayload')}: ${d.headers ? `${d.maxReadable}/${d.readableLength}${t('unitsBytes')}` : t('notReached')}`,
      `${t('diagnosticFrames')}: ${d.frames ? `${t('diagnosticPassed')}${d.validFrames} / ` +
        `${t('diagnosticFailed')}${d.frames - d.validFrames}` : t('notReached')}`,
      d.frames ? `CRC: ${t('diagnosticFailed')}${d.crcFailures} / ${t('diagnosticEnd')}: ${d.endFailures} / UTF-8: ${d.utf8Failures}` : '',
      `${t('diagnosticGap')}: ${(d.maxGap * 1000).toFixed(1)}ms`
    ];
    $('diagnostic-details').textContent = lines.filter(Boolean).join('\n');
  }

  function render() {
    document.documentElement.lang = language;
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
    document.querySelectorAll('[data-label]').forEach(node => {
      node.setAttribute('aria-label', t(node.dataset.label));
      node.setAttribute('title', t(node.dataset.label));
    });
    preview();
    renderState();
    drawPlot();
  }

  function setBusy(value) {
    busy = value;
    document.body.dataset.busy = String(value);
    for (const node of document.querySelectorAll('input[name="mode"],#timing,#repeat-count,#role,#text-input,#gain,#wav-input')) {
      node.disabled = value;
    }
    $('repeat-count').disabled = value || ['receive', 'offline'].includes($('role').value);
    for (const id of ['check-devices', 'test-microphone', 'test-speaker']) $(id).disabled = value;
    $('device-stop').disabled = !value;
    $('start').disabled = value;
    $('stop').disabled = !value;
  }

  function stop() {
    generation++;
    if (confirmResolve) confirmResolve(false);
    confirmResolve = null;
    if ($('processing-dialog').open) $('processing-dialog').close();
    audio.close();
    if (deviceTest) { deviceStatus = 'deviceTestStopped'; deviceTest = null; }
    $('wav-input').value = '';
    setBusy(false);
    statusKey = 'stopped';
    renderState();
    drawPlot();
  }

  function confirmProcessing() {
    return new Promise(resolve => {
      confirmResolve = resolve;
      $('processing-dialog').showModal();
    });
  }

  function answerProcessing(answer) {
    const resolve = confirmResolve;
    confirmResolve = null;
    $('processing-dialog').close();
    if (resolve) resolve(answer);
  }

  function handleEvent(event) {
    if (event.type === 'diagnostics') diagnostics = event.value;
    if (event.type === 'status') statusKey = event.key;
    if (event.type === 'sync') { statusKey = 'synchronized'; live = null; }
    if (event.type === 'byte') live = event;
    if (event.type === 'spectrum') plotSample(event);
    if (event.type === 'environment') environment = event.value;
    if (event.type === 'error') statusKey = event.reason;
    if (event.type === 'frame') {
      if (!result || event.valid || !result.valid) { result = event; live = event; }
    }
    if (event.type !== 'spectrum') renderState();
  }

  async function start() {
    if (busy) return;
    preview();
    const role = $('role').value, mode = document.querySelector('input[name="mode"]:checked').value;
    if (['send', 'loopback'].includes(role) && (inputError || !$('text-input').value)) {
      errorKey = inputError || 'emptyInput';
      renderState();
      return;
    }
    if (role === 'offline' && !$('wav-input').files.length) { errorKey = 'chooseWav'; renderState(); return; }
    const token = ++generation;
    errorKey = inputError = '';
    result = null;
    live = null;
    diagnostics = null;
    resultRole = role;
    expected = role === 'loopback' ? $('text-input').value : null;
    statusKey = 'pending';
    plotReset(mode);
    setBusy(true);
    renderState();
    try {
      const onEvent = event => { if (token === generation) handleEvent(event); };
      let received;
      if (role === 'offline') {
        received = await audio.offline($('wav-input').files[0], mode, onEvent, options());
      } else {
        const details = await audio.open(role, key => { if (token === generation) { statusKey = key; renderState(); } });
        if (token !== generation) return;
        environment = details;
        await updateDevices(token);
        if (token !== generation) return;
        renderState();
        if (!core.config(mode, details.sampleRate, options()).supported) throw new Error('unsupportedBand');
        if (details.processing.echoCancellation === 'on' || details.processing.noiseSuppression === 'on') {
          if (!await confirmProcessing()) { if (token === generation) stop(); return; }
          if (token !== generation) return;
        }
        received = await audio.run(role, $('text-input').value, mode, Number($('gain').value), onEvent, options());
      }
      if (token !== generation) return;
      result = received;
      live = received;
      statusKey = 'completed';
    } catch (error) {
      if (token !== generation || error.message === 'cancelled') return;
      errorKey = messages[language][error.message] ? error.message : 'unexpected';
      statusKey = 'stopped';
    } finally {
      if (token === generation) {
        await audio.close();
        if (token !== generation) return;
        $('wav-input').value = '';
        setBusy(false);
        renderState();
        drawPlot();
      }
    }
  }

  function clearResults() {
    result = live = resultRole = expected = diagnostics = null;
    statusKey = 'waiting';
    errorKey = '';
    plotReset(document.querySelector('input[name="mode"]:checked').value);
    renderSettings();
    renderState();
  }

  function roleChanged() {
    const role = $('role').value;
    $('send-fields').hidden = !['send', 'loopback'].includes(role);
    $('file-fields').hidden = role !== 'offline';
    $('repeat-count').disabled = ['receive', 'offline'].includes(role);
    clearResults();
  }
  $('text-input').addEventListener('input', () => { errorKey = ''; preview(); });
  $('role').addEventListener('change', roleChanged);
  document.querySelectorAll('input[name="mode"]').forEach(node => node.addEventListener('change', () => {
    if (!busy) clearResults();
  }));
  for (const id of ['timing', 'repeat-count']) $(id).addEventListener('change', () => { if (!busy) clearResults(); });
  $('wav-input').addEventListener('change', () => { errorKey = ''; renderState(); });
  $('gain').addEventListener('input', () => { $('gain-value').textContent = `${$('gain').value}dBFS`; });
  $('lang-toggle').addEventListener('click', () => { language = language === 'ja' ? 'en' : 'ja'; save('lang', language); render(); });
  $('theme-toggle').addEventListener('click', () => { theme = theme === 'light' ? 'dark' : 'light'; save('theme', theme); render(); });
  $('start').addEventListener('click', start);
  $('check-devices').addEventListener('click', () => runDeviceTest('check'));
  $('test-microphone').addEventListener('click', () => runDeviceTest('microphone'));
  $('test-speaker').addEventListener('click', () => runDeviceTest('speaker'));
  $('device-stop').addEventListener('click', stop);
  $('stop').addEventListener('click', stop);
  $('help-toggle').addEventListener('click', () => { if (busy) stop(); $('help-dialog').showModal(); });
  $('help-close').addEventListener('click', () => { $('help-dialog').close(); });
  $('help-dialog').addEventListener('close', () => { $('help-toggle').focus(); });
  for (const id of ['timing', 'repeat']) {
    $(`${id}-help`).addEventListener('click', () => {
      if (busy) stop();
      $(`${id}-dialog`).showModal();
    });
    $(`${id}-help-close`).addEventListener('click', () => { $(`${id}-dialog`).close(); });
    $(`${id}-dialog`).addEventListener('close', () => { $(`${id}-help`).focus(); });
  }
  $('processing-continue').addEventListener('click', () => answerProcessing(true));
  $('processing-cancel').addEventListener('click', () => answerProcessing(false));
  $('processing-dialog').addEventListener('cancel', event => { event.preventDefault(); answerProcessing(false); });
  audio.onInterrupted(key => { errorKey = key; stop(); });
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      if (busy) stop();
      deviceInfo = { microphone: null, speaker: null }; deviceStatus = 'devicesChanged'; renderDevices();
    });
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && busy) stop(); });
  window.addEventListener('pagehide', stop);
  window.addEventListener('load', drawPlot);
  const observer = new ResizeObserver(drawPlot);
  for (const plot of Object.values(plots)) observer.observe(plot.canvas);
  document.body.dataset.busy = 'false';
  render();
  roleChanged();
}());
