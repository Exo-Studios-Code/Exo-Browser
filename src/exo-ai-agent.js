/**
 * exo-ai-agent.js — Exo Browser — AI Agent Module (Gemini)
 *
 * Tento modul je require()-ován z main.js.
 * Zodpovědnosti:
 *  • Komunikace s Google Gemini API (1.5 Flash / Pro)
 *  • Zpracování příkazů Exo-Pilot (NLU → akce → výsledek)
 *  • Sumarizace / analýza obsahu stránky
 *  • Bezpečné ukládání API klíče přes electron-store (safeStorage)
 *
 * Neobsahuje žádné UI. Veškerou komunikaci obstarávají IPC handlery
 * registrované v registerAgentIPC(ipcMain, getActiveTab).
 *
 * ZÁVISLOSTI (přidat do package.json):
 *   "electron-store": "^10.0.0"
 *
 * Gemini REST endpoint (nevyžaduje npm balíček — používáme net.fetch):
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={KEY}
 */

'use strict';

const { net, safeStorage, ipcMain } = require('electron');
const path = require('path');

// ─── Konfigurace ──────────────────────────────────────────────────────────────

const GEMINI_MODEL   = 'gemini-2.5-flash';   // Výchozí model
const GEMINI_TIMEOUT = 20_000;                // ms

const GEMINI_ENDPOINT = (key, model) =>
  `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${key}`;

// ─── Secure Storage ───────────────────────────────────────────────────────────

/**
 * Jednoduchý wrapper nad safeStorage + electron-store.
 * Klíč API je šifrován nativně OS-keychain mechanismem Electronu.
 * Fallback na obyčejný JSON store (méně bezpečný), pokud safeStorage není dostupný.
 */
class SecureSettings {
  constructor(userDataPath) {
    this._file = path.join(userDataPath, 'exo-secure-settings.json');
    this._cache = {};
    this._load();
  }

  _load() {
    try {
      const fs = require('fs');
      if (fs.existsSync(this._file)) {
        this._cache = JSON.parse(fs.readFileSync(this._file, 'utf8'));
      }
    } catch (_) { this._cache = {}; }
  }

  _save() {
    try {
      require('fs').writeFileSync(this._file, JSON.stringify(this._cache), 'utf8');
    } catch (err) {
      console.error('[Exo-AI] Nelze uložit nastavení:', err.message);
    }
  }

  /**
   * Uloží citlivý řetězec (API klíč) s šifrováním, pokud je dostupné.
   */
  setSecret(key, value) {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(value);
      this._cache[key] = { encrypted: true, data: encrypted.toString('base64') };
    } else {
      // Fallback bez šifrování — varování v konzoli
      console.warn('[Exo-AI] safeStorage není dostupný — ukládám API klíč jako plain text!');
      this._cache[key] = { encrypted: false, data: value };
    }
    this._save();
  }

  /**
   * Načte citlivý řetězec.
   * @returns {string|null}
   */
  getSecret(key) {
    const entry = this._cache[key];
    if (!entry) return null;
    if (entry.encrypted) {
      try {
        return safeStorage.decryptString(Buffer.from(entry.data, 'base64'));
      } catch (_) { return null; }
    }
    return entry.data;
  }

  /**
   * Uloží běžné (nešifrované) nastavení.
   */
  set(key, value) {
    this._cache[key] = value;
    this._save();
  }

  get(key, defaultValue = null) {
    return key in this._cache ? this._cache[key] : defaultValue;
  }

  delete(key) {
    delete this._cache[key];
    this._save();
  }
}

// Singleton — inicializován v registerAgentIPC
let settings = null;

// ─── Gemini API ───────────────────────────────────────────────────────────────

/**
 * Odešle požadavek na Gemini API.
 *
 * @param {string} apiKey
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {Object} [jsonSchema]   Pokud zadán, vynutí JSON output
 * @returns {Promise<string>}     Odpověď modelu jako text
 */
async function callGemini(apiKey, systemPrompt, userMessage, jsonSchema = null) {
  const model = settings ? settings.get('ai-model', GEMINI_MODEL) : GEMINI_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT);

  const body = {
    contents: [
      { role: 'user', parts: [{ text: `${systemPrompt}\n\n---\n${userMessage}` }] },
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1024,
    },
  };

  // Pokud chceme strukturovaný JSON výstup
  if (jsonSchema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema   = jsonSchema;
  }

  try {
    const resp = await net.fetch(GEMINI_ENDPOINT(apiKey, model), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    });

    clearTimeout(timer);

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${resp.status}`);
    }

    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini vrátil prázdnou odpověď.');
    return text;

  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('Gemini API timeout (>20s).');
    throw err;
  }
}

// ─── Exo-Pilot: NLU → Akce ───────────────────────────────────────────────────

const PILOT_SYSTEM = `
Jsi Exo-Pilot, AI asistent zabudovaný v Exo Browseru.
Přijímáš příkazy od uživatele v přirozeném jazyce a vracíš PŘESNĚ JSON objekt dle schématu níže.

Schéma:
{
  "message": "<krátká odpověď pro uživatele — 1-2 věty, česky>",
  "action": {
    "type": "<search | open_tab | navigate | scroll | click | summarize | none>",
    "query": "<pro search>",
    "url": "<pro open_tab nebo navigate>",
    "direction": "<up|down pro scroll>",
    "amount": <číslo px pro scroll>,
    "selector": "<CSS selector pro click>"
  }
}

Pravidla:
- Pokud uživatel chce hledat → type: "search", query: <dotaz>
- Pokud chce otevřít URL / web → type: "open_tab", url: <https://...>
- Pokud chce navigovat v aktivním tabu → type: "navigate"
- Pokud chce scrollovat → type: "scroll"
- Pokud chce kliknout na prvek → type: "click"
- Pokud chce sumarizovat stránku → type: "summarize"
- Jinak → type: "none"
- VŽDY vrať validní JSON. Žádný Markdown. Žádné \`\`\`.
`.trim();

const PILOT_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    action:  {
      type: 'object',
      properties: {
        type:      { type: 'string', enum: ['search','open_tab','navigate','scroll','click','summarize','none'] },
        query:     { type: 'string' },
        url:       { type: 'string' },
        direction: { type: 'string', enum: ['up','down'] },
        amount:    { type: 'number' },
        selector:  { type: 'string' },
      },
      required: ['type'],
    },
  },
  required: ['message','action'],
};

/**
 * Zpracuje příkaz Exo-Pilot.
 * @param {string} apiKey
 * @param {string} command   Uživatelský příkaz
 * @param {string} pageCtx   Kontext stránky (URL + titulek)
 * @returns {Promise<{ message: string, action: object }>}
 */
async function processPilotCommand(apiKey, command, pageCtx) {
  const userMsg = pageCtx
    ? `Kontext aktivní stránky: ${pageCtx}\n\nPříkaz: ${command}`
    : `Příkaz: ${command}`;

  const raw = await callGemini(apiKey, PILOT_SYSTEM, userMsg, PILOT_SCHEMA);

  try {
    // Gemini s JSON schema by měl vrátit čistý JSON, ale pro jistotu strip
    const clean = raw.replace(/^```(?:json)?|```$/gm, '').trim();
    return JSON.parse(clean);
  } catch (_) {
    return { message: raw, action: { type: 'none' } };
  }
}

// ─── Sumarizace stránky ───────────────────────────────────────────────────────

const SUMMARIZE_SYSTEM = `
Jsi expert na analýzu webových stránek. Dostaneš textový obsah stránky a URL.
Tvůj úkol:
1. Napiš krátký souhrn (3-5 vět) v češtině.
2. Vypiš 3-5 klíčových bodů (bullet points).
3. Odhadni kategorii stránky (Zprávy, Tutorial, E-shop, Dokumentace, Sociální sítě, Jiné).

Výstup:
SOUHRN:
<text>

KLÍČOVÉ BODY:
• <bod 1>
• <bod 2>
...

KATEGORIE: <kategorie>
`.trim();

/**
 * Sumarizuje obsah stránky pomocí Gemini.
 * @param {string} apiKey
 * @param {string} url
 * @param {string} pageText   Extrahovaný text stránky (max ~8000 chars)
 * @returns {Promise<string>}
 */
async function summarizePage(apiKey, url, pageText) {
  const truncated = pageText.slice(0, 8000);
  const userMsg   = `URL: ${url}\n\nObsah stránky:\n${truncated}`;
  return callGemini(apiKey, SUMMARIZE_SYSTEM, userMsg);
}

// ─── IPC Registrace ───────────────────────────────────────────────────────────

/**
 * Zaregistruje všechny IPC handlery pro AI agenta.
 *
 * @param {Electron.IpcMain}    ipcMain
 * @param {() => object|null}   getActiveTab     Vrací aktuální tab objekt { view, url, title }
 * @param {string}              userDataPath     app.getPath('userData')
 */
function registerAgentIPC(ipcMain, getActiveTab, userDataPath) {
  settings = new SecureSettings(userDataPath);

  // ── Nastavení API klíče ─────────────────────────────────────────────────────

  ipcMain.handle('ai-get-config', () => {
    const hasKey = !!settings.getSecret('gemini-api-key');
    const model  = settings.get('ai-model', GEMINI_MODEL);
    return { hasKey, model };
  });

  ipcMain.handle('ai-set-api-key', (_e, { key }) => {
    if (!key || typeof key !== 'string') return { ok: false, error: 'Klíč musí být string.' };
    settings.setSecret('gemini-api-key', key.trim());
    return { ok: true };
  });

  ipcMain.handle('ai-delete-api-key', () => {
    settings.delete('gemini-api-key');
    return { ok: true };
  });

  ipcMain.handle('ai-set-model', (_e, { model }) => {
    settings.set('ai-model', model);
    return { ok: true };
  });

  // ── Exo-Pilot Command ───────────────────────────────────────────────────────

  ipcMain.handle('exo-pilot-command', async (_e, { text }) => {
    const apiKey = settings.getSecret('gemini-api-key');
    if (!apiKey) return { error: 'API klíč není nastaven. Otevři Nastavení (⚙) a zadej Gemini API klíč.' };

    const tab    = getActiveTab();
    const pageCtx = tab ? `${tab.title} — ${tab.url}` : null;

    try {
      const result = await processPilotCommand(apiKey, text, pageCtx);

      // Proveď akci v main procesu
      const actionResult = await dispatchAction(result.action, getActiveTab);
      return { ...result, actionResult };

    } catch (err) {
      return { error: `Chyba AI: ${err.message}` };
    }
  });

  // ── Sumarizace aktivní stránky ──────────────────────────────────────────────

  ipcMain.handle('ai-summarize-page', async (_e, { pageText }) => {
    const apiKey = settings.getSecret('gemini-api-key');
    if (!apiKey) return { error: 'API klíč není nastaven.' };

    const tab = getActiveTab();
    if (!tab) return { error: 'Žádný aktivní tab.' };

    try {
      const summary = await summarizePage(apiKey, tab.url, pageText || '');
      return { ok: true, summary };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── Obecný AI dotaz (AI Chat sidebar) ──────────────────────────────────────

  ipcMain.handle('ai-chat', async (_e, { messages, pageContext }) => {
    const apiKey = settings.getSecret('gemini-api-key');
    if (!apiKey) return { error: 'API klíč není nastaven.' };

    const systemPrompt = `
Jsi AI asistent Exo Browseru. Pomáháš uživateli porozumět obsahu webových stránek,
odpovídáš na otázky a poskytuje relevantní informace. Odpovídej česky nebo v jazyce uživatele.
${pageContext ? `\nAktuální stránka: ${pageContext}` : ''}
    `.trim();

    // Sestavení konverzace — vezmi posledních 6 zpráv
    const history = (messages || []).slice(-6);
    const lastMsg = history.pop();
    if (!lastMsg) return { error: 'Žádná zpráva.' };

    try {
      // Pro jednoduchost voláme Gemini se systémem + posledním uživatelským pokynem
      // (Gemini 1.5 Flash nepodporuje multi-turn v tomto endpointu snadno — simulujeme)
      const historyText = history
        .map(m => `${m.role === 'user' ? 'Uživatel' : 'Asistent'}: ${m.content}`)
        .join('\n');
      const userMsg = historyText
        ? `Předchozí konverzace:\n${historyText}\n\nUživatel: ${lastMsg.content}`
        : lastMsg.content;

      const reply = await callGemini(apiKey, systemPrompt, userMsg);
      return { ok: true, reply };
    } catch (err) {
      return { error: err.message };
    }
  });

  // ── Test API klíče ──────────────────────────────────────────────────────────

  ipcMain.handle('ai-test-key', async () => {
    const apiKey = settings.getSecret('gemini-api-key');
    if (!apiKey) return { ok: false, error: 'Klíč není uložen.' };
    try {
      const resp = await callGemini(apiKey, 'Answer with exactly: OK', 'ping', null);
      const model = settings.get('ai-model', GEMINI_MODEL);
      return { ok: resp.trim().startsWith('OK') || resp.length > 0, model };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  console.log('[Exo-AI] AI Agent inicializován. Model:', GEMINI_MODEL);
}

// ─── Action Dispatcher ────────────────────────────────────────────────────────

/**
 * Provede akci v browseru podle instrukce od AI.
 * @param {{ type: string, query?: string, url?: string, direction?: string, amount?: number, selector?: string }} action
 * @param {() => object|null} getActiveTab
 */
async function dispatchAction(action, getActiveTab) {
  if (!action || action.type === 'none') return { ok: true };

  const tab = getActiveTab();

  switch (action.type) {

    case 'search': {
      // Naviguje aktivní tab na DuckDuckGo hledání
      if (!tab?.view) return { error: 'Žádný aktivní tab.' };
      const q = encodeURIComponent(action.query || '');
      tab.view.webContents.loadURL(`https://duckduckgo.com/?q=${q}`);
      return { ok: true };
    }

    case 'open_tab': {
      // Signál do main.js — nelze přímo createTab (jsme v modulu)
      // Posíláme přes singleton event emitter
      agentEmitter.emit('create-tab', action.url || 'about:blank');
      return { ok: true };
    }

    case 'navigate': {
      if (!tab?.view) return { error: 'Žádný aktivní tab.' };
      const url = action.url;
      if (!url) return { error: 'Chybí URL.' };
      tab.view.webContents.loadURL(
        /^https?:\/\//i.test(url) ? url : `https://${url}`
      );
      return { ok: true };
    }

    case 'scroll': {
      if (!tab?.view) return { error: 'Žádný aktivní tab.' };
      const amount    = action.amount    ?? 500;
      const direction = action.direction ?? 'down';
      const delta     = direction === 'up' ? -amount : amount;
      await tab.view.webContents.executeJavaScript(`window.scrollBy(0, ${delta})`);
      return { ok: true };
    }

    case 'click': {
      if (!tab?.view || !action.selector) return { error: 'Chybí selektor nebo tab.' };
      const result = await tab.view.webContents.executeJavaScript(`
        (function() {
          const el = document.querySelector(${JSON.stringify(action.selector)});
          if (!el) return { error: 'Prvek nenalezen: ' + ${JSON.stringify(action.selector)} };
          el.click();
          return { ok: true };
        })()
      `).catch(err => ({ error: err.message }));
      return result;
    }

    case 'summarize':
      // Sumarizace je zpracována separátně přes 'ai-summarize-page'
      return { ok: true, note: 'Použij ai-summarize-page IPC.' };

    default:
      return { ok: true };
  }
}

// ─── Event Emitter (pro cross-module komunikaci) ──────────────────────────────

const EventEmitter = require('events');
const agentEmitter = new EventEmitter();

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { registerAgentIPC, agentEmitter };
