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
  let errorKey = '';
  const t = key => messages[language][key] || key;

  function preview() {
    try {
      const bytes = core.bytesOf($('text-input').value);
      $('byte-count').textContent = `${bytes.length} / 16 ${t('unitsBytes')}`;
      $('byte-preview').textContent = bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
      errorKey = '';
    } catch (error) {
      $('byte-count').textContent = `${new TextEncoder().encode($('text-input').value).length} / 16 ${t('unitsBytes')}`;
      $('byte-preview').textContent = '';
      errorKey = error.message;
    }
    $('error').textContent = errorKey ? t(errorKey) : '';
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
  }

  function roleChanged() {
    const role = $('role').value;
    $('send-fields').hidden = !['send', 'loopback'].includes(role);
    $('file-fields').hidden = role !== 'offline';
  }
  $('text-input').addEventListener('input', preview);
  $('role').addEventListener('change', roleChanged);
  $('gain').addEventListener('input', () => { $('gain-value').textContent = `${$('gain').value}dBFS`; });
  $('lang-toggle').addEventListener('click', () => { language = language === 'ja' ? 'en' : 'ja'; save('lang', language); render(); });
  $('theme-toggle').addEventListener('click', () => { theme = theme === 'light' ? 'dark' : 'light'; save('theme', theme); render(); });
  $('help-toggle').addEventListener('click', () => { $('help-dialog').showModal(); });
  $('help-close').addEventListener('click', () => { $('help-dialog').close(); });
  $('help-dialog').addEventListener('close', () => { $('help-toggle').focus(); });
  document.body.dataset.busy = 'false';
  render();
  roleChanged();
}());
