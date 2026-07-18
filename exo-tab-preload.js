/**
 * exo-tab-preload.js — Exo Browser — Tab WebContentsView Preload
 *
 * This preload runs in every browser tab (WebContentsView) with:
 *   contextIsolation: true  — renderer JS cannot access this scope
 *   nodeIntegration: false  — renderer cannot require() Node modules
 *
 * It exposes a single narrow IPC channel: window.__exo_ipc_send_vault_save__
 * This is used by the injected autofill bridge to send vault-save-prompts
 * to the main process via reliable ipcRenderer.send, bypassing the fragile
 * executeJavaScript-poll mechanism which fails during page navigation.
 *
 * Security: only the 'vault-save-prompt' channel is exposed. The payload
 * is intentionally limited to { origin, username, password }.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__exo_tab__', {
  /**
   * Send a vault save-prompt directly to the main process via IPC.
   * Reliable even during page navigation / form POST redirect.
   * @param {string} origin
   * @param {string} username
   * @param {string} password
   */
  vaultSave: (origin, username, password) => {
    if (typeof origin !== 'string' || typeof username !== 'string' || typeof password !== 'string') return;
    ipcRenderer.send('vault-save-prompt-ipc', { origin, username, password });
  },
});
