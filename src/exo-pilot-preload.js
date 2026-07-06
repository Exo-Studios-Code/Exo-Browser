/**
 * exo-pilot-preload.js — Exo Browser — Exo-Pilot Window Preload
 *
 * Samostatný preload pro pilotní BrowserWindow.
 * Vystavuje POUZE minimální API potřebné pro pilot UI.
 *
 * Security model:
 *  • contextIsolation: true → renderer JS nemá přístup k tomuto scope
 *  • nodeIntegration: false → renderer nemůže require() Node moduly
 *  • Žádný ipcRenderer není nikdy přímo vystavený
 */

const { contextBridge, ipcRenderer } = require('electron');

// ─── Exposed API ──────────────────────────────────────────────────────────────

contextBridge.exposeInMainWorld('pilotAPI', {

  /**
   * Odešle příkaz uživatele na main process → AI handler → browser akce.
   *
   * @param {string} text  Přirozený jazyk příkaz od uživatele
   * @returns {Promise<{
   *   message:      string,
   *   action:       { type: string, query?: string, url?: string, direction?: string, amount?: number, selector?: string },
   *   actionResult: { ok?: boolean, error?: string }
   * }>}
   */
  sendCommand: (text) => ipcRenderer.invoke('exo-pilot-command', { text }),

  /**
   * Skryje pilot okno (window se nezničí, jen schová — je rychlejší znovu otevřít).
   */
  closeWindow: () => ipcRenderer.send('pilot-close'),

});
