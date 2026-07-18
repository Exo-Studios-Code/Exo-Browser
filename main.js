/**
 * main.js — Exo Browser — Main Process
 *
 * Architecture:
 *  • BrowserWindow renders the toolbar UI (frameless)
 *  • Each browser tab is a WebContentsView (Electron 28+ API)
 *  • Privacy Shield via onBeforeRequest tracker blocking
 *  • Tab Sleep: inactive tabs are discarded after SLEEP_TIMEOUT_MS to free RAM
 *  • Chromium flags set before app.whenReady() for maximum effect
 *
 * Requires: Electron 29+
 */

const { app, BrowserWindow, WebContentsView, ipcMain, session, globalShortcut } = require('electron');
const path    = require('path');
const os      = require('os');

// ── AI Agent (Gemini) ─────────────────────────────────────────────────────────
const { registerAgentIPC, agentEmitter } = require('./src/exo-ai-agent');

// ── Plugin Engine ─────────────────────────────────────────────────────────────
const { PluginEngine, registerPluginIPC } = require('./src/exo-plugin-engine');

// ── Password Manager ──────────────────────────────────────────────────────────
const { registerPasswordIPC } = require('./exo-password-manager');

// ── Exo internal URL scheme helpers ──────────────────────────────────────────
/** Local file:// URL for the New Tab page */
const EXO_NEWTAB_FILE = path.join(__dirname, 'src', 'exo-newtab.html');
const EXO_NEWTAB_URL  = 'file:///' + EXO_NEWTAB_FILE.replace(/\\/g, '/');
/** Sentinel string shown in the URL bar (never sent to Electron's loadURL) */
const EXO_NEWTAB_VIRTUAL = 'exo://newtab';

// ─── Chromium Performance & Privacy Flags ────────────────────────────────────
// IMPORTANT: These must be called BEFORE app.whenReady()

// ── Privacy: kill telemetry, sync, phishing pings ────────────────────────────
// NOTE: 'disable-background-networking' is intentionally OMITTED —
//       it blocks real page requests, not just telemetry.
app.commandLine.appendSwitch('disable-sync');                        // no Chrome sync
app.commandLine.appendSwitch('no-first-run');                        // skip first-run wizard
app.commandLine.appendSwitch('safebrowsing-disable-auto-update');    // no SafeBrowsing updates
app.commandLine.appendSwitch('disable-client-side-phishing-detection'); // no phishing reports to Google
app.commandLine.appendSwitch('disable-default-apps');                // no bundled app installs
app.commandLine.appendSwitch('disable-translate');                   // no Google Translate pings
app.commandLine.appendSwitch('metrics-recording-only');              // stops UMA histogram uploads

// ── Performance: reduce background CPU/RAM usage ─────────────────────────────
app.commandLine.appendSwitch('disable-renderer-backgrounding');      // don't throttle hidden renderers
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows'); // no throttle when window is behind another
app.commandLine.appendSwitch('disable-background-timer-throttling'); // critical for gaming — no 1Hz throttle
app.commandLine.appendSwitch('disable-ipc-flooding-protection');     // smoother IPC under load
app.commandLine.appendSwitch('renderer-process-limit', '5');         // cap renderer procs

// ── GPU / Rendering ───────────────────────────────────────────────────────────
app.commandLine.appendSwitch('enable-gpu-rasterization');            // GPU-accelerated raster
app.commandLine.appendSwitch('enable-zero-copy');                    // skip CPU copy for textures
app.commandLine.appendSwitch('disable-software-rasterizer');         // force hardware rendering

// ─── Privacy Shield: Tracker Blocklist ───────────────────────────────────────
/**
 * Hostname-level blocklist — matched via a fast Set lookup (O(1)).
 * Covers analytics, ad pixels, session recording, and fingerprinting services.
 */
const BLOCKED_HOSTS = new Set([
  // Google
  'www.google-analytics.com', 'ssl.google-analytics.com',
  'analytics.google.com',
  'www.googletagmanager.com', 'googletagservices.com',
  'pagead2.googlesyndication.com', 'adservice.google.com',
  'www.doubleclick.net', 'ad.doubleclick.net', 'stats.g.doubleclick.net',
  // Meta / Facebook (pixel only — NOT www.facebook.com to avoid blocking the site itself)
  'connect.facebook.net', 'an.facebook.com',
  // Microsoft / Bing
  'bat.bing.com', 'c.clarity.ms', 'clarity.ms',
  // Twitter / X
  'analytics.twitter.com', 'static.ads-twitter.com',
  't.co',   // tracker redirect shortener
  // LinkedIn
  'px.ads.linkedin.com', 'snap.licdn.com',
  // Snapchat
  'tr.snapchat.com',
  // Pinterest
  'ct.pinterest.com',
  // TikTok
  'analytics.tiktok.com',
  // Hotjar
  'static.hotjar.com', 'script.hotjar.com', 'vars.hotjar.com', 'insights.hotjar.com',
  // FullStory
  'rs.fullstory.com', 'edge.fullstory.com',
  // LogRocket
  'cdn.logrocket.io', 'cdn.logrocket.com', 'r.lr-ingest.io',
  // Heap
  'cdn.heapanalytics.com', 'heapanalytics.com',
  // Mixpanel
  'cdn4.mxpnl.com', 'api.mixpanel.com',
  // Amplitude
  'cdn.amplitude.com', 'api2.amplitude.com', 'api.amplitude.com',
  // Segment
  'cdn.segment.com', 'api.segment.io', 'cdn.segment.io',
  // Scorecard
  'b.scorecardresearch.com', 'sb.scorecardresearch.com',
  // Quantcast
  'pixel.quantserve.com',
  // Chartbeat
  'static.chartbeat.com', 'ping.chartbeat.net',
  // Mouseflow
  'cdn.mouseflow.com',
  // Yandex Metrika
  'mc.yandex.ru', 'mc.yandex.com',
  // Criteo
  'static.criteo.net', 'sslwidget.criteo.com',
  // Taboola
  'trc.taboola.com', 'cdn.taboola.com',
  // Outbrain
  'widgets.outbrain.com',
  // Intercom (tracking parts)
  'nexus-websocket-a.intercom.io',
  // DataDog RUM
  'rum.browser-intake-datadoghq.com',
]);

// Extra URL patterns (substrings) for rules that can't be hostname-only
const BLOCKED_PATTERNS = [
  '/beacon.min.js',       // various beacons
  '/gtag/js',             // Google tag
  'fbevents.js',          // Facebook pixel
  '/collect?',            // GA collect hits
  '/analytics.js',        // GA legacy
  '/ga.js',
];

// ─── Automatická aktualizace AdBlock listu (Background Fetch) ──────────────
async function updateBlocklist() {
  try {
    console.log('[Exo] Stahuji nejnovější AdBlock list...');
    
    // Stáhne surový textový soubor ze StevenBlack GitHubu
    const response = await fetch('https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts');
    if (!response.ok) throw new Error(`HTTP chyba: ${response.status}`);
    
    const text = await response.text();
    const lines = text.split('\n');
    let addedCount = 0;

    for (const line of lines) {
      // Zajímají nás jen řádky začínající na "0.0.0.0" (kromě samotného localhostu)
      if (line.startsWith('0.0.0.0') && line !== '0.0.0.0 0.0.0.0') {
        const parts = line.split(' ');
        if (parts.length > 1) {
          const domain = parts[1].trim();
          if (domain) {
            BLOCKED_HOSTS.add(domain);
            addedCount++;
          }
        }
      }
    }
    
    console.log(`[Exo] AdBlock list úspěšně aktualizován! Přidáno ${addedCount} domén. Celkem blokováno: ${BLOCKED_HOSTS.size} domén.`);
  } catch (error) {
    // Pokud selže internet, nic se neděje, Exo použije ten tvůj základní BLOCKED_HOSTS seznam nahoře.
    console.warn('[Exo] Nepodařilo se stáhnout AdBlock list, používám základní offline seznam.', error.message);
  }
}


// ── Dark Reader Integration ────────────────────────────────────────────────────
// Professional dark mode via Dark Reader (https://darkreader.org).
// Replaces the old CSS invert()/hue-rotate() approach which broke on GitHub,
// Google Docs, React/Vue/Angular apps, modern CSS variables and gradients.
const { enableDarkMode, disableDarkMode } = require('./src/exo-dark-reader');


// ── Autofill Content Script ───────────────────────────────────────────────────
/**
 * Loaded once at startup, injected into every web tab on did-stop-loading.
 * fs.readFileSync here avoids per-tab file I/O overhead.
 */
const AUTOFILL_JS = (() => {
  try {
    return require('fs').readFileSync(
      path.join(__dirname, 'exo-autofill.js'), 'utf8'
    );
  } catch (e) {
    console.error('[Exo-Vault] Nelze načíst exo-autofill.js:', e.message);
    return '';
  }
})();

// ─── Constants ────────────────────────────────────────────────────────────────

/** Combined toolbar height: tab-bar 52px + nav-bar 44px */
const TOOLBAR_HEIGHT = 96;

/** Width of the GX-style gaming sidebar when open */
const SIDEBAR_WIDTH = 240;

/** Width of the History sidebar (right side) when open */
const HISTORY_WIDTH = 280;

/** Width of the AI Chat Sidebar (right side) when open */
const AI_SIDEBAR_WIDTH = 320;

/** Tabs inactive longer than this are silently discarded to free RAM */
const SLEEP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ─── State ────────────────────────────────────────────────────────────────────

/** @type {BrowserWindow} */
let mainWindow = null;

/**
 * Průhledné overlay okno pro Download Manager HUD.
 * Létá NAD WebContentsView (taby), takže panel je vždy viditelný.
 * @type {BrowserWindow|null}
 */
let overlayWindow = null;
// Dedup: button-click + form-submit both fire on same login → suppress duplicates
let _lastVaultPromptKey = '';
let _lastVaultPromptAt  = 0;

let sidebarOpen = false;
let historySidebarOpen = false;
let aiSidebarOpen   = false;   // ✨ AI Chat Sidebar
let blockedCount = 0;   // Privacy Shield: lifetime blocked request counter

/** Dark mode state — toggled via IPC 'dark-mode-set' from renderer settings */
let darkModeEnabled = true; // on by default (matches DEFAULTS.darkMode in renderer)

/** @type {BrowserWindow|null} Settings window */
let settingsWindow  = null;
/** @type {BrowserWindow|null} AI Chat Sidebar window */
let aiSidebarWindow = null;
/** @type {BrowserWindow|null} Plugin Manager window */
let pluginManagerWindow = null;

/** @type {PluginEngine|null} Plugin engine singleton */
let pluginEngine = null;

/**
 * @type {Map<number, {
 *   view: WebContentsView|null,
 *   url: string,
 *   title: string,
 *   favicon: string|null,
 *   loading: boolean,
 *   sleeping: boolean,
 *   sleepUrl: string|null,
 * }>}
 */
const tabs = new Map();

/** tabId → Date.now() of last activation */
const tabLastActive = new Map();

/**
 * downloadId → Electron DownloadItem
 * Umožňuje zrušit stahování z rendereru přes IPC.
 */
const activeDownloads = new Map();

let activeTabId = null;
let tabIdCounter = 0;

// ─── History ──────────────────────────────────────────────────────────────────
let _histId = 0;
/** @type {{ id:number, url:string, title:string, timestamp:number }[]} */
const historyDB = [];

function addToHistory({ url, title }) {
  if (!url || url.startsWith('about:') || url.startsWith('chrome:') || url.startsWith('devtools:') || url.startsWith('file:')) return;
  if (historyDB.length && historyDB[0].url === url) {
    historyDB[0].title = title || historyDB[0].title;
    historyDB[0].timestamp = Date.now();
    mainWindow?.webContents.send('history-updated', { entry: historyDB[0] });
    return;
  }
  const entry = { id: ++_histId, url, title: title || url, timestamp: Date.now() };
  historyDB.unshift(entry);
  if (historyDB.length > 500) historyDB.pop();
  mainWindow?.webContents.send('history-updated', { entry });
}

// ─── Download Overlay Window ──────────────────────────────────────────────────

/**
 * Proč je potřeba samostatné okno?
 * ─────────────────────────────────────────────────────────────────────────────
 * mainWindow.contentView je root view. Každý tab (WebContentsView) je přidán
 * jako child view přes contentView.addChildView() → child views se renderují
 * VŽDY nad samotným HTML mainWindow (index.html = toolbar).
 *
 * Proto #exo-dl-panel v index.html sice existuje, ale je SCHOVANÝ za nativní
 * vrstvou tabu a není vidět.
 *
 * Řešení: průhledný BrowserWindow jako sibling mainWindow. BrowserWindow
 * s alwaysOnTop letí nad vším, včetně WebContentsView childů.
 *
 * Mouse passthrough:
 *   • Defaultně setIgnoreMouseEvents(true, { forward: true }) — klikání prochází
 *   • Renderer posílá 'overlay-set-clickable' true/false dle pozice kurzoru
 *   • Jen nad .exo-dl-card se okno stane klikatelné (cancel button)
 */
function createOverlayWindow() {
  const b = mainWindow.getBounds();

  overlayWindow = new BrowserWindow({
    x:       b.x,
    y:       b.y + TOOLBAR_HEIGHT,
    width:   b.width,
    height:  Math.max(1, b.height - TOOLBAR_HEIGHT),
    transparent:  true,
    frame:        false,
    resizable:    false,
    movable:      false,
    focusable:    false,
    skipTaskbar:  true,
    hasShadow:    false,
    alwaysOnTop:  true,
    parent:       mainWindow,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
  });

  // Defaultně ignoruj klikání — prochází na okno pod ním
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.loadFile(path.join(__dirname, 'src', 'exo-dl-overlay.html'));

  // Synchronizuj polohu a velikost s mainWindow
  const syncOverlay = () => {
    if (!overlayWindow || !mainWindow) return;
    const mb = mainWindow.getBounds();
    overlayWindow.setBounds({
      x:      mb.x,
      y:      mb.y + TOOLBAR_HEIGHT,
      width:  mb.width,
      height: Math.max(1, mb.height - TOOLBAR_HEIGHT),
    });
  };

  mainWindow.on('move',       syncOverlay);
  mainWindow.on('resize',     syncOverlay);
  mainWindow.on('maximize',   syncOverlay);
  mainWindow.on('unmaximize', syncOverlay);

  overlayWindow.on('closed', () => { overlayWindow = null; });
}

// IPC: renderer overlay hlásí, jestli je kurzor nad interaktivním prvkem
ipcMain.on('overlay-set-clickable', (_e, { clickable }) => {
  overlayWindow?.setIgnoreMouseEvents(!clickable, { forward: true });
});

// ─── Settings Window ──────────────────────────────────────────────────────────

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }
  const b = mainWindow.getBounds();
  settingsWindow = new BrowserWindow({
    width:  640,
    height: 560,
    x: Math.round(b.x + b.width  / 2 - 320),
    y: Math.round(b.y + b.height / 2 - 280),
    frame: false,
    resizable: false,
    parent: mainWindow,
    modal: false,
    show: false,
    backgroundColor: '#080810',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
  });
  settingsWindow.loadFile(path.join(__dirname, 'src', 'exo-settings.html'));
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ─── AI Chat Sidebar Window ───────────────────────────────────────────────────

function createAiSidebarWindow() {
  if (aiSidebarWindow) return;
  const b = mainWindow.getBounds();
  aiSidebarWindow = new BrowserWindow({
    x:       b.x + b.width - AI_SIDEBAR_WIDTH,
    y:       b.y + TOOLBAR_HEIGHT,
    width:   AI_SIDEBAR_WIDTH,
    height:  Math.max(1, b.height - TOOLBAR_HEIGHT),
    frame:        false,
    resizable:    false,
    movable:      false,
    skipTaskbar:  true,
    alwaysOnTop:  false,
    parent:       mainWindow,
    backgroundColor: '#080810',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
  });
  aiSidebarWindow.loadFile(path.join(__dirname, 'src', 'exo-ai-sidebar.html'));

  const syncAiSidebar = () => {
    if (!aiSidebarWindow || !mainWindow) return;
    const mb = mainWindow.getBounds();
    aiSidebarWindow.setBounds({
      x:      mb.x + mb.width - AI_SIDEBAR_WIDTH,
      y:      mb.y + TOOLBAR_HEIGHT,
      width:  AI_SIDEBAR_WIDTH,
      height: Math.max(1, mb.height - TOOLBAR_HEIGHT),
    });
  };
  mainWindow.on('move',       syncAiSidebar);
  mainWindow.on('resize',     syncAiSidebar);
  mainWindow.on('maximize',   syncAiSidebar);
  mainWindow.on('unmaximize', syncAiSidebar);

  aiSidebarWindow.on('closed', () => {
    aiSidebarWindow = null;
    aiSidebarOpen   = false;
    tabs.forEach((tab, id) => { if (tab.view) updateViewBounds(id, tab.view); });
    mainWindow?.webContents.send('ai-sidebar-state', { open: false });
  });
}

// ─── getActiveTab helper ──────────────────────────────────────────────────────

/**
 * Vrací aktuální tab objekt pro AI agent.
 * @returns {{ view: WebContentsView, url: string, title: string }|null}
 */
function getActiveTab() {
  if (activeTabId === null) return null;
  const tab = tabs.get(activeTabId);
  return tab ? { view: tab.view, url: tab.url, title: tab.title } : null;
}

// ─── Plugin Manager Window ────────────────────────────────────────────────────

function createPluginManagerWindow() {
  if (pluginManagerWindow) { pluginManagerWindow.focus(); return; }
  const b = mainWindow.getBounds();
  pluginManagerWindow = new BrowserWindow({
    width:  800,
    height: 620,
    x: Math.round(b.x + b.width  / 2 - 400),
    y: Math.round(b.y + b.height / 2 - 310),
    frame: false,
    resizable: true,
    minWidth: 600,
    minHeight: 400,
    parent: mainWindow,
    modal: false,
    show: false,
    backgroundColor: '#080810',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
  });
  pluginManagerWindow.loadFile(path.join(__dirname, 'src', 'exo-plugins.html'));
  pluginManagerWindow.once('ready-to-show', () => pluginManagerWindow.show());
  pluginManagerWindow.on('closed', () => { pluginManagerWindow = null; });
}



/**
 * Zachytí všechna stahování v defaultSession a:
 *   1. Odešle 'download-started'  → renderer vytvoří kartu
 *   2. Průběžně posílá 'download-progress' s %, rychlostí
 *   3. Po dokončení odešle 'download-done' (completed | cancelled | interrupted)
 *
 * IPC 'cancel-download' { downloadId } → zavolá item.cancel()
 */
function setupDownloadManager() {
  let _dlIdCounter = 0;

  session.defaultSession.on('will-download', (_event, item) => {
    const downloadId = ++_dlIdCounter;
    activeDownloads.set(downloadId, item);

    const filename   = item.getFilename();
    const totalBytes = item.getTotalBytes(); // 0 pokud neznámá

    // Upozorni overlay renderer — vznikne karta v UI
    overlayWindow?.webContents.send('download-started', { downloadId, filename, totalBytes });

    let lastReceived = 0;
    let lastTime     = Date.now();

    item.on('updated', (_e, state) => {
      if (state === 'interrupted') return; // nezahltit UI chybovými stavy

      const received = item.getReceivedBytes();
      const total    = item.getTotalBytes();
      const now      = Date.now();
      const dtSec    = Math.max((now - lastTime) / 1000, 0.001); // vyhni se dělení nulou
      const speedBps = Math.round((received - lastReceived) / dtSec);

      lastReceived = received;
      lastTime     = now;

      // percent = -1 signalizuje indeterminate (neznámá velikost)
      const percent = total > 0 ? Math.round((received / total) * 100) : -1;

      overlayWindow?.webContents.send('download-progress', {
        downloadId,
        receivedBytes: received,
        totalBytes:    total,
        percent,
        speedBps,
      });
    });

    item.once('done', (_e, state) => {
      activeDownloads.delete(downloadId);
      overlayWindow?.webContents.send('download-done', {
        downloadId,
        state,         // 'completed' | 'cancelled' | 'interrupted'
        filename,
        totalBytes: item.getTotalBytes(),
      });
    });
  });

  // ── IPC: renderer žádá o zrušení stahování ─────────────────────────────────
  ipcMain.on('cancel-download', (_e, { downloadId }) => {
    const item = activeDownloads.get(downloadId);
    if (item) {
      item.cancel();
      activeDownloads.delete(downloadId);
    }
  });

  console.log('[Exo] Download Manager inicializován.');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 820,
    minHeight: 600,
    frame: false,
    backgroundColor: '#080810',
    show: false,
    // --- TADY PŘIDEJ TENTO ŘÁDEK ---
    icon: path.join(__dirname, 'src', 'icon.ico'), 
    // -------------------------------
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });


  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.show();
    createTab(EXO_NEWTAB_URL);
    createOverlayWindow();   // ← spustí overlay až po zobrazení mainWindow (getBounds() je platný)
  });

  mainWindow.on('resize', () => {
    if (activeTabId !== null) updateViewBounds(activeTabId);
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-state-changed', { maximized: true });
    if (activeTabId !== null) updateViewBounds(activeTabId);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-state-changed', { maximized: false });
    if (activeTabId !== null) updateViewBounds(activeTabId);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── Tab Event Wiring (extracted so wake can re-use) ─────────────────────────

function wireTabEvents(tabId, view) {
  // 1. Zkratka pro Exo-Neural Mirror
  view.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'e') {
      event.preventDefault();
      runExoMirror(view);
    }
  });

  view.webContents.on('did-start-loading', () => {
    safeTabUpdate(tabId, { loading: true });
    mainWindow.webContents.send('tab-loading', { tabId, loading: true });
  });

  view.webContents.on('did-stop-loading', async () => {
    safeTabUpdate(tabId, { loading: false });
    mainWindow.webContents.send('tab-loading', { tabId, loading: false });
    sendNavState(tabId);
    // Record to browsing history
    addToHistory({ url: view.webContents.getURL(), title: view.webContents.getTitle() });
    
    // Dark Reader — skip internal Exo pages (they have their own dark design)
    const stopUrl = view.webContents.getURL();
    if (darkModeEnabled) {
      await enableDarkMode(view.webContents, stopUrl);
    }

    // ✨ Plugin content script injekce
    if (pluginEngine) {
      pluginEngine.injectIntoTab(view.webContents, stopUrl, tabId).catch(() => {});
    }

    // ── Autofill injection ────────────────────────────────────────────────────
    // CRITICAL FIX: Bridge and autofill script are combined into ONE atomic
    // executeJavaScript call. The previous two-call approach had a race condition:
    // exo-autofill.js ran init() and fired sendToMain('get-credentials') BEFORE
    // the second executeJavaScript had registered its 'message' listener for
    // __exo_af__ messages. The postMessage fired into the void, watchSubmissions()
    // was never called, and no submit was ever captured.
    //
    // Fix: bridge code runs FIRST in the combined script, then AUTOFILL_JS is
    // appended. By the time autofill's init() calls sendToMain(), the bridge
    // listener is already live in the same JS execution context.
    if (AUTOFILL_JS) {
      try {
        const BRIDGE_JS = `
          (function() {
            if (window.__exo_vault_bridge__) return;
            window.__exo_vault_bridge__ = true;

            // Outgoing queue: page → main (polled every 250ms by main process)
            window.__exo_vault_queue__ = window.__exo_vault_queue__ || [];
            window.addEventListener('message', (e) => {
              if (e.data && e.data.__exo_af_main__) {
                window.__exo_vault_queue__.push(e.data);
              }
            });

            window.__exo_vault_get__ = (origin) => new Promise(res => {
              window.__exo_vault_pending_get__ = res;
              window.postMessage({ __exo_af_main__: true, type: 'vault-get', origin }, '*');
            });
            window.__exo_vault_reveal__ = (id) => new Promise(res => {
              window.__exo_vault_pending_reveal__ = res;
              window.postMessage({ __exo_af_main__: true, type: 'vault-reveal', id }, '*');
            });
            window.__exo_vault_save_prompt__ = (origin, username, password) => {
              window.postMessage({ __exo_af_main__: true, type: 'vault-save-prompt', origin, username, password }, '*');
            };

            // Relay __exo_af__ postMessages from autofill script → bridge helpers
            window.addEventListener('message', async (e) => {
              if (!e.data || !e.data.__exo_af__) return;
              const { type, payload } = e.data;
              if (type === 'get-credentials') {
                const creds = await window.__exo_vault_get__(payload.origin);
                window.__exo_vault_creds_cache__ = creds || [];
                if (typeof window.__exo_af_response__ === 'function')
                  window.__exo_af_response__('credentials', { creds: creds || [] });
              }
              if (type === 'autofill-request') {
                const result = await window.__exo_vault_reveal__(payload.id);
                const username = (window.__exo_vault_creds_cache__ || [])
                  .find(c => c.id === payload.id)?.username ?? '';
                if (result && typeof window.__exo_af_response__ === 'function')
                  window.__exo_af_response__('autofill-fill', { username, password: result.password });
              }
              if (type === 'password-save-prompt') {
                // Use the direct IPC path (exo-tab-preload.js) — reliable even
                // during page navigation when executeJavaScript-based poll fails.
                if (typeof window.__exo_tab__?.vaultSave === 'function') {
                  window.__exo_tab__.vaultSave(payload.origin, payload.username, payload.password);
                } else {
                  // Fallback: double-postMessage queue path (SPA logins that don't navigate)
                  window.__exo_vault_save_prompt__(payload.origin, payload.username, payload.password);
                }
              }
            });

            console.log('✅ [Exo-Bridge] Vault bridge installed');
          })();
        `;

        // Single atomic injection: bridge runs first, autofill appended after.
        await view.webContents.executeJavaScript(BRIDGE_JS + '\n' + AUTOFILL_JS);
      } catch (err) { console.error('[Exo] Autofill inject error:', err.message); }
    }
  });

  // ── Vault ↔ content-script message relay (polled every 250 ms) ─────────────
  // The page has no contextBridge, so the autofill script uses window.postMessage.
  // We drain a shared queue from here and call vault methods directly.
  {
    let _pollTimer = null;

    const startPoll = () => {
      _pollTimer = setInterval(async () => {
        if (!view.webContents || view.webContents.isDestroyed()) {
          clearInterval(_pollTimer); return;
        }
        let msgs;
        try {
          msgs = await view.webContents.executeJavaScript(
            `(window.__exo_vault_queue__ || []).splice(0)`
          );
        } catch (_) { clearInterval(_pollTimer); return; }

        for (const msg of (msgs || [])) {
          await handleVaultMessage(msg, view.webContents);
        }
      }, 250);
    };

    view.webContents.on('did-finish-load', () => {
      clearInterval(_pollTimer);
      if (AUTOFILL_JS) startPoll();
    });

    // ── Pre-navigation drain ────────────────────────────────────────────────
    // Traditional <form> POSTs navigate immediately after the submit event,
    // which fires did-start-loading before the next 250ms poll tick.
    // We do one final drain + check the dedicated pending slot BEFORE we
    // kill the poll timer, so save-prompts from native form submits aren't lost.
    view.webContents.on('did-start-loading', async () => {
      // 1. Drain any queued vault messages first
      if (AUTOFILL_JS && !view.webContents.isDestroyed()) {
        try {
          const msgs = await view.webContents.executeJavaScript(
            `(window.__exo_vault_queue__ || []).splice(0)`
          );
          for (const msg of (msgs || [])) {
            await handleVaultMessage(msg, view.webContents);
          }
        } catch (_) {}

        // 2. Also check the dedicated save-pending slot (written synchronously
        //    by exo-autofill.js in the submit capture handler)
        try {
          const pending = await view.webContents.executeJavaScript(
            `(function(){ var p = window.__exo_vault_save_pending__; window.__exo_vault_save_pending__ = null; return p || null; })()`
          );
          if (pending && pending.type !== 'consumed') {
            console.log('📡 [Main] Pre-navigation save-pending slot flushed:', pending.origin, pending.username);
            await handleVaultMessage(
              { type: 'vault-save-prompt', origin: pending.origin, username: pending.username, password: pending.password },
              view.webContents
            );
          }
        } catch (_) {}
      }

      clearInterval(_pollTimer);
    });

    view.webContents.on('destroyed', () => clearInterval(_pollTimer));
  }

  view.webContents.on('did-navigate', (_e, navUrl) => {
    safeTabUpdate(tabId, { url: navUrl });
    mainWindow.webContents.send('tab-navigated', { tabId, url: navUrl });
    sendNavState(tabId);

    if (navUrl.includes('exo-search.html#')) {
      try {
        const hash = decodeURIComponent(new URL(navUrl).hash.slice(1)).trim();
        if (hash) {
          fetchDDGResults(hash).then(payload => {
            const js = `typeof window.__exoResults==='function'&&window.__exoResults(${JSON.stringify(payload)})`;
            view.webContents.executeJavaScript(js).catch(() => {});
          }).catch(err => {
            const payload = { query: hash, items: [], noResults: true, noResultsMsg: `Chyba: ${err.message}` };
            const js = `typeof window.__exoResults==='function'&&window.__exoResults(${JSON.stringify(payload)})`;
            view.webContents.executeJavaScript(js).catch(() => {});
          });
        }
      } catch (_) {}
    }
  });

  // 🚀 TOTO CHYBĚLO: Zajišťuje hledání bez nutnosti reloadovat stránku!
  view.webContents.on('did-navigate-in-page', (_e, navUrl, isMainFrame) => {
    if (!isMainFrame) return;
    safeTabUpdate(tabId, { url: navUrl });
    mainWindow.webContents.send('tab-navigated', { tabId, url: navUrl });
    sendNavState(tabId);

    if (navUrl.includes('exo-search.html#')) {
      try {
        const hash  = decodeURIComponent(new URL(navUrl).hash.slice(1)).trim();
        if (hash) {
          fetchDDGResults(hash).then(payload => {
            const js = `typeof window.__exoResults==='function'&&window.__exoResults(${JSON.stringify(payload)})`;
            view.webContents.executeJavaScript(js).catch(() => {});
          }).catch(err => {
            const payload = { query: hash, items: [], noResults: true, noResultsMsg: `Chyba: ${err.message}` };
            const js = `typeof window.__exoResults==='function'&&window.__exoResults(${JSON.stringify(payload)})`;
            view.webContents.executeJavaScript(js).catch(() => {});
          });
        }
      } catch (_) {}
    }
  });

  view.webContents.on('page-title-updated', (_e, title) => {
    safeTabUpdate(tabId, { title });
    mainWindow.webContents.send('tab-title-updated', { tabId, title });
  });

  view.webContents.on('page-favicon-updated', (_e, favicons) => {
    const favicon = favicons?.[0] ?? null;
    safeTabUpdate(tabId, { favicon });
    mainWindow.webContents.send('tab-favicon-updated', { tabId, favicon });
  });

  view.webContents.setWindowOpenHandler(({ url: newUrl }) => {
    createTab(newUrl);
    return { action: 'deny' };
  });
}

// ── Gaming Sidebar ────────────────────────────────────────────────────────────

ipcMain.on('sidebar-toggle', (_e, { open }) => {
  sidebarOpen = open;
  // Resize all tab views to respect the sidebar gutter
  tabs.forEach((tab, id) => {
    if (tab.view) updateViewBounds(id, tab.view);
  });
  mainWindow?.webContents.send('sidebar-state-changed', { open });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHYBĚJÍCÍ GAMING MODE HANDLERY 
// ═══════════════════════════════════════════════════════════════════════════════

let gamingModeActive = false;

ipcMain.handle('gaming-mode-enable', async () => {
  gamingModeActive = true;
  let slept = 0;
  
  // Uspí všechny taby kromě aktivního
  tabs.forEach((tab, id) => {
    if (id === activeTabId || tab.sleeping) return;
    sleepTab(id);
    slept++;
  });

  // Vymaže cache Chromium jádra (RAM i GPU)
  try {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({
      storages: ['shadercache', 'serviceworkers'],
    });
  } catch (_) {}

  mainWindow?.webContents.send('gaming-mode-changed', { active: true, tabsSlept: slept });
  return { ok: true, tabsSlept: slept };
});

ipcMain.handle('gaming-mode-disable', async () => {
  gamingModeActive = false;
  mainWindow?.webContents.send('gaming-mode-changed', { active: false, tabsSlept: 0 });
  return { ok: true };
});


// ─── Tab Management ───────────────────────────────────────────────────────────

function createTab(url = EXO_NEWTAB_URL) {
  const tabId = ++tabIdCounter;

  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,   // must be false to allow preload (contextIsolation still enforced)
      preload: path.join(__dirname, 'exo-tab-preload.js'),
    },
  });

  mainWindow.contentView.addChildView(view);
  updateViewBounds(tabId, view);

  tabs.set(tabId, {
    view,
    url,
    title: 'New Tab',
    favicon: null,
    loading: false,
    sleeping: false,
    sleepUrl: null,
  });

  wireTabEvents(tabId, view);

  view.webContents.loadURL(resolveUrl(url));
  switchTab(tabId);

  mainWindow.webContents.send('tab-created', {
    tabId,
    url,
    title: 'New Tab',
    active: true,
  });

  return tabId;
}

function switchTab(tabId) {
  if (!tabs.has(tabId)) return;

  const tab = tabs.get(tabId);

  // Wake sleeping tab before switching
  if (tab.sleeping) {
    wakeTab(tabId);
    // wakeTab re-creates the view; wait for it to be ready
  }

  tabs.forEach((t, id) => {
    if (t.view) t.view.setVisible(id === tabId);
  });

  activeTabId = tabId;
  tabLastActive.set(tabId, Date.now());
  updateViewBounds(tabId);

  const current = tabs.get(tabId);
  const nh = current.view ? current.view.webContents.navigationHistory : null;
  mainWindow.webContents.send('tab-switched', {
    tabId,
    url:          current.url,
    title:        current.title,
    loading:      current.loading,
    sleeping:     current.sleeping,
    canGoBack:    nh ? nh.canGoBack()    : false,
    canGoForward: nh ? nh.canGoForward() : false,
  });
}

function closeTab(tabId) {
  if (!tabs.has(tabId)) return;

  const tab = tabs.get(tabId);
  if (tab.view) mainWindow.contentView.removeChildView(tab.view);
  tabs.delete(tabId);
  tabLastActive.delete(tabId);

  mainWindow.webContents.send('tab-closed', { tabId });

  if (tabs.size === 0) {
    createTab(EXO_NEWTAB_URL);
    return;
  }

  if (activeTabId === tabId) {
    const ids = Array.from(tabs.keys());
    switchTab(ids[ids.length - 1]);
  }
}

// ─── Tab Sleep / Wake ─────────────────────────────────────────────────────────

/**
 * Discards a tab's WebContentsView to free RAM.
 * The URL is saved so the tab can be reloaded on wake.
 */
function sleepTab(tabId) {
  if (tabId === activeTabId) return;            // never sleep the active tab
  const tab = tabs.get(tabId);
  if (!tab || tab.sleeping || !tab.view) return;

  const currentUrl = tab.view.webContents.getURL() || tab.url;

  try {
    mainWindow.contentView.removeChildView(tab.view);
  } catch (_) { /* already detached */ }

  tab.view = null;
  tab.sleeping = true;
  tab.sleepUrl = currentUrl;

  mainWindow.webContents.send('tab-sleeping', { tabId, sleeping: true });
}

/**
 * Recreates a discarded tab's WebContentsView and reloads its URL.
 */
function wakeTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab || !tab.sleeping) return;

  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // must be false to allow preload (contextIsolation still enforced)
      preload: path.join(__dirname, 'exo-tab-preload.js'),
    },
  });

  mainWindow.contentView.addChildView(view);
  updateViewBounds(tabId, view);

  tab.view = view;
  tab.sleeping = false;
  tab.loading = true;

  wireTabEvents(tabId, view);
  view.webContents.loadURL(resolveUrl(tab.sleepUrl || tab.url));

  mainWindow.webContents.send('tab-sleeping', { tabId, sleeping: false });
}

/** Periodic sleep checker — runs every 60 seconds */
function startSleepTimer() {
  setInterval(() => {
    if (!mainWindow) return;
    const now = Date.now();
    tabs.forEach((tab, id) => {
      if (id === activeTabId || tab.sleeping) return;
      const lastActive = tabLastActive.get(id) ?? 0;
      if (now - lastActive > SLEEP_TIMEOUT_MS) {
        sleepTab(id);
      }
    });
  }, 60_000);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function updateViewBounds(tabId, view) {
  const targetView = view ?? tabs.get(tabId)?.view;
  if (!targetView) return;
  const { width, height } = mainWindow.getContentBounds();
  const xOff      = sidebarOpen        ? SIDEBAR_WIDTH  : 0;
  const rightOff  = historySidebarOpen ? HISTORY_WIDTH
                  : aiSidebarOpen      ? AI_SIDEBAR_WIDTH
                  : 0;
  targetView.setBounds({
    x: xOff,
    y: TOOLBAR_HEIGHT,
    width:  Math.max(0, width - xOff - rightOff),
    height: Math.max(0, height - TOOLBAR_HEIGHT),
  });
}

function sendNavState(tabId) {
  if (!tabs.has(tabId) || tabId !== activeTabId) return;
  const tab = tabs.get(tabId);
  if (!tab.view) return;
  const nh = tab.view.webContents.navigationHistory;
  mainWindow.webContents.send('nav-state-updated', {
    tabId,
    canGoBack:    nh.canGoBack(),
    canGoForward: nh.canGoForward(),
  });
}

function safeTabUpdate(tabId, patch) {
  const tab = tabs.get(tabId);
  if (tab) Object.assign(tab, patch);
}

/**
 * Resolves raw user input to a full URL.
 * The renderer handles search-engine composition, so this
 * only needs to handle plain hostnames and passthrough.
 */
function resolveUrl(input) {
  if (!input) return EXO_NEWTAB_URL;
  const trimmed = input.trim();
  // ── Exo virtual URLs ─────────────────────────────────────────────────────
  if (trimmed === 'exo://newtab' || trimmed === 'exo://newtab/')
    return EXO_NEWTAB_URL;
  if (/^exo:\/\/search/i.test(trimmed)) {
    // exo://search?q=QUERY — extract and trigger via IPC (caller does this)
    // resolveUrl just returns about:blank; actual search is handled upstream
    return EXO_NEWTAB_URL;
  }
  // ── Standard URLs ────────────────────────────────────────────────────────
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^file:\/\/\//i.test(trimmed)) return trimmed;
  if (/^[^\s]+\.[^\s]+$/.test(trimmed)) return `https://${trimmed}`;
  // Fallback: renderer already composed search URL before calling us
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.on('navigate', (_e, { url, tabId }) => {
  const id = tabId ?? activeTabId;
  if (!id || !tabs.has(id)) return;
  const tab = tabs.get(id);
  if (!tab.view) return;
  tab.view.webContents.loadURL(resolveUrl(url));
});

ipcMain.on('go-back', (_e, { tabId }) => {
  const tab = tabs.get(tabId ?? activeTabId);
  const nh = tab?.view?.webContents.navigationHistory;
  if (nh?.canGoBack()) nh.goBack();
});

ipcMain.on('go-forward', (_e, { tabId }) => {
  const tab = tabs.get(tabId ?? activeTabId);
  const nh = tab?.view?.webContents.navigationHistory;
  if (nh?.canGoForward()) nh.goForward();
});

ipcMain.on('reload', (_e, { tabId }) => {
  tabs.get(tabId ?? activeTabId)?.view?.webContents.reload();
});

ipcMain.on('stop-loading', (_e, { tabId }) => {
  tabs.get(tabId ?? activeTabId)?.view?.webContents.stop();
});

ipcMain.on('new-tab', (_e, { url } = {}) => {
  createTab(url || EXO_NEWTAB_URL);
});

ipcMain.on('switch-tab', (_e, { tabId }) => switchTab(tabId));
ipcMain.on('close-tab',  (_e, { tabId }) => closeTab(tabId));

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

// ── History IPC ───────────────────────────────────────────────────────────────
ipcMain.handle('history-get',    ()         => historyDB.slice(0, 300));
ipcMain.on   ('history-clear',   ()         => { historyDB.length = 0; mainWindow?.webContents.send('history-updated', { cleared: true }); });
ipcMain.on   ('history-delete',  (_e, { id }) => { const i = historyDB.findIndex(h => h.id === id); if (i !== -1) historyDB.splice(i, 1); });

// ── Gaming Sidebar ────────────────────────────────────────────────────────────

ipcMain.on('sidebar-toggle', (_e, { open }) => {
  sidebarOpen = open;
  // Resize all tab views to respect the sidebar gutter
  tabs.forEach((tab, id) => {
    if (tab.view) updateViewBounds(id, tab.view);
  });
  mainWindow?.webContents.send('sidebar-state-changed', { open });
});

// ── History Sidebar ───────────────────────────────────────────────────────────

ipcMain.on('history-sidebar-toggle', (_e, { open }) => {
  historySidebarOpen = open;
  // Resize all tab views to respect the history panel gutter on the right
  tabs.forEach((tab, id) => {
    if (tab.view) updateViewBounds(id, tab.view);
  });
});

// ── Settings Window ───────────────────────────────────────────────────────────
ipcMain.on('open-settings',  () => createSettingsWindow());
ipcMain.on('close-settings', () => settingsWindow?.close());

// ── Dark Mode toggle ──────────────────────────────────────────────────────────
// Renderer sends 'dark-mode-set' { enabled: bool } when the user flips the
// Dark Mode toggle in the GX sidebar settings panel.
// We apply the change to every currently open tab immediately.
ipcMain.on('dark-mode-set', (_e, { enabled }) => {
  darkModeEnabled = !!enabled;
  tabs.forEach((tab) => {
    if (!tab.view || tab.sleeping) return;
    if (darkModeEnabled) {
      enableDarkMode(tab.view.webContents).catch(() => {});
    } else {
      disableDarkMode(tab.view.webContents).catch(() => {});
    }
  });
  console.log(`[Exo-Dark] Dark mode ${darkModeEnabled ? 'zapnut' : 'vypnut'} (${tabs.size} tabů).`);
});

// ── Plugin Manager ────────────────────────────────────────────────────────────
ipcMain.on('open-plugin-manager',  () => createPluginManagerWindow());
ipcMain.on('close-plugin-manager', () => pluginManagerWindow?.close());

// ── AI Sidebar ────────────────────────────────────────────────────────────────
ipcMain.on('ai-sidebar-toggle', (_e, { open }) => {
  aiSidebarOpen = open;
  if (open) {
    createAiSidebarWindow();
    // Pošli kontext aktivní stránky do sidebaru po krátkém zpoždění (okno se načítá)
    const tab = getActiveTab();
    if (tab) {
      setTimeout(() => {
        const ctx = tab.title ? `${tab.title} (${tab.url})` : tab.url;
        aiSidebarWindow?.webContents.send('ai-sidebar-context', ctx);
      }, 500);
    }
  } else {
    aiSidebarWindow?.close();
  }
  tabs.forEach((tab, id) => { if (tab.view) updateViewBounds(id, tab.view); });
  mainWindow?.webContents.send('ai-sidebar-state', { open });
});

// ── Get page text (pro AI sumarizaci) ─────────────────────────────────────────
ipcMain.handle('get-page-text', async () => {
  const tab = getActiveTab();
  if (!tab?.view) return '';
  try {
    return await tab.view.webContents.executeJavaScript(`
      (function() {
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('script,style,nav,header,footer,aside,[role="navigation"]').forEach(el => el.remove());
        return (clone.innerText || clone.textContent || '').replace(/\\s{3,}/g, '\\n\\n').slice(0, 12000);
      })()
    `);
  } catch (_) { return ''; }
});

// ── Performance Stats (for sidebar meters) ────────────────────────────────────

let _lastCpuTotal = 0;
let _lastCpuIdle  = 0;

ipcMain.handle('get-perf-stats', () => {
  // CPU — delta between two samples
  const cpus      = os.cpus();
  const total     = cpus.reduce((a, c) => a + Object.values(c.times).reduce((x, y) => x + y, 0), 0);
  const idle      = cpus.reduce((a, c) => a + c.times.idle, 0);
  const totalDiff = total - _lastCpuTotal;
  const idleDiff  = idle  - _lastCpuIdle;
  const cpuPct    = totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0;
  _lastCpuTotal   = total;
  _lastCpuIdle    = idle;

  // RAM
  const totalMem  = os.totalmem();
  const freeMem   = os.freemem();
  const usedMem   = totalMem - freeMem;

  return {
    cpu:        Math.min(100, Math.max(0, cpuPct)),
    ramUsedMB:  Math.round(usedMem  / 1_048_576),
    ramTotalMB: Math.round(totalMem / 1_048_576),
    ramPct:     Math.round((usedMem / totalMem) * 100),
    blocked:    blockedCount,
    tabCount:   tabs.size,
    sleepCount: Array.from(tabs.values()).filter(t => t.sleeping).length,
  };
});

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // ── Privacy Shield: tracker blocker ────────────────────────────────────────
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['<all_urls>'] },
    (details, callback) => {
      try {
        const urlObj = new URL(details.url);
        if (BLOCKED_HOSTS.has(urlObj.hostname)) {
          blockedCount++;
          return callback({ cancel: true });
        }
        // Path-level pattern matching (cheap string search)
        const raw = details.url;
        for (const pat of BLOCKED_PATTERNS) {
          if (raw.includes(pat)) { blockedCount++; return callback({ cancel: true }); }
        }
      } catch (_) { /* malformed URL — let it through */ }
      callback({});
    }
  );

  // NOTE: No onHeadersReceived CSP override — the toolbar's CSP is set via
  // <meta http-equiv="Content-Security-Policy"> in index.html.
  // Injecting CSP here would overwrite every website's own CSP and break them.

  createWindow();
  startSleepTimer();
  setupDownloadManager();   // ← Download Manager (po createWindow, aby existoval mainWindow)

  // 🚀 ZDE JE TO NOVÉ VOLÁNÍ STAHŮVÁNÍ ADBLOCKU:
  updateBlocklist();

  // ✨ AI Agent (Gemini) — registrace IPC handlerů
  registerAgentIPC(ipcMain, getActiveTab, app.getPath('userData'));
  agentEmitter.on('create-tab', (url) => createTab(url));

  // ✨ Plugin Engine — inicializace a IPC
  pluginEngine = new PluginEngine(
    app.getPath('userData'),
    () => tabs,
    () => activeTabId,
    mainWindow
  );
  pluginEngine.loadAll();
  registerPluginIPC(pluginEngine, mainWindow);

  // ── Password Manager IPC ────────────────────────────────────────────────────
  registerPasswordIPC(ipcMain, app.getPath('userData'));

  // ── Vault save-prompt: direct IPC from tab preload (reliable during nav) ────
  // The autofill bridge calls window.__exo_tab__.vaultSave() which uses
  // ipcRenderer.send('vault-save-prompt-ipc') from exo-tab-preload.js.
  // This fires synchronously even when the page is navigating away, unlike
  // executeJavaScript which fails on navigating webContents.
  ipcMain.on('vault-save-prompt-ipc', (_e, { origin, username, password }) => {
    const key = `${origin}|${username}`;
    const now = Date.now();
    if (key === _lastVaultPromptKey && now - _lastVaultPromptAt < 1000) {
      console.log('📡 [Main] vault-save-prompt-ipc deduplicated');
      return;
    }
    _lastVaultPromptKey = key;
    _lastVaultPromptAt  = now;
    console.log('📡 [Main] SUCCESSFULLY RECEIVED PROMPT FROM BRIDGE:', { origin, username });
    const promptPayload = { origin, username, password };
    mainWindow?.webContents.send('vault-save-prompt', promptPayload);
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      console.log('📡 [Main] Injecting vault toast into overlayWindow...');
      _injectVaultToast(overlayWindow, promptPayload);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXO SEARCH — ULTRA STABLE (Chromium net.fetch + Timeout Guard)
// ═══════════════════════════════════════════════════════════════════════════════

const { net } = require('electron');

/** Decode HTML entities in a plain string */
function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Strip HTML tags from a string */
function stripTags(str) {
  return str.replace(/<[^>]+>/g, '');
}

/** Parse DuckDuckGo HTML endpoint response (Univerzální) */
function parseDDGHtml(html, query) {
  const items = [];
  const blocks = html.split(/(?=<div[^>]+class="[^"]*\bresult\b|<tr[^>]+class="[^"]*\bresult\b)/i);

  for (const block of blocks) {
    if (/class="[^"]*result--ad/.test(block)) continue;

    const titleMatch = block.match(/<a[^>]+(?:class="result__a"|class="result-url"|class="result-title")[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;

    let href = titleMatch[1];
    let titleRaw = decodeHtmlEntities(stripTags(titleMatch[2])).trim();
    if (!titleRaw) continue;

    let url = href;
    try {
      if (href.includes('uddg=')) {
        const full = href.startsWith('/') ? 'https://duckduckgo.com' + href : href;
        const uddg = new URL(full).searchParams.get('uddg');
        if (uddg) url = decodeURIComponent(uddg);
      } else if (href && !/^https?:/i.test(href)) {
        url = 'https://duckduckgo.com' + href;
      }
    } catch (_) {}

    if (!/^https?:/i.test(url)) continue;

    const snippetMatch = block.match(/(?:class="result__snippet"[^>]*>|class="result-snippet"[^>]*>)([\s\S]*?)(?:<\/a>|<\/td>|<\/div>)/i);
    const snippet = snippetMatch ? decodeHtmlEntities(stripTags(snippetMatch[1])).trim() : '';

    let displayUrl = '';
    try { displayUrl = new URL(url).hostname.replace(/^www\./, ''); } catch(_) {}

    items.push({ title: titleRaw, url, snippet, displayUrl });
  }

  return {
    query,
    items: items.slice(0, 20),
    noResults: items.length === 0,
    noResultsMsg: items.length === 0 ? 'Žádné výsledky nenalezeny.' : '',
  };
}

/**
 * Fetch results from DuckDuckGo using Electron's native Chromium network stack
 */
async function fetchDDGResults(query) {
  const url = `https://html.duckduckgo.com/html/`;
  
  // Ochrana proti zablokování spojení (Tarpit). Max 5 vteřin.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    // Používáme net.fetch! Server vidí 100% čistý Chrome, nikoliv NodeJS skript.
    const resp = await net.fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      body: `q=${encodeURIComponent(query.trim())}`,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!resp.ok) throw new Error(`Přístup zamítnut (HTTP ${resp.status})`);
    return parseDDGHtml(await resp.text(), query);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Vyhledávač neodpověděl do 5 vteřin (Time-out).');
    }
    throw err;
  }
}

/**
 * IPC: renderer sends query → main loads exo-search.html + injects results.
 * Flow:
 *   1. Load local exo-search.html immediately (skeleton visible right away)
 *   2. Fetch DDG results in parallel
 *   3. Once page DOM is ready, inject via executeJavaScript → window.__exoResults()
 */
ipcMain.handle('exo-search', async (_e, { query, tabId }) => {
  const q  = (query || '').trim();
  const id = tabId ?? activeTabId;
  if (!id || !tabs.has(id)) return { error: 'no active tab' };
  const tab = tabs.get(id);
  if (!tab?.view) return { error: 'no view' };

  // Build file:// URL with query in hash so the page can show it immediately
  const pageFile = path.join(__dirname, 'src', 'exo-search.html');
  const pageUrl  = 'file:///' + pageFile.replace(/\\/g, '/') + (q ? '#' + encodeURIComponent(q) : '');

  // Navigate the tab to our local search page (shows loading skeleton at once)
  tab.view.webContents.loadURL(pageUrl);

  // Empty query → just show the empty search page, no fetch needed
  if (!q) return { ok: true };

  // Fetch in parallel
  let payload;
  try   { payload = await fetchDDGResults(q); }
  catch (err) { payload = { query: q, items: [], noResults: true, noResultsMsg: `Chyba při načítání: ${err.message}` }; }

  // Inject results — wait for page if still loading
  const inject = () => {
    const js = `typeof window.__exoResults==='function'&&window.__exoResults(${JSON.stringify(payload)})`;
    tab.view?.webContents.executeJavaScript(js).catch(() => {});
  };

  if (tab.view.webContents.isLoading()) {
    tab.view.webContents.once('did-finish-load', inject);
  } else {
    inject();
  }

  return { ok: true };
});

// ── Vault ↔ content-script message handler ────────────────────────────────────
/**
 * Called by the per-tab postMessage relay poll (inside createTab).
 * Processes outgoing vault requests from the autofill content script and
 * responds by calling back into the page via executeJavaScript.
 *
 * @param {{ type: string, [key: string]: any }} msg
 * @param {Electron.WebContents}               wc
 */
/**
 * Inject the "Uložit heslo?" toast into the overlay window via executeJavaScript.
 * The overlay is an alwaysOnTop BrowserWindow that paints above all WebContentsViews.
 * Called both from handleVaultMessage (poll path) and vault-save-prompt-ipc (preload path).
 * @param {Electron.BrowserWindow} win   the overlayWindow
 * @param {{ origin, username, password }} payload
 */
// ── Vault toast cursor poll ───────────────────────────────────────────────────
// Tracks whether the cursor is over the toast rect (reported by the renderer).
// Used by the Main-process cursor poll to toggle setIgnoreMouseEvents.
let _vaultToastRect   = null; // { x, y, w, h } in overlay-window client coords
let _vaultToastActive = false;
let _vaultCursorPoll  = null;

function _startVaultCursorPoll(win) {
  if (_vaultCursorPoll) return; // already running
  const { screen } = require('electron');
  _vaultCursorPoll = setInterval(() => {
    if (!win || win.isDestroyed() || !_vaultToastActive) {
      _stopVaultCursorPoll(win);
      return;
    }
    const cursor  = screen.getCursorScreenPoint();
    const bounds  = win.getBounds();
    // Convert screen coords → overlay-window client coords
    const cx = cursor.x - bounds.x;
    const cy = cursor.y - bounds.y;
    const r  = _vaultToastRect;
    const over = r && cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
    win.setIgnoreMouseEvents(!over, { forward: true });
  }, 16); // ~60 fps
}

function _stopVaultCursorPoll(win) {
  if (_vaultCursorPoll) { clearInterval(_vaultCursorPoll); _vaultCursorPoll = null; }
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(true, { forward: true });
}

// Renderer reports the toast rect and active state via IPC
ipcMain.on('vault-toast-rect', (_e, rect) => {
  _vaultToastRect   = rect; // { x, y, w, h } or null when hidden
  _vaultToastActive = !!rect;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (_vaultToastActive) {
      _startVaultCursorPoll(overlayWindow);
    } else {
      _stopVaultCursorPoll(overlayWindow);
    }
  }
});

function _injectVaultToast(win, payload) {
  if (!win || win.isDestroyed()) return;
  // Start Main-process cursor poll — toggles setIgnoreMouseEvents based on
  // whether the cursor is over the toast rect (reported via vault-toast-rect IPC).
  _startVaultCursorPoll(win);
  const safePayload = JSON.stringify(payload);
  win.webContents.executeJavaScript(`
    (function(payload) {
      // Idempotent — only inject once; on repeat calls just update + show
      if (document.getElementById('__exo_vault_overlay_toast__')) {
        document.getElementById('__exo_ovt_sub__').textContent =
          (payload.username || '') + ' — ' + (payload.origin || '');
        document.getElementById('__exo_vault_overlay_toast__').__pendingPayload = payload;
        document.getElementById('__exo_vault_overlay_toast__').classList.add('show');
        // Re-report rect so poll knows toast is active again after re-show
        requestAnimationFrame(() => {
          const r2 = document.getElementById('__exo_vault_overlay_toast__').getBoundingClientRect();
          window.browserAPI?.setVaultToastRect({ x: Math.round(r2.left), y: Math.round(r2.top), w: Math.round(r2.width), h: Math.round(r2.height) });
        });
        return;
      }

      // ── Styles ────────────────────────────────────────────────────────────
      const s = document.createElement('style');
      s.textContent = \`
        #__exo_vault_overlay_toast__ {
          position: fixed; bottom: 20px; left: 50%;
          transform: translateX(-50%) translateY(140%);
          z-index: 2147483647;
          background: rgba(14,14,26,0.97);
          backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(167,139,250,0.4); border-radius: 14px;
          box-shadow: 0 12px 48px rgba(0,0,0,.75);
          padding: 14px 18px; min-width: 320px; max-width: 460px;
          display: flex; align-items: flex-start; gap: 12px;
          transition: transform .32s cubic-bezier(.34,1.56,.64,1), opacity .25s;
          opacity: 0; font-family: -apple-system,"Segoe UI",sans-serif;
          pointer-events: auto;
        }
        #__exo_vault_overlay_toast__.show { transform: translateX(-50%) translateY(0); opacity: 1; }
        #__exo_vault_overlay_toast__ .__ovt_icon { font-size:22px; flex-shrink:0; margin-top:2px; }
        #__exo_vault_overlay_toast__ .__ovt_body { flex:1; min-width:0; }
        #__exo_vault_overlay_toast__ .__ovt_title { font-size:13px; font-weight:600; color:#e2e8f0; margin-bottom:3px; }
        #__exo_vault_overlay_toast__ .__ovt_sub   { font-size:12px; color:#64748b; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        #__exo_vault_overlay_toast__ .__ovt_acts  { display:flex; gap:8px; margin-top:10px; }
        #__exo_vault_overlay_toast__ .__ovt_btn   { border:none; border-radius:7px; font-size:12px; font-weight:500; cursor:pointer; padding:5px 12px; transition:background .12s; }
        #__exo_vault_overlay_toast__ .__ovt_save  { background:rgba(167,139,250,.18); color:#a78bfa; border:1px solid rgba(167,139,250,.35); }
        #__exo_vault_overlay_toast__ .__ovt_save:hover { background:rgba(167,139,250,.3); }
        #__exo_vault_overlay_toast__ .__ovt_skip  { background:rgba(255,255,255,.04); color:#64748b; border:1px solid rgba(255,255,255,.08); }
        #__exo_vault_overlay_toast__ .__ovt_skip:hover { background:rgba(255,255,255,.09); color:#94a3b8; }
        #__exo_vault_overlay_toast__ .__ovt_x     { background:none; border:none; color:#475569; font-size:16px; cursor:pointer; padding:0; line-height:1; align-self:flex-start; flex-shrink:0; }
        #__exo_vault_overlay_toast__ .__ovt_x:hover { color:#94a3b8; }
      \`;
      document.head.appendChild(s);

      // ── DOM ───────────────────────────────────────────────────────────────
      const el = document.createElement('div');
      el.id = '__exo_vault_overlay_toast__';
      el.__pendingPayload = payload;
      el.innerHTML = \`
        <div class="__ovt_icon">🔐</div>
        <div class="__ovt_body">
          <div class="__ovt_title">Uložit heslo?</div>
          <div class="__ovt_sub" id="__exo_ovt_sub__"></div>
          <div class="__ovt_acts">
            <button class="__ovt_btn __ovt_save" id="__exo_ovt_save__">✓ Uložit</button>
            <button class="__ovt_btn __ovt_skip" id="__exo_ovt_skip__">✕ Ignorovat</button>
          </div>
        </div>
        <button class="__ovt_x" id="__exo_ovt_close__">✕</button>
      \`;
      document.body.appendChild(el);
      document.getElementById('__exo_ovt_sub__').textContent =
        (payload.username || '') + ' — ' + (payload.origin || '');

      const hide = () => {
        el.classList.remove('show');
        // Tell Main-process cursor poll that toast is gone → restores passthrough
        window.browserAPI?.setVaultToastRect(null);
      };

      // ── Auto-dismiss timer ───────────────────────────────────────────────────
      // Mouse events are managed entirely by the Main-process cursor poll
      // (16ms interval, screen.getCursorScreenPoint() vs toast rect).
      // mouseenter/mouseleave work here because the poll keeps the overlay
      // non-passthrough while the cursor is over the rect.
      let _autoDismissTimer = setTimeout(hide, 12000);

      // Pause auto-dismiss while cursor is over the toast; restart on leave.
      el.addEventListener('mouseenter', () => clearTimeout(_autoDismissTimer));
      el.addEventListener('mouseleave', () => {
        _autoDismissTimer = setTimeout(hide, 4000);
      });

      document.getElementById('__exo_ovt_skip__').addEventListener('click', hide);
      document.getElementById('__exo_ovt_close__').addEventListener('click', hide);
      document.getElementById('__exo_ovt_save__').addEventListener('click', async () => {
        const p = el.__pendingPayload;
        if (!p) return;
        hide();
        if (!window.browserAPI?.passwordSave) {
          console.error('[VaultToast] browserAPI.passwordSave not available');
          return;
        }
        try {
          const res = await window.browserAPI.passwordSave(p.origin, p.username, p.password);
          console.log('[VaultToast] passwordSave result:', res);
          if (res?.ok) {
            const ack = document.createElement('div');
            ack.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:2147483647;background:rgba(74,222,128,.15);border:1px solid rgba(74,222,128,.3);border-radius:8px;padding:8px 18px;color:#4ade80;font:600 13px/1.4 -apple-system,sans-serif;pointer-events:none;transition:opacity .4s;';
            ack.textContent = '✅ Heslo uloženo do Exo Vault.';
            document.body.appendChild(ack);
            setTimeout(() => { ack.style.opacity = '0'; setTimeout(() => ack.remove(), 400); }, 2500);
          } else {
            console.error('[VaultToast] Save failed:', res?.error);
          }
        } catch (err) {
          console.error('[VaultToast] passwordSave threw:', err);
        }
      });

      // After CSS transition settles, report rect to Main cursor poll
      requestAnimationFrame(() => {
        el.classList.add('show');
        // Wait for transition to finish (~350ms) before locking in the rect
        setTimeout(() => {
          const r = el.getBoundingClientRect();
          window.browserAPI?.setVaultToastRect({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
        }, 380);
      });
    })(${safePayload})
  `).catch(err => console.error('[Main] Vault toast inject error:', err));
}

async function handleVaultMessage(msg, wc) {
  if (!msg || !msg.type || wc.isDestroyed()) return;

  const pm = require('./exo-password-manager');
  const vlt = pm._vault;
  if (!vlt) return; // vault not yet initialised (shouldn't happen)

  if (msg.type === 'vault-get') {
    // Return saved credentials (passwords redacted) for this origin
    const creds = vlt.getByDomain(msg.origin || '');
    try {
      await wc.executeJavaScript(
        `typeof window.__exo_vault_pending_get__ === 'function' && ` +
        `(window.__exo_vault_pending_get__(${JSON.stringify(creds)}), ` +
        ` window.__exo_vault_pending_get__ = null)`
      );
    } catch (_) {}
    return;
  }

  if (msg.type === 'vault-reveal') {
    // Decrypt and return the plaintext password for autofill
    const result = vlt.reveal(msg.id || '');
    try {
      await wc.executeJavaScript(
        `typeof window.__exo_vault_pending_reveal__ === 'function' && ` +
        `(window.__exo_vault_pending_reveal__(${JSON.stringify(result)}), ` +
        ` window.__exo_vault_pending_reveal__ = null)`
      );
    } catch (_) {}
    return;
  }

  if (msg.type === 'vault-save-prompt') {
    const key = `${msg.origin}|${msg.username}`;
    const now = Date.now();
    if (key === _lastVaultPromptKey && now - _lastVaultPromptAt < 1000) {
      console.log('📡 [Main] vault-save-prompt (poll) deduplicated');
      return;
    }
    _lastVaultPromptKey = key;
    _lastVaultPromptAt  = now;
    console.log('📡 [Main] Forwarding vault prompt to UI...', msg.origin, msg.username);
    const promptPayload = { origin: msg.origin, username: msg.username, password: msg.password };
    mainWindow?.webContents.send('vault-save-prompt', promptPayload);
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      console.log('📡 [Main] Injecting vault toast into overlayWindow...');
      _injectVaultToast(overlayWindow, promptPayload);
    }
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── EXO MIRROR RUNNER ──
async function runExoMirror(view) {
  const fs = require('fs');
  const path = require('path');
  const { dialog } = require('electron');

  const scriptPath = path.join(__dirname, 'src', 'exo-mirror.js');
  
  if (!fs.existsSync(scriptPath)) {
    console.error('[Exo] exo-mirror.js nebyl nalezen v:', scriptPath);
    return;
  }

  const script = fs.readFileSync(scriptPath, 'utf8');

  try {
    const result = await view.webContents.executeJavaScript(script);
    if (!result) return;

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: `export.${result.format}`,
      filters: [{ name: 'Exported Data', extensions: [result.format] }]
    });

    if (filePath) {
      fs.writeFileSync(filePath, result.content);
      console.log('[Exo] Data uložena do:', filePath);
    }
  } catch (err) {
    console.error('[Exo] Chyba při běhu Mirroru:', err);
  }
}