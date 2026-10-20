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
  let environment = null, result = null, resultRole = null, expected = null, live = '', confirmResolve = null;
  const audio = window.AirborneAudio.create();
  const t = key => messages[language][key] || key;

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
    $('live-text').textContent = live || t('noData');
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
      $('received-text').textContent = result.text || (result.bytes.length ? '?' : '∅');
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
    setBusy(false);
    statusKey = 'stopped';
    renderState();
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
    if (event.type === 'sync') statusKey = 'synchronized';
    if (event.type === 'error') statusKey = event.reason;
    if (event.type === 'frame') {
      if (!result || event.valid || !result.valid) { result = event; live = event.text; }
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
    if (role === 'offline') { errorKey = 'offlinePending'; renderState(); return; }
    const token = ++generation;
    errorKey = inputError = '';
    result = null;
    live = '';
    resultRole = role;
    expected = role === 'loopback' ? $('text-input').value : null;
    statusKey = 'pending';
    setBusy(true);
    renderState();
    try {
      const details = await audio.open(role, key => { if (token === generation) { statusKey = key; renderState(); } });
      if (token !== generation) return;
      environment = details;
      renderState();
      if (!core.config(mode, details.sampleRate).supported) throw new Error('unsupportedBand');
      if (details.processing.echoCancellation === 'on' || details.processing.noiseSuppression === 'on') {
        if (!await confirmProcessing()) { if (token === generation) stop(); return; }
        if (token !== generation) return;
      }
      const received = await audio.run(role, $('text-input').value, mode, Number($('gain').value), event => {
        if (token === generation) handleEvent(event);
      });
      if (token !== generation) return;
      result = received;
      live = received.text;
      statusKey = 'completed';
    } catch (error) {
      if (token !== generation || error.message === 'cancelled') return;
      errorKey = messages[language][error.message] ? error.message : 'unexpected';
      statusKey = 'stopped';
    } finally {
      if (token === generation) { await audio.close(); setBusy(false); renderState(); }
    }
  }

  function roleChanged() {
    const role = $('role').value;
    $('send-fields').hidden = !['send', 'loopback'].includes(role);
    $('file-fields').hidden = role !== 'offline';
    errorKey = '';
    renderState();
  }
  $('text-input').addEventListener('input', () => { errorKey = ''; preview(); });
  $('role').addEventListener('change', roleChanged);
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
  document.body.dataset.busy = 'false';
  render();
  roleChanged();
}());
