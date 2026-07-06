# Ex0 Browser
<img width="1914" height="1029" alt="obrazek" src="https://github.com/user-attachments/assets/49325943-b0e5-4942-903b-b426c9d1c60e" />
Ono to není v čistém HTML kódu, ale v takzvaném **Markdownu** (který GitHub používá pro formátování textů a tabulek).

Tady máš celý ten text připravený v jednom přehledném bloku. Stačí kliknout na tlačítko **Copy** (Kopírovat) v rohu tabulky a vložit to celé rovnou do tvého editoru na GitHubu:

```markdown
# Exo-Browser 🚀
Developed by **Ex0 Studios**

Exo-Browser is a modern, minimal web browser built on top of Electron and Chromium. 

> **Design Aesthetic:** *Midnight Glass* — deep blacks, iridescent accents, and absolute precision.

<!-- Drop your screenshot here (Ctrl+V) to display a preview! -->

---

## Quick Start

```bash
# 1. Clone / extract the project and navigate into the directory
cd Exo-Browser

# 2. Install dependencies
npm install

# 3. Launch the application
npm start

# For development with full logging enabled:
npm run dev

```

**Requirements:** Node.js 18+, npm 9+

**Core Framework:** Electron (utilizes the modern `WebContentsView` API)

---

## Project Structure

```
Exo-Browser/
├── main.js          Custom new-tab page — lokální HTML s vyhledávačem a oblíbenými weby
├── preload.js       History — SQLite via better-sqlite3
├── package.json
├── .gitignore
└── src/
    ├── index.html   DevTools — Ctrl+Shift+I → view.webContents.openDevTools()
    ├── styles.css   Extensions — Chromium extensions via session.loadExtension()
    └── renderer.js  Packaging — electron-builder pro .dmg / .exe / .AppImage

```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  BrowserWindow (frameless)                              │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Tab Bar (52px)  — drag region + window controls  │  │
│  ├───────────────────────────────────────────────────┤  │
│  │  Nav Bar (44px)  — ← → ↺  │ 🔒 URL bar           │  │
│  ├───────────────────────────────────────────────────┤  │
│  │                                                   │  │
│  │   WebContentsView  (Tab 1 — Active)               │  │
│  │   WebContentsView  (Tab 2 — Hidden)               │  │
│  │   WebContentsView  (Tab N — Hidden)               │  │
│  │                                                   │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘

main.js  ←──IPC (ipcMain)──→  preload.js  ←──contextBridge──→  renderer.js

```

### Security Model

| Feature | Value | Purpose |
| --- | --- | --- |
| `contextIsolation` | `true` | Renderer process has no access to Node.js scope |
| `nodeIntegration` | `false` | Disables `require()` inside the renderer process |
| `sandbox` | `true` | `WebContentsView` tabs are fully sandboxed |
| `contextBridge` | `true` | The only secure method for renderer ↔ main communication |

---

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl + T` | Open new tab |
| `Ctrl + W` | Close active tab |
| `Ctrl + L` | Focus URL bar |
| `Ctrl + R` / `F5` | Reload page |
| `Alt + ←` | Go back |
| `Alt + →` | Go forward |
| `Middle Click` | Close clicked tab |

---

## Core Features & Extensions

* **Gemini AI Agent:** Built-in active sidebar capable of analyzing, summarizing, and explaining content from your active tabs in real-time.
* **Discord Rich Presence:** Automated RPC client integration to share your active browsing status on Discord.
* **Production Packaging:** Fully configured deployment system using `electron-builder` and `Inno Setup`.

---

## 💬 Community & Downloads

Get the official compiled builds or join our dev team:

📦 **[Download Latest Installer (.exe)](https://github.com/Exo-Studios-Code/Exo-Browser/releases/tag/v1.0.0)**

👉 **[Join the Official Ex0 Studios Discord Server](https://discord.gg/b5B9tzHNEv)**

---

## License

This project is licensed under the **MIT License** by **Ex0 Studios**. See the full `LICENSE.txt` for details.

```

```
