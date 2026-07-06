/**
 * renderer.js — Exo Browser — Renderer Process
 */

'use strict';

if (!window.browserAPI) console.error('[Exo] browserAPI not found — is preload.js loaded?');
const api = window.browserAPI;

// ─── DOM ──────────────────────────────────────────────────────────────────────
const tabsContainer = document.getElementById('tabs-container');
const urlBar        = document.getElementById('url-bar');
const btnBack       = document.getElementById('btn-back');
const btnForward    = document.getElementById('btn-forward');
const btnReload     = document.getElementById('btn-reload');
const btnNewTab     = document.getElementById('btn-new-tab');
const btnClose      = document.getElementById('btn-close');
const btnMinimize   = document.getElementById('btn-minimize');
const btnMaximize   = document.getElementById('btn-maximize');
const loadingRing   = document.getElementById('loading-ring');
const securityBadge = document.getElementById('security-badge');
const iconReload    = document.getElementById('icon-reload');
const iconStop      = document.getElementById('icon-stop');
const btnEngine     = document.getElementById('btn-engine');
const engineBadge   = document.getElementById('engine-badge');
const engineToast   = document.getElementById('engine-toast');

// ─── Search Engines ───────────────────────────────────────────────────────────
// ── Search Engines ───────────────────────────────────────────────────────────
// 'exo' uses a special sentinel '__EXO__:query' so the urlBar handler can
// intercept it before passing anything to api.navigate (which needs http URLs).
const ENGINES = {
  exo:    { name: 'Exo Search',   abbr: 'E',  color: '#a78bfa', home: null,                       search: q => '__EXO__:' + q },
  ddg:    { name: 'DuckDuckGo',   abbr: 'D',  color: '#de5833', home: 'https://duckduckgo.com',   search: q => 'https://duckduckgo.com/?q=' + encodeURIComponent(q) },
  brave:  { name: 'Brave Search', abbr: 'Br', color: '#fb542b', home: 'https://search.brave.com', search: q => 'https://search.brave.com/search?q=' + encodeURIComponent(q) },
  google: { name: 'Google',       abbr: 'G',  color: '#4285f4', home: 'https://www.google.com',   search: q => 'https://www.google.com/search?q=' + encodeURIComponent(q) },
  bing:   { name: 'Bing',         abbr: 'Bi', color: '#00adef', home: 'https://www.bing.com',     search: q => 'https://www.bing.com/search?q=' + encodeURIComponent(q) },
};
const ENGINE_ORDER = ['exo', 'ddg', 'brave', 'google', 'bing'];

let selectedEngine = localStorage.getItem('exo-engine') || 'ddg';
let toastTimer     = null;

/** Pull search query from any search URL or from Exo Search's hash */
function extractSearchQuery(url) {
  if (!url) return null;
  try {
    // Exo Search page stores query in URL hash
    if (url.includes('exo-search.html')) {
      const h = new URL(url).hash.slice(1);
      return h ? decodeURIComponent(h) : null;
    }
    return new URL(url).searchParams.get('q') || null;
  } catch (_) { return null; }
}

function applyEngine(key, showToast = false) {
  selectedEngine = key;
  localStorage.setItem('exo-engine', key);
  const e = ENGINES[key];
  engineBadge.textContent     = e.abbr;
  engineBadge.style.color     = e.color;
  btnEngine.style.borderColor = e.color + '44';
  btnEngine.title             = 'Vyhledávač: ' + e.name + ' — klikni pro změnu';
  urlBar.placeholder = key === 'exo'
    ? 'Exo Search — hledat nebo zadat URL…'
    : 'Hledat přes ' + e.name + ' nebo zadat URL…';
  if (showToast && engineToast) {
    engineToast.textContent       = e.name;
    engineToast.style.color       = e.color;
    engineToast.style.borderColor = e.color + '44';
    engineToast.classList.remove('hidden', 'toast-fade-out');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      engineToast.classList.add('toast-fade-out');
      setTimeout(() => engineToast.classList.add('hidden'), 300);
    }, 1800);
  }
}

/** Send a query to main process → opens exo-search.html with results */
function doExoSearch(query) {
  const q = (query || '').trim();
  // q can be empty — main.js handles that by showing empty search page
  api.exoSearch(q || '', activeTabId);
}

/**
 * Cycle to next engine + immediately re-search or navigate.
 * TO exo  → always open Exo Search page (with current query if any)
 * FROM exo → navigate to external engine (with current query if any)
 */
/** True when active tab is showing the Exo New Tab page */
function isOnNewTab() {
  const url = tabState.get(activeTabId)?.url || '';
  return !url || url.includes('exo-newtab.html') || url === 'exo://newtab';
}

function cycleEngine() {
  const nextKey = ENGINE_ORDER[(ENGINE_ORDER.indexOf(selectedEngine) + 1) % ENGINE_ORDER.length];
  applyEngine(nextKey, true);

  // On New Tab page: only swap engine silently — never navigate away.
  // applyEngine() already updated the placeholder. The in-page search form
  // reads exo-engine from localStorage on submit, so it just works.
  if (isOnNewTab()) return;

  // On a search results page: re-run the same query with the new engine
  const tab = tabState.get(activeTabId);
  const q   = tab ? extractSearchQuery(tab.url) : null;

  if (nextKey === 'exo') {
    doExoSearch(q || '');
    return;
  }

  const target = q ? ENGINES[nextKey].search(q) : ENGINES[nextKey].home;
  if (target) {
    api.navigate(target, activeTabId);
    urlBar.value = target;
  }
}

btnEngine.addEventListener('click', cycleEngine);
applyEngine(selectedEngine, false);

/**
 * Resolve raw URL bar input → navigable string.
 * Exo engine returns '__EXO__:query' sentinel.
 * urlBar keydown handler intercepts this BEFORE calling api.navigate.
 */
function resolveInput(raw) {
  const t = raw.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[^\s]+\.[^\s]+$/.test(t) || /^localhost(:\d+)?/.test(t)) return 'https://' + t;
  return ENGINES[selectedEngine].search(t);
}

// ─── State ────────────────────────────────────────────────────────────────────
const tabState = new Map();
let activeTabId = null;

// ─── Window controls ──────────────────────────────────────────────────────────
btnClose.addEventListener('click',    () => api.close());
btnMinimize.addEventListener('click', () => api.minimize());
btnMaximize.addEventListener('click', () => api.maximize());

// ─── Nav buttons ──────────────────────────────────────────────────────────────
btnBack.addEventListener('click',    () => { if (!btnBack.disabled)    api.goBack(activeTabId); });
btnForward.addEventListener('click', () => { if (!btnForward.disabled) api.goForward(activeTabId); });
btnReload.addEventListener('click',  () => { const t = tabState.get(activeTabId); t?.loading ? api.stopLoading(activeTabId) : api.reload(activeTabId); });

// ─── URL bar ──────────────────────────────────────────────────────────────────
urlBar.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const r = resolveInput(urlBar.value);
    if (!r) return;
    // Intercept Exo Search sentinel before it reaches api.navigate
    if (r.startsWith('__EXO__:')) {
      doExoSearch(r.slice(8));
    } else {
      api.navigate(r, activeTabId);
    }
    urlBar.blur();
    return;
  }
  if (e.key === 'Escape') {
    const t = tabState.get(activeTabId);
    if (t) urlBar.value = getDisplayUrl(t.url);
    urlBar.blur();
  }
});
urlBar.addEventListener('focus', () => {
  setTimeout(() => {
    const t = tabState.get(activeTabId);
    // On New Tab page: clear the virtual address so user can type right away
    if (!t?.url || t.url.includes('exo-newtab.html')) {
      urlBar.value = '';
    } else {
      urlBar.select();
    }
  }, 50);
});

btnNewTab.addEventListener('click', () => api.newTab());

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl  && e.key === 't') { e.preventDefault(); api.newTab(); }
  if (ctrl  && e.key === 'w') { e.preventDefault(); api.closeTab(activeTabId); }
  if (ctrl  && e.key === 'l') { e.preventDefault(); urlBar.focus(); urlBar.select(); }
  if (ctrl  && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); historySidebarOpen ? closeHistorySidebar() : openHistorySidebar(); }
  if (ctrl  && e.key === 'r') { e.preventDefault(); api.reload(activeTabId); }
  if (e.key === 'F5')         { e.preventDefault(); api.reload(activeTabId); }
  if (e.altKey && e.key === 'ArrowLeft')  { e.preventDefault(); api.goBack(activeTabId); }
  if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); api.goForward(activeTabId); }
  if (e.altKey && (e.key === 'g'||e.key==='G')) { e.preventDefault(); sidebarOpen ? closeSidebar() : openSidebar(); }
});

// ─── IPC Events ───────────────────────────────────────────────────────────────
api.onTabCreated(d => {
  tabState.set(d.tabId, { title: d.title||'New Tab', url: d.url||'', favicon: null, loading: true, active: false, sleeping: false });
  renderAllTabs(); updateGxTabCounts();
});
api.onTabClosed(d => { tabState.delete(d.tabId); renderAllTabs(); updateGxTabCounts(); });
/**
 * Convert raw internal file:// URLs into clean virtual addresses.
 * The URL bar should never expose filesystem paths to the user.
 *   exo-newtab.html  →  exo://newtab
 *   exo-search.html  →  exo://search?q=QUERY  (or exo://search)
 *   everything else  →  unchanged
 */
function getDisplayUrl(url) {
  if (!url) return '';
  if (url.includes('exo-newtab.html') || url === 'about:blank') return 'exo://newtab';
  if (url.includes('exo-search.html')) {
    const q = extractSearchQuery(url);
    return q ? 'exo://search?q=' + q : 'exo://search';
  }
  return url;
}

api.onTabSwitched(d => {
  tabState.forEach((t,id) => { t.active = id === d.tabId; });
  activeTabId = d.tabId;
  urlBar.value = getDisplayUrl(d.url || '');
  setNavButtons(d.canGoBack, d.canGoForward);
  setLoadingState(d.loading||false);
  setSecurityBadge(d.url||'');
  renderAllTabs();
});
api.onTabNavigated(d => {
  const t = tabState.get(d.tabId); if (t) t.url = d.url;
  if (d.tabId === activeTabId) {
    urlBar.value = getDisplayUrl(d.url || '');
    setSecurityBadge(d.url || '');
  }
});
api.onTabTitleUpdated(d => { const t = tabState.get(d.tabId); if (t) t.title = d.title; updateTabTitle(d.tabId, d.title); });
api.onTabFaviconUpdated(d => { const t = tabState.get(d.tabId); if (t) t.favicon = d.favicon; updateTabFavicon(d.tabId, d.favicon); });
api.onTabLoading(d => {
  const t = tabState.get(d.tabId); if (t) t.loading = d.loading;
  if (d.tabId === activeTabId) setLoadingState(d.loading);
  const el = tabsContainer.querySelector(`[data-tab-id="${d.tabId}"]`);
  if (el) el.classList.toggle('loading', d.loading);
  updateTabSpinner(d.tabId, d.loading);
});
api.onNavStateUpdated(d => { if (d.tabId === activeTabId) setNavButtons(d.canGoBack, d.canGoForward); });
api.onTabSleeping?.(d => {
  const t = tabState.get(d.tabId); if (!t) return;
  t.sleeping = d.sleeping;
  const el = tabsContainer.querySelector(`[data-tab-id="${d.tabId}"]`);
  if (el) {
    el.classList.toggle('sleeping', d.sleeping);
    let badge = el.querySelector('.tab-sleep-badge');
    if (d.sleeping && !badge) { badge = document.createElement('span'); badge.className='tab-sleep-badge'; badge.textContent='zz'; el.appendChild(badge); }
    else if (!d.sleeping && badge) badge.remove();
  }
  updateGxTabCounts();
});

// ─── Tab rendering ────────────────────────────────────────────────────────────
function renderAllTabs() {
  const sl = tabsContainer.parentElement?.scrollLeft ?? 0;
  tabsContainer.innerHTML = '';
  tabState.forEach((tab, tabId) => tabsContainer.appendChild(buildTabElement(tabId, tab)));
  if (tabsContainer.parentElement) tabsContainer.parentElement.scrollLeft = sl;
  tabsContainer.querySelector('.tab.active')?.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'nearest' });
}

function buildTabElement(tabId, tab) {
  const el = document.createElement('div');
  el.className = ['tab', tab.active?'active':'', tab.loading?'loading':'', tab.sleeping?'sleeping':''].filter(Boolean).join(' ');
  el.dataset.tabId = tabId;
  el.setAttribute('role','tab'); el.setAttribute('aria-selected', tab.active?'true':'false');
  el.title = tab.sleeping ? `💤 ${tab.title||'New Tab'}` : tab.title||tab.url||'New Tab';

  const iconWrap = document.createElement('div'); iconWrap.className = 'tab-icon';
  if (tab.sleeping) { iconWrap.appendChild(makeMoonIcon()); }
  else if (tab.loading) { const s = document.createElement('div'); s.className='tab-spinner'; iconWrap.appendChild(s); }
  else if (tab.favicon) { const img = document.createElement('img'); img.className='tab-favicon'; img.src=tab.favicon; img.alt=''; img.draggable=false; img.addEventListener('error', ()=>img.replaceWith(makeGlobeIcon())); iconWrap.appendChild(img); }
  else { iconWrap.appendChild(makeGlobeIcon()); }
  el.appendChild(iconWrap);

  const titleEl = document.createElement('span'); titleEl.className='tab-title'; titleEl.textContent = tab.title||'New Tab'; el.appendChild(titleEl);
  if (tab.sleeping) { const b = document.createElement('span'); b.className='tab-sleep-badge'; b.textContent='zz'; el.appendChild(b); }

  const closeBtn = document.createElement('button'); closeBtn.className='tab-close'; closeBtn.setAttribute('aria-label',`Zavřít: ${tab.title||'New Tab'}`);
  closeBtn.innerHTML = `<svg viewBox="0 0 10 10" width="10" height="10" fill="none"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  closeBtn.addEventListener('click', e => { e.stopPropagation(); api.closeTab(tabId); });
  el.appendChild(closeBtn);

  el.addEventListener('click', () => { if (tabId !== activeTabId) api.switchTab(tabId); });
  el.addEventListener('auxclick', e => { if (e.button===1) { e.preventDefault(); api.closeTab(tabId); } });
  return el;
}

function updateTabTitle(tabId, title) {
  const el = tabsContainer.querySelector(`[data-tab-id="${tabId}"] .tab-title`);
  const te = tabsContainer.querySelector(`[data-tab-id="${tabId}"]`);
  if (el) el.textContent = title||'New Tab';
  if (te) te.title = title||'New Tab';
}
function updateTabFavicon(tabId, favicon) {
  const iw = tabsContainer.querySelector(`[data-tab-id="${tabId}"] .tab-icon`); if (!iw) return;
  const t = tabState.get(tabId); if (t?.loading||t?.sleeping) return;
  iw.innerHTML = '';
  if (favicon) { const img=document.createElement('img'); img.className='tab-favicon'; img.src=favicon; img.alt=''; img.draggable=false; img.addEventListener('error',()=>{iw.innerHTML='';iw.appendChild(makeGlobeIcon());}); iw.appendChild(img); }
  else iw.appendChild(makeGlobeIcon());
}
function updateTabSpinner(tabId, loading) {
  const t = tabState.get(tabId); const iw = tabsContainer.querySelector(`[data-tab-id="${tabId}"] .tab-icon`); if (!iw||t?.sleeping) return;
  iw.innerHTML = '';
  if (loading) { const s=document.createElement('div'); s.className='tab-spinner'; iw.appendChild(s); }
  else if (t?.favicon) { const img=document.createElement('img'); img.className='tab-favicon'; img.src=t.favicon; img.alt=''; img.draggable=false; img.addEventListener('error',()=>{iw.innerHTML='';iw.appendChild(makeGlobeIcon());}); iw.appendChild(img); }
  else iw.appendChild(makeGlobeIcon());
}

function setNavButtons(b, f)    { btnBack.disabled = !b; btnForward.disabled = !f; }
function setLoadingState(l)     { loadingRing.classList.toggle('hidden',!l); iconReload.classList.toggle('hidden',l); iconStop.classList.toggle('hidden',!l); }
function setSecurityBadge(url)  {
  const secure = /^https:\/\//i.test(url);
  securityBadge.classList.toggle('insecure', !secure && url !== '');
  const is = document.getElementById('icon-secure'), ii = document.getElementById('icon-insecure');
  if (!url) { is.classList.add('hidden'); ii.classList.add('hidden'); }
  else if (secure) { is.classList.remove('hidden'); ii.classList.add('hidden'); }
  else { is.classList.add('hidden'); ii.classList.remove('hidden'); }
}

function makeGlobeIcon() {
  const s = document.createElementNS('http://www.w3.org/2000/svg','svg');
  s.setAttribute('viewBox','0 0 14 14'); s.setAttribute('fill','none'); s.setAttribute('width','14'); s.setAttribute('height','14'); s.classList.add('tab-globe');
  s.innerHTML = `<circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.1"/><path d="M7 1.5c0 0-2 2-2 5.5s2 5.5 2 5.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><path d="M7 1.5c0 0 2 2 2 5.5s-2 5.5-2 5.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><path d="M1.5 7h11" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><path d="M2 4.5h10M2 9.5h10" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity="0.6"/>`;
  return s;
}
function makeMoonIcon() {
  const s = document.createElementNS('http://www.w3.org/2000/svg','svg');
  s.setAttribute('viewBox','0 0 14 14'); s.setAttribute('fill','none'); s.setAttribute('width','14'); s.setAttribute('height','14'); s.classList.add('tab-moon');
  s.innerHTML = `<path d="M10.5 8.5A5 5 0 0 1 5.5 3.5a5 5 0 0 0 5 7 5 5 0 0 1-0 -2z" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>`;
  return s;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GX GAMING SIDEBAR
// ═══════════════════════════════════════════════════════════════════════════════

const gxSidebar       = document.getElementById('gx-sidebar');
const btnSidebar      = document.getElementById('btn-sidebar');
const btnSidebarClose = document.getElementById('btn-sidebar-close');

const gxCpuValue    = document.getElementById('gx-cpu-value');
const gxCpuBar      = document.getElementById('gx-cpu-bar');
const gxRamValue    = document.getElementById('gx-ram-value');
const gxRamBar      = document.getElementById('gx-ram-bar');
const gxRamSub      = document.getElementById('gx-ram-sub');
const gxFpsValue    = document.getElementById('gx-fps-value');
const gxFpsBar      = document.getElementById('gx-fps-bar');
const gxBlockedEl   = document.getElementById('gx-blocked');
const gxTabCountEl  = document.getElementById('gx-tab-count');
const gxSleepCountEl= document.getElementById('gx-sleep-count');
const gxClockEl     = document.getElementById('gx-clock');
const gxDateEl      = document.getElementById('gx-date');
const gxUptimeEl    = document.getElementById('gx-uptime');

let sidebarOpen   = false;
let statsInterval = null;

// History buffers
const HIST = 30;
const cpuHist = new Array(HIST).fill(0);
const ramHist = new Array(HIST).fill(0);
const fpsHist = new Array(HIST).fill(60);

// ── Settings ──────────────────────────────────────────────────────────────────
const DEFAULTS = { accentColor:'#a78bfa', pollMs:1500, sleepMin:5, darkMode:true, showFps:true, compactMode:false };
let S = { ...DEFAULTS };
try { const sv = localStorage.getItem('exo-gx-s'); if (sv) S = {...DEFAULTS,...JSON.parse(sv)}; } catch(_){}
const saveS = () => localStorage.setItem('exo-gx-s', JSON.stringify(S));

function applyAccent(c) {
  document.documentElement.style.setProperty('--acc-1', c);
  document.documentElement.style.setProperty('--acc-glow', c+'28');
  document.documentElement.style.setProperty('--border-focus', c+'80');
}
applyAccent(S.accentColor);

// ── FPS tracking ──────────────────────────────────────────────────────────────
let _fpsBuf = [], _lastFt = performance.now(), _fps = 60;
(function rafLoop() {
  const now = performance.now(); _fpsBuf.push(1000/(now-_lastFt)); _lastFt = now;
  if (_fpsBuf.length > 20) _fpsBuf.shift();
  _fps = Math.round(_fpsBuf.reduce((a,b)=>a+b,0)/_fpsBuf.length);
  requestAnimationFrame(rafLoop);
})();

// ── Session uptime ────────────────────────────────────────────────────────────
const T0 = Date.now();
const fmtUp = ms => { const s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60); return h?`${h}h ${m%60}m`:m?`${m}m ${s%60}s`:`${s}s`; };

// ── Sidebar toggle ────────────────────────────────────────────────────────────
function openSidebar() {
  sidebarOpen = true;
  gxSidebar.classList.remove('hidden','gx-closing');
  requestAnimationFrame(() => gxSidebar.classList.add('gx-open'));
  btnSidebar?.setAttribute('aria-pressed','true'); btnSidebar?.classList.add('active');
  api.toggleSidebar(true);
  startStats(); renderSettings();
}
function closeSidebar() {
  sidebarOpen = false;
  gxSidebar.classList.remove('gx-open'); gxSidebar.classList.add('gx-closing');
  btnSidebar?.setAttribute('aria-pressed','false'); btnSidebar?.classList.remove('active');
  setTimeout(() => { gxSidebar.classList.add('hidden'); gxSidebar.classList.remove('gx-closing'); }, 280);
  api.toggleSidebar(false); stopStats();
}
btnSidebar?.addEventListener('click', () => sidebarOpen ? closeSidebar() : openSidebar());
btnSidebarClose?.addEventListener('click', closeSidebar);
api.onSidebarState?.(d => { if(d.open!==sidebarOpen) d.open?openSidebar():closeSidebar(); });

// ─── Gaming Mode ──────────────────────────────────────────────────────────────
const btnGamingMode = document.getElementById('btn-gaming-mode');
const gmPill        = document.getElementById('gm-pill');
const gmStatusText  = document.getElementById('gm-status-text');
let   gamingActive  = false;

function updateGamingUI(active, slept = 0) {
  gamingActive = active;
  if (!btnGamingMode) return;
  btnGamingMode.setAttribute('aria-pressed', String(active));
  btnGamingMode.classList.toggle('gm-active', active);
  if (gmPill) {
    gmPill.textContent = active ? 'ON' : 'OFF';
    gmPill.classList.toggle('on', active);
  }
  if (gmStatusText) {
    gmStatusText.textContent = active
      ? (slept > 0 ? `Aktivní · ${slept} tabů uspáno` : 'Aktivní')
      : 'Neaktivní';
  }
}

btnGamingMode?.addEventListener('click', async () => {
  if (!gamingActive) {
    btnGamingMode.classList.add('gm-pulsing');
    try {
      const res = await api.enableGamingMode();
      updateGamingUI(true, res?.tabsSlept ?? 0);
    } catch(e) { console.error('[Exo] Gaming Mode enable failed:', e); }
    btnGamingMode.classList.remove('gm-pulsing');
  } else {
    try { await api.disableGamingMode(); } catch(_) {}
    updateGamingUI(false, 0);
  }
});

// Alt+M shortcut
document.addEventListener('keydown', e => {
  if (e.altKey && (e.key === 'm' || e.key === 'M')) {
    e.preventDefault();
    btnGamingMode?.click();
  }
});

// ── Stats ─────────────────────────────────────────────────────────────────────
function getColor(pct) { return pct<50?'#34d399':pct<80?'#a78bfa':'#f87171'; }

function setBar(el, pct) {
  if (!el) return;
  const c = Math.min(100, Math.max(0, pct));
  el.style.width = `${c}%`;
  el.style.setProperty('--bar-color', getColor(c));
}

function spark(id, hist, color) {
  const cv = document.getElementById(id); if (!cv) return;
  const ctx = cv.getContext('2d'), w = cv.width, h = cv.height;
  ctx.clearRect(0,0,w,h);
  const step = w/(hist.length-1);
  const pts = hist.map((v,i) => [i*step, h-(Math.min(100,Math.max(0,v))/100)*(h-3)-1]);
  // Fill
  ctx.beginPath(); pts.forEach(([x,y],i) => i?ctx.lineTo(x,y):ctx.moveTo(x,y));
  ctx.lineTo(w,h); ctx.lineTo(0,h); ctx.closePath();
  const g = ctx.createLinearGradient(0,0,0,h); g.addColorStop(0,color+'44'); g.addColorStop(1,color+'00');
  ctx.fillStyle=g; ctx.fill();
  // Line
  ctx.beginPath(); pts.forEach(([x,y],i) => i?ctx.lineTo(x,y):ctx.moveTo(x,y));
  ctx.strokeStyle=color; ctx.lineWidth=1.5; ctx.lineJoin='round'; ctx.stroke();
  // Dot
  const [lx,ly]=pts[pts.length-1]; ctx.beginPath(); ctx.arc(lx,ly,2.5,0,Math.PI*2); ctx.fillStyle=color; ctx.fill();
}

async function pollStats() {
  try {
    const s = await api.getStats();

    cpuHist.push(s.cpu); cpuHist.shift();
    if (gxCpuValue) gxCpuValue.textContent = `${s.cpu}%`;
    setBar(gxCpuBar, s.cpu);
    spark('gx-cpu-spark', cpuHist, getColor(s.cpu));

    ramHist.push(s.ramPct); ramHist.shift();
    const ug=(s.ramUsedMB/1024).toFixed(1), tg=(s.ramTotalMB/1024).toFixed(1);
    if (gxRamValue) gxRamValue.textContent = `${s.ramUsedMB} MB`;
    if (gxRamSub)   gxRamSub.textContent   = `${ug} / ${tg} GB`;
    setBar(gxRamBar, s.ramPct);
    spark('gx-ram-spark', ramHist, getColor(s.ramPct));

    fpsHist.push(_fps); fpsHist.shift();
    if (gxFpsValue) gxFpsValue.textContent = `${_fps}`;
    setBar(gxFpsBar, Math.min(100, (_fps/60)*100));
    spark('gx-fps-spark', fpsHist.map(v=>(v/60)*100), '#34d399');

    if (gxBlockedEl) gxBlockedEl.textContent = s.blocked.toLocaleString();
    if (gxUptimeEl)  gxUptimeEl.textContent  = fmtUp(Date.now()-T0);
  } catch(_) {}
  updateGxTabCounts();
}

function updateGxTabCounts() {
  if (gxTabCountEl)   gxTabCountEl.textContent   = tabState.size;
  if (gxSleepCountEl) { let sl=0; tabState.forEach(t=>{if(t.sleeping)sl++;}); gxSleepCountEl.textContent=sl; }
}

function startStats() { pollStats(); statsInterval = setInterval(pollStats, S.pollMs); }
function stopStats()  { clearInterval(statsInterval); statsInterval=null; }

// ── Clock ─────────────────────────────────────────────────────────────────────
function tickClock() {
  const n = new Date();
  const hh=String(n.getHours()).padStart(2,'0'), mm=String(n.getMinutes()).padStart(2,'0'), ss=String(n.getSeconds()).padStart(2,'0');
  if (gxClockEl) gxClockEl.textContent = `${hh}:${mm}:${ss}`;
  const D=['Ne','Po','Út','St','Čt','Pá','So'], M=['Led','Úno','Bře','Dub','Kvě','Čvn','Čvc','Srp','Zář','Říj','Lis','Pro'];
  if (gxDateEl) gxDateEl.textContent = `${D[n.getDay()]} ${n.getDate()}. ${M[n.getMonth()]} ${n.getFullYear()}`;
}
setInterval(tickClock,1000); tickClock();

// ── Settings panel ────────────────────────────────────────────────────────────
function renderSettings() {
  const panel = document.getElementById('gx-settings-panel'); if (!panel) return;
  const swatches = [['#a78bfa','Fialová'],['#38bdf8','Modrá'],['#34d399','Zelená'],['#f472b6','Růžová'],['#fb923c','Oranžová'],['#f87171','Červená']];

  panel.innerHTML = `
    <div class="gx-setting-row">
      <label class="gx-setting-label">Barva akcentu</label>
      <div class="gx-color-swatches">
        ${swatches.map(([c,n])=>`<button class="gx-swatch${S.accentColor===c?' active':''}" style="background:${c}" title="${n}" data-color="${c}"></button>`).join('')}
        <input type="color" class="gx-color-input" value="${S.accentColor}" title="Vlastní">
      </div>
    </div>
    <div class="gx-setting-row">
      <label class="gx-setting-label">Interval stats</label>
      <div class="gx-setting-control">
        <input type="range" class="gx-slider" min="500" max="5000" step="500" value="${S.pollMs}" id="sl-poll">
        <span class="gx-slider-val" id="sv-poll">${S.pollMs/1000}s</span>
      </div>
    </div>
    <div class="gx-setting-row">
      <label class="gx-setting-label">Tab sleep (min)</label>
      <div class="gx-setting-control">
        <input type="range" class="gx-slider" min="1" max="60" step="1" value="${S.sleepMin}" id="sl-sleep">
        <span class="gx-slider-val" id="sv-sleep">${S.sleepMin}m</span>
      </div>
    </div>
    <div class="gx-setting-row">
      <label class="gx-setting-label">Dark mode inject</label>
      <label class="gx-toggle"><input type="checkbox" id="tog-dark" ${S.darkMode?'checked':''}><span class="gx-toggle-track"><span class="gx-toggle-thumb"></span></span></label>
    </div>
    <div class="gx-setting-row">
      <label class="gx-setting-label">Zobrazit FPS</label>
      <label class="gx-toggle"><input type="checkbox" id="tog-fps" ${S.showFps?'checked':''}><span class="gx-toggle-track"><span class="gx-toggle-thumb"></span></span></label>
    </div>
    <div class="gx-setting-row">
      <label class="gx-setting-label">Kompaktní mód</label>
      <label class="gx-toggle"><input type="checkbox" id="tog-compact" ${S.compactMode?'checked':''}><span class="gx-toggle-track"><span class="gx-toggle-thumb"></span></span></label>
    </div>
    <button class="gx-reset-btn" id="gx-reset">↺ Výchozí nastavení</button>
  `;

  // Swatches
  panel.querySelectorAll('.gx-swatch').forEach(b => b.addEventListener('click', () => {
    S.accentColor = b.dataset.color; saveS(); applyAccent(S.accentColor); renderSettings();
  }));
  // Custom color
  panel.querySelector('.gx-color-input')?.addEventListener('input', e => {
    S.accentColor = e.target.value; saveS(); applyAccent(S.accentColor);
  });
  // Poll slider
  const slp = document.getElementById('sl-poll'), svp = document.getElementById('sv-poll');
  slp?.addEventListener('input', () => { S.pollMs=+slp.value; if(svp)svp.textContent=`${S.pollMs/1000}s`; saveS(); if(statsInterval){stopStats();startStats();} });
  // Sleep slider
  const sls = document.getElementById('sl-sleep'), svs = document.getElementById('sv-sleep');
  sls?.addEventListener('input', () => { S.sleepMin=+sls.value; if(svs)svs.textContent=`${S.sleepMin}m`; saveS(); });
  // Toggles
  document.getElementById('tog-dark')?.addEventListener('change', e => { S.darkMode=e.target.checked; saveS(); });
  document.getElementById('tog-fps')?.addEventListener('change', e => {
    S.showFps=e.target.checked; saveS();
    const c = document.getElementById('gx-fps-card'); if(c) c.style.display=S.showFps?'':'none';
  });
  document.getElementById('tog-compact')?.addEventListener('change', e => {
    S.compactMode=e.target.checked; saveS(); gxSidebar.classList.toggle('compact', S.compactMode);
  });
  // Reset
  document.getElementById('gx-reset')?.addEventListener('click', () => {
    Object.assign(S,DEFAULTS); saveS(); applyAccent(S.accentColor); renderSettings();
  });

  // Apply states
  gxSidebar.classList.toggle('compact', S.compactMode);
  const fc = document.getElementById('gx-fps-card'); if(fc) fc.style.display=S.showFps?'':'none';
}

// Collapsible card sections
document.addEventListener('click', e => {
  const h = e.target.closest('.gx-card-header[data-collapsible]'); if (!h) return;
  const card = h.closest('.gx-card'); if (!card) return;
  card.classList.toggle('collapsed');
  const icon = h.querySelector('.gx-collapse-icon');
  if (icon) icon.style.transform = card.classList.contains('collapsed') ? 'rotate(-90deg)' : '';
});

// ═══════════════════════════════════════════════════════════════════════════════
//  HISTORY SIDEBAR
// ═══════════════════════════════════════════════════════════════════════════════

const historySidebarEl   = document.getElementById('history-sidebar');
const btnHistory         = document.getElementById('btn-history');
const btnHistoryClose    = document.getElementById('btn-history-close');
const btnHistoryClear    = document.getElementById('btn-history-clear');
const historyListEl      = document.getElementById('history-list');
const historySearchInput = document.getElementById('history-search');
const historyEmptyEl     = document.getElementById('history-empty');

let historySidebarOpen = false;
let historyItems       = [];   // full cached list
let historySearchTimer = null;

// ── Open / Close ──────────────────────────────────────────────────────────────
function openHistorySidebar() {
  historySidebarOpen = true;
  historySidebarEl.classList.remove('hidden', 'hist-closing');
  requestAnimationFrame(() => historySidebarEl.classList.add('hist-open'));
  btnHistory?.setAttribute('aria-pressed', 'true');
  btnHistory?.classList.add('active');
  api.toggleHistorySidebar(true);
  loadHistory();
  setTimeout(() => historySearchInput?.focus(), 220);
}

function closeHistorySidebar() {
  historySidebarOpen = false;
  historySidebarEl.classList.remove('hist-open');
  historySidebarEl.classList.add('hist-closing');
  btnHistory?.setAttribute('aria-pressed', 'false');
  btnHistory?.classList.remove('active');
  setTimeout(() => {
    historySidebarEl.classList.add('hidden');
    historySidebarEl.classList.remove('hist-closing');
  }, 280);
  api.toggleHistorySidebar(false);
}

btnHistory?.addEventListener('click', () => historySidebarOpen ? closeHistorySidebar() : openHistorySidebar());
btnHistoryClose?.addEventListener('click', closeHistorySidebar);

// ── Load & Render ─────────────────────────────────────────────────────────────
async function loadHistory() {
  try {
    historyItems = (await api.getHistory()) || [];
    renderHistory(historyItems);
  } catch (_) {
    historyItems = [];
    renderHistory([]);
  }
}

function renderHistory(items) {
  if (!historyListEl) return;

  if (!items.length) {
    historyListEl.innerHTML = '';
    historyEmptyEl?.classList.remove('hidden');
    return;
  }
  historyEmptyEl?.classList.add('hidden');

  // Group by day
  const groups = new Map();
  items.forEach(item => {
    const d  = new Date(item.timestamp);
    const key = dayKey(d);
    if (!groups.has(key)) groups.set(key, { label: dayLabel(d), entries: [] });
    groups.get(key).entries.push(item);
  });

  const frag = document.createDocumentFragment();
  groups.forEach(({ label, entries }) => {
    const sep = document.createElement('li');
    sep.className = 'hist-day-sep';
    sep.textContent = label;
    frag.appendChild(sep);

    entries.forEach(item => frag.appendChild(buildHistItem(item)));
  });

  historyListEl.innerHTML = '';
  historyListEl.appendChild(frag);
}

function buildHistItem(item) {
  const li = document.createElement('li');
  li.className = 'hist-item';
  li.dataset.id = item.id;

  const favUrl = getFaviconUrl(item.url);

  li.innerHTML = `
    <div class="hist-item-icon">
      ${favUrl
        ? `<img src="${escHtml(favUrl)}" width="14" height="14" alt="" class="hist-favicon" onerror="this.replaceWith(makeGlobeIconEl())">`
        : '<span class="hist-globe-wrap"></span>'}
    </div>
    <div class="hist-item-body">
      <span class="hist-item-title" title="${escHtml(item.title || item.url)}">${escHtml(item.title || item.url)}</span>
      <span class="hist-item-url">${escHtml(formatDisplayUrl(item.url))}</span>
    </div>
    <div class="hist-item-meta">
      <span class="hist-item-time">${fmtTime(item.timestamp)}</span>
      <button class="hist-item-del" title="Smazat tuto položku" aria-label="Smazat">
        <svg viewBox="0 0 10 10" width="9" fill="none">
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>`;

  // Replace globe placeholder with SVG element
  const globeWrap = li.querySelector('.hist-globe-wrap');
  if (globeWrap) globeWrap.replaceWith(makeGlobeIcon());

  // Navigate on row click (not on delete button)
  li.addEventListener('click', e => {
    if (e.target.closest('.hist-item-del')) return;
    api.navigate(item.url, activeTabId);
    closeHistorySidebar();
  });

  // Delete single item
  li.querySelector('.hist-item-del')?.addEventListener('click', e => {
    e.stopPropagation();
    api.deleteHistoryEntry(item.id);
    historyItems = historyItems.filter(h => h.id !== item.id);
    const filtered = applySearch(historyItems, historySearchInput?.value || '');
    renderHistory(filtered);
  });

  return li;
}

// ── Search ────────────────────────────────────────────────────────────────────
historySearchInput?.addEventListener('input', () => {
  clearTimeout(historySearchTimer);
  historySearchTimer = setTimeout(() => {
    const q = historySearchInput.value.trim();
    renderHistory(applySearch(historyItems, q));
  }, 160);
});

function applySearch(items, q) {
  if (!q) return items;
  const lq = q.toLowerCase();
  return items.filter(h =>
    (h.title || '').toLowerCase().includes(lq) ||
    (h.url  || '').toLowerCase().includes(lq)
  );
}

// ── Clear all ─────────────────────────────────────────────────────────────────
btnHistoryClear?.addEventListener('click', () => {
  if (!confirm('Smazat celou historii prohlížení?')) return;
  api.clearHistory();
  historyItems = [];
  renderHistory([]);
});

// ── Listen for external history updates ──────────────────────────────────────
api.onHistoryUpdated?.(() => {
  if (historySidebarOpen) loadHistory();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function getFaviconUrl(url) {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`; }
  catch (_) { return ''; }
}

function formatDisplayUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname !== '/' ? u.pathname : '');
  } catch (_) { return url; }
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function makeGlobeIconEl() {
  // Used in onerror — returns a text node placeholder (DOM method unavailable inline)
  const s = makeGlobeIcon();
  return s;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

const TODAY = new Date();
const DAYS_CS  = ['Ne','Po','Út','St','Čt','Pá','So'];
const MONTHS_CS = ['ledna','února','března','dubna','května','června','července','srpna','září','října','listopadu','prosince'];

function dayLabel(d) {
  const today = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);
  const day = new Date(d); day.setHours(0,0,0,0);
  if (day.getTime() === today.getTime())     return 'Dnes';
  if (day.getTime() === yesterday.getTime()) return 'Včera';
  return `${DAYS_CS[d.getDay()]} ${d.getDate()}. ${MONTHS_CS[d.getMonth()]}`;
}

// ════════════════════════════════════════════════════════════════════════════
// ✨ AI FEATURES — AI Sidebar, Settings, Smart Command Bar
// ════════════════════════════════════════════════════════════════════════════

// ── AI Sidebar Button ──────────────────────────────────────────────────────
(function setupAiSidebar() {
  const btnAiSidebar = document.getElementById('btn-ai-sidebar');
  if (!btnAiSidebar) return;

  let aiOpen = false;

  function toggleAiSidebar() {
    aiOpen = !aiOpen;
    btnAiSidebar.setAttribute('aria-pressed', String(aiOpen));
    btnAiSidebar.classList.toggle('ai-active', aiOpen);
    api.toggleAiSidebar(aiOpen);
  }

  btnAiSidebar.addEventListener('click', toggleAiSidebar);

  // Sync při zavření okna křížkem uvnitř sidebaru
  api.onAiSidebarState?.((d) => {
    aiOpen = d.open;
    btnAiSidebar.setAttribute('aria-pressed', String(d.open));
    btnAiSidebar.classList.toggle('ai-active', d.open);
  });

  // Ctrl+Shift+A
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      toggleAiSidebar();
    }
  });
})();

// ── Settings Button ────────────────────────────────────────────────────────
(function setupSettings() {
  const btnSettings = document.getElementById('btn-settings');
  if (!btnSettings) return;

  btnSettings.addEventListener('click', () => api.openSettings());

  // Ctrl+, otevře nastavení
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === ',') {
      e.preventDefault();
      api.openSettings();
    }
  });
})();

// ── Smart Command Bar ──────────────────────────────────────────────────────
(function setupSmartCommandBar() {
  const overlay  = document.getElementById('smart-cmd-overlay');
  const backdrop = document.getElementById('smart-cmd-backdrop');
  const input    = document.getElementById('smart-cmd-input');
  const resultEl = document.getElementById('smart-cmd-result');
  const examples = document.querySelectorAll('.cmd-ex');
  if (!overlay) return;

  let isOpen  = false;
  let cmdTimer = null;

  function openCmdBar() {
    if (isOpen) return;
    isOpen = true;
    overlay.classList.remove('hidden');
    resultEl.classList.add('hidden');
    resultEl.textContent = '';
    input.value = '';
    setTimeout(() => input.focus(), 60);
  }

  function closeCmdBar() {
    if (!isOpen) return;
    isOpen = false;
    overlay.classList.add('hidden');
    clearTimeout(cmdTimer);
  }

  async function executeCommand(cmd) {
    if (!cmd.trim()) return;
    resultEl.textContent = 'Zpracovávám…';
    resultEl.className = 'loading';
    resultEl.classList.remove('hidden');
    try {
      const res = await api.aiCommand(cmd);
      if (res.error) {
        resultEl.textContent = '⚠ ' + res.error;
        resultEl.className = 'error';
      } else {
        resultEl.textContent = res.message || 'Hotovo.';
        resultEl.className = '';
        cmdTimer = setTimeout(closeCmdBar, 2400);
      }
    } catch (err) {
      resultEl.textContent = '⚠ Chyba: ' + err.message;
      resultEl.className = 'error';
    }
  }

  // Ctrl+Space
  document.addEventListener('keydown', (e) => {
    if (e.target === urlBar) return; // nevyrušovat URL bar
    if (e.ctrlKey && e.code === 'Space') {
      e.preventDefault();
      isOpen ? closeCmdBar() : openCmdBar();
    }
    if (e.key === 'Escape' && isOpen) closeCmdBar();
  });

  backdrop.addEventListener('click', closeCmdBar);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); executeCommand(input.value.trim()); }
    if (e.key === 'Escape') closeCmdBar();
  });

  examples.forEach(btn => {
    btn.addEventListener('click', () => {
      input.value = btn.dataset.cmd;
      executeCommand(btn.dataset.cmd);
    });
  });
})();
