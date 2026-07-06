/**
 * exo-mirror.js — Exo Browser Neural Mirror
 * Kompletní opravená verze (Cyber-Deck vizuál, Enter capture, oprava zablokované myši)
 */
(function () {
  'use strict';

  // ── Ochrana před dvojitou injekcí ──────────────────────────────────────────
  if (window.__exoMirrorActive) {
    if (typeof window.__exoMirrorDestroy === 'function') window.__exoMirrorDestroy();
    return null;
  }
  window.__exoMirrorActive = true;

  // ── Stav ───────────────────────────────────────────────────────────────────
  let hoveredEl   = null;
  let extractedItems = [];
  let format      = 'json';
  let idCounter   = 0;
  let resolvePromise = null;

  // ── CSS: Cyber-Deck vizuál ─────────────────────────────────────────────────
  const STYLE = `
    /* ── ROOT (FIX: navrácení counter-invertu kvůli hlavnímu prohlížeči) ── */
    #__xm_root__ {
      position: fixed;
      inset: 0;
      z-index: 2147483645;
      pointer-events: none;
      background: transparent;
      filter: invert(1) hue-rotate(180deg) !important; 
    }

    #__xm_root__ * {
      box-sizing: border-box;
      font-family: 'JetBrains Mono', 'Share Tech Mono', monospace;
    }

    /* ── DIM OVERLAY (Bez bluru, aby to neblokovalo myš v Electronu) ── */
    #__xm_dim__ {
      position: fixed;
      inset: 0;
      background: rgba(5, 5, 10, 0.75);
      pointer-events: none;
    }

    /* ── HUD BANNER (HORNÍ LIŠTA) ────────────────────────────────────────── */
    #__xm_hud__ {
      position: fixed; top: 0; left: 0; right: 0; height: 40px; display: flex; align-items: center; gap: 10px; padding: 0 18px; background: rgba(4, 4, 18, 0.85); border-bottom: 1px solid rgba(167,139,250,.25); pointer-events: none; z-index: 2147483647; animation: __xm_slide_down__ .3s cubic-bezier(0.16,1,.3,1) forwards;
    }
    #__xm_hud_dot__ {
      width: 7px; height: 7px; border-radius: 50%; background: #a78bfa; box-shadow: 0 0 8px #a78bfa, 0 0 16px rgba(167,139,250,.5); animation: __xm_pulse__ 1.4s ease-in-out infinite;
    }
    #__xm_hud_label__ {
      font-size: 10px; letter-spacing: .2em; font-weight: 700; background: linear-gradient(90deg,#a78bfa,#38bdf8,#f472b6); -webkit-background-clip: text; background-clip: text; color: transparent;
    }
    #__xm_hud_hint__ {
      font-size: 10px; letter-spacing: .08em; color: rgba(148,163,184,.65); margin-left: auto;
    }
    #__xm_hud_count__ {
      font-size: 10px; letter-spacing: .1em; color: #38bdf8; font-weight: 700;
    }

    /* ── PANEL (CYBER-DECK CORE) ─────────────────────────────────────────── */
    #__xm_panel__ {
      position: fixed; bottom: 20px; right: 20px; width: 380px; max-height: 70vh; background: rgba(10, 10, 25, 0.96); border-radius: 14px; display: flex; flex-direction: column; pointer-events: all; z-index: 2147483647; animation: __xm_panel_in__ .25s ease-out; border: 1px solid transparent;
    }
    #__xm_panel__::before {
      content: ""; position: absolute; inset: -1px; border-radius: 14px; background: linear-gradient(120deg, #00e0ff, #7c3aed, #ff00cc, #00e0ff); background-size: 300% 300%; animation: __xm_rgb_flow__ 6s linear infinite; z-index: -1; opacity: 0.4; filter: blur(4px);
    }
    #__xm_panel__ > * {
      position: relative; z-index: 1;
    }

    /* ── HEADER PANLELU ──────────────────────────────────────────────────── */
    #__xm_panel_header__ {
      display: flex; align-items: center; padding: 12px 14px; border-bottom: 1px solid rgba(120, 80, 255, 0.2); background: linear-gradient(90deg, rgba(120,80,255,0.08), rgba(0,150,255,0.08));
    }
    #__xm_panel_title__ {
      font-size: 11px; letter-spacing: 0.15em; font-weight: 700; color: #8ab4ff; animation: __xm_text_glow__ 2.5s ease-in-out infinite;
    }
    #__xm_panel_items_count__ {
      margin-left: auto; font-size: 10px; color: #00e0ff; animation: __xm_text_glow__ 3s ease-in-out infinite;
    }
    #__xm_close_btn__ {
      margin-left: 10px; cursor: pointer; color: #ff6b6b; font-size: 12px; opacity: 0.8;
    }
    #__xm_close_btn__:hover {
      opacity: 1; text-shadow: 0 0 6px #ff6b6b;
    }

    /* ── ITEMS LIST & EMPTY STATE ────────────────────────────────────────── */
    #__xm_empty__ { padding: 20px; text-align: center; font-size: 11px; color: #7f8fa6; }
    #__xm_items_list__ { overflow-y: auto; flex: 1 1 0; min-height: 0; padding: 6px 8px; }
    #__xm_items_list__::-webkit-scrollbar { width: 3px; }
    #__xm_items_list__::-webkit-scrollbar-track { background: transparent; }
    #__xm_items_list__::-webkit-scrollbar-thumb { background: rgba(167,139,250,.3); border-radius: 2px; }
    .xm_item_card { margin-bottom: 6px; border-radius: 8px; overflow: hidden; border: 1px solid rgba(167,139,250,.12); background: rgba(167,139,250,.04); transition: border-color .15s ease; }
    .xm_item_card_header { display: flex; align-items: center; gap: 6px; padding: 7px 10px 6px; border-bottom: 1px solid rgba(167,139,250,.08); }
    .xm_item_idx { font-size: 9px; font-weight: 700; color: #a78bfa; background: rgba(167,139,250,.12); border-radius: 4px; padding: 1px 5px; letter-spacing: .06em; }
    .xm_item_tag { font-size: 9px; letter-spacing: .12em; color: #00e0ff; text-transform: uppercase; }
    .xm_item_selector { font-size: 8.5px; color: #6b7280; margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; }
    .xm_item_remove { font-size: 10px; color: rgba(248,113,113,.5); cursor: pointer; padding: 0 2px; line-height: 1; transition: color .1s ease; }
    .xm_item_remove:hover { color: #f87171; }
    .xm_item_preview { padding: 7px 10px 8px; font-size: 10px; line-height: 1.55; color: #e6f1ff; max-height: 80px; overflow: hidden; position: relative; }
    .xm_item_preview::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 18px; background: linear-gradient(transparent, rgba(10,10,25,.96)); }

    /* ── ACTION BAR & BUTTONS ────────────────────────────────────────────── */
    #__xm_action_bar__ { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-top: 1px solid rgba(167,139,250,.1); flex-shrink: 0; }
    .xm_fmt_btn { font-size: 10px; padding: 5px 10px; border-radius: 6px; background: transparent; border: 1px solid rgba(120, 80, 255, 0.3); color: #9ca3af; cursor: pointer; }
    .xm_fmt_btn.active { color: #00e0ff; border-color: #00e0ff; box-shadow: 0 0 8px rgba(0, 224, 255, 0.4); }
    #__xm_save_btn__ { margin-left: auto; background: rgba(120, 80, 255, 0.15); border: 1px solid rgba(120, 80, 255, 0.6); color: #c4b5fd; font-size: 10px; padding: 6px 12px; border-radius: 8px; cursor: pointer; }
    #__xm_save_btn__:hover:not(:disabled) { box-shadow: 0 0 12px rgba(120, 80, 255, 0.6); }
    #__xm_save_btn__:disabled { opacity: 0.35; cursor: default; }

    /* ── FIX: HOVER & SELECTED (BEZ BÍLÉHO FLASHE) ───────────────────────── */
    .__xm_hover__ {
      outline: 2px solid #00e0ff !important; outline-offset: -2px !important; box-shadow: inset 0 0 30px rgba(0, 224, 255, 0.3) !important; cursor: crosshair !important; background: transparent !important; color: inherit !important;
    }
    .__xm_selected__ {
      outline: 2px solid #a855f7 !important; outline-offset: -2px !important; box-shadow: inset 0 0 30px rgba(168, 85, 247, 0.3) !important; background: transparent !important; color: inherit !important;
    }

    /* ── BADGE (Číslo u výběru) ──────────────────────────────────────────── */
    .__xm_badge__ {
      position: fixed !important; font-size: 9px !important; font-weight: 700 !important; line-height: 1 !important; letter-spacing: .05em !important; padding: 2px 5px !important; border-radius: 4px !important; background: rgba(167,139,250,.9) !important; color: #08080f !important; pointer-events: none !important; z-index: 2147483646 !important;
    }

    /* ── ANIMACE ─────────────────────────────────────────────────────────── */
    @keyframes __xm_panel_in__ { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    @keyframes __xm_rgb_flow__ { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
    @keyframes __xm_text_glow__ { 0%, 100% { text-shadow: 0 0 4px rgba(0,224,255,0.4); } 50% { text-shadow: 0 0 10px rgba(168,85,247,0.8); } }
    @keyframes __xm_slide_down__ { from{transform:translateY(-100%);opacity:0} to{transform:translateY(0);opacity:1} }
    @keyframes __xm_pulse__ { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(.8)} }
  `;

  // ── DOM helper ─────────────────────────────────────────────────────────────
  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'style') e.style.cssText = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
      else e.setAttribute(k, v);
    }
    children.forEach(c => c && e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return e;
  }

  // ── Css selektor generátor ─────────────────────────────────────────────────
  function getSelector(node) {
    try {
      if (node.id) return `#${node.id}`;
      const tag  = node.tagName.toLowerCase();
      const idx  = Array.from(node.parentNode?.children || []).indexOf(node) + 1;
      const cls  = node.className && typeof node.className === 'string'
        ? '.' + node.className.trim().split(/\s+/).slice(0,2).join('.') : '';
      return `${tag}${cls}:nth-child(${idx})`;
    } catch (_) { return node.tagName?.toLowerCase() || 'element'; }
  }

  // ── Extrakce dat z elementu ────────────────────────────────────────────────
  function extractElement(node) {
    const tag = node.tagName.toLowerCase();

    if (tag === 'table' || node.querySelector('table')) {
      const tbl = tag === 'table' ? node : node.querySelector('table');
      const rows = [];
      for (const tr of tbl.querySelectorAll('tr')) {
        const cells = Array.from(tr.querySelectorAll('th,td')).map(c => c.innerText.trim());
        if (cells.length) rows.push(cells);
      }
      return { type: 'table', tableData: rows, text: rows.map(r => r.join(' | ')).join('\n') };
    }

    if (tag === 'pre' || tag === 'code') return { type: 'code', text: node.innerText || node.textContent || '' };
    if (tag === 'img') return { type: 'image', text: `[image] alt="${node.alt}" src="${node.src}"` };
    if (tag === 'a') return { type: 'link', text: `[link] "${node.innerText.trim()}" → ${node.href}` };

    const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    return { type: 'text', text: text.length > 2000 ? text.slice(0, 2000) + '…' : text };
  }

  // ── Export formatter ───────────────────────────────────────────────────────
  function buildExport(fmt) {
    const meta = { url: location.href, title: document.title, timestamp: new Date().toISOString(), itemCount: extractedItems.length };
    if (fmt === 'json') {
      return JSON.stringify({ exoMirror: { version: '1.0', ...meta }, items: extractedItems }, null, 2);
    }
    const lines = [`# Exo Mirror Export`, ``, `**URL:** ${meta.url}`, `**Titulek:** ${meta.title}`, `**Čas:** ${meta.timestamp}`, ``, `---`, ``];
    for (const item of extractedItems) {
      lines.push(`## Položka ${item.id} — \`${item.tag.toUpperCase()}\``);
      if (item.type === 'table' && item.tableData?.length) {
        const [header, ...body] = item.tableData;
        if (header) {
          lines.push('| ' + header.join(' | ') + ' |');
          lines.push('| ' + header.map(() => '---').join(' | ') + ' |');
          for (const row of body) lines.push('| ' + row.join(' | ') + ' |');
        }
      } else if (item.type === 'code') {
        lines.push('```\n' + item.text + '\n```');
      } else {
        lines.push(item.text);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  // ── Sestavení DOM ──────────────────────────────────────────────────────────
  const styleTag = el('style', { id: '__xm_style__' });
  styleTag.textContent = STYLE;
  document.head.appendChild(styleTag);

  const root = el('div', { id: '__xm_root__' });
  document.documentElement.appendChild(root);
  root.appendChild(el('div', { id: '__xm_dim__' }));

  const hudCount = el('span', { id: '__xm_hud_count__', text: '0 položek' });
  root.appendChild(el('div', { id: '__xm_hud__' }, el('div', { id: '__xm_hud_dot__' }), el('span', { id: '__xm_hud_label__', text: '⬡ EXO NEURAL MIRROR' }), el('span', { id: '__xm_hud_hint__', text: 'Vyber text a dej ENTER, nebo klikej na bloky • ESC pro zrušení' }), hudCount));

  const itemsCountBadge = el('span', { id: '__xm_panel_items_count__', text: '0' });
  const closeBtn = el('div', { id: '__xm_close_btn__', text: '✕' });
  const panelHeader = el('div', { id: '__xm_panel_header__' }, el('span', { id: '__xm_panel_title__', text: 'EXTRAHOVANÁ DATA' }), itemsCountBadge, closeBtn);
  const emptyState = el('div', { id: '__xm_empty__' }, el('span', { text: '⬡', style: 'display:block;font-size:22px;margin-bottom:8px;opacity:.5;' }), 'Klikni na element, nebo označ text a stiskni ENTER.');
  const itemsList = el('div', { id: '__xm_items_list__', style: 'display:none;' });
  
  const fmtJson = el('button', { class: 'xm_fmt_btn active', text: 'JSON' });
  const fmtMd   = el('button', { class: 'xm_fmt_btn', text: 'MARKDOWN' });
  const saveBtn = el('button', { id: '__xm_save_btn__', disabled: 'true', text: 'ULOŽIT EXPORT' });
  const actionBar = el('div', { id: '__xm_action_bar__' }, fmtJson, fmtMd, saveBtn);

  const panel = el('div', { id: '__xm_panel__' }, panelHeader, emptyState, itemsList, actionBar);
  root.appendChild(panel);

  // ── Panel update ───────────────────────────────────────────────────────────
  function refreshPanel() {
    const count = extractedItems.length;
    itemsCountBadge.textContent = String(count);
    hudCount.textContent = `${count} ${count === 1 ? 'položka' : count < 5 ? 'položky' : 'položek'}`;
    if (count === 0) { emptyState.style.display = ''; itemsList.style.display = 'none'; saveBtn.disabled = true; }
    else { emptyState.style.display = 'none'; itemsList.style.display = ''; saveBtn.disabled = false; }
  }

  function addItemCard(item) {
    const preview = (item.text || '').slice(0, 150).replace(/\n/g, ' ');
    const removeBtn = el('span', { class: 'xm_item_remove', title: 'Odebrat' }, '✕');
    removeBtn.addEventListener('click', (e) => { e.stopPropagation(); removeItem(item.id); });
    const card = el('div', { class: 'xm_item_card', 'data-xm-id': item.id },
      el('div', { class: 'xm_item_card_header' }, el('span', { class: 'xm_item_idx', text: `#${item.id}` }), el('span', { class: 'xm_item_tag', text: item.tag }), el('span', { class: 'xm_item_selector', text: item.selector }), removeBtn),
      el('div', { class: 'xm_item_preview', text: preview || '[prázdný element]' })
    );
    itemsList.appendChild(card);
    itemsList.scrollTop = itemsList.scrollHeight;
  }

  function removeItem(id) {
    const idx = extractedItems.findIndex(i => i.id === id);
    if (idx === -1) return;
    extractedItems.splice(idx, 1);
    itemsList.querySelector(`[data-xm-id="${id}"]`)?.remove();
    root.querySelector(`[data-xm-badge="${id}"]`)?.remove();
    refreshPanel();
  }

  // ── Event handlers ─────────────────────────────────────────────────────────
  function isOwnElement(node) {
    if (!node || !node.closest) return false;
    return node.closest('#__xm_root__') || node.id?.startsWith('__xm_') || node.closest('[id^="__xm_"]');
  }

  function onMouseMove(e) {
    const target = e.target;
    if (isOwnElement(target)) {
      if (hoveredEl) { hoveredEl.classList.remove('__xm_hover__'); hoveredEl = null; }
      return;
    }
    if (target === hoveredEl) return;
    if (hoveredEl) hoveredEl.classList.remove('__xm_hover__');
    hoveredEl = target;
    hoveredEl.classList.add('__xm_hover__');
  }

  function captureElement(target) {
    if (!target || isOwnElement(target)) return;
    target.classList.add('__xm_selected__');
    setTimeout(() => target.classList.remove('__xm_selected__'), 800);

    const id = ++idCounter;
    const item = { id, tag: target.tagName.toLowerCase(), selector: getSelector(target), ...extractElement(target) };
    extractedItems.push(item);

    try {
      const rect = target.getBoundingClientRect();
      const badge = el('div', { class: '__xm_badge__', 'data-xm-badge': id, text: `#${id}` });
      badge.style.top = (rect.top + window.scrollY - 16) + 'px';
      badge.style.left = (rect.left + window.scrollX) + 'px';
      document.documentElement.appendChild(badge);
    } catch (_) {}

    addItemCard(item);
    refreshPanel();
  }

  function onClick(e) {
    if (isOwnElement(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    const target = e.target.closest('table, pre, code, img, a, p, li, h1, h2, h3, h4, h5, h6, div, section, article, blockquote, td, th, span') || e.target;
    captureElement(target);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      cleanup();
      if (resolvePromise) resolvePromise(null);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // 1. SCENÁŘ: Uživatel natvrdo označil text myší
      const selection = window.getSelection().toString().trim();
      if (selection.length > 0) {
        const id = ++idCounter;
        const item = { id, tag: 'text', selector: 'označený výběr', type: 'text', text: selection.length > 2000 ? selection.slice(0, 2000) + '…' : selection };
        extractedItems.push(item);
        addItemCard(item);
        refreshPanel();
        window.getSelection().removeAllRanges(); // zruší výběr, jako důkaz nasátí
        return;
      }
      // 2. SCENÁŘ: Není označený text, vezmeme to, nad čím je myš
      if (hoveredEl) captureElement(hoveredEl);
    }
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown);
  document.body.style.cursor = 'crosshair';

  // ── Tlačítka ───────────────────────────────────────────────────────────────
  closeBtn.addEventListener('click', () => { cleanup(); if (resolvePromise) resolvePromise(null); });
  fmtJson.addEventListener('click', () => { format = 'json'; fmtJson.classList.add('active'); fmtMd.classList.remove('active'); });
  fmtMd.addEventListener('click', () => { format = 'md'; fmtMd.classList.add('active'); fmtJson.classList.remove('active'); });
  saveBtn.addEventListener('click', () => {
    if (!extractedItems.length) return;
    const content = buildExport(format);
    const meta = { url: location.href, title: document.title, timestamp: new Date().toISOString(), itemCount: extractedItems.length, format };
    cleanup();
    if (resolvePromise) resolvePromise({ format, content, meta });
  });

  // ── Cleanup ────────────────────────────────────────────────────────────────
  function cleanup() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown);
    if (hoveredEl) { hoveredEl.classList.remove('__xm_hover__'); hoveredEl = null; }
    document.querySelectorAll('.__xm_selected__').forEach(e => e.classList.remove('__xm_selected__'));
    document.querySelectorAll('.__xm_badge__').forEach(e => e.remove());
    document.getElementById('__xm_root__')?.remove();
    document.getElementById('__xm_style__')?.remove();
    document.body.style.cursor = '';
    delete window.__exoMirrorActive;
    delete window.__exoMirrorDestroy;
  }
  window.__exoMirrorDestroy = cleanup;

  // ── Vrátí Promise pro main.js ──────────────────────────────────────────────
  return new Promise(resolve => { resolvePromise = resolve; });
})();