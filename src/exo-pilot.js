/**
 * exo-pilot.js — Exo Browser — Exo-Pilot Window Renderer
 *
 * Běží v renderer kontextu pilotního BrowserWindow.
 * Komunikuje s main procesem přes window.pilotAPI (vystaveno přes exo-pilot-preload.js).
 *
 * Zodpovědnosti:
 *  • Přijímá příkazy od uživatele
 *  • Zobrazuje výsledky ve scrollovatelném logu
 *  • Spravuje vizuální stavový stroj (idle → thinking → executing → idle)
 */

'use strict';

// ─── Guard ────────────────────────────────────────────────────────────────────
if (!window.pilotAPI) {
  console.error('[Exo-Pilot] pilotAPI není dostupné — je načten exo-pilot-preload.js?');
}
const api = window.pilotAPI;

// ─── DOM References ───────────────────────────────────────────────────────────
const panel       = document.getElementById('pilot-panel');
const led         = document.getElementById('led');
const statusEl    = document.getElementById('pilot-status');
const logEl       = document.getElementById('pilot-log');
const inputEl     = document.getElementById('pilot-input');
const sendBtn     = document.getElementById('pilot-send');
const closeBtn    = document.getElementById('pilot-close');

// ─── State ────────────────────────────────────────────────────────────────────
/** @type {'idle' | 'thinking' | 'executing'} */
let currentState = 'idle';

// ─── Status texts ─────────────────────────────────────────────────────────────
const STATUS_LABELS = {
  idle:      'IDLE',
  thinking:  'ZPRACOVÁVÁM',
  executing: 'PROVÁDÍM',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns current time as HH:MM:SS */
function nowTs() {
  return new Date().toLocaleTimeString('cs-CZ', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

/**
 * Sets the UI state and updates LED, badge, panel glow, and input availability.
 * @param {'idle' | 'thinking' | 'executing'} state
 */
function setState(state) {
  currentState = state;

  // LED class
  led.className = state !== 'idle' ? state : '';

  // Status badge text + class
  statusEl.textContent = STATUS_LABELS[state] ?? state.toUpperCase();
  statusEl.className   = state !== 'idle' ? state : '';

  // Panel glow
  panel.className = state !== 'idle' ? `state-${state}` : '';

  // Lock input during processing
  inputEl.disabled = state !== 'idle';
  sendBtn.disabled = state !== 'idle';
}

/**
 * Appends a new log entry to the log area.
 *
 * @param {'user'|'pilot'|'action'|'ok'|'error'|'system'} type  Color variant
 * @param {string} badge   Short badge label shown in the color pill
 * @param {string} text    Message text
 * @param {boolean} dim    Apply dim style to text (for detail lines)
 * @returns {HTMLElement}  The created entry element (so caller can remove it)
 */
function addLog(type, badge, text, dim = false) {
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML =
    `<span class="log-ts">${nowTs()}</span>` +
    `<span class="log-badge badge-${type}">${badge}</span>` +
    `<span class="log-text${dim ? ' dim' : ''}">${escapeHtml(text)}</span>`;

  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
  return entry;
}

/**
 * Adds a temporary "thinking..." entry (removed after AI responds).
 * @returns {HTMLElement} The entry element — caller must remove it.
 */
function addThinkingEntry() {
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML =
    `<span class="log-ts">${nowTs()}</span>` +
    `<span class="log-badge badge-pilot">PILOT</span>` +
    `<span class="log-text dim thinking-anim">Analyzuji příkaz</span>`;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
  return entry;
}

/**
 * Logs a dispatched action with its relevant parameters.
 * @param {{ type: string, query?: string, url?: string, direction?: string, amount?: number, selector?: string }} action
 */
function logAction(action) {
  if (!action || action.type === 'none') return;

  /** @type {[string, string]} badge label + human detail */
  const MAP = {
    search:   ['SEARCH',   `query: "${action.query ?? ''}"`],
    open_tab: ['NEW TAB',  `url: ${action.url ?? ''}`],
    scroll:   ['SCROLL',   `direction: ${action.direction ?? 'down'}, amount: ${action.amount ?? 500}px`],
    click:    ['CLICK',    `selector: "${action.selector ?? ''}"`],
  };

  const [badge, detail] = MAP[action.type] ?? ['EXEC', action.type];
  addLog('action', badge, detail, true);
}

/** Minimal HTML escaping — prevents XSS from AI text injected into innerHTML. */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Core: Send Command ───────────────────────────────────────────────────────

/**
 * Reads the input, sends the command to main process via IPC,
 * handles the response, and updates the log.
 *
 * Flow:
 *   1. Validate input
 *   2. Log user message → setState('thinking')
 *   3. Show animated thinking entry
 *   4. Invoke IPC 'exo-pilot-command'
 *   5. Remove thinking entry
 *   6. Log AI message → setState('executing')
 *   7. Log action → wait briefly for visual feedback
 *   8. Log result → setState('idle')
 */
async function sendCommand() {
  const text = inputEl.value.trim();
  if (!text || currentState !== 'idle') return;

  inputEl.value = '';

  // ── Step 1: Log user command
  addLog('user', 'USER', text);
  setState('thinking');

  // ── Step 2: Thinking indicator
  const thinkEntry = addThinkingEntry();

  let result;
  try {
    result = await api.sendCommand(text);
  } catch (err) {
    // IPC transport error (main process crashed, etc.)
    logEl.removeChild(thinkEntry);
    addLog('error', 'IPC', `Transport chyba: ${err.message}`);
    setState('idle');
    inputEl.focus();
    return;
  }

  // ── Step 3: Remove thinking indicator
  if (thinkEntry.parentNode === logEl) logEl.removeChild(thinkEntry);

  // ── Step 4: Handle error from main
  if (result?.error && !result?.message) {
    addLog('error', 'ERROR', result.error);
    setState('idle');
    inputEl.focus();
    return;
  }

  // ── Step 5: Show AI narration message
  if (result?.message) {
    addLog('pilot', 'PILOT', result.message);
  }

  // ── Step 6: Show and execute action
  const action = result?.action;
  if (action && action.type !== 'none') {
    setState('executing');
    logAction(action);

    // Small pause so the user can see the "executing" state
    await new Promise(r => setTimeout(r, 380));

    // Result of the dispatch (success or error)
    if (result?.actionResult?.error) {
      addLog('error', 'FAIL', result.actionResult.error);
    } else {
      addLog('ok', 'DONE', 'Akce provedena úspěšně');
    }
  }

  // ── Step 7: Back to idle
  setState('idle');
  inputEl.focus();
}

// ─── Event Wiring ─────────────────────────────────────────────────────────────

sendBtn.addEventListener('click', sendCommand);

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendCommand();
  }
  if (e.key === 'Escape') {
    api.closeWindow();
  }
});

closeBtn.addEventListener('click', () => api.closeWindow());

// Re-focus input whenever the window regains focus
window.addEventListener('focus', () => {
  if (currentState === 'idle') inputEl.focus();
});
