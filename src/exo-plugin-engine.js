/**
 * exo-plugin-engine.js — Exo Browser Plugin System
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Architektura:
 *  • Pluginy jsou složky v {userData}/plugins/{plugin-id}/
 *  • Každý plugin má manifest.json + content.js (+ volitelně background.js, styles.css)
 *  • Content script se injektuje do každého tabu přes executeJavaScript (sandbox)
 *  • Background script běží jako Node.js modul v main procesu (trusted, jen pro pokročilé)
 *  • Plugin API je exponováno přes window.__exoPlugin objekt injektovaný do stránky
 *
 * Manifest.json schéma:
 * {
 *   "id":          "my-plugin",           // unikátní ID (lowercase, pomlčky)
 *   "name":        "My Plugin",           // zobrazovaný název
 *   "version":     "1.0.0",
 *   "description": "Co plugin dělá",
 *   "author":      "Jméno",
 *   "homepage":    "https://...",         // volitelné
 *   "permissions": ["storage", "tabs", "notifications"],   // co plugin potřebuje
 *   "content_scripts": {
 *     "matches": ["*://youtube.com/*", "*://*.github.com/*"],  // URL patterny
 *     "js":      "content.js",
 *     "css":     "styles.css"            // volitelné
 *   },
 *   "background": "background.js",       // volitelné, Node.js kontext
 *   "toolbar_action": {                  // volitelné tlačítko v toolbaru
 *     "icon":    "icon.svg",
 *     "tooltip": "Spustit plugin"
 *   },
 *   "settings_page": "settings.html"    // volitelné nastavení pluginu
 * }
 *
 * Bezpečnostní model:
 *  • Content scripts: čistý JS sandbox (executeJavaScript) — BEZ Node.js
 *  • Background scripts: Node.js, ale plugin musí mít "trusted": true v manifestu
 *    a uživatel to musí potvrdit při instalaci
 *  • Storage: izolované na plugin ID přes SecureSettings/JSON soubor
 *  • Permissions: deklarativní — plugin může jen to co si zažádal
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { ipcMain } = require('electron');

// ─── Konstanty ────────────────────────────────────────────────────────────────

const PLUGIN_API_VERSION = '1.0';

/** Povolené URL patterny pro content scripts (bezpečnostní filtr) */
const SAFE_PERMISSIONS = new Set(['storage', 'tabs', 'notifications', 'clipboard', 'contextMenus']);

// ─── Plugin Manager ───────────────────────────────────────────────────────────

class PluginEngine {
  /**
   * @param {string} userDataPath  app.getPath('userData')
   * @param {() => Map} getTabs    funkce vracející tabs Map z main.js
   * @param {() => number|null} getActiveTabId
   * @param {BrowserWindow} mainWindow
   */
  constructor(userDataPath, getTabs, getActiveTabId, mainWindow) {
    this._pluginsDir  = path.join(userDataPath, 'plugins');
    this._storageDir  = path.join(userDataPath, 'plugin-storage');
    this._getTabs     = getTabs;
    this._getActiveTabId = getActiveTabId;
    this._mainWindow  = mainWindow;

    /** @type {Map<string, PluginEntry>} id → plugin */
    this._plugins = new Map();
    /** @type {Set<string>} disabled plugin IDs */
    this._disabled = new Set();

    this._ensureDirs();
    this._loadDisabledList();
  }

  _ensureDirs() {
    [this._pluginsDir, this._storageDir].forEach(d => {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });
  }

  _loadDisabledList() {
    const f = path.join(this._pluginsDir, '.disabled.json');
    try {
      if (fs.existsSync(f)) {
        const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
        arr.forEach(id => this._disabled.add(id));
      }
    } catch (_) {}
  }

  _saveDisabledList() {
    const f = path.join(this._pluginsDir, '.disabled.json');
    fs.writeFileSync(f, JSON.stringify([...this._disabled]), 'utf8');
  }

  // ── Načtení pluginů ze složky ──────────────────────────────────────────────

  /**
   * Načte všechny pluginy z plugins adresáře.
   * Zavolej při startu + po instalaci nového pluginu.
   */
  loadAll() {
    this._plugins.clear();

    let entries;
    try {
      entries = fs.readdirSync(this._pluginsDir, { withFileTypes: true });
    } catch (_) { return; }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginDir = path.join(this._pluginsDir, entry.name);
      try {
        this._loadPlugin(pluginDir);
      } catch (err) {
        console.warn(`[Exo-Plugins] Nelze načíst plugin ${entry.name}:`, err.message);
      }
    }

    console.log(`[Exo-Plugins] Načteno ${this._plugins.size} pluginů.`);
  }

  _loadPlugin(pluginDir) {
    const manifestPath = path.join(pluginDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Validace
    if (!manifest.id || !manifest.name || !manifest.version) {
      throw new Error('Neplatný manifest — chybí id, name nebo version.');
    }
    if (!/^[a-z0-9-]+$/.test(manifest.id)) {
      throw new Error(`Neplatné plugin ID: "${manifest.id}" — povoleny jen lowercase a pomlčky.`);
    }

    // Přečti content script
    let contentJs  = null;
    let contentCss = null;

    if (manifest.content_scripts?.js) {
      const jsPath = path.join(pluginDir, manifest.content_scripts.js);
      if (fs.existsSync(jsPath)) contentJs = fs.readFileSync(jsPath, 'utf8');
    }
    if (manifest.content_scripts?.css) {
      const cssPath = path.join(pluginDir, manifest.content_scripts.css);
      if (fs.existsSync(cssPath)) contentCss = fs.readFileSync(cssPath, 'utf8');
    }

    // Background script (Node.js)
    let backgroundModule = null;
    if (manifest.background && manifest.trusted === true) {
      const bgPath = path.join(pluginDir, manifest.background);
      if (fs.existsSync(bgPath)) {
        try {
          // Dynamický require — rizikové, proto jen trusted pluginy
          backgroundModule = require(bgPath);
        } catch (err) {
          console.error(`[Exo-Plugins] Background script chyba (${manifest.id}):`, err.message);
        }
      }
    }

    // Ikona pro toolbar
    let toolbarIcon = null;
    if (manifest.toolbar_action?.icon) {
      const iconPath = path.join(pluginDir, manifest.toolbar_action.icon);
      if (fs.existsSync(iconPath)) {
        const ext = path.extname(iconPath).toLowerCase();
        const data = fs.readFileSync(iconPath);
        const mime = ext === '.svg' ? 'image/svg+xml' : 'image/png';
        toolbarIcon = `data:${mime};base64,${data.toString('base64')}`;
      }
    }

    const plugin = {
      id:          manifest.id,
      name:        manifest.name,
      version:     manifest.version,
      description: manifest.description || '',
      author:      manifest.author || '',
      homepage:    manifest.homepage || '',
      permissions: (manifest.permissions || []).filter(p => SAFE_PERMISSIONS.has(p)),
      trusted:     manifest.trusted === true,
      matches:     manifest.content_scripts?.matches || ['<all_urls>'],
      contentJs,
      contentCss,
      backgroundModule,
      toolbarIcon,
      toolbarTooltip: manifest.toolbar_action?.tooltip || manifest.name,
      settingsPage:   manifest.settings_page || null,
      dir:         pluginDir,
    };

    this._plugins.set(manifest.id, plugin);

    // Inicializuj background modul
    if (backgroundModule?.onLoad) {
      try {
        backgroundModule.onLoad({ pluginId: manifest.id, ipcMain });
      } catch (err) {
        console.error(`[Exo-Plugins] onLoad chyba (${manifest.id}):`, err.message);
      }
    }
  }

  // ── URL Pattern matching ───────────────────────────────────────────────────

  /**
   * Vrátí všechny aktivní pluginy jejichž content_scripts.matches sedí na URL.
   * @param {string} url
   * @returns {PluginEntry[]}
   */
  getMatchingPlugins(url) {
    const result = [];
    for (const [id, plugin] of this._plugins) {
      if (this._disabled.has(id)) continue;
      if (!plugin.contentJs && !plugin.contentCss) continue;
      if (this._urlMatchesPatterns(url, plugin.matches)) {
        result.push(plugin);
      }
    }
    return result;
  }

  _urlMatchesPatterns(url, patterns) {
    for (const pattern of patterns) {
      if (pattern === '<all_urls>') return true;
      // Jednoduchý glob matching: * = libovolný segment
      try {
        const regexStr = pattern
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // escape special chars
          .replace(/\*/g, '.*');                    // * → .*
        if (new RegExp(`^${regexStr}$`).test(url)) return true;
      } catch (_) {}
    }
    return false;
  }

  // ── Injekce do tabu ────────────────────────────────────────────────────────

  /**
   * Injektuje všechny matchující pluginy do webContents.
   * Voláno z createTab() po did-stop-loading.
   * @param {Electron.WebContents} webContents
   * @param {string} url
   * @param {number} tabId
   */
  async injectIntoTab(webContents, url, tabId) {
    const plugins = this.getMatchingPlugins(url);
    if (!plugins.length) return;

    for (const plugin of plugins) {
      try {
        // CSS injekce
        if (plugin.contentCss) {
          await webContents.insertCSS(plugin.contentCss, { cssOrigin: 'user' });
        }

        // JS injekce — sandbox wrapper
        if (plugin.contentJs) {
          const sandboxedCode = this._wrapContentScript(plugin, tabId, url);
          await webContents.executeJavaScript(sandboxedCode);
        }
      } catch (err) {
        console.warn(`[Exo-Plugins] Injekce pluginu ${plugin.id} selhala:`, err.message);
      }
    }
  }

  /**
   * Zabalí content script do sandboxu s Plugin API.
   */
  _wrapContentScript(plugin, tabId, url) {
    const storageKey = `plugin_${plugin.id}`;

    // Plugin API objekt dostupný jako exo.* ve scriptu
    const apiSetup = `
(function() {
  if (window.__exoPluginLoaded_${plugin.id.replace(/-/g,'_')}) return;
  window.__exoPluginLoaded_${plugin.id.replace(/-/g,'_')} = true;

  /* ── Storage API (localStorage v namespace pluginu) ── */
  const _storageKey = '__exoPlg_${plugin.id}__';
  const _storage = {
    get: (key) => {
      try { const d = JSON.parse(localStorage.getItem(_storageKey) || '{}'); return d[key] ?? null; }
      catch(_) { return null; }
    },
    set: (key, value) => {
      try {
        const d = JSON.parse(localStorage.getItem(_storageKey) || '{}');
        d[key] = value;
        localStorage.setItem(_storageKey, JSON.stringify(d));
        return true;
      } catch(_) { return false; }
    },
    remove: (key) => {
      try {
        const d = JSON.parse(localStorage.getItem(_storageKey) || '{}');
        delete d[key];
        localStorage.setItem(_storageKey, JSON.stringify(d));
      } catch(_) {}
    },
    clear: () => { try { localStorage.removeItem(_storageKey); } catch(_) {} }
  };

  /* ── Notifications API ── */
  const _notify = ${plugin.permissions.includes('notifications') ? `(title, body) => {
    if (Notification.permission === 'granted') new Notification(title, { body, icon: '' });
    else Notification.requestPermission().then(p => { if (p==='granted') new Notification(title, { body }); });
  }` : `() => { console.warn('[Exo Plugin] notifications permission not granted'); }`};

  /* ── Clipboard API ── */
  const _clipboard = ${plugin.permissions.includes('clipboard') ? `{
    write: (text) => navigator.clipboard.writeText(text).catch(()=>{}),
    read:  ()     => navigator.clipboard.readText().catch(()=>Promise.resolve(''))
  }` : `{ write: ()=>{}, read: ()=>Promise.resolve('') }`};

  /* ── Expose jako window.exo ── */
  window.exo = {
    plugin: {
      id:      '${plugin.id}',
      name:    ${JSON.stringify(plugin.name)},
      version: '${plugin.version}',
    },
    storage:      _storage,
    notify:       _notify,
    clipboard:    _clipboard,
    log: (...args) => console.log('[Plugin:${plugin.id}]', ...args),
    url: '${url}',
  };
})();
`;

    return `
${apiSetup}
/* ════════════ PLUGIN: ${plugin.name} v${plugin.version} ════════════ */
(function() {
  'use strict';
  try {
    ${plugin.contentJs}
  } catch(err) {
    console.error('[Exo Plugin ${plugin.id}] Runtime chyba:', err.message);
  }
})();
`;
  }

  // ── Plugin Storage (main-side, pro background scripty) ────────────────────

  getPluginStorage(pluginId) {
    const f = path.join(this._storageDir, `${pluginId}.json`);
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return {}; }
  }

  setPluginStorage(pluginId, data) {
    const f = path.join(this._storageDir, `${pluginId}.json`);
    fs.writeFileSync(f, JSON.stringify(data, null, 2), 'utf8');
  }

  // ── Instalace / odinstalace ────────────────────────────────────────────────

  /**
   * Nainstaluje plugin ze ZIP souboru.
   * @param {string} zipPath  Cesta k .zip souboru
   * @returns {{ ok: boolean, id?: string, error?: string }}
   */
  /**
   * Nainstaluje plugin ze ZIP souboru.
   * @param {string} zipPath  Cesta k .zip souboru
   * @returns {{ ok: boolean, id?: string, error?: string }}
   */
  async installFromZip(zipPath) {
    let AdmZip;
    try { AdmZip = require('adm-zip'); }
    catch (_) {
      return { ok: false, error: 'Missing dependency adm-zip. Run: npm install adm-zip' };
    }

    const tmp = path.join(this._pluginsDir, '_tmp_install');

    try {
      // ── 0. Open ZIP — guard against invalid input ──────────────────────────
      let zip;
      try {
        zip = new AdmZip(zipPath);
      } catch (err) {
        return { ok: false, error: `Failed to open ZIP file: ${err.message}` };
      }

      const entries = zip.getEntries();

      // DEBUG — log every entry so you can see exactly what adm-zip sees
      console.log(`[Exo-Plugins] ZIP entries (${entries.length} total):`);
      entries.forEach(e => console.log(`  [${e.isDirectory ? 'DIR ' : 'FILE'}] "${e.entryName}"`));

      if (entries.length === 0) {
        return { ok: false, error: 'ZIP file appears to be empty or could not be read.' };
      }

      // ── 1. Locate manifest.json at ANY depth — pick the shallowest one ──────
      //    Normalise backslashes → forward slashes, drop macOS junk entries.
      let manifestEntry = null;
      let manifestDepth = Infinity;

      for (const e of entries) {
        const name = e.entryName.replace(/\\/g, '/');

        // Skip macOS resource-fork directories
        if (name.toLowerCase().includes('__macosx')) continue;
        // Skip directory entries
        if (e.isDirectory) continue;

        // Check if this entry IS a manifest.json (at any nesting level)
        if (name === 'manifest.json' || name.endsWith('/manifest.json')) {
          const depth = name.split('/').length - 1; // 0 = root, 1 = one level, etc.
          if (depth < manifestDepth) {
            manifestEntry = e;
            manifestDepth = depth;
          }
        }
      }

      if (!manifestEntry) {
        // Give a useful error that lists what WAS found
        const fileList = entries
          .filter(e => !e.isDirectory)
          .map(e => e.entryName.replace(/\\/g, '/'))
          .slice(0, 10)
          .join(', ');
        return {
          ok: false,
          error: `ZIP does not contain manifest.json. Files found: ${fileList || '(none)'}`,
        };
      }

      console.log(`[Exo-Plugins] Found manifest at: "${manifestEntry.entryName}" (depth ${manifestDepth})`);

      // Prefix = everything before "manifest.json" in the normalised path
      const manifestPathNorm = manifestEntry.entryName.replace(/\\/g, '/');
      const prefix   = manifestPathNorm.slice(0, -'manifest.json'.length); // "" or "yt-enhancer/"
      const isNested = prefix.length > 0;

      // ── 2. Parse manifest from buffer — no disk write needed ────────────────
      let manifest;
      try {
        manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
      } catch (_) {
        return { ok: false, error: 'manifest.json is not valid JSON.' };
      }

      if (!manifest.id) {
        return { ok: false, error: 'manifest.json is missing the required "id" field.' };
      }
      if (!/^[a-z0-9-]+$/.test(manifest.id)) {
        return { ok: false, error: `Invalid plugin id "${manifest.id}". Use only lowercase letters, digits, and hyphens.` };
      }

      // ── 3. Extract files, stripping the wrapper prefix ──────────────────────
      const targetDir = path.join(this._pluginsDir, manifest.id);

      if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });

      let extractedCount = 0;

      for (const entry of entries) {
        if (entry.isDirectory) continue;

        let rel = entry.entryName.replace(/\\/g, '/');

        // Drop macOS junk
        if (rel.toLowerCase().includes('__macosx')) continue;

        // Strip wrapper prefix for nested ZIPs
        if (isNested) {
          if (!rel.startsWith(prefix)) continue; // different branch — skip
          rel = rel.substring(prefix.length);
        }

        if (!rel) continue; // was the wrapper folder node itself

        const destPath = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, entry.getData());
        extractedCount++;
      }

      console.log(`[Exo-Plugins] Extracted ${extractedCount} file(s) to tmp.`);

      if (extractedCount === 0) {
        throw new Error('No files were extracted from the ZIP (all entries were skipped).');
      }

      // ── 4. Atomic rename tmp → plugins/[id] ─────────────────────────────────
      if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
      fs.renameSync(tmp, targetDir);

      this._loadPlugin(targetDir);

      console.log(`[Exo-Plugins] Plugin "${manifest.id}" installed successfully.`);
      return { ok: true, id: manifest.id, name: manifest.name };

    } catch (err) {
      console.error('[Exo-Plugins] installFromZip error:', err);
      if (fs.existsSync(tmp)) {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
      }
      return { ok: false, error: err.message };
    }
  }

  /**
   * Odstraní plugin.
   * @param {string} pluginId
   */
  uninstall(pluginId) {
    const plugin = this._plugins.get(pluginId);
    if (!plugin) return { ok: false, error: 'Plugin nenalezen' };

    if (plugin.backgroundModule?.onUnload) {
      try { plugin.backgroundModule.onUnload(); } catch (_) {}
    }

    try {
      fs.rmSync(plugin.dir, { recursive: true, force: true });
    } catch (err) {
      return { ok: false, error: err.message };
    }

    this._plugins.delete(pluginId);
    this._disabled.delete(pluginId);
    this._saveDisabledList();
    return { ok: true };
  }

  // ── Enable / Disable ──────────────────────────────────────────────────────

  enable(pluginId) {
    this._disabled.delete(pluginId);
    this._saveDisabledList();
    return { ok: true };
  }

  disable(pluginId) {
    this._disabled.add(pluginId);
    this._saveDisabledList();
    return { ok: true };
  }

  isEnabled(pluginId) { return !this._disabled.has(pluginId); }

  // ── Přehled pluginů ───────────────────────────────────────────────────────

  listPlugins() {
    return Array.from(this._plugins.values()).map(p => ({
      id:          p.id,
      name:        p.name,
      version:     p.version,
      description: p.description,
      author:      p.author,
      homepage:    p.homepage,
      permissions: p.permissions,
      trusted:     p.trusted,
      enabled:     !this._disabled.has(p.id),
      hasToolbar:  !!p.toolbarIcon,
      toolbarIcon: p.toolbarIcon,
      toolbarTooltip: p.toolbarTooltip,
      hasSettings: !!p.settingsPage,
      matches:     p.matches,
    }));
  }

  // ── Plugin Manager URL ────────────────────────────────────────────────────

  get pluginsDir() { return this._pluginsDir; }
}

// ─── IPC Registrace ───────────────────────────────────────────────────────────

/**
 * Zaregistruje IPC handlery pro Plugin systém.
 * @param {PluginEngine} engine
 * @param {BrowserWindow} mainWindow
 */
function registerPluginIPC(engine, mainWindow) {

  // ── Seznam pluginů ────────────────────────────────────────────────────────
  ipcMain.handle('plugins-list', () => engine.listPlugins());

  // ── Reload pluginů ────────────────────────────────────────────────────────
  ipcMain.handle('plugins-reload', () => {
    engine.loadAll();
    return { ok: true, count: engine.listPlugins().length };
  });

  // ── Enable / Disable ──────────────────────────────────────────────────────
  ipcMain.handle('plugin-enable',  (_e, { id }) => engine.enable(id));
  ipcMain.handle('plugin-disable', (_e, { id }) => engine.disable(id));

  // ── Uninstall ─────────────────────────────────────────────────────────────
  ipcMain.handle('plugin-uninstall', (_e, { id }) => engine.uninstall(id));

  // ── Instalace ze ZIP ──────────────────────────────────────────────────────
  ipcMain.handle('plugin-install-zip', async (_e, { filePath }) => {
    const result = await engine.installFromZip(filePath);
    if (result.ok) {
      // Notifikuj renderer o novém pluginu
      mainWindow?.webContents.send('plugins-updated', engine.listPlugins());
    }
    return result;
  });

  // ── Otevřít složku pluginů v průzkumníku ─────────────────────────────────
  ipcMain.handle('plugins-open-dir', async () => {
    const { shell } = require('electron');
    await shell.openPath(engine.pluginsDir);
    return { ok: true };
  });

  // ── Toolbar akce pluginu ──────────────────────────────────────────────────
  ipcMain.handle('plugin-toolbar-action', async (_e, { id }) => {
    const plugins = engine.listPlugins();
    const plugin  = plugins.find(p => p.id === id);
    if (!plugin) return { error: 'Plugin nenalezen' };
    // Pošli zprávu do aktivního tabu
    mainWindow?.webContents.send('plugin-toolbar-triggered', { id });
    return { ok: true };
  });

  // ── Storage API (pro background scripty) ──────────────────────────────────
  ipcMain.handle('plugin-storage-get', (_e, { pluginId }) =>
    engine.getPluginStorage(pluginId));
  ipcMain.handle('plugin-storage-set', (_e, { pluginId, data }) => {
    engine.setPluginStorage(pluginId, data);
    return { ok: true };
  });

  console.log('[Exo-Plugins] Plugin Engine IPC zaregistrován.');
}

module.exports = { PluginEngine, registerPluginIPC };