/**
 * exo-password-manager.js — Exo Browser — Password Manager & Vault
 *
 * Architecture:
 *  • Uses electron.safeStorage to AES-encrypt passwords via the OS keychain
 *    (DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux).
 *  • Falls back to base64 obfuscation when safeStorage is unavailable, with
 *    a prominent warning so the user knows the vault is not fully hardened.
 *  • Persists records in a JSON flat-file database at userData/exo-vault.json.
 *    (better-sqlite3 is not currently a project dependency, so we mirror the
 *    existing exo-ai-agent.js pattern of a JSON store. Swap to SQLite trivially
 *    by replacing _load / _save with better-sqlite3 calls if you add the dep.)
 *
 * IPC channels exposed to the renderer via preload.js:
 *  handle  'passwords-save'           { origin, username, password }  → { ok, error? }
 *  handle  'passwords-get-by-domain'  { origin }                      → Credential[]
 *  handle  'passwords-get-all'        ()                              → Credential[]
 *  handle  'passwords-delete'         { id }                          → { ok }
 *  handle  'passwords-reveal'         { id }                          → { password?, error? }
 *
 * Credential shape:
 *  { id: string, origin: string, username: string,
 *    encryptedPassword: string, encMethod: 'safeStorage'|'b64',
 *    dateCreated: number }
 */

'use strict';

const fs            = require('fs');
const path          = require('path');
const crypto        = require('crypto');
const { safeStorage, ipcMain } = require('electron');

// ─── Vault store ──────────────────────────────────────────────────────────────

class PasswordVault {
  /**
   * @param {string} userDataPath  app.getPath('userData')
   */
  constructor(userDataPath) {
    this._file  = path.join(userDataPath, 'exo-vault.json');
    /** @type {Record<string, import('./exo-password-manager').Credential>} */
    this._store = {};
    this._load();
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  _load() {
    try {
      if (fs.existsSync(this._file)) {
        const raw = fs.readFileSync(this._file, 'utf8');
        this._store = JSON.parse(raw);
      }
    } catch (err) {
      console.error('[Exo-Vault] Chyba při načítání vaultu:', err.message);
      this._store = {};
    }
  }

  _save() {
    try {
      fs.writeFileSync(this._file, JSON.stringify(this._store, null, 2), 'utf8');
    } catch (err) {
      console.error('[Exo-Vault] Chyba při ukládání vaultu:', err.message);
    }
  }

  // ── Encryption helpers ───────────────────────────────────────────────────────

  /**
   * Encrypt a plaintext password using safeStorage when available,
   * falling back to base64 (obfuscation-only) with a visible warning.
   * @param {string} plaintext
   * @returns {{ data: string, method: 'safeStorage'|'b64' }}
   */
  _encrypt(plaintext) {
    if (safeStorage.isEncryptionAvailable()) {
      const buf = safeStorage.encryptString(plaintext);
      return { data: buf.toString('base64'), method: 'safeStorage' };
    }
    // Fallback — logs a warning so developers are aware
    console.warn(
      '[Exo-Vault] ⚠ safeStorage není dostupný! ' +
      'Heslo ukládáno jako base64 (NENÍ šifrováno). ' +
      'Zkontrolujte, zda běží Electron s klíčenkou OS.'
    );
    return { data: Buffer.from(plaintext, 'utf8').toString('base64'), method: 'b64' };
  }

  /**
   * Decrypt a stored credential entry back to plaintext.
   * @param {{ data: string, method: 'safeStorage'|'b64' }} entry
   * @returns {string}
   */
  _decrypt(entry) {
    if (entry.method === 'safeStorage') {
      return safeStorage.decryptString(Buffer.from(entry.data, 'base64'));
    }
    // b64 fallback
    return Buffer.from(entry.data, 'base64').toString('utf8');
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  /**
   * Save (upsert) a credential. If an entry for the same origin+username
   * already exists it is overwritten so the password stays current.
   * @param {string} origin     e.g. "https://github.com"
   * @param {string} username
   * @param {string} password
   * @returns {{ ok: boolean, id: string }}
   */
  save(origin, username, password) {
    // Normalise origin to scheme+host only (strip path/query/hash)
    const normOrigin = _normaliseOrigin(origin);

    // Check for an existing entry with the same origin+username to upsert
    const existing = Object.values(this._store).find(
      c => c.origin === normOrigin && c.username === username
    );

    const id = existing?.id ?? _genId();
    const enc = this._encrypt(password);

    this._store[id] = {
      id,
      origin:            normOrigin,
      username,
      encryptedPassword: enc.data,
      encMethod:         enc.method,
      dateCreated:       existing?.dateCreated ?? Date.now(),
      dateUpdated:       Date.now(),
    };

    this._save();
    return { ok: true, id };
  }

  /**
   * Return all credentials whose origin matches (scheme+host).
   * @param {string} origin
   * @returns {SafeCredential[]}
   */
  getByDomain(origin) {
    const normOrigin = _normaliseOrigin(origin);
    return Object.values(this._store)
      .filter(c => c.origin === normOrigin)
      .map(_stripPassword);
  }

  /**
   * Return all credentials (passwords redacted).
   * @returns {SafeCredential[]}
   */
  getAll() {
    return Object.values(this._store)
      .sort((a, b) => b.dateCreated - a.dateCreated)
      .map(_stripPassword);
  }

  /**
   * Decrypt and return the plaintext password for a single entry.
   * Called only by the "Show Password" action in the Vault UI.
   * @param {string} id
   * @returns {{ password: string }|{ error: string }}
   */
  reveal(id) {
    const entry = this._store[id];
    if (!entry) return { error: 'Záznam nenalezen.' };
    try {
      return { password: this._decrypt({ data: entry.encryptedPassword, method: entry.encMethod }) };
    } catch (err) {
      return { error: `Dešifrování selhalo: ${err.message}` };
    }
  }

  /**
   * Delete a credential by id.
   * @param {string} id
   * @returns {{ ok: boolean }}
   */
  delete(id) {
    if (!this._store[id]) return { ok: false };
    delete this._store[id];
    this._save();
    return { ok: true };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalise any URL to its origin (scheme + host + optional port). */
function _normaliseOrigin(raw) {
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return u.origin; // "https://github.com"
  } catch {
    return raw.toLowerCase().trim();
  }
}

/** Strip the encrypted password before sending to renderer. */
function _stripPassword(c) {
  const { encryptedPassword, encMethod, ...safe } = c; // eslint-disable-line no-unused-vars
  return safe;
}

/** Generate a random 16-char hex id. */
function _genId() {
  return crypto.randomBytes(8).toString('hex');
}

// ─── IPC registration ─────────────────────────────────────────────────────────

/** @type {PasswordVault|null} */
let vault = null;

/**
 * Register all password-manager IPC handlers.
 * Call this once from main.js inside app.whenReady().
 *
 * @param {Electron.IpcMain} ipc      the ipcMain instance
 * @param {string}           userDataPath  app.getPath('userData')
 */
function registerPasswordIPC(ipc, userDataPath) {
  vault = new PasswordVault(userDataPath);

  // ── Save credential ──────────────────────────────────────────────────────────
  ipc.handle('passwords-save', (_e, { origin, username, password }) => {
    try {
      if (!origin || !username || !password) {
        return { ok: false, error: 'Chybí origin, username nebo password.' };
      }
      return vault.save(origin, username, password);
    } catch (err) {
      console.error('[Exo-Vault] passwords-save error:', err);
      return { ok: false, error: err.message };
    }
  });

  // ── Get by domain ────────────────────────────────────────────────────────────
  ipc.handle('passwords-get-by-domain', (_e, { origin }) => {
    try {
      if (!origin) return [];
      return vault.getByDomain(origin);
    } catch (err) {
      console.error('[Exo-Vault] passwords-get-by-domain error:', err);
      return [];
    }
  });

  // ── Get all ──────────────────────────────────────────────────────────────────
  ipc.handle('passwords-get-all', () => {
    try {
      return vault.getAll();
    } catch (err) {
      console.error('[Exo-Vault] passwords-get-all error:', err);
      return [];
    }
  });

  // ── Delete ───────────────────────────────────────────────────────────────────
  ipc.handle('passwords-delete', (_e, { id }) => {
    try {
      return vault.delete(id);
    } catch (err) {
      console.error('[Exo-Vault] passwords-delete error:', err);
      return { ok: false };
    }
  });

  // ── Reveal plaintext (Show Password) ─────────────────────────────────────────
  ipc.handle('passwords-reveal', (_e, { id }) => {
    try {
      return vault.reveal(id);
    } catch (err) {
      console.error('[Exo-Vault] passwords-reveal error:', err);
      return { error: err.message };
    }
  });

  console.log('[Exo-Vault] ✅ Password Manager inicializován. Vault:', vault._file);
}

module.exports = {
  registerPasswordIPC,
  // Exposes the live singleton so handleVaultMessage in main.js can access
  // the vault directly without re-registering IPC round-trips.
  get _vault() { return vault; },
};
