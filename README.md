# Ex0 Browser
<img width="1914" height="1029" alt="obrazek" src="https://github.com/user-attachments/assets/49325943-b0e5-4942-903b-b426c9d1c60e" />

> Moderní, minimalistický webový prohlížeč postavený na Electronu 29 + Chromiu.  
> Design: *Midnight Glass* — hluboká tma, irideskentní akcenty, přesnost.

---

## Rychlý start

```bash
# 1. Naklonovat / rozbalit projekt
cd Exo-browser

# 2. Nainstalovat závislosti (pouze Electron)
npm install

# 3. Spustit
npm start

# Pro vývoj s logy:
npm run dev
```

**Požadavky:** Node.js 18+, npm 9+  
**Electron:** 29.x (vyžaduje `WebContentsView` API)

---

## Struktura projektu

```
nyx-browser/
├── main.js          ← Hlavní proces: okno, správa tabů, IPC handlery
├── preload.js       ← Bezpečný bridge (contextBridge) mezi main ↔ renderer
├── package.json
├── .gitignore
└── src/
    ├── index.html   ← Toolbar shell (tab bar + nav bar)
    ├── styles.css   ← Celé UI — dark glass design
    └── renderer.js  ← Frontend logika, IPC eventy, rendering tabů
```

---

## Architektura

```
┌─────────────────────────────────────────────────────────┐
│  BrowserWindow (frameless)                              │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Tab Bar (52px)  — drag region + window controls  │  │
│  ├───────────────────────────────────────────────────┤  │
│  │  Nav Bar (44px)  — ← → ↺  │ 🔒 URL bar           │  │
│  ├───────────────────────────────────────────────────┤  │
│  │                                                   │  │
│  │   WebContentsView  (Tab 1 — aktivní)              │  │
│  │   WebContentsView  (Tab 2 — skrytý)               │  │
│  │   WebContentsView  (Tab N — skrytý)               │  │
│  │                                                   │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘

main.js  ←──IPC (ipcMain)──→  preload.js  ←──contextBridge──→  renderer.js
```

### Bezpečnostní model
| Vlastnost | Hodnota | Důvod |
|---|---|---|
| `contextIsolation` | `true` | Renderer nemá přístup k Node.js scope |
| `nodeIntegration` | `false` | Žádný `require()` v renderer procesu |
| `sandbox` | `true` | WebContentsView (tabu) jsou plně sandboxované |
| `contextBridge` | Ano | Jediný způsob komunikace renderer ↔ main |

---

## Klávesové zkratky

| Zkratka | Akce |
|---|---|
| `Ctrl+T` | Nový tab |
| `Ctrl+W` | Zavřít aktivní tab |
| `Ctrl+L` | Fokus URL baru |
| `Ctrl+R` / `F5` | Obnovit stránku |
| `Alt+←` | Zpět |
| `Alt+→` | Vpřed |
| Prostřední klik na tab | Zavřít tab |

---

## Rozšíření MVP (doporučené další kroky)

1. **Bookmarks** — `electron-store` pro persistenci záložek
2. **Sidebar** — Arc-style vertikální tab panel (`flexDirection: column`)
3. **Custom new-tab page** — lokální HTML s vyhledávačem a oblíbenými weby
4. **History** — SQLite via `better-sqlite3`
5. **DevTools** — `Ctrl+Shift+I` → `view.webContents.openDevTools()`
6. **Extensions** — Chromium extensions via `session.loadExtension()`
7. **Packaging** — `electron-builder` pro `.dmg` / `.exe` / `.AppImage`

---

## Licence

MIT
