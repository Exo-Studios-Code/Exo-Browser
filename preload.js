/**
 * preload.js — Exo Browser — Preload Script (AI Edition)
 *
 * Rozšíření původního preload.js o:
 *  • AI Agent API (Gemini chat, sumarizace, Pilot příkazy)
 *  • Settings Window API
 *  • AI Sidebar toggle + kontext
 *  • Smart Command Bar helpers
 *
 * Změny jsou označeny komentářem "// ✨ NOVÉ"
 *
 * Security model:
 *  • contextIsolation: true  → renderer JS nemá přístup k tomuto scope
 *  • nodeIntegration: false  → renderer nemůže require() Node moduly
 *  • Všechna data jsou validována před předáním do main procesu
 */


const { contextBridge, ipcRenderer, webUtils } = require('electron');
// ─── Type-checked send helpers ────────────────────────────────────────────────

const assertString = (v, name) => {
  if (typeof v !== 'string') throw new TypeError(`${name} must be a string`);
  return v;
};
const assertNumber = (v, name) => {
  if (typeof v !== 'number') throw new TypeError(`${name} must be a number`);
  return v;
};

// ─── Exposed API ──────────────────────────────────────────────────────────────

contextBridge.exposeInMainWorld('browserAPI', {

  // ════════════════════════════════════════════════════════════════════════════
  // PŮVODNÍ API (nezměněno)
  // ════════════════════════════════════════════════════════════════════════════

  // ── Navigation ──────────────────────────────────────────────────────────────
  navigate: (url, tabId) =>
    ipcRenderer.send('navigate', {
      url: assertString(url, 'url'),
      tabId: tabId != null ? assertNumber(tabId, 'tabId') : undefined,
    }),

  goBack:      (tabId) => ipcRenderer.send('go-back',      { tabId }),
  goForward:   (tabId) => ipcRenderer.send('go-forward',   { tabId }),
  reload:      (tabId) => ipcRenderer.send('reload',        { tabId }),
  stopLoading: (tabId) => ipcRenderer.send('stop-loading', { tabId }),

  // ── Tabs ────────────────────────────────────────────────────────────────────
  newTab: (url) =>
    ipcRenderer.send('new-tab', { url }),

  switchTab: (tabId) =>
    ipcRenderer.send('switch-tab', { tabId: assertNumber(tabId, 'tabId') }),

  closeTab: (tabId) =>
    ipcRenderer.send('close-tab', { tabId: assertNumber(tabId, 'tabId') }),

  // ── Window Controls ─────────────────────────────────────────────────────────
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close:    () => ipcRenderer.send('window-close'),

  // ── History Sidebar ─────────────────────────────────────────────────────────
  toggleHistorySidebar: (open) => ipcRenderer.send('history-sidebar-toggle', { open }),

  // ── Event Subscriptions ─────────────────────────────────────────────────────
  onTabCreated:       (cb) => ipcRenderer.on('tab-created',         (_e, d) => cb(d)),
  onTabClosed:        (cb) => ipcRenderer.on('tab-closed',          (_e, d) => cb(d)),
  onTabSwitched:      (cb) => ipcRenderer.on('tab-switched',        (_e, d) => cb(d)),
  onTabNavigated:     (cb) => ipcRenderer.on('tab-navigated',       (_e, d) => cb(d)),
  onTabTitleUpdated:  (cb) => ipcRenderer.on('tab-title-updated',   (_e, d) => cb(d)),
  onTabFaviconUpdated:(cb) => ipcRenderer.on('tab-favicon-updated', (_e, d) => cb(d)),
  onTabLoading:       (cb) => ipcRenderer.on('tab-loading',         (_e, d) => cb(d)),
  onNavStateUpdated:  (cb) => ipcRenderer.on('nav-state-updated',   (_e, d) => cb(d)),
  onWindowState:      (cb) => ipcRenderer.on('window-state-changed',(_e, d) => cb(d)),

  // ── Tab Sleep ───────────────────────────────────────────────────────────────
  onTabSleeping: (cb) => ipcRenderer.on('tab-sleeping', (_e, d) => cb(d)),

  // ── Gaming Sidebar ──────────────────────────────────────────────────────────
  toggleSidebar:  (open) => ipcRenderer.send('sidebar-toggle', { open }),
  onSidebarState: (cb)   => ipcRenderer.on('sidebar-state-changed', (_e, d) => cb(d)),

  // ── Performance Stats ───────────────────────────────────────────────────────
  getStats: () => ipcRenderer.invoke('get-perf-stats'),

  // ── 🚨 Utils (PŘIDÁNO PRO PLUGIN MANAGER) ──────────────────────────────────
  getPathForFile: (file) => webUtils.getPathForFile(file),
  // ── Exo Search ──────────────────────────────────────────────────────────────
  exoSearch: (query, tabId) =>
    ipcRenderer.invoke('exo-search', {
      query: assertString(query, 'query'),
      tabId: tabId != null ? assertNumber(tabId, 'tabId') : undefined,
    }),

  // ── Gaming Mode ─────────────────────────────────────────────────────────────
  enableGamingMode:  () => ipcRenderer.invoke('gaming-mode-enable'),
  disableGamingMode: () => ipcRenderer.invoke('gaming-mode-disable'),

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),

  // ── Downloads ────────────────────────────────────────────────────────────────
  onDownloadStarted:  (cb) => ipcRenderer.on('download-started',  (_e, d) => cb(d)),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_e, d) => cb(d)),
  onDownloadDone:     (cb) => ipcRenderer.on('download-done',     (_e, d) => cb(d)),
  cancelDownload: (downloadId) =>
    ipcRenderer.send('cancel-download', { downloadId: assertNumber(downloadId, 'downloadId') }),
  setOverlayClickable: (clickable) =>
    ipcRenderer.send('overlay-set-clickable', { clickable: !!clickable }),

  // ── History ─────────────────────────────────────────────────────────────────
  getHistory:         ()      => ipcRenderer.invoke('history-get'),
  clearHistory:       ()      => ipcRenderer.send('history-clear'),
  deleteHistoryEntry: (id)    => ipcRenderer.send('history-delete', { id }),
  onHistoryUpdated:   (cb)    => ipcRenderer.on('history-updated', (_e, d) => cb(d)),


  // ════════════════════════════════════════════════════════════════════════════
  // ✨ NOVÉ: AI Agent API
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Vrátí konfiguraci AI agenta (jestli je klíč nastaven, model).
   * @returns {Promise<{ hasKey: boolean, model: string }>}
   */
  aiGetConfig: () => ipcRenderer.invoke('ai-get-config'),

  /**
   * Uloží Gemini API klíč bezpečně (OS safeStorage).
   * @param {string} key
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  aiSetApiKey: (key) =>
    ipcRenderer.invoke('ai-set-api-key', { key: assertString(key, 'key') }),

  /**
   * Smaže uložený API klíč.
   * @returns {Promise<{ ok: boolean }>}
   */
  aiDeleteApiKey: () => ipcRenderer.invoke('ai-delete-api-key'),

  /**
   * Nastaví preferovaný Gemini model.
   * @param {string} model
   */
  aiSetModel: (model) =>
    ipcRenderer.invoke('ai-set-model', { model: assertString(model, 'model') }),

  /**
   * Otestuje API klíč jednoduchým ping dotazem.
   * @returns {Promise<{ ok: boolean, model?: string, error?: string }>}
   */
  aiTestKey: () => ipcRenderer.invoke('ai-test-key'),

  /**
   * Odešle zprávu do AI chatu s historií konverzace.
   * @param {{ role: string, content: string }[]} messages
   * @param {string|null} pageContext
   * @returns {Promise<{ ok?: boolean, reply?: string, error?: string }>}
   */
  aiChat: (messages, pageContext) =>
    ipcRenderer.invoke('ai-chat', { messages, pageContext }),

  /**
   * Sumarizuje obsah aktuální stránky.
   * @param {string} pageText   Text extrahovaný ze stránky
   * @returns {Promise<{ ok?: boolean, summary?: string, error?: string }>}
   */
  aiSummarizePage: (pageText) =>
    ipcRenderer.invoke('ai-summarize-page', { pageText }),

  /**
   * Extrahuje text z aktivní stránky (pro sumarizaci).
   * @returns {Promise<string>}
   */
  getPageText: () => ipcRenderer.invoke('get-page-text'),

  /**
   * Poslouchá kontext stránky z main procesu (pro AI sidebar).
   * @param {function(string): void} cb
   */
  onAiSidebarContext: (cb) => ipcRenderer.on('ai-sidebar-context', (_e, ctx) => cb(ctx)),

  // ════════════════════════════════════════════════════════════════════════════
  // ✨ NOVÉ: Settings Window
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Otevře okno nastavení.
   */
  openSettings: () => ipcRenderer.send('open-settings'),

  /**
   * Zavře okno nastavení (voláno z exo-settings.html).
   */
  closeSettingsWindow: () => ipcRenderer.send('close-settings'),

  // ════════════════════════════════════════════════════════════════════════════
  // ✨ NOVÉ: AI Sidebar
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Otevře / zavře AI Chat Sidebar.
   * @param {boolean} open
   */
  toggleAiSidebar: (open) =>
    ipcRenderer.send('ai-sidebar-toggle', { open: !!open }),

  /**
   * Poslouchá změnu stavu AI sidebaru.
   * @param {function({ open: boolean }): void} cb
   */
  onAiSidebarState: (cb) =>
    ipcRenderer.on('ai-sidebar-state', (_e, d) => cb(d)),

  // ════════════════════════════════════════════════════════════════════════════
  // ✨ NOVÉ: Plugin Manager
  // ════════════════════════════════════════════════════════════════════════════

  /** Otevře Plugin Manager okno */
  openPluginManager: () => ipcRenderer.send('open-plugin-manager'),
  closePluginManager: () => ipcRenderer.send('close-plugin-manager'),

  /** @returns {Promise<PluginInfo[]>} */
  pluginsList: () => ipcRenderer.invoke('plugins-list'),

  /** Znovu načte všechny pluginy ze složky */
  pluginsReload: () => ipcRenderer.invoke('plugins-reload'),

  /** Otevře složku pluginů v průzkumníku */
  pluginsOpenDir: () => ipcRenderer.invoke('plugins-open-dir'),

  /** @param {string} id */
  pluginEnable:    (id) => ipcRenderer.invoke('plugin-enable',    { id }),
  pluginDisable:   (id) => ipcRenderer.invoke('plugin-disable',   { id }),
  pluginUninstall: (id) => ipcRenderer.invoke('plugin-uninstall', { id }),

  /**
   * Nainstaluje plugin ze ZIP.
   * @param {string} filePath  Absolutní cesta k .zip souboru
   */
  pluginInstallZip: (filePath) =>
    ipcRenderer.invoke('plugin-install-zip', { filePath }),

  /** Poslouchá aktualizace seznamu pluginů */
  onPluginsUpdated: (cb) => ipcRenderer.on('plugins-updated', (_e, d) => cb(d)),

  /** Toolbar akce pluginu */
  pluginToolbarAction: (id) => ipcRenderer.invoke('plugin-toolbar-action', { id }),



  /**
   * Rychlý AI příkaz z Command Baru.
   * Interně volá exo-pilot-command, ale vrací jen message + action (bez UI Pilot okna).
   * @param {string} command
   * @returns {Promise<{ message: string, action: object, actionResult?: object, error?: string }>}
   */
  aiCommand: (command) =>
    ipcRenderer.invoke('exo-pilot-command', { text: assertString(command, 'command') }),

});
