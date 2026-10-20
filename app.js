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
  const audio = window.AirborneAudio.create();
  const t = key => messages[language][key] || key;
  const canvas = $('spectrogram'), pen = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let columns = [], plotSettings = core.config('reliable', 48000), plotStart = null;
  let lastColumn = -Infinity, lastPaint = -Infinity, selectedTones = null;

  function plotReset(mode) {
    columns = [];
    plotSettings = core.config(mode, 48000);
    plotStart = null;
    lastColumn = lastPaint = -Infinity;
    selectedTones = null;
    drawPlot();
  }

  function drawPlot() {
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
    const end = columns.length ? columns.at(-1).time : 0, start = Math.max(0, end - span);
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
    const measuredEnd = Math.min(width - 10, x(end + (columns.length ? 0.032 : 0)));
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
    $('tone-pair').textContent = selectedTones ? `${t('selectedTones')}: ${selectedTones.join('Hz + ')}Hz` : t('noTone');
  }

  function plotSample(event) {
    if (plotStart === null) plotStart = event.time;
    plotSettings = event.settings;
    if (event.time - lastColumn < 0.032) return;
    lastColumn = event.time;
    const value = event.decision.kind === 'data' ? event.decision.value : null;
    const selected = value === null ? null : [value >> 4, 16 + (value & 15)];
    if (selected) selectedTones = selected.map(i => plotSettings.tones[i]);
    const db = event.decision.powers.map(power => 10 * Math.log10(Math.max(1e-12, power)));
    columns.push({ time: event.time - plotStart, selected, db });
    if (columns.length > 400) columns.shift();
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
  }

  function renderState() {
    $('status').textContent = t(statusKey);
    $('error').textContent = t(($('send-fields').hidden ? '' : inputError) || errorKey);
    const role = resultRole || $('role').value;
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
    for (const node of document.querySelectorAll('input[name="mode"],#role,#text-input,#gain,#wav-input')) node.disabled = value;
    $('start').disabled = value;
    $('stop').disabled = !value;
  }

  function stop() {
    generation++;
    if (confirmResolve) confirmResolve(false);
    confirmResolve = null;
    if ($('processing-dialog').open) $('processing-dialog').close();
    audio.close();
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
        received = await audio.offline($('wav-input').files[0], mode, onEvent);
      } else {
        const details = await audio.open(role, key => { if (token === generation) { statusKey = key; renderState(); } });
        if (token !== generation) return;
        environment = details;
        renderState();
        if (!core.config(mode, details.sampleRate).supported) throw new Error('unsupportedBand');
        if (details.processing.echoCancellation === 'on' || details.processing.noiseSuppression === 'on') {
          if (!await confirmProcessing()) { if (token === generation) stop(); return; }
          if (token !== generation) return;
        }
        received = await audio.run(role, $('text-input').value, mode, Number($('gain').value), onEvent);
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
    result = live = resultRole = expected = null;
    statusKey = 'waiting';
    errorKey = '';
    plotReset(document.querySelector('input[name="mode"]:checked').value);
    renderState();
  }

  function roleChanged() {
    const role = $('role').value;
    $('send-fields').hidden = !['send', 'loopback'].includes(role);
    $('file-fields').hidden = role !== 'offline';
    clearResults();
  }
  $('text-input').addEventListener('input', () => { errorKey = ''; preview(); });
  $('role').addEventListener('change', roleChanged);
  document.querySelectorAll('input[name="mode"]').forEach(node => node.addEventListener('change', () => {
    if (!busy) clearResults();
  }));
  $('wav-input').addEventListener('change', () => { errorKey = ''; renderState(); });
  $('gain').addEventListener('input', () => { $('gain-value').textContent = `${$('gain').value}dBFS`; });
  $('lang-toggle').addEventListener('click', () => { language = language === 'ja' ? 'en' : 'ja'; save('lang', language); render(); });
  $('theme-toggle').addEventListener('click', () => { theme = theme === 'light' ? 'dark' : 'light'; save('theme', theme); render(); });
  $('start').addEventListener('click', start);
  $('stop').addEventListener('click', stop);
  $('help-toggle').addEventListener('click', () => { if (busy) stop(); $('help-dialog').showModal(); });
  $('help-close').addEventListener('click', () => { $('help-dialog').close(); });
  $('help-dialog').addEventListener('close', () => { $('help-toggle').focus(); });
  $('processing-continue').addEventListener('click', () => answerProcessing(true));
  $('processing-cancel').addEventListener('click', () => answerProcessing(false));
  $('processing-dialog').addEventListener('cancel', event => { event.preventDefault(); answerProcessing(false); });
  audio.onInterrupted(key => { errorKey = key; stop(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && busy) stop(); });
  window.addEventListener('pagehide', stop);
  window.addEventListener('load', drawPlot);
  new ResizeObserver(drawPlot).observe(canvas);
  document.body.dataset.busy = 'false';
  render();
  roleChanged();
}());
