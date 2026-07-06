/**
 * exo-downloads.js — Exo Browser — Download Manager UI
 *
 * Samostatný modul pro správu UI stahování s estetikou "Cyber-Deck".
 * Použití: <script src="exo-downloads.js"></script>
 *          initDownloadManager();
 *
 * Architektura:
 *  • DOM prvky vznikají až při prvním stahování (lazy creation)
 *  • Každé stahování = samostatná "karta" v panelu (multi-download)
 *  • Panel se skryje automaticky po dokončení všech stahování (s animací)
 *  • Přímá závislost pouze na window.browserAPI (context bridge)
 *
 * Kompatibilita: contextIsolation: true, nodeIntegration: false
 */

(function () {
  'use strict';

  // ─── Konfigurace ──────────────────────────────────────────────────────────
  const CFG = {
    /** Jak dlouho zůstane karta viditelná po dokončení (ms) */
    CARD_LINGER_MS:    4500,
    /** Délka CSS transition pro skrytí panelu (ms) */
    PANEL_EXIT_MS:      500,
    /** Maximální počet karet zobrazených najednou */
    MAX_VISIBLE:          6,
    /** Pozice panelu — 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' */
    POSITION:   'bottom-right',
  };

  // ─── CSS styly (vloženy jen jednou při inicializaci) ─────────────────────
  const STYLES = `
        :root {
            --exo-dl-bg: rgba(5, 8, 18, 0.92);
            --exo-dl-border: rgba(0,255,255,0.15);

            --exo-dl-text: #e6f7ff;
            --exo-dl-muted: rgba(160,200,255,0.55);

            --exo-dl-radius: 14px;
            --exo-dl-font: 'Share Tech Mono', monospace;
        }

        /* PANEL – natvrdo bottom-right */
        #exo-dl-panel {
            position: fixed;
            bottom: 18px;
            right: 20px;
            z-index: 2147483646;

            display: flex;
            flex-direction: column-reverse;
            align-items: flex-end;

            gap: 12px;
            padding: 14px;

            pointer-events: none;
            transition: all 0.35s ease;
        }

        #exo-dl-panel.exo-dl--hidden {
            opacity: 0;
            transform: translateY(25px);
        }

        /* CARD */
        .exo-dl-card {
            width: 360px;
            pointer-events: auto;

            background: var(--exo-dl-bg);
            border-radius: var(--exo-dl-radius);

            border: 1px solid var(--exo-dl-border);

            box-shadow:
                0 0 0 1px rgba(0,255,255,0.05),
                0 10px 40px rgba(0,0,0,0.9),
                0 0 25px rgba(0,255,255,0.08);

            padding: 14px;
            color: var(--exo-dl-text);
            font-family: var(--exo-dl-font);

            position: relative;
            overflow: hidden;

            animation: exo-enter .35s ease;
        }

        @keyframes exo-enter {
            from { opacity:0; transform: translateY(25px) scale(.95); }
            to   { opacity:1; transform: translateY(0) scale(1); }
        }

        /* RGB PULSE BORDER */
        .exo-dl-card::before {
            content:"";
            position:absolute;
            inset:-1px;
            border-radius: inherit;

            background: linear-gradient(
                120deg,
                #00ffff,
                #00ff9f,
                #00d0ff,
                #00ffff
            );

            background-size: 300% 300%;
            animation: rgbPulse 4s linear infinite;

            opacity: .25;
            filter: blur(6px);
            z-index: 0;
        }

        @keyframes rgbPulse {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
        }

        /* content layer above glow */
        .exo-dl-card > * {
            position: relative;
            z-index: 1;
        }

        /* HEADER */
        .exo-dl-header {
            display:flex;
            align-items:center;
            gap:10px;
        }

        .exo-dl-icon {
            width:30px;
            height:30px;
            border-radius:8px;

            display:flex;
            align-items:center;
            justify-content:center;

            background: rgba(0,255,255,0.05);
            border: 1px solid rgba(0,255,255,0.2);

            box-shadow: 0 0 10px rgba(0,255,255,0.4);
        }

        .exo-dl-icon svg {
            width:15px;
            height:15px;
            fill:#00ffff;
        }

        .exo-dl-meta {
            flex:1;
            min-width:0;
        }

        .exo-dl-filename {
            font-size:13px;
            white-space:nowrap;
            overflow:hidden;
            text-overflow:ellipsis;
        }

        .exo-dl-status {
            font-size:10px;
            color: var(--exo-dl-muted);
        }

        /* BUTTON */
        .exo-dl-cancel-btn {
            border:1px solid rgba(255,60,100,0.3);
            background:transparent;
            color:#ff5c7c;

            padding:4px 8px;
            border-radius:6px;
            font-size:10px;
            cursor:pointer;

            transition:.2s;
        }

        .exo-dl-cancel-btn:hover {
            background: rgba(255,60,100,0.2);
            box-shadow: 0 0 12px rgba(255,60,100,0.6);
        }

        /* BAR */
        .exo-dl-bar-wrap {
            margin-top:10px;
            height:5px;
            border-radius:6px;
            overflow:hidden;

            background: rgba(0,255,255,0.08);
        }

        .exo-dl-bar {
            height:100%;
            width:0%;
            position:relative;

            background: linear-gradient(90deg,#00ffff,#00ff9f);
            box-shadow: 0 0 15px rgba(0,255,255,0.9);

            transition: width .25s ease;
        }

        /* SCANLINE */
        .exo-dl-bar::after {
            content:"";
            position:absolute;
            inset:0;

            background:
                repeating-linear-gradient(
                    to bottom,
                    rgba(255,255,255,0.1) 0px,
                    rgba(255,255,255,0.1) 1px,
                    transparent 2px,
                    transparent 4px
                );

            animation: scanMove 1s linear infinite;
            opacity:.5;
        }

        @keyframes scanMove {
            from { transform: translateY(-100%); }
            to   { transform: translateY(100%); }
        }

        /* DETAILS */
        .exo-dl-details {
            display:flex;
            justify-content:space-between;
            font-size:10px;
            margin-top:6px;
            color: var(--exo-dl-muted);
        }

        .exo-dl-percent {
            color:#00ffff;
        }

        /* STATES */
        .exo-dl--done .exo-dl-bar {
            background: linear-gradient(90deg,#00ff8c,#a0ffcc);
        }

        .exo-dl--error .exo-dl-bar {
            background: linear-gradient(90deg,#ff3c64,#ff8ca0);
        }
    `;
  // ─── Utility funkce ───────────────────────────────────────────────────────

  /** Formátuje bajty na čitelný řetězec (B / KB / MB / GB) */
  function formatBytes(bytes) {
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  /** Formátuje rychlost stahování */
  function formatSpeed(bps) {
    if (bps <= 0) return '';
    return formatBytes(bps) + '/s';
  }

  // ─── SVG ikony (inline, bez závislostí) ──────────────────────────────────

  const ICON_DOWNLOAD = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 16L7 11h3V4h4v7h3l-5 5zM5 18h14v2H5v-2z"/>
    </svg>`;

  const ICON_DONE = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
    </svg>`;

  const ICON_ERROR = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
    </svg>`;

  // ─── DOM Management ───────────────────────────────────────────────────────

  let _panel = null;
  let _stylesInjected = false;

  /**
   * Vloží <style> tag jednou do <head>.
   */
  function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'exo-dl-styles';
    style.textContent = STYLES;
    (document.head || document.documentElement).appendChild(style);
  }

  /**
   * Vrátí nebo vytvoří hlavní panel (#exo-dl-panel).
   * Panel existuje v DOM, jen se zobrazuje/skrývá.
   */
  function getOrCreatePanel() {
    if (_panel) return _panel;

    _panel = document.createElement('div');
    _panel.id = 'exo-dl-panel';

    // Přiřaď CSS třídu pro pozici
    const posMap = {
      'bottom-right': 'exo-dl--br',
      'bottom-left':  'exo-dl--bl',
      'top-right':    'exo-dl--tr',
      'top-left':     'exo-dl--tl',
    };
    _panel.classList.add(posMap[CFG.POSITION] || 'exo-dl--br');
    _panel.classList.add('exo-dl--hidden'); // začíná skrytý

    document.body.appendChild(_panel);
    return _panel;
  }

  /**
   * Zobrazí panel (odstraní třídu hidden).
   */
  function showPanel() {
    const panel = getOrCreatePanel();
    // Zruš případný probíhající timer pro skrytí
    if (panel._hideTimer) {
      clearTimeout(panel._hideTimer);
      panel._hideTimer = null;
    }
    // Malý rAF delay zajistí, že prohlížeč stihne vykreslit před přidáním třídy
    requestAnimationFrame(() => {
      panel.classList.remove('exo-dl--hidden');
    });
  }

  /**
   * Skryje panel, pokud jsou všechny karty dokončeny.
   */
  function maybeHidePanel() {
    const panel = getOrCreatePanel();
    const cards = panel.querySelectorAll('.exo-dl-card:not(.exo-dl-card--exit)');
    if (cards.length > 0) return; // jsou ještě aktivní karty

    panel._hideTimer = setTimeout(() => {
      panel.classList.add('exo-dl--hidden');
    }, 300);
  }

  /**
   * Vytvoří DOM kartu pro jedno stahování a přidá ji do panelu.
   * @returns {{ card, barEl, statusEl, percentEl, speedEl, iconEl, cancelBtn }}
   */
  function createCard(downloadId, filename) {
    const card = document.createElement('div');
    card.className = 'exo-dl-card';
    card.dataset.downloadId = downloadId;

    card.innerHTML = `
      <div class="exo-dl-header">
        <div class="exo-dl-icon">
          ${ICON_DOWNLOAD}
        </div>

        <div class="exo-dl-meta">
          <div class="exo-dl-filename" title="${filename}">
            ${filename}
          </div>
          <div class="exo-dl-status">
            INITIALIZING...
          </div>
        </div>

        <button class="exo-dl-cancel-btn">
          STOP
        </button>
      </div>

      <div class="exo-dl-bar-wrap">
        <div class="exo-dl-bar exo-dl--indeterminate"></div>
      </div>

      <div class="exo-dl-details">
        <span class="exo-dl-speed"></span>
        <span class="exo-dl-percent">--%</span>
      </div>
    `;

    const panel = getOrCreatePanel();

    const allCards = panel.querySelectorAll('.exo-dl-card');
    if (allCards.length >= CFG.MAX_VISIBLE) {
      allCards[0]?.remove();
    }

    panel.appendChild(card);

    return {
      card,
      barEl: card.querySelector('.exo-dl-bar'),
      statusEl: card.querySelector('.exo-dl-status'),
      percentEl: card.querySelector('.exo-dl-percent'),
      speedEl: card.querySelector('.exo-dl-speed'),
      iconEl: card.querySelector('.exo-dl-icon'),
      cancelBtn: card.querySelector('.exo-dl-cancel-btn'),
    };
  }

  /**
   * Plynule odstraní kartu z panelu po animaci.
   */
  function dismissCard(card, delay = 0) {
    setTimeout(() => {
      card.classList.add('exo-dl-card--exit');
      card.addEventListener('animationend', () => {
        card.remove();
        maybeHidePanel();
      }, { once: true });
      // Záloha pro případ, že animationend nepřijde
      setTimeout(() => { card.remove(); maybeHidePanel(); }, 600);
    }, delay);
  }

  // ─── Hlavní logika Download Manageru ─────────────────────────────────────

  /** downloadId → { card, barEl, statusEl, percentEl, speedEl, cancelBtn } */
  const _activeCards = new Map();

  /**
   * Inicializuje download manager.
   * Naslouchá eventům z window.browserAPI (context bridge).
   * Bezpečné volat opakovaně — druhé volání je no-op.
   */
  function initDownloadManager() {
    // Guard: inicializuj jen jednou
    if (initDownloadManager._initialized) return;
    initDownloadManager._initialized = true;

    // Ověř přítomnost context bridge
    if (!window.browserAPI) {
      console.warn('[ExoDownloads] window.browserAPI není k dispozici. '
        + 'Ujisti se, že preload.js exponuje browserAPI přes contextBridge.');
      return;
    }

    injectStyles();

    // ── Stahování začalo ──────────────────────────────────────────────────
    window.browserAPI.onDownloadStarted(({ downloadId, filename, totalBytes }) => {
      showPanel();

      const els = createCard(downloadId, filename);
      _activeCards.set(downloadId, els);

      // Nastav cancel button
      els.cancelBtn.addEventListener('click', () => {
        window.browserAPI.cancelDownload(downloadId);
        // Okamžitá vizuální zpětná vazba
        els.cancelBtn.textContent = '…';
        els.cancelBtn.disabled = true;
      });

      // Pokud známe velikost hned od začátku, zruš indeterminate
      if (totalBytes > 0) {
        els.barEl.classList.remove('exo-dl--indeterminate');
        els.statusEl.textContent = 'STAHOVÁNÍ · ' + formatBytes(totalBytes);
      } else {
        els.statusEl.textContent = 'STAHOVÁNÍ…';
      }
    });

    // ── Průběh stahování ──────────────────────────────────────────────────
    window.browserAPI.onDownloadProgress(({ downloadId, receivedBytes, totalBytes, percent, speedBps }) => {
      const els = _activeCards.get(downloadId);
      if (!els) return;

      const { barEl, statusEl, percentEl, speedEl } = els;

      if (percent >= 0) {
        // Známá velikost
        barEl.classList.remove('exo-dl--indeterminate');
        barEl.style.width = percent + '%';
        percentEl.textContent = percent + '%';
        statusEl.textContent = formatBytes(receivedBytes) + ' / ' + formatBytes(totalBytes);
      } else {
        // Neznámá velikost — indeterminate
        barEl.classList.add('exo-dl--indeterminate');
        percentEl.textContent = formatBytes(receivedBytes);
        statusEl.textContent = 'STAHOVÁNÍ…';
      }

      speedEl.textContent = formatSpeed(speedBps);
    });

    // ── Stahování dokončeno / přerušeno ───────────────────────────────────
    window.browserAPI.onDownloadDone(({ downloadId, state, filename, totalBytes }) => {
      const els = _activeCards.get(downloadId);
      if (!els) return;

      const { card, barEl, statusEl, percentEl, speedEl, iconEl, cancelBtn } = els;

      // Skryj cancel button
      cancelBtn.classList.add('exo-dl--hidden');
      speedEl.textContent = '';

      if (state === 'completed') {
        card.classList.add('exo-dl--done');
        iconEl.innerHTML = ICON_DONE;
        statusEl.textContent = 'DOKONČENO';
        percentEl.textContent = totalBytes > 0 ? formatBytes(totalBytes) : '✓';
      } else if (state === 'cancelled') {
        card.classList.add('exo-dl--error');
        iconEl.innerHTML = ICON_ERROR;
        statusEl.textContent = 'ZRUŠENO';
        percentEl.textContent = '–';
      } else {
        // interrupted
        card.classList.add('exo-dl--error');
        iconEl.innerHTML = ICON_ERROR;
        statusEl.textContent = 'PŘERUŠENO';
        percentEl.textContent = '!';
      }

      _activeCards.delete(downloadId);

      // Kartu ponecháme viditelnou po CFG.CARD_LINGER_MS, pak ji skryjeme
      dismissCard(card, CFG.CARD_LINGER_MS);
    });

    console.log('[ExoDownloads] Download Manager inicializován.');

    // ── Mouse passthrough pro overlay okno ───────────────────────────────────
    // Overlay defaultně ignoruje klikání (setIgnoreMouseEvents true).
    // Při každém pohybu myši zjistíme, jestli je kurzor nad kartou.
    // Pokud ano, předáme main procesu signál aby přijímal klikání.
    // Tak cancel button funguje, ale průhledná plocha proklikává na tab.
    if (window.browserAPI?.setOverlayClickable) {
      document.addEventListener('mousemove', (e) => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const overCard = !!(el && el.closest('.exo-dl-card'));
        window.browserAPI.setOverlayClickable(overCard);
      }, { passive: true });

      // Kurzor opustil okno → vrať passthrough
      document.addEventListener('mouseleave', () => {
        window.browserAPI.setOverlayClickable(false);
      }, { passive: true });
    }
  }

  // ─── Export ───────────────────────────────────────────────────────────────
  // Exponujeme přes window, aby bylo možné volat z jakéhokoli inline scriptu.
  window.initDownloadManager = initDownloadManager;

})();
