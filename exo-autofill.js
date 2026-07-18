/**
 * exo-autofill.js — Exo Browser — Form Detection & Autofill Engine
 *
 * Injected via view.webContents.executeJavaScript() on every did-stop-loading
 * event (alongside DARK_INJECT_JS). Runs entirely inside the page's renderer
 * context, communicates back to the Exo chrome via postMessage → main process
 * relay (see EXO_AUTOFILL_RELAY_JS in main.js).
 *
 * Flow:
 *  1. Detect login forms (password input present).
 *  2. Request stored credentials for window.location.origin via postMessage.
 *  3. If credentials exist, show an inline autofill chip near the username field.
 *  4. On form submit with NEW credentials, notify the chrome to show a save-prompt.
 *
 * Security notes:
 *  • Passwords are NEVER stored in this injected script or the page DOM.
 *  • Autofill only dispatches native InputEvent so SPA frameworks pick it up.
 *  • Guard __exo_autofill_init__ prevents double-injection on SPA nav.
 */
console.log('🔥 [Exo-Autofill] Skript úspěšně načten na:', window.location.href);
(function () {
  'use strict';

  // ── Guard: run once per page lifetime ─────────────────────────────────────
  if (window.__exo_autofill_init__) return;
  window.__exo_autofill_init__ = true;

  // ── Unique message namespace ───────────────────────────────────────────────
  const NS = '__exo_af__';

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Send a typed message to the Exo main-process relay.
   * The relay listener in main.js calls ipcMain-equivalent handlers and
   * responds by calling window.__exo_af_response__(type, payload).
   */
  function sendToMain(type, payload = {}) {
    window.postMessage({ [NS]: true, type, payload }, '*');
  }

  /**
   * Dispatch a native InputEvent on an <input> so that React/Vue/Angular
   * frameworks notice the value change.
   */
  function nativeFill(input, value) {
    // Use Object.getOwnPropertyDescriptor to bypass React's synthetic event system
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── Form detection ────────────────────────────────────────────────────────

  /**
   * Find all login form pairs on the page.
   * Returns an array of { usernameInput, passwordInput, form } objects.
   */
  function detectLoginForms() {
    const results = [];
    const pwInputs = [...document.querySelectorAll('input[type="password"]')];

    for (const pwInput of pwInputs) {
      // Walk backwards from the password field to find the username field
      const form = pwInput.closest('form') ?? pwInput.parentElement;
      const allInputs = form
        ? [...form.querySelectorAll('input')]
        : [...document.querySelectorAll('input')];

      const pwIdx = allInputs.indexOf(pwInput);
      // Username is the closest text/email input BEFORE the password field
      let userInput = null;
      for (let i = pwIdx - 1; i >= 0; i--) {
        const t = allInputs[i].type.toLowerCase();
        if (t === 'text' || t === 'email' || t === '' || t === 'tel') {
          userInput = allInputs[i];
          break;
        }
      }

      results.push({ usernameInput: userInput, passwordInput: pwInput, form });
    }
    return results;
  }

  // ── Autofill chip UI ──────────────────────────────────────────────────────

  const CHIP_ID = '__exo_autofill_chip__';

  function removeChip() {
    document.getElementById(CHIP_ID)?.remove();
  }

  /**
   * Render a floating credential picker near the username field.
   * @param {HTMLInputElement|null} anchor   username input (or password if no username)
   * @param {Array}                 creds    array of SafeCredential objects
   * @param {{ usernameInput, passwordInput }} pair
   */
  function showChip(anchor, creds, pair) {
    removeChip();

    const chip = document.createElement('div');
    chip.id = CHIP_ID;

    // ── Chip styles (all inline to be CSP-friendly; no stylesheet injection) ──
    Object.assign(chip.style, {
      position:       'fixed',
      zIndex:         '2147483646',
      background:     'rgba(14,14,26,0.96)',
      backdropFilter: 'blur(12px)',
      border:         '1px solid rgba(167,139,250,0.35)',
      borderRadius:   '10px',
      boxShadow:      '0 8px 32px rgba(0,0,0,0.6)',
      padding:        '6px',
      minWidth:       '220px',
      fontFamily:     '-apple-system, "Segoe UI", sans-serif',
      fontSize:       '13px',
      color:          '#e2e8f0',
    });

    // Position the chip below the anchor input
    const rect = (anchor ?? pair.passwordInput).getBoundingClientRect();
    chip.style.top  = `${rect.bottom + 6 + window.scrollY}px`;
    chip.style.left = `${rect.left   + window.scrollX}px`;

    // Header row
    const header = document.createElement('div');
    Object.assign(header.style, {
      display:        'flex',
      alignItems:     'center',
      gap:            '6px',
      padding:        '4px 8px 8px',
      borderBottom:   '1px solid rgba(167,139,250,0.15)',
      marginBottom:   '4px',
    });
    header.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
      <span style="color:#a78bfa;font-weight:600;font-size:12px;letter-spacing:.05em">EXO VAULT</span>
      <button id="__exo_af_close__" style="margin-left:auto;background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px;line-height:1;padding:0">✕</button>
    `;
    chip.appendChild(header);

    // Credential rows
    for (const cred of creds) {
      const row = document.createElement('button');
      Object.assign(row.style, {
        display:      'flex',
        flexDirection:'column',
        alignItems:   'flex-start',
        gap:          '1px',
        width:        '100%',
        background:   'none',
        border:       'none',
        borderRadius: '6px',
        padding:      '6px 10px',
        cursor:       'pointer',
        textAlign:    'left',
        color:        '#e2e8f0',
        transition:   'background .12s',
      });
      row.onmouseenter = () => { row.style.background = 'rgba(167,139,250,0.12)'; };
      row.onmouseleave = () => { row.style.background = 'none'; };

      const uLine = document.createElement('span');
      uLine.style.fontWeight = '500';
      uLine.textContent = cred.username;

      const oLine = document.createElement('span');
      oLine.style.cssText = 'font-size:11px;color:#64748b;';
      oLine.textContent = cred.origin;

      row.appendChild(uLine);
      row.appendChild(oLine);

      row.addEventListener('click', () => {
        // Ask main process to decrypt & return the password for this id
        sendToMain('autofill-request', { id: cred.id });
        removeChip();
      });

      chip.appendChild(row);
    }

    document.body.appendChild(chip);

    // Pending autofill targets so we can fill when password arrives
    window.__exo_pending_fill__ = pair;

    // Close button
    document.getElementById('__exo_af_close__')?.addEventListener('click', removeChip);

    // Click outside dismisses chip
    const dismiss = (e) => {
      if (!chip.contains(e.target)) { removeChip(); document.removeEventListener('click', dismiss, true); }
    };
    setTimeout(() => document.addEventListener('click', dismiss, true), 0);
  }

  // ── Save-password notification ────────────────────────────────────────────

  /**
   * Notify the Exo chrome (main process) that the user just submitted
   * new credentials that haven't been saved yet.
   *
   * IMPORTANT: Traditional <form> submits navigate immediately after the
   * 'submit' event. The normal postMessage → 250ms poll chain is killed by
   * did-start-loading before the queue is drained. We therefore ALSO push
   * into window.__exo_vault_save_pending__ — a dedicated slot that main.js
   * reads synchronously in the did-start-loading handler before clearing
   * the poll timer.
   */
  // Debounce: button-click + form-submit both fire on the same login click.
  // We suppress duplicates for 500 ms — long enough to swallow the twin event
  // but short enough not to block a genuine second submission.
  let _lastPromptKey = '';
  let _lastPromptAt  = 0;

  function notifySavePrompt(origin, username, password) {
    const key = `${origin}|${username}`;
    const now = Date.now();
    if (key === _lastPromptKey && now - _lastPromptAt < 500) {
      console.log('🔥 [Autofill] notifySavePrompt deduplicated (double-fire suppressed)');
      return;
    }
    _lastPromptKey = key;
    _lastPromptAt  = now;

    console.log('🔥 [Autofill] notifySavePrompt called:', origin, username);

    // Primary path: postMessage queue (works for SPA / fetch-based logins)
    sendToMain('password-save-prompt', { origin, username, password });

    // Redundant safety path: write to a dedicated slot that main reads
    // in did-start-loading BEFORE clearing the interval (see main.js patch).
    try {
      window.__exo_vault_save_pending__ = { origin, username, password };
    } catch (_) {}
  }

  // ── Submission watcher ────────────────────────────────────────────────────

  /**
   * Attach submit listeners to all detected login forms using the CAPTURE
   * phase so we run before any e.preventDefault() in the page's own handlers.
   * Also intercepts clicks on submit buttons and Enter on password fields.
   *
   * @param {{ usernameInput, passwordInput, form }[]} pairs
   * @param {string[]} knownUsernames  usernames already in the vault for this origin
   */
  function watchSubmissions(pairs, knownUsernames) {
    for (const { usernameInput, passwordInput, form } of pairs) {
      const handler = (src) => {
        const username = usernameInput?.value?.trim() ?? '';
        const password = passwordInput?.value ?? '';
        console.log(`🔥 [Autofill] Submit intercepted (${src}): user="${username}" hasPass=${!!password}`);
        if (!password) return;

        // Only prompt if this username isn't already saved
        const isNew = !knownUsernames.includes(username);
        console.log(`🔥 [Autofill] isNew=${isNew} knownUsernames=`, knownUsernames);
        if (isNew) {
          notifySavePrompt(window.location.origin, username, password);
        }
      };

      if (form) {
        // capture:true — fires before the form's own submit handlers
        form.addEventListener('submit', () => handler('form-submit'), { capture: true });

        // Also intercept clicks on any submit-type button inside the form
        form.addEventListener('click', (e) => {
          const btn = e.target.closest('button[type="submit"], input[type="submit"], button:not([type])');
          if (btn) handler('button-click');
        }, { capture: true });
      }

      // Catch Enter key on password field (SPA pattern — no real <form> submit)
      passwordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handler('enter-key');
      }, { capture: true });

      // Fallback: watch for clicks on any button labelled like a login button
      // that isn't inside a <form> (common in React/Vue SPAs)
      if (!form) {
        document.addEventListener('click', (e) => {
          const btn = e.target.closest('button, [role="button"], input[type="submit"]');
          if (!btn) return;
          const label = (btn.textContent || btn.value || btn.ariaLabel || '').toLowerCase();
          if (/log\s?in|sign\s?in|přihlásit|login|submit/.test(label)) {
            handler('spa-button-click');
          }
        }, { capture: true });
      }
    }
  }

  // ── Main init ─────────────────────────────────────────────────────────────

  // Mutable set of usernames already in the vault for this origin.
  // Populated async when the vault responds, but submit listeners are attached
  // SYNCHRONOUSLY the moment a form is found — no waiting for the vault reply.
  const _knownUsernames = [];

  /** True once we've found a form, attached listeners, and fired get-credentials */
  let _initDone = false;

  function tryInit() {
    if (_initDone) return;
    const pairs = detectLoginForms();
    if (pairs.length === 0) return; // no login form yet

    _initDone = true;
    console.log('🔥 [Autofill] Login form detected — attaching listeners immediately for', window.location.origin);

    // ── CRITICAL: attach submit/click/keydown listeners RIGHT NOW, synchronously.
    // Do NOT wait for the vault get-credentials response. The vault may be empty,
    // the IPC round-trip takes a few ms, and the user can click Login before it
    // resolves. _knownUsernames starts empty and is filled in when the vault replies.
    watchSubmissions(pairs, _knownUsernames);

    // Request credentials async — when reply arrives we show the autofill chip
    // and update _knownUsernames so repeat-save prompts are suppressed.
    sendToMain('get-credentials', { origin: window.location.origin });
  }

  function init() {
    tryInit();

    // MutationObserver fallback: some sites render the login form after a delay
    // (React hydration, SPA route change, etc.). Watch for password inputs to appear.
    if (!_initDone) {
      const obs = new MutationObserver(() => {
        tryInit();
        if (_initDone) obs.disconnect();
      });
      obs.observe(document.body || document.documentElement, {
        childList: true, subtree: true
      });
      // Auto-disconnect after 10s to avoid lingering observers
      setTimeout(() => obs.disconnect(), 10000);
    }
  }

  // ── Response handler (called by main-process relay) ───────────────────────

  window.__exo_af_response__ = function (type, payload) {
    if (type === 'credentials') {
      const { creds } = payload;

      // Update the shared knownUsernames array in-place so the already-attached
      // submit listeners immediately start suppressing already-saved credentials.
      _knownUsernames.length = 0;
      _knownUsernames.push(...creds.map(c => c.username));

      if (creds.length > 0) {
        const pairs = detectLoginForms();
        if (pairs.length === 0) return;

        // Show autofill chip on the first detected form
        const { usernameInput } = pairs[0];
        showChip(usernameInput, creds, pairs[0]);

        // If there's exactly one cred and the username field is empty, pre-fill it
        if (creds.length === 1 && usernameInput && !usernameInput.value) {
          nativeFill(usernameInput, creds[0].username);
        }
      }
    }

    if (type === 'autofill-fill') {
      // Main sent back the decrypted password — fill it in
      const { username, password } = payload;
      const pair = window.__exo_pending_fill__;
      if (!pair) return;
      if (pair.usernameInput && username) nativeFill(pair.usernameInput, username);
      if (pair.passwordInput && password) nativeFill(pair.passwordInput, password);
      pair.passwordInput.focus();
    }
  };

  // ── Kick off ──────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();