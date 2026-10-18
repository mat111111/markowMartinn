/* Apariencia personalizable: lo usan el navegador (vista previa) y el servidor
   (que la inyecta en la página para que no haya parpadeo al cargar). */
(function (root) {
  'use strict';

  var HEX = /^#[0-9a-f]{6}$/i;

  var PRESETS = [
    { id: 'original', name: 'Original', custom: false },
    { id: 'tinta', name: 'Tinta', custom: true, textColor: '#14181f', bgColor: '#f3f4f1', accentColor: '#2539c2' },
    { id: 'noche', name: 'Noche', custom: true, textColor: '#e8e6df', bgColor: '#15181d', accentColor: '#e0b45a' },
    { id: 'pizarra', name: 'Pizarra', custom: true, textColor: '#f0f2f4', bgColor: '#26313b', accentColor: '#7fc4b8' },
    { id: 'vino', name: 'Vino', custom: true, textColor: '#2a1418', bgColor: '#f6f1ef', accentColor: '#8a1f33' },
    { id: 'bosque', name: 'Bosque', custom: true, textColor: '#132019', bgColor: '#eef2ec', accentColor: '#2f6b45' },
    { id: 'contraste', name: 'Alto contraste', custom: true, textColor: '#000000', bgColor: '#ffffff', accentColor: '#0033cc' },
  ];

  var DEFAULTS = { fontScale: 100, custom: false, textColor: '#14181f', bgColor: '#f3f4f1', accentColor: '#2539c2' };

  function rgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function hex(c) {
    return '#' + c.map(function (v) {
      var s = Math.round(Math.max(0, Math.min(255, v))).toString(16);
      return s.length === 1 ? '0' + s : s;
    }).join('');
  }
  // mezcla: t = proporción de b
  function mix(a, b, t) {
    var x = rgb(a), y = rgb(b);
    return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
  }
  function lum(h) {
    return rgb(h).map(function (c) {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }).reduce(function (s, c, i) { return s + c * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }
  function contrast(a, b) {
    var l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  function normalize(a) {
    a = a || {};
    var scale = Number(a.fontScale);
    return {
      fontScale: scale >= 85 && scale <= 130 ? Math.round(scale) : 100,
      custom: Boolean(a.custom),
      textColor: HEX.test(a.textColor) ? a.textColor.toLowerCase() : DEFAULTS.textColor,
      bgColor: HEX.test(a.bgColor) ? a.bgColor.toLowerCase() : DEFAULTS.bgColor,
      accentColor: HEX.test(a.accentColor) ? a.accentColor.toLowerCase() : DEFAULTS.accentColor,
    };
  }

  function vars(a) {
    a = normalize(a);
    var v = {};
    if (a.fontScale !== 100) v['font-size'] = a.fontScale + '%';
    if (!a.custom) return v;

    var ink = a.textColor, paper = a.bgColor, accent = a.accentColor;
    var dark = lum(paper) < lum(ink);
    var white = '#ffffff', black = '#000000';
    var footer = dark ? mix(paper, black, 0.35) : ink;
    var footerInk = dark ? ink : paper;

    v['--paper'] = paper;
    v['--paper-2'] = mix(paper, ink, dark ? 0.05 : 0.045);
    v['--card'] = dark ? mix(paper, white, 0.05) : mix(paper, white, 0.6);
    v['--ink'] = ink;
    v['--ink-2'] = mix(ink, paper, 0.28);
    v['--ink-3'] = mix(ink, paper, 0.45);
    v['--line'] = mix(paper, ink, 0.17);
    v['--accent'] = accent;
    v['--accent-ink'] = contrast(accent, white) >= contrast(accent, '#111111') ? white : '#111111';
    v['--accent-soft'] = mix(paper, accent, 0.13);
    v['--footer'] = footer;
    v['--footer-ink'] = footerInk;
    v['--footer-ink-2'] = mix(footerInk, footer, 0.35);
    v['--footer-line'] = mix(footer, footerInk, 0.16);
    v['--footer-field'] = mix(footer, footerInk, 0.06);
    if (dark) {
      v['--ok'] = '#7ccb8e'; v['--ok-soft'] = mix(paper, '#7ccb8e', 0.14);
      v['--warn'] = '#e2bd63'; v['--warn-soft'] = mix(paper, '#e2bd63', 0.14);
      v['--danger'] = '#f08b80'; v['--danger-soft'] = mix(paper, '#f08b80', 0.14);
    } else {
      v['--ok-soft'] = mix(paper, '#2d6a3d', 0.12);
      v['--warn-soft'] = mix(paper, '#7f5a00', 0.12);
      v['--danger-soft'] = mix(paper, '#a3261c', 0.12);
    }
    v['color-scheme'] = dark ? 'dark' : 'light';
    return v;
  }

  // Regla CSS lista para un <style>. ":root:root" gana sobre el modo oscuro automático.
  function css(a) {
    var v = vars(a);
    var body = Object.keys(v).map(function (k) { return k + ':' + v[k]; }).join(';');
    return body ? ':root:root{' + body + '}' : '';
  }

  // Avisos de legibilidad para el panel.
  function warnings(a) {
    a = normalize(a);
    if (!a.custom) return [];
    var out = [];
    var c = contrast(a.textColor, a.bgColor);
    if (c < 4.5) out.push('El texto y el fondo tienen poco contraste (' + c.toFixed(1) + ':1). Para leer cómodo se recomienda 4.5:1 o más.');
    var ca = contrast(a.accentColor, a.bgColor);
    if (ca < 3) out.push('El color de acento se distingue poco del fondo (' + ca.toFixed(1) + ':1). Probá uno más oscuro o más claro.');
    return out;
  }

  var api = { PRESETS: PRESETS, DEFAULTS: DEFAULTS, normalize: normalize, vars: vars, css: css, warnings: warnings, contrast: contrast };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SiteTheme = api;
})(typeof window !== 'undefined' ? window : globalThis);
