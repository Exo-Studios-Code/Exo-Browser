/**
 * exo-dark-reader.js — Exo Browser — Dark Reader Integration
 *
 * Replaces the old CSS invert()/hue-rotate() hack with the real Dark Reader
 * library (https://darkreader.org), bundled locally from node_modules.
 *
 * Public API:
 *   enableDarkMode(webContents)   — activate Dark Reader in a WebContents
 *   disableDarkMode(webContents)  — deactivate Dark Reader in a WebContents
 *
 * Principles:
 *   • Dark Reader is read from disk once at startup and cached in memory —
 *     no per-tab file I/O, no CDN, no network dependency.
 *   • A guard flag (__exo_dr_loaded__) prevents double-injection on the same page.
 *   • Works with React, Vue, Angular, Shadow DOM, and SPA navigations because
 *     Dark Reader uses its own MutationObserver internally.
 *   • Images, videos, canvas, and SVG keep their original colours — Dark Reader
 *     handles this correctly out of the box (unlike the old invert approach).
 *   • The EXO watermark/badge is injected separately (after Dark Reader),
 *     so it is always visible on top of any page.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Load Dark Reader bundle once at startup ───────────────────────────────────
// node_modules/darkreader/darkreader.js is the official UMD browser bundle.
// It exposes window.DarkReader = { enable, disable, exportGeneratedCSS, ... }
// when executed in a browser context.
const DARK_READER_BUNDLE_PATH = path.join(
  __dirname, '..', 'node_modules', 'darkreader', 'darkreader.js'
);

let _darkReaderSource = null;

function getDarkReaderSource() {
  if (_darkReaderSource !== null) return _darkReaderSource;
  try {
    _darkReaderSource = fs.readFileSync(DARK_READER_BUNDLE_PATH, 'utf8');
    console.log('[Exo-Dark] Dark Reader bundle načten (' +
      Math.round(_darkReaderSource.length / 1024) + ' KB)');
  } catch (err) {
    console.error('[Exo-Dark] Nelze načíst darkreader.js:', err.message);
    _darkReaderSource = '';
  }
  return _darkReaderSource;
}

// ── Dark Reader configuration ─────────────────────────────────────────────────
// These settings mirror what Opera GX / Edge use.
// brightness/contrast near 100 = minimal colour shift; Dark Reader does the
// heavy lifting via its CSS filter algorithm (not a blanket invert).
const DR_CONFIG = JSON.stringify({
  brightness:  100,
  contrast:    90,
  sepia:       10,
  grayscale:   0,
  // Dark Reader 4.9+ removed cssFilter/staticTheme from the public enable()
  // API — "dynamicTheme" is the only engine supported via DarkReader.enable().
  // It works fine in Electron renderer contexts; cross-origin iframes simply
  // don't receive the theme, which is acceptable behaviour.
  engine:      'dynamicTheme',
});

// ── EXO watermark badge ───────────────────────────────────────────────────────
// Kept separate from Dark Reader so it always renders on top,
// regardless of the page's z-index hierarchy.
const EXO_BADGE_JS = /* js */`
(function() {
  if (document.getElementById('__exo_badge__')) return;
  const badge = document.createElement('div');
  badge.id = '__exo_badge__';
  badge.style.cssText = [
    'position:fixed',
    'bottom:14px',
    'right:14px',
    'z-index:2147483647',
    'font:700 9px/1 -apple-system,sans-serif',
    'letter-spacing:.22em',
    'padding:4px 8px',
    'border-radius:6px',
    'background:rgba(8,8,16,.72)',
    'backdrop-filter:blur(6px)',
    'border:1px solid rgba(167,139,250,.35)',
    'color:transparent',
    'background-clip:text',
    '-webkit-background-clip:text',
    'background-image:linear-gradient(90deg,#a78bfa,#38bdf8,#f472b6,#a78bfa)',
    'background-size:300% 100%',
    'animation:__exo_flow__ 4s linear infinite',
    'pointer-events:none',
    'user-select:none',
  ].join(';');
  badge.textContent = 'EXO';
  const anim = document.createElement('style');
  anim.textContent = '@keyframes __exo_flow__{0%{background-position:0 0}100%{background-position:300% 0}}';
  document.head.appendChild(anim);
  document.documentElement.appendChild(badge);
})();
`;

// ── Core injection script ─────────────────────────────────────────────────────
/**
 * Builds the JS string that, when executed inside a WebContents, will:
 *   1. Inject the Dark Reader UMD bundle (once, guarded by __exo_dr_loaded__)
 *   2. Call DarkReader.enable() with our config
 *   3. Inject the EXO badge
 *
 * @param {string} darkReaderSrc  — raw source of darkreader.js
 * @returns {string}
 */
function buildEnableScript(darkReaderSrc) {
  return /* js */`
(function() {
  // ── Guard: skip if already active on this page ─────────────────────────────
  if (window.__exo_dr_loaded__) {
    // Re-enable in case it was paused (e.g. SPA soft-nav to a disabled page)
    try { window.DarkReader && window.DarkReader.enable(${DR_CONFIG}); } catch(_) {}
    return;
  }
  window.__exo_dr_loaded__ = true;

  // ── Inject Dark Reader bundle ───────────────────────────────────────────────
  // We run the source directly (no <script> tag needed — executeJavaScript
  // already runs in the page's JS context and populates window.DarkReader).
  try {
    ${darkReaderSrc}
  } catch(e) {
    console.error('[Exo-Dark] Dark Reader bundle error:', e);
    return;
  }

  // ── Activate Dark Reader ────────────────────────────────────────────────────
  // setFetchMethod is required in Electron because Dark Reader's default fetch
  // may be blocked; window.fetch is always available in renderer contexts.
  try {
    if (typeof DarkReader !== 'undefined') {
      DarkReader.setFetchMethod(window.fetch);
      DarkReader.enable(${DR_CONFIG});
      console.log('[Exo-Dark] Dark Reader aktivní.');
    }
  } catch(e) {
    console.warn('[Exo-Dark] enable() selhal:', e.message);
  }
})();
${EXO_BADGE_JS}
`;
}

/**
 * JS string that disables Dark Reader on the current page.
 * Safe to call even if Dark Reader was never enabled (no-op).
 */
const DISABLE_SCRIPT = /* js */`
(function() {
  try {
    if (window.DarkReader) {
      window.DarkReader.disable();
      window.__exo_dr_loaded__ = false;
      console.log('[Exo-Dark] Dark Reader deaktivován.');
    }
  } catch(e) {
    console.warn('[Exo-Dark] disable() selhal:', e.message);
  }
})();
`;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Enable Dark Reader in the given WebContents.
 * Safe to call multiple times — idempotent on the same page.
 * Automatically skips Exo's own internal pages (newtab, search).
 *
 * @param {Electron.WebContents} webContents
 * @param {string} [currentUrl]  — optional URL hint (avoids extra IPC call)
 */
async function enableDarkMode(webContents, currentUrl) {
  if (!webContents || webContents.isDestroyed()) return;

  const url = currentUrl || webContents.getURL();

  // Skip Exo-internal pages — they already have their own dark design.
  if (url.includes('exo-newtab.html') || url.includes('exo-search.html') || !url) return;

  const src = getDarkReaderSource();
  if (!src) return; // bundle missing — fail silently

  try {
    await webContents.executeJavaScript(buildEnableScript(src));
  } catch (_) {
    // CSP or navigation during injection — silently skip.
  }
}

/**
 * Disable Dark Reader in the given WebContents.
 * Safe to call even if Dark Reader was never enabled.
 *
 * @param {Electron.WebContents} webContents
 */
async function disableDarkMode(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  try {
    await webContents.executeJavaScript(DISABLE_SCRIPT);
  } catch (_) {}
}

module.exports = { enableDarkMode, disableDarkMode };