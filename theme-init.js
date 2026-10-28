/* Airborne Tone Link - MIT (c) 2026 ipusiron
 * Decides the theme before the first paint. index.html loads this file in <head> right after style.css, without defer.
 * A saved choice (airborne-tone-link.theme) of "light" or "dark" wins; otherwise the OS setting decides.
 * app.js reads data-theme back at start-up and saves the choice when the toggle is pressed. */
(function (global) {
  'use strict';
  let saved = null;
  try { saved = global.localStorage.getItem('airborne-tone-link.theme'); } catch (_) { /* Optional. */ }
  const prefersDark = !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
  global.document.documentElement.dataset.theme = saved === 'light' || saved === 'dark' ? saved : (prefersDark ? 'dark' : 'light');
})(typeof window !== 'undefined' ? window : globalThis);
