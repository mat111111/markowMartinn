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

  // Combinaciones tipográficas (títulos / textos largos / interfaz), todas de Google Fonts.
  var FONTS = [
    { id: 'clasica', name: 'Clásica', display: '"Bodoni Moda", "Didot", Georgia, serif', text: '"Literata", Georgia, serif', ui: '"Schibsted Grotesk", "Helvetica Neue", Arial, sans-serif',
      q: 'family=Bodoni+Moda:ital,opsz,wght@0,6..96,400..700;1,6..96,400..600&family=Literata:ital,opsz,wght@0,7..72,400..600;1,7..72,400&family=Schibsted+Grotesk:wght@400..700' },
    { id: 'garamond', name: 'Garamond', display: '"EB Garamond", Garamond, Georgia, serif', text: '"EB Garamond", Garamond, Georgia, serif', ui: '"Work Sans", Arial, sans-serif',
      q: 'family=EB+Garamond:ital,wght@0,400..700;1,400..600&family=Work+Sans:wght@400..700' },
    { id: 'moderna', name: 'Moderna', display: '"DM Serif Display", Georgia, serif', text: '"Source Serif 4", Georgia, serif', ui: '"DM Sans", Arial, sans-serif',
      q: 'family=DM+Serif+Display:ital@0;1&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..600;1,8..60,400&family=DM+Sans:opsz,wght@9..40,400..700' },
    { id: 'romantica', name: 'Romántica', display: '"Playfair Display", Georgia, serif', text: '"Lora", Georgia, serif', ui: '"Manrope", Arial, sans-serif',
      q: 'family=Playfair+Display:ital,wght@0,400..700;1,400..600&family=Lora:ital,wght@0,400..600;1,400&family=Manrope:wght@400..700' },
    { id: 'tecnica', name: 'Técnica', display: '"Space Grotesk", Arial, sans-serif', text: '"IBM Plex Serif", Georgia, serif', ui: '"IBM Plex Sans", Arial, sans-serif',
      q: 'family=Space+Grotesk:wght@400..700&family=IBM+Plex+Serif:ital,wght@0,400;0,500;1,400&family=IBM+Plex+Sans:wght@400;500;600;700' },
    { id: 'maquina', name: 'Máquina de escribir', display: '"Special Elite", "Courier New", monospace', text: '"Courier Prime", "Courier New", monospace', ui: '"IBM Plex Mono", "Courier New", monospace',
      q: 'family=Special+Elite&family=Courier+Prime:ital,wght@0,400;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600' },
    { id: 'legible', name: 'Alta legibilidad', display: '"Atkinson Hyperlegible", Arial, sans-serif', text: '"Atkinson Hyperlegible", Arial, sans-serif', ui: '"Atkinson Hyperlegible", Arial, sans-serif',
      q: 'family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400;1,700' },
  ];
  function font(id) {
    for (var i = 0; i < FONTS.length; i++) if (FONTS[i].id === id) return FONTS[i];
    return FONTS[0];
  }
  function fontsHref(a) {
    return 'https://fonts.googleapis.com/css2?' + font(normalize(a).font).q + '&display=swap';
  }
  // Todas juntas, para las muestras del panel.
  function allFontsHref() {
    return 'https://fonts.googleapis.com/css2?' + FONTS.map(function (f) { return f.q; }).join('&') + '&display=swap';
  }

  var DEFAULTS = { fontScale: 100, font: 'clasica', custom: false, textColor: '#14181f', bgColor: '#f3f4f1', accentColor: '#2539c2' };

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
      font: font(a.font).id,
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
    if (a.font !== 'clasica') {
      var f = font(a.font);
      v['--f-display'] = f.display;
      v['--f-text'] = f.text;
      v['--f-ui'] = f.ui;
    }
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

  var api = { PRESETS: PRESETS, DEFAULTS: DEFAULTS, FONTS: FONTS, fontsHref: fontsHref, allFontsHref: allFontsHref, normalize: normalize, vars: vars, css: css, warnings: warnings, contrast: contrast };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SiteTheme = api;
})(typeof window !== 'undefined' ? window : globalThis);
