# Ex0 Browser
<img width="1914" height="1029" alt="obrazek" src="https://github.com/user-attachments/assets/49325943-b0e5-4942-903b-b426c9d1c60e" />

## 🚀 What's New in v1.1.0: Modular Plugin Engine

Exo-Browser is no longer just a browser; it's a fully extensible platform. We've just shipped a brand-new custom Plugin Architecture!

* 📦 **Drag & Drop Installation:** Installing a plugin is as easy as dragging a `.zip` file into the Plugin Manager. No manual folder digging required.
* 🛡️ **Secure Execution:** Content scripts are cleanly injected and sandboxed, while allowing powerful API access via the `window.exo` namespace.
* 🛠️ **Developer Friendly:** Want to build your own Spotify widget, Crypto tracker, or custom UI tweak? Check out the built-in Developer Guide inside the browser.

> **Note for Builders:** The first official open-source plugin, **YouTube Enhancer** (AdBlock + timestamp memory), is already available on our Discord!

# Exo-Browser 🚀
Developed by **Ex0 Studios**

Exo-Browser is a modern, minimal web browser built on top of Electron and Chromium. 

> **Design Aesthetic:** *Midnight Glass* — deep blacks, iridescent accents, and absolute precision.

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



## 📂 Project Structure

```text
Exo-Browser/
├── main.js                  # Electron Main Process (backend, správa oken a procesů)
├── preload.js               # Bezpečnostní můstek (Context Bridge) a IPC komunikace
├── package.json             # NPM závislosti, metadata a build skripty
├── .gitignore               # Zabezpečení proti pushování nepotřebných dat (.zip, .iss)
└── src/                     # Hlavní složka s frontendem a logikou funkcí
    ├── index.html           # Hlavní okno prohlížeče (UI kostra)
    ├── renderer.js          # Logika frontendového rozhraní (správa tabů, navigace)
    ├── styles.css           # Hlavní kaskádové styly prohlížeče
    ├── exo-ai-agent.js      # Backend komunikace pro integraci modelu Gemini 2.5 Flash
    ├── exo-ai-sidebar.html  # Uživatelské rozhraní pro AI postranní panel
    ├── exo-downloads.js     # Logika pro stahování a blokování reklam (AdBlock)
    ├── exo-dl-overlay.html  # UI vrstva pro historii stahování
    ├── exo-newtab.html      # Design Nové karty (domovská obrazovka s grafikou)
    ├── exo-pilot.js         # Backend logika pro asistenta Exo Pilot
    ├── exo-pilot-preload.js # Izolovaný preload script pro Exo Pilota
    ├── exo-pilot.html       # Uživatelské rozhraní pro Exo Pilota
    ├── exo-plugin-engine.js # Backend jádro pro instalaci a správu .zip pluginů
    ├── exo-plugins.html     # UI Plugin Manageru (tržnice a správa rozšíření)
    ├── exo-search.html      # UI pro rychlé vyhledávání (Command Palette)
    ├── exo-search.css       # Styly vyhrazené pro vyhledávací rozhraní
    ├── exo-settings.html    # Uživatelské rozhraní nastavení prohlížeče
    ├── background.png       # Hlavní grafika na pozadí aplikace
    └── icon.ico / *.png     # Balík ikon, favicon a manifestů pro build

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
<img width="1908" height="1027" alt="obrazek" src="https://github.com/user-attachments/assets/9fc73b0d-b175-4190-b712-944b81025f35" />
