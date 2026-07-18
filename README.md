# Ex0 Browser
<img width="1914" height="1029" alt="obrazek" src="https://github.com/user-attachments/assets/49325943-b0e5-4942-903b-b426c9d1c60e" />

## 🚀 What's New in v1.2.0: Native Password Vault & Pro Dark Reader

Exo-Browser takes a massive leap forward in daily usability, security, and aesthetics. We've replaced experimental features with rock-solid, production-grade systems!

* 🔐 **Native Password Vault & Autofill:** Built directly into the Chromium core using isolated IPC tunnels (`exo-tab-preload`). It intelligently detects login forms, displays a sleek overlay toast to save your credentials, and autofills them on your next visit—all encrypted locally with zero cloud exposure.
* 🌙 **True Dark Mode (Powered by Dark Reader):** Say goodbye to weird color inversions and midnight white-screen flashbangs! We integrated a professional Dark Reader engine that renders websites in deep, clean blacks instantly without breaking page layouts.
* 📦 **Modular Plugin Engine:** Continue building and installing custom extensions with drag & drop `.zip` installation and sandboxed API execution via the `window.exo` namespace.

> **Note for Builders:** The open-source **YouTube Enhancer** plugin and the new **v1.2.0 installer** are available right now on our Discord and GitHub Releases!

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

```
Exo-Browser/
├── main.js                  # Electron Main Process (backend, window & process management)
├── preload.js               # Security Context Bridge & main IPC renderer communication
├── exo-autofill.js          # DOM injection script for form detection & credential harvesting
├── exo-password-manager.js  # Core encryption vault & password storage backend
├── exo-tab-preload.js       # Isolated high-security IPC tunnel for WebContentsViews
├── package.json             # NPM dependencies, metadata, and electron-builder scripts
├── .gitignore               # Protection against pushing build binaries (.zip, .iss, /dist)
└── src/                     # Core frontend UI and functional modules
    ├── index.html           # Main browser window layout & UI skeleton
    ├── renderer.js          # Frontend interface logic (tab management, navigation)
    ├── styles.css           # Core stylesheet (Midnight Glass aesthetic)
    ├── exo-ai-agent.js      # Backend IPC communication for Gemini 2.5 Flash AI integration
    ├── exo-ai-sidebar.html  # UI layout for the interactive AI sidebar
    ├── exo-dark-reader.js   # Native high-performance Dark Reader engine integration
    ├── exo-downloads.js     # Download manager logic & AdBlock filter engine
    ├── exo-dl-overlay.html  # UI layer for download history & floating toasts
    ├── exo-newtab.html      # New Tab page design (home screen with custom graphics)
    ├── exo-pilot.js         # Backend logic for the Exo Pilot AI assistant
    ├── exo-pilot-preload.js # Isolated preload script for Exo Pilot
    ├── exo-pilot.html       # User interface for the Exo Pilot assistant
    ├── exo-plugin-engine.js # Backend core for .zip plugin installation & sandbox execution
    ├── exo-plugins.html     # UI for the Plugin Manager (marketplace & management)
    ├── exo-search.html      # UI for the quick Command Palette / search bar
    ├── exo-search.css       # Dedicated stylesheet for the search interface
    ├── exo-settings.html    # Browser configuration & settings UI
    ├── background.png       # Core background graphic for the application
    └── icon.ico / *.png     # Bundle of icons, favicons, and manifest assets for builds

```
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
