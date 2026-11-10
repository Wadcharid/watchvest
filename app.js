/**
 * Watchvest Application Script
 * Faithful replication of StockAnalysis.com Watchlist with Cloudflare Pages Functions
 */

const STORAGE_KEYS = {
  WATCHLISTS: 'watchvest_watchlists',
  ACTIVE_LIST_ID: 'watchvest_active_list_id',
  THEME: 'watchvest_theme',
  GITHUB_PAT: 'watchvest_github_pat',
  VIEW_MODE: 'watchvest_view_mode'
};

const GITHUB_REPO = 'Wadcharid/watchvest';

// Default Watchlist Configuration
const DEFAULT_WATCHLISTS = {
  'main': {
    id: 'main',
    name: 'พอร์ตหลัก (Main)',
    symbols: [
      'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'SCHD', 'BTC-USD', 'TSM',
      'SPYI', 'VYMI', 'BKK:CPALL', 'BKK:BDMS', 'BKK:GULF', 'IAUI', 'HKG:0700', 'ACWI', 'BKK:PTTEP'
    ]
  },
  'dividend': {
    id: 'dividend',
    name: 'หุ้น & กองทุนปันผล',
    symbols: ['SCHD', 'SPYI', 'VYMI', 'IAUI', 'BKK:CPALL', 'BKK:BDMS', 'BKK:PTTEP']
  },
  'tech': {
    id: 'tech',
    name: 'US Tech & Growth',
    symbols: ['NVDA', 'MSFT', 'GOOGL', 'AMZN', 'TSM']
  }
};

// Global App State
let appWatchlists = {};
let activeListId = 'main';
let marketDataMap = new Map(); // symbol -> data object
let activeView = 'overview'; // 'overview', 'technical', 'dividends', 'all'
let activeCategory = 'ALL';
let activeRsiFilter = 'ALL';
let tableSearchQuery = '';
let currentSort = { column: 'symbol', order: 'asc' };
let searchDebounceTimer = null;

// DOM Elements
const globalSearchInput = document.getElementById('globalSearchInput');
const searchDropdown = document.getElementById('searchDropdown');
const lastUpdatedBadge = document.getElementById('lastUpdatedBadge');
const btnRefresh = document.getElementById('btnRefresh');
const btnRefreshLabel = document.getElementById('btnRefreshLabel');
const btnThemeToggle = document.getElementById('btnThemeToggle');
const btnOpenSettings = document.getElementById('btnOpenSettings');

const watchlistsTabsContainer = document.getElementById('watchlistsTabsContainer');
const btnNewWatchlist = document.getElementById('btnNewWatchlist');
const btnListMenu = document.getElementById('btnListMenu');
const listMenuDropdown = document.getElementById('listMenuDropdown');
const menuRenameList = document.getElementById('menuRenameList');
const menuDuplicateList = document.getElementById('menuDuplicateList');
const menuDeleteList = document.getElementById('menuDeleteList');

const viewSwitcher = document.getElementById('viewSwitcher');
const categoryPills = document.getElementById('categoryPills');
const rsiZoneFilter = document.getElementById('rsiZoneFilter');
const tableFilterInput = document.getElementById('tableFilterInput');

const tableHeader = document.getElementById('tableHeader');
const tableBody = document.getElementById('tableBody');
const emptyState = document.getElementById('emptyState');
const btnSeedDefault = document.getElementById('btnSeedDefault');

const statTotal = document.getElementById('statTotal');
const statGainers = document.getElementById('statGainers');
const statLosers = document.getElementById('statLosers');
const statOversold = document.getElementById('statOversold');
const statOverbought = document.getElementById('statOverbought');

// Modals
const settingsModal = document.getElementById('settingsModal');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const btnDoneSettings = document.getElementById('btnDoneSettings');
const modalWatchlistJson = document.getElementById('modalWatchlistJson');
const btnApplyModalJson = document.getElementById('btnApplyModalJson');
const btnCopyModalJson = document.getElementById('btnCopyModalJson');
const modalGithubPat = document.getElementById('modalGithubPat');
const btnSavePat = document.getElementById('btnSavePat');
const btnSyncToGithub = document.getElementById('btnSyncToGithub');
const githubSyncStatus = document.getElementById('githubSyncStatus');
const btnResetToDefaults = document.getElementById('btnResetToDefaults');

const renameModal = document.getElementById('renameModal');
const renameModalTitle = document.getElementById('renameModalTitle');
const renameInput = document.getElementById('renameInput');
const btnCloseRename = document.getElementById('btnCloseRename');
const btnCancelRename = document.getElementById('btnCancelRename');
const btnConfirmRename = document.getElementById('btnConfirmRename');

const toast = document.getElementById('toast');

/* ==========================================================================
   Initialization
   ========================================================================== */
async function initApp() {
  initTheme();
  loadWatchlistsState();
  initViewMode();
  setupEventListeners();

  // Load baseline stocks.json immediately so PE and initial data appear with zero lag
  await loadBaselineData();

  // Fetch live market data
  fetchActiveListMarketData();
}

async function loadBaselineData() {
  try {
    const res = await fetch(`data/stocks.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.assets)) {
        data.assets.forEach(asset => {
          const existing = marketDataMap.get(asset.symbol);
          if ((asset.pe === null || asset.pe === undefined) && existing && existing.pe !== null) {
            asset.pe = existing.pe;
          }
          if ((asset.dividend_yield === null || asset.dividend_yield === undefined) && existing && existing.dividend_yield !== null) {
            asset.dividend_yield = existing.dividend_yield;
          }
          if (!asset.market_cap && existing && existing.market_cap) {
            asset.market_cap = existing.market_cap;
          }
          if ((asset.high_52w === null || asset.high_52w === undefined) && existing && existing.high_52w !== null && existing.high_52w !== undefined) {
            asset.high_52w = existing.high_52w;
          }
          if ((asset.low_52w === null || asset.low_52w === undefined) && existing && existing.low_52w !== null && existing.low_52w !== undefined) {
            asset.low_52w = existing.low_52w;
          }
          marketDataMap.set(asset.symbol, asset);
        });
        if (data.last_updated) {
          lastUpdatedBadge.textContent = data.last_updated;
        }
        renderTable();
      }
    }
  } catch (err) {
    console.warn('Could not load baseline stocks.json:', err);
  }
}

function initTheme() {
  const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || 'dark';
  document.documentElement.className = savedTheme;
}

function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  const nextTheme = isDark ? 'light' : 'dark';
  document.documentElement.className = nextTheme;
  localStorage.setItem(STORAGE_KEYS.THEME, nextTheme);
  showToast(`สลับเป็นธีม ${nextTheme === 'dark' ? 'Dark' : 'Light'}`);
}

function initViewMode() {
  const savedView = localStorage.getItem(STORAGE_KEYS.VIEW_MODE);
  if (savedView && ['overview', 'technical', 'dividends', 'all'].includes(savedView)) {
    activeView = savedView;
  }
  updateViewSwitcherButtons();
}

function updateViewSwitcherButtons() {
  viewSwitcher.querySelectorAll('.view-btn').forEach(btn => {
    if (btn.dataset.view === activeView) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

/* ==========================================================================
   Watchlists State Management
   ========================================================================== */
function loadWatchlistsState() {
  const saved = localStorage.getItem(STORAGE_KEYS.WATCHLISTS);
  if (saved) {
    try {
      appWatchlists = JSON.parse(saved);
    } catch (e) {
      console.warn('Error reading saved watchlists:', e);
      appWatchlists = JSON.parse(JSON.stringify(DEFAULT_WATCHLISTS));
    }
  } else {
    appWatchlists = JSON.parse(JSON.stringify(DEFAULT_WATCHLISTS));
    saveWatchlists();
  }

  const savedActiveId = localStorage.getItem(STORAGE_KEYS.ACTIVE_LIST_ID);
  if (savedActiveId && appWatchlists[savedActiveId]) {
    activeListId = savedActiveId;
  } else {
    activeListId = Object.keys(appWatchlists)[0] || 'main';
  }

  renderWatchlistTabs();
}

function saveWatchlists() {
  localStorage.setItem(STORAGE_KEYS.WATCHLISTS, JSON.stringify(appWatchlists));
  localStorage.setItem(STORAGE_KEYS.ACTIVE_LIST_ID, activeListId);
}

function getActiveWatchlist() {
  if (!appWatchlists[activeListId]) {
    activeListId = Object.keys(appWatchlists)[0] || 'main';
  }
  return appWatchlists[activeListId] || { id: 'main', name: 'พอร์ตหลัก', symbols: [] };
}

function renderWatchlistTabs() {
  watchlistsTabsContainer.innerHTML = '';
  Object.values(appWatchlists).forEach(list => {
    const tab = document.createElement('button');
    tab.className = `watchlist-tab ${list.id === activeListId ? 'active' : ''}`;
    tab.innerHTML = `
      <span>${escapeHtml(list.name)}</span>
      <span class="tab-badge">${list.symbols.length}</span>
    `;
    tab.addEventListener('click', () => {
      if (activeListId !== list.id) {
        activeListId = list.id;
        saveWatchlists();
        renderWatchlistTabs();
        renderTable();
        fetchActiveListMarketData();
      }
    });
    watchlistsTabsContainer.appendChild(tab);
  });
}

function createNewWatchlist(name) {
  const listName = (name || '').trim() || `Watchlist ${Object.keys(appWatchlists).length + 1}`;
  const newId = 'list_' + Date.now();
  appWatchlists[newId] = {
    id: newId,
    name: listName,
    symbols: []
  };
  activeListId = newId;
  saveWatchlists();
  renderWatchlistTabs();
  renderTable();
  showToast(`🎉 สร้าง Watchlist "${listName}" เรียบร้อย`);
}

function deleteCurrentWatchlist() {
  const keys = Object.keys(appWatchlists);
  if (keys.length <= 1) {
    alert('ต้องมีอย่างน้อย 1 Watchlist ในระบบครับ');
    return;
  }
  const current = getActiveWatchlist();
  if (confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบ Watchlist "${current.name}"?`)) {
    delete appWatchlists[activeListId];
    activeListId = Object.keys(appWatchlists)[0];
    saveWatchlists();
    renderWatchlistTabs();
    renderTable();
    fetchActiveListMarketData();
    showToast(`🗑️ ลบ Watchlist เรียบร้อยแล้ว`);
  }
}

function duplicateCurrentWatchlist() {
  const current = getActiveWatchlist();
  const newId = 'list_' + Date.now();
  appWatchlists[newId] = {
    id: newId,
    name: `${current.name} (คัดลอก)`,
    symbols: [...current.symbols]
  };
  activeListId = newId;
  saveWatchlists();
  renderWatchlistTabs();
  renderTable();
  showToast(`📋 คัดลอก Watchlist เรียบร้อย`);
}

/* ==========================================================================
   Data Fetching Engine (Cloudflare Edge Function + Fallback)
   ========================================================================== */
function getApiEndpoint(path) {
  const isCloudflareOrLocal = window.location.hostname.includes('pages.dev') ||
    window.location.hostname.includes('workers.dev') ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';
  const base = isCloudflareOrLocal ? '' : 'https://watchvest.pages.dev';
  return `${base}${path}`;
}

async function fetchActiveListMarketData(forceRefresh = false) {
  const list = getActiveWatchlist();
  if (!list.symbols || list.symbols.length === 0) {
    renderTable();
    return;
  }

  setRefreshLoading(true);

  const symbolsParam = list.symbols.join(',');
  const cacheBuster = `&_t=${Date.now()}`;

  try {
    // 1. Try Cloudflare Pages Function endpoint
    const edgeUrl = getApiEndpoint(`/api/quote?symbols=${encodeURIComponent(symbolsParam)}${cacheBuster}`);
    const res = await fetch(edgeUrl, { cache: 'no-store' });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.assets)) {
        data.assets.forEach(asset => {
          const prev = marketDataMap.get(asset.symbol) || {};
          const merged = {
            ...prev,
            ...asset,
            market_cap: asset.market_cap || prev.market_cap || null,
            pe: (asset.pe !== null && asset.pe !== undefined) ? asset.pe : (prev.pe ?? null),
            dividend_yield: (asset.dividend_yield !== null && asset.dividend_yield !== undefined) ? asset.dividend_yield : (prev.dividend_yield ?? null),
            rsi_daily: (asset.rsi_daily !== null && asset.rsi_daily !== undefined) ? asset.rsi_daily : (prev.rsi_daily ?? null),
            rsi_weekly: (asset.rsi_weekly !== null && asset.rsi_weekly !== undefined) ? asset.rsi_weekly : (prev.rsi_weekly ?? null),
            rsi_monthly: (asset.rsi_monthly !== null && asset.rsi_monthly !== undefined) ? asset.rsi_monthly : (prev.rsi_monthly ?? null),
            high_52w: (asset.high_52w !== null && asset.high_52w !== undefined) ? asset.high_52w : (prev.high_52w ?? null),
            low_52w: (asset.low_52w !== null && asset.low_52w !== undefined) ? asset.low_52w : (prev.low_52w ?? null),
          };
          marketDataMap.set(asset.symbol, merged);
        });
        if (data.last_updated) {
          lastUpdatedBadge.textContent = data.last_updated;
        }
        renderTable();
        setRefreshLoading(false);
        if (forceRefresh) showToast('🎉 อัปเดตราคาและ RSI ล่าสุดเรียบร้อยแล้ว');
        return;
      }
    }
    throw new Error('Edge API not available or empty');
  } catch (err) {
    console.warn('Falling back to data/stocks.json:', err);
    // 2. Fallback to data/stocks.json
    try {
      const fallbackRes = await fetch(`data/stocks.json?t=${Date.now()}`, { cache: 'no-store' });
      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json();
        if (Array.isArray(fallbackData.assets)) {
          fallbackData.assets.forEach(asset => {
            const prev = marketDataMap.get(asset.symbol) || {};
            const merged = {
              ...prev,
              ...asset,
              pe: (asset.pe !== null && asset.pe !== undefined) ? asset.pe : (prev.pe ?? null),
              dividend_yield: (asset.dividend_yield !== null && asset.dividend_yield !== undefined) ? asset.dividend_yield : (prev.dividend_yield ?? null),
              rsi_daily: (asset.rsi_daily !== null && asset.rsi_daily !== undefined) ? asset.rsi_daily : (prev.rsi_daily ?? null),
              rsi_weekly: (asset.rsi_weekly !== null && asset.rsi_weekly !== undefined) ? asset.rsi_weekly : (prev.rsi_weekly ?? null),
              rsi_monthly: (asset.rsi_monthly !== null && asset.rsi_monthly !== undefined) ? asset.rsi_monthly : (prev.rsi_monthly ?? null),
              high_52w: (asset.high_52w !== null && asset.high_52w !== undefined) ? asset.high_52w : (prev.high_52w ?? null),
              low_52w: (asset.low_52w !== null && asset.low_52w !== undefined) ? asset.low_52w : (prev.low_52w ?? null),
            };
            marketDataMap.set(asset.symbol, merged);
          });
          if (fallbackData.last_updated) {
            lastUpdatedBadge.textContent = fallbackData.last_updated;
          }
        }
      }
    } catch (fbErr) {
      console.error('All fetch sources failed:', fbErr);
    }
  }

  setRefreshLoading(false);
  renderTable();
}

function setRefreshLoading(isLoading) {
  if (isLoading) {
    btnRefresh.disabled = true;
    btnRefresh.querySelector('.refresh-svg').classList.add('spin-anim');
    btnRefreshLabel.textContent = 'กำลังโหลด...';
  } else {
    btnRefresh.disabled = false;
    btnRefresh.querySelector('.refresh-svg').classList.remove('spin-anim');
    btnRefreshLabel.textContent = 'รีเฟรช';
  }
}

/* ==========================================================================
   Table Rendering & Columns (StockAnalysis Views)
   ========================================================================== */
function renderTable() {
  const currentList = getActiveWatchlist();
  const symbols = currentList.symbols || [];

  if (symbols.length === 0) {
    tableHeader.innerHTML = '';
    tableBody.innerHTML = '';
    emptyState.classList.remove('hidden');
    updateSummaryStats([]);
    return;
  }

  emptyState.classList.add('hidden');

  // Build items from map or placeholder
  let items = symbols.map(sym => {
    const data = marketDataMap.get(sym);
    if (data) return data;
    return {
      symbol: sym,
      name: sym,
      type: resolveAssetType(sym),
      currency: sym.startsWith('BKK:') ? 'THB' : sym.startsWith('HKG:') ? 'HKD' : 'USD',
      price: null,
      change_pct: null,
      pe: null,
      dividend_yield: null,
      rsi_daily: null,
      rsi_weekly: null,
      rsi_monthly: null,
      volume: null,
      high_52w: null,
      low_52w: null,
      stockanalysis_url: getStockAnalysisUrl(sym)
    };
  });

  // Category Filter
  if (activeCategory !== 'ALL') {
    if (activeCategory === 'SET') {
      items = items.filter(a => a.symbol.startsWith('BKK:'));
    } else {
      items = items.filter(a => a.type === activeCategory && !a.symbol.startsWith('BKK:'));
    }
  }

  // RSI Filter
  if (activeRsiFilter === 'OVERSOLD') {
    items = items.filter(a => a.rsi_daily !== null && a.rsi_daily < 30);
  } else if (activeRsiFilter === 'NEUTRAL') {
    items = items.filter(a => a.rsi_daily !== null && a.rsi_daily >= 30 && a.rsi_daily <= 70);
  } else if (activeRsiFilter === 'OVERBOUGHT') {
    items = items.filter(a => a.rsi_daily !== null && a.rsi_daily > 70);
  }

  // Search Filter within list
  if (tableSearchQuery) {
    const q = tableSearchQuery.toUpperCase();
    items = items.filter(a => a.symbol.toUpperCase().includes(q) || (a.name && a.name.toUpperCase().includes(q)));
  }

  // Sort items
  sortItems(items);

  // Render Table Header
  renderTableHeader();

  // Render Table Body
  renderTableBody(items);

  // Update Stats
  updateSummaryStats(items);
}

function renderTableHeader() {
  let thHtml = '';
  const makeTh = (colKey, label, align = 'left') => {
    const isSorted = currentSort.column === colKey;
    const sortCls = isSorted ? (currentSort.order === 'asc' ? 'sort-asc' : 'sort-desc') : '';
    const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : '';
    return `<th class="${sortCls} ${alignCls}" onclick="handleSort('${colKey}')">${label}</th>`;
  };

  if (activeView === 'overview') {
    thHtml = `
      <tr>
        <th style="width: 40px;" class="text-center">#</th>
        ${makeTh('symbol', 'Symbol / สินทรัพย์')}
        ${makeTh('price', 'ราคาล่าสุด', 'right')}
        ${makeTh('market_cap', 'Market Cap', 'right')}
        ${makeTh('change_pct', '% เปลี่ยนแปลง', 'right')}
        ${makeTh('pe', 'P/E Ratio', 'right')}
        ${makeTh('dividend_yield', 'Dividend Yield', 'right')}
        ${makeTh('high_52w', '52W High (%)', 'right')}
        ${makeTh('low_52w', '52W Low (%)', 'right')}
        <th class="text-center" style="width: 60px;">จัดการ</th>
      </tr>
    `;
  } else if (activeView === 'technical') {
    thHtml = `
      <tr>
        <th style="width: 40px;" class="text-center">#</th>
        ${makeTh('symbol', 'Symbol / สินทรัพย์')}
        ${makeTh('price', 'ราคาล่าสุด', 'right')}
        ${makeTh('change_pct', '% เปลี่ยนแปลง', 'right')}
        ${makeTh('rsi_daily', 'Daily RSI (14)', 'center')}
        ${makeTh('rsi_weekly', 'Weekly RSI (14)', 'center')}
        ${makeTh('rsi_monthly', 'Monthly RSI (14)', 'center')}
        <th class="text-center">โซน RSI</th>
        <th class="text-center" style="width: 60px;">จัดการ</th>
      </tr>
    `;
  } else if (activeView === 'dividends') {
    thHtml = `
      <tr>
        <th style="width: 40px;" class="text-center">#</th>
        ${makeTh('symbol', 'Symbol / สินทรัพย์')}
        ${makeTh('price', 'ราคาล่าสุด', 'right')}
        ${makeTh('change_pct', '% เปลี่ยนแปลง', 'right')}
        ${makeTh('dividend_yield', 'Dividend Yield (TTM)', 'right')}
        ${makeTh('pe', 'P/E Ratio', 'right')}
        <th class="text-center" style="width: 60px;">จัดการ</th>
      </tr>
    `;
  } else {
    // All Columns
    thHtml = `
      <tr>
        <th style="width: 40px;" class="text-center">#</th>
        ${makeTh('symbol', 'Symbol / สินทรัพย์')}
        ${makeTh('price', 'ราคาล่าสุด', 'right')}
        ${makeTh('market_cap', 'Market Cap', 'right')}
        ${makeTh('change_pct', '% เปลี่ยนแปลง', 'right')}
        ${makeTh('pe', 'P/E', 'right')}
        ${makeTh('dividend_yield', 'Div Yield', 'right')}
        ${makeTh('rsi_daily', 'Daily RSI', 'center')}
        ${makeTh('rsi_weekly', 'Weekly RSI', 'center')}
        ${makeTh('rsi_monthly', 'Monthly RSI', 'center')}
        ${makeTh('high_52w', '52W High (%)', 'right')}
        ${makeTh('low_52w', '52W Low (%)', 'right')}
        <th class="text-center" style="width: 60px;">จัดการ</th>
      </tr>
    `;
  }

  tableHeader.innerHTML = thHtml;
}

function renderTableBody(items) {
  if (items.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="12" class="text-center" style="padding: 40px; color: var(--text-muted);">ไม่พบข้อมูลสินทรัพย์ที่ตรงกับเงื่อนไขการค้นหา/กรอง</td></tr>`;
    return;
  }

  const rows = items.map((asset, idx) => {
    const symHtml = `
      <div class="symbol-cell">
        <a href="${asset.stockanalysis_url}" target="_blank" rel="noopener noreferrer" class="symbol-link" title="เปิดดูบน StockAnalysis.com">
          ${escapeHtml(asset.symbol)}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
        </a>
        <span class="badge-type ${getBadgeClass(asset.type)}">${escapeHtml(asset.type || 'STOCK')}</span>
        <span class="company-name" title="${escapeHtml(asset.name || '')}">${escapeHtml(asset.name || '')}</span>
      </div>
    `;

    const priceHtml = `<span class="price-val">${formatPrice(asset.price, asset.currency)}</span>`;
    const changeHtml = formatChange(asset.change_pct);
    const deleteBtn = `<button class="btn-row-action" onclick="removeSymbolFromCurrentList('${asset.symbol}')" title="ลบออกจาก Watchlist">&times;</button>`;

    if (activeView === 'overview') {
      return `
        <tr>
          <td class="text-center mono" style="color: var(--text-muted); font-size: 11px;">${idx + 1}</td>
          <td>${symHtml}</td>
          <td class="text-right">${priceHtml}</td>
          <td class="text-right mono" style="font-weight: 500;">${formatMarketCap(asset.market_cap)}</td>
          <td class="text-right">${changeHtml}</td>
          <td class="text-right mono">${formatVal(asset.pe)}</td>
          <td class="text-right mono">${formatPercent(asset.dividend_yield)}</td>
          <td class="text-right mono">${format52wHigh(asset)}</td>
          <td class="text-right mono">${format52wLow(asset)}</td>
          <td class="text-center">${deleteBtn}</td>
        </tr>
      `;
    } else if (activeView === 'technical') {
      const zoneBadge = getRsiZoneBadge(asset.rsi_daily);
      return `
        <tr>
          <td class="text-center mono" style="color: var(--text-muted); font-size: 11px;">${idx + 1}</td>
          <td>${symHtml}</td>
          <td class="text-right">${priceHtml}</td>
          <td class="text-right">${changeHtml}</td>
          <td class="text-center">${formatRsiPill(asset.rsi_daily)}</td>
          <td class="text-center">${formatRsiPill(asset.rsi_weekly)}</td>
          <td class="text-center">${formatRsiPill(asset.rsi_monthly)}</td>
          <td class="text-center">${zoneBadge}</td>
          <td class="text-center">${deleteBtn}</td>
        </tr>
      `;
    } else if (activeView === 'dividends') {
      return `
        <tr>
          <td class="text-center mono" style="color: var(--text-muted); font-size: 11px;">${idx + 1}</td>
          <td>${symHtml}</td>
          <td class="text-right">${priceHtml}</td>
          <td class="text-right">${changeHtml}</td>
          <td class="text-right mono" style="font-weight: 600; color: var(--green-text);">${formatPercent(asset.dividend_yield)}</td>
          <td class="text-right mono">${formatVal(asset.pe)}</td>
          <td class="text-center">${deleteBtn}</td>
        </tr>
      `;
    } else {
      // All Columns
      return `
        <tr>
          <td class="text-center mono" style="color: var(--text-muted); font-size: 11px;">${idx + 1}</td>
          <td>${symHtml}</td>
          <td class="text-right">${priceHtml}</td>
          <td class="text-right mono" style="font-weight: 500;">${formatMarketCap(asset.market_cap)}</td>
          <td class="text-right">${changeHtml}</td>
          <td class="text-right mono">${formatVal(asset.pe)}</td>
          <td class="text-right mono">${formatPercent(asset.dividend_yield)}</td>
          <td class="text-center">${formatRsiPill(asset.rsi_daily)}</td>
          <td class="text-center">${formatRsiPill(asset.rsi_weekly)}</td>
          <td class="text-center">${formatRsiPill(asset.rsi_monthly)}</td>
          <td class="text-right mono">${format52wHigh(asset)}</td>
          <td class="text-right mono">${format52wLow(asset)}</td>
          <td class="text-center">${deleteBtn}</td>
        </tr>
      `;
    }
  });

  tableBody.innerHTML = rows.join('');
}

/* ==========================================================================
   Formatting & Visual Helpers
   ========================================================================== */
function formatPrice(val, currency = 'USD') {
  if (val === null || val === undefined || isNaN(val)) return '-';
  let symbol = '$';
  if (currency === 'THB') symbol = '฿';
  else if (currency === 'HKD') symbol = 'HK$';
  else if (currency !== 'USD') symbol = currency + ' ';

  const formatted = val >= 1000 ? val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : val.toFixed(2);
  return `${symbol}${formatted}`;
}

function formatChange(val) {
  if (val === null || val === undefined || isNaN(val)) return '<span class="change-pill zero">-</span>';
  const isPos = val > 0;
  const isNeg = val < 0;
  const sign = isPos ? '+' : '';
  const arrow = isPos ? '▲ ' : isNeg ? '▼ ' : '';
  const cls = isPos ? 'pos' : isNeg ? 'neg' : 'zero';
  return `<span class="change-pill ${cls}">${arrow}${sign}${val.toFixed(2)}%</span>`;
}

function formatRsiPill(val) {
  if (val === null || val === undefined || isNaN(val)) return '<span class="text-muted">-</span>';
  let cls = 'rsi-neutral';
  if (val < 30) cls = 'rsi-oversold';
  else if (val > 70) cls = 'rsi-overbought';
  return `<span class="rsi-badge ${cls}">${val.toFixed(1)}</span>`;
}

function getRsiZoneBadge(val) {
  if (val === null || val === undefined || isNaN(val)) return '-';
  if (val < 30) return '<span style="color: var(--purple-text); font-weight: 600; font-size: 11px;">🟢 OVERSOLD</span>';
  if (val > 70) return '<span style="color: var(--red-text); font-weight: 600; font-size: 11px;">🔴 OVERBOUGHT</span>';
  return '<span style="color: var(--text-muted); font-size: 11px;">⚪ NEUTRAL</span>';
}

function formatVal(val) {
  if (val === null || val === undefined || isNaN(val)) return '-';
  return val.toFixed(2);
}

function formatPercent(val) {
  if (val === null || val === undefined || isNaN(val)) return '-';
  return `${val.toFixed(2)}%`;
}

function calculate52wHighPct(asset) {
  if (!asset || asset.price === null || asset.price === undefined ||
      asset.high_52w === null || asset.high_52w === undefined || asset.high_52w <= 0) {
    return null;
  }
  return ((asset.price - asset.high_52w) / asset.high_52w) * 100;
}

function calculate52wLowPct(asset) {
  if (!asset || asset.price === null || asset.price === undefined ||
      asset.low_52w === null || asset.low_52w === undefined || asset.low_52w <= 0) {
    return null;
  }
  return ((asset.price - asset.low_52w) / asset.low_52w) * 100;
}

function format52wHigh(asset) {
  const pct = calculate52wHighPct(asset);
  if (pct === null || isNaN(pct)) return '<span style="color: var(--text-muted);">-</span>';
  const isPos = pct > 0.001;
  const isZero = Math.abs(pct) <= 0.001;
  const sign = isPos ? '+' : '';
  const color = isPos ? 'var(--green-text)' : (isZero ? 'var(--text-muted)' : 'var(--red-text)');
  const highPriceStr = formatPrice(asset.high_52w, asset.currency);
  const curPriceStr = formatPrice(asset.price, asset.currency);
  const diffFromPrice = asset.price > 0 ? (((asset.high_52w - asset.price) / asset.price) * 100).toFixed(2) : '0.00';
  const tooltip = `52W High: ${highPriceStr} | ราคาล่าสุด: ${curPriceStr} (${pct < 0 ? 'ต่ำกว่า High ' : ''}${sign}${pct.toFixed(2)}% / ห่างจากราคาปัจจุบัน +${diffFromPrice}%)`;
  return `<span style="color: ${color}; font-weight: 500;" title="${escapeHtml(tooltip)}">${sign}${pct.toFixed(2)}%</span>`;
}

function format52wLow(asset) {
  const pct = calculate52wLowPct(asset);
  if (pct === null || isNaN(pct)) return '<span style="color: var(--text-muted);">-</span>';
  const isPos = pct > 0.001;
  const isZero = Math.abs(pct) <= 0.001;
  const sign = isPos ? '+' : '';
  const color = isPos ? 'var(--green-text)' : (isZero ? 'var(--text-muted)' : 'var(--red-text)');
  const lowPriceStr = formatPrice(asset.low_52w, asset.currency);
  const curPriceStr = formatPrice(asset.price, asset.currency);
  const diffFromPrice = asset.price > 0 ? (((asset.low_52w - asset.price) / asset.price) * 100).toFixed(2) : '0.00';
  const tooltip = `52W Low: ${lowPriceStr} | ราคาล่าสุด: ${curPriceStr} (${pct > 0 ? 'สูงกว่า Low ' : ''}${sign}${pct.toFixed(2)}% / ห่างจากราคาปัจจุบัน ${diffFromPrice}%)`;
  return `<span style="color: ${color}; font-weight: 500;" title="${escapeHtml(tooltip)}">${sign}${pct.toFixed(2)}%</span>`;
}

function formatVolume(val) {
  if (val === null || val === undefined || isNaN(val)) return '-';
  if (val >= 1e9) return (val / 1e9).toFixed(2) + 'B';
  if (val >= 1e6) return (val / 1e6).toFixed(2) + 'M';
  if (val >= 1e3) return (val / 1e3).toFixed(1) + 'K';
  return val.toLocaleString();
}

function formatMarketCap(val) {
  if (val === null || val === undefined || val === '') return '-';
  if (typeof val === 'string') return val;
  if (typeof val === 'number') {
    if (val >= 1e12) return (val / 1e12).toFixed(2) + 'T';
    if (val >= 1e9) return (val / 1e9).toFixed(2) + 'B';
    if (val >= 1e6) return (val / 1e6).toFixed(2) + 'M';
  }
  return String(val);
}

function getBadgeClass(type) {
  if (type === 'ETF') return 'badge-etf';
  if (type === 'CRYPTOCURRENCY') return 'badge-crypto';
  return 'badge-stock';
}

function resolveAssetType(sym) {
  if (sym.includes('-USD') || sym.includes('BTC') || sym.includes('ETH')) return 'CRYPTOCURRENCY';
  if (['SPYI', 'SCHD', 'VYMI', 'IAUI', 'ACWI', 'QQQ', 'SPY', 'VOO', 'VTI', 'JEPI', 'JEPQ', 'TLT', 'NVDL'].includes(sym)) return 'ETF';
  return 'STOCK';
}

function getStockAnalysisUrl(symbol) {
  const sym = symbol.trim();
  if (sym.includes(':')) {
    const parts = sym.split(':');
    return `https://stockanalysis.com/quote/${parts[0].toLowerCase()}/${parts[1].toUpperCase()}/`;
  }
  const cleanSym = symbol.toLowerCase().replace('-usd', '').replace('^', '').trim();
  const type = resolveAssetType(symbol);
  if (type === 'ETF') {
    return `https://stockanalysis.com/etf/${cleanSym}/`;
  } else if (type === 'CRYPTOCURRENCY') {
    return `https://stockanalysis.com/?s=${cleanSym.toUpperCase()}`;
  }
  return `https://stockanalysis.com/stocks/${cleanSym}/`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ==========================================================================
   Sorting Logic
   ========================================================================== */
function handleSort(column) {
  if (currentSort.column === column) {
    currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
  } else {
    currentSort.column = column;
    currentSort.order = 'asc';
  }
  renderTable();
}
window.handleSort = handleSort;

function sortItems(items) {
  const { column, order } = currentSort;
  const mult = order === 'asc' ? 1 : -1;

  items.sort((a, b) => {
    let valA = a[column];
    let valB = b[column];

    if (column === 'high_52w') {
      valA = calculate52wHighPct(a);
      valB = calculate52wHighPct(b);
    } else if (column === 'low_52w') {
      valA = calculate52wLowPct(a);
      valB = calculate52wLowPct(b);
    }

    if (valA === null || valA === undefined || isNaN(valA)) return 1;
    if (valB === null || valB === undefined || isNaN(valB)) return -1;

    if (typeof valA === 'string') {
      return valA.localeCompare(valB) * mult;
    }
    return (valA - valB) * mult;
  });
}

/* ==========================================================================
   Statistics Summary
   ========================================================================== */
function updateSummaryStats(items) {
  statTotal.textContent = items.length;

  let gainers = 0;
  let losers = 0;
  let oversold = 0;
  let overbought = 0;

  items.forEach(item => {
    if (item.change_pct !== null && !isNaN(item.change_pct)) {
      if (item.change_pct > 0) gainers++;
      else if (item.change_pct < 0) losers++;
    }
    if (item.rsi_daily !== null && !isNaN(item.rsi_daily)) {
      if (item.rsi_daily < 30) oversold++;
      else if (item.rsi_daily > 70) overbought++;
    }
  });

  statGainers.textContent = gainers;
  statLosers.textContent = losers;
  statOversold.textContent = oversold;
  statOverbought.textContent = overbought;
}

/* ==========================================================================
   Symbol Search & Autocomplete
   ========================================================================== */
async function handleSearchInput(e) {
  const query = e.target.value.trim();
  clearTimeout(searchDebounceTimer);

  if (query.length < 1) {
    searchDropdown.classList.add('hidden');
    searchDropdown.innerHTML = '';
    return;
  }

  searchDebounceTimer = setTimeout(async () => {
    try {
      const searchUrl = getApiEndpoint(`/api/search?q=${encodeURIComponent(query)}`);
      const res = await fetch(searchUrl);
      if (res.ok) {
        const data = await res.json();
        renderSearchDropdown(data.results || [], query);
        return;
      }
    } catch (err) {
      console.warn('Search API failed, fallback to local search:', err);
    }
    // Fallback search
    renderSearchDropdown([
      { symbol: query.toUpperCase(), name: `เพิ่ม ${query.toUpperCase()}`, type: 'STOCK' }
    ], query);
  }, 200);
}

function renderSearchDropdown(results, rawQuery) {
  if (results.length === 0) {
    searchDropdown.innerHTML = `
      <div class="search-dropdown-item" onclick="addSymbolToCurrentList('${rawQuery.toUpperCase()}')">
        <div class="dropdown-item-left">
          <div class="dropdown-symbol-row">
            <span class="dropdown-symbol">${escapeHtml(rawQuery.toUpperCase())}</span>
            <span class="dropdown-badge">CUSTOM</span>
          </div>
          <span class="dropdown-name">กดเพื่อเพิ่ม "${escapeHtml(rawQuery.toUpperCase())}" เข้าสู่ Watchlist</span>
        </div>
        <span class="dropdown-action-hint">+ เพิ่ม</span>
      </div>
    `;
    searchDropdown.classList.remove('hidden');
    return;
  }

  const itemsHtml = results.map(item => `
    <div class="search-dropdown-item" onclick="addSymbolToCurrentList('${item.symbol}')">
      <div class="dropdown-item-left">
        <div class="dropdown-symbol-row">
          <span class="dropdown-symbol">${escapeHtml(item.symbol)}</span>
          <span class="dropdown-badge">${escapeHtml(item.type || 'STOCK')}</span>
        </div>
        <span class="dropdown-name">${escapeHtml(item.name || item.symbol)}</span>
      </div>
      <span class="dropdown-action-hint">+ เพิ่ม</span>
    </div>
  `).join('');

  searchDropdown.innerHTML = itemsHtml;
  searchDropdown.classList.remove('hidden');
}

function addSymbolToCurrentList(symbol) {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return;

  const currentList = getActiveWatchlist();
  if (currentList.symbols.includes(sym)) {
    showToast(`⚠️ ${sym} อยู่ใน Watchlist แล้ว`);
    searchDropdown.classList.add('hidden');
    globalSearchInput.value = '';
    return;
  }

  currentList.symbols.push(sym);
  saveWatchlists();
  renderWatchlistTabs();
  renderTable();

  searchDropdown.classList.add('hidden');
  globalSearchInput.value = '';
  showToast(`✅ เพิ่ม ${sym} เข้าสู่ "${currentList.name}" แล้ว`);

  // Fetch data for the new symbol
  fetchActiveListMarketData();
}
window.addSymbolToCurrentList = addSymbolToCurrentList;

function removeSymbolFromCurrentList(symbol) {
  const currentList = getActiveWatchlist();
  currentList.symbols = currentList.symbols.filter(s => s !== symbol);
  saveWatchlists();
  renderWatchlistTabs();
  renderTable();
  showToast(`🗑️ ลบ ${symbol} ออกจาก Watchlist แล้ว`);
}
window.removeSymbolFromCurrentList = removeSymbolFromCurrentList;

/* ==========================================================================
   Event Listeners & Interactions
   ========================================================================== */
function setupEventListeners() {
  // Theme Toggle
  btnThemeToggle.addEventListener('click', toggleTheme);

  // Refresh Button
  btnRefresh.addEventListener('click', () => {
    fetchActiveListMarketData(true);
  });

  // Search Input & Autocomplete
  globalSearchInput.addEventListener('input', handleSearchInput);
  globalSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = globalSearchInput.value.trim().toUpperCase();
      if (val) addSymbolToCurrentList(val);
    }
  });

  // Close search dropdown on click outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-autocomplete-wrapper')) {
      searchDropdown.classList.add('hidden');
    }
    if (!e.target.closest('.watchlist-dropdown-wrapper')) {
      listMenuDropdown.classList.add('hidden');
    }
  });

  // Watchlist Actions
  btnNewWatchlist.addEventListener('click', () => {
    const name = prompt('กรุณาตั้งชื่อ Watchlist ใหม่:');
    if (name) createNewWatchlist(name);
  });

  btnListMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    listMenuDropdown.classList.toggle('hidden');
  });

  menuRenameList.addEventListener('click', () => {
    listMenuDropdown.classList.add('hidden');
    const current = getActiveWatchlist();
    renameInput.value = current.name;
    renameModal.classList.remove('hidden');
    renameInput.focus();
  });

  menuDuplicateList.addEventListener('click', () => {
    listMenuDropdown.classList.add('hidden');
    duplicateCurrentWatchlist();
  });

  menuDeleteList.addEventListener('click', () => {
    listMenuDropdown.classList.add('hidden');
    deleteCurrentWatchlist();
  });

  // Rename Modal
  btnCloseRename.addEventListener('click', () => renameModal.classList.add('hidden'));
  btnCancelRename.addEventListener('click', () => renameModal.classList.add('hidden'));
  btnConfirmRename.addEventListener('click', () => {
    const val = renameInput.value.trim();
    if (val) {
      const current = getActiveWatchlist();
      current.name = val;
      saveWatchlists();
      renderWatchlistTabs();
      renameModal.classList.add('hidden');
      showToast(`✏️ เปลี่ยนชื่อเป็น "${val}" เรียบร้อย`);
    }
  });

  // View Switcher Buttons
  viewSwitcher.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeView = btn.dataset.view;
      localStorage.setItem(STORAGE_KEYS.VIEW_MODE, activeView);
      updateViewSwitcherButtons();
      renderTable();
    });
  });

  // Category Pills
  categoryPills.querySelectorAll('.pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      categoryPills.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCategory = btn.dataset.cat;
      renderTable();
    });
  });

  // RSI Filter
  rsiZoneFilter.addEventListener('change', (e) => {
    activeRsiFilter = e.target.value;
    renderTable();
  });

  // Table Filter Input
  tableFilterInput.addEventListener('input', (e) => {
    tableSearchQuery = e.target.value.trim();
    renderTable();
  });

  // Seed default button in empty state
  btnSeedDefault.addEventListener('click', () => {
    const current = getActiveWatchlist();
    current.symbols = [
      'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'SCHD', 'BTC-USD', 'TSM',
      'SPYI', 'VYMI', 'BKK:CPALL', 'BKK:BDMS', 'BKK:GULF', 'IAUI'
    ];
    saveWatchlists();
    renderWatchlistTabs();
    fetchActiveListMarketData(true);
  });

  // Settings Modal
  btnOpenSettings.addEventListener('click', openSettingsModal);
  btnCloseSettings.addEventListener('click', closeSettingsModal);
  btnDoneSettings.addEventListener('click', closeSettingsModal);

  btnCopyModalJson.addEventListener('click', () => {
    navigator.clipboard.writeText(modalWatchlistJson.value);
    showToast('📋 คัดลอก JSON เรียบร้อยแล้ว');
  });

  btnApplyModalJson.addEventListener('click', () => {
    try {
      const parsed = JSON.parse(modalWatchlistJson.value);
      if (Array.isArray(parsed)) {
        const current = getActiveWatchlist();
        current.symbols = parsed.map(s => String(s).trim().toUpperCase()).filter(Boolean);
        saveWatchlists();
        renderWatchlistTabs();
        renderTable();
        fetchActiveListMarketData(true);
        showToast('✅ บันทึกรายการ Symbol สำเร็จ');
      } else {
        alert('รูปแบบ JSON ต้องเป็น Array เช่น ["NVDA", "MSFT"]');
      }
    } catch (err) {
      alert(`รูปแบบ JSON ไม่ถูกต้อง: ${err.message}`);
    }
  });

  btnSavePat.addEventListener('click', () => {
    const pat = modalGithubPat.value.trim();
    localStorage.setItem(STORAGE_KEYS.GITHUB_PAT, pat);
    showToast('🔑 บันทึก GitHub Token ลงในเครื่องเรียบร้อย');
  });

  btnSyncToGithub.addEventListener('click', handleSyncToGithub);

  btnResetToDefaults.addEventListener('click', () => {
    if (confirm('คุณต้องการรีเซ็ต Watchlist ทั้งหมดกลับเป็นค่าเริ่มต้นหรือไม่?')) {
      appWatchlists = JSON.parse(JSON.stringify(DEFAULT_WATCHLISTS));
      activeListId = 'main';
      saveWatchlists();
      renderWatchlistTabs();
      renderTable();
      fetchActiveListMarketData(true);
      closeSettingsModal();
      showToast('🔄 รีเซ็ตเป็นค่าเริ่มต้นเรียบร้อยแล้ว');
    }
  });
}

function openSettingsModal() {
  const current = getActiveWatchlist();
  modalWatchlistJson.value = JSON.stringify(current.symbols, null, 2);
  modalGithubPat.value = localStorage.getItem(STORAGE_KEYS.GITHUB_PAT) || '';
  githubSyncStatus.textContent = '';
  settingsModal.classList.remove('hidden');
}

function closeSettingsModal() {
  settingsModal.classList.add('hidden');
}

/* ==========================================================================
   GitHub Repository Direct Sync
   ========================================================================== */
async function handleSyncToGithub() {
  const token = modalGithubPat.value.trim();
  if (!token) {
    alert('กรุณากรอก GitHub Token ก่อนกดซิงก์');
    return;
  }
  localStorage.setItem(STORAGE_KEYS.GITHUB_PAT, token);
  githubSyncStatus.textContent = '⏳ กำลังติดต่อ GitHub API...';

  const current = getActiveWatchlist();

  try {
    // 1. Get current SHA of data/watchlist.json
    const getRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/data/watchlist.json`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    let sha = null;
    if (getRes.ok) {
      const getData = await getRes.json();
      sha = getData.sha;
    }

    githubSyncStatus.textContent = '⏳ กำลังบันทึก data/watchlist.json ไปยัง Repository...';
    const contentBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(current.symbols, null, 2) + '\n')));

    const putRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/data/watchlist.json`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `Update watchlist.json (${current.name}) from Watchvest UI`,
        content: contentBase64,
        sha: sha
      })
    });

    if (!putRes.ok) {
      const err = await putRes.json();
      throw new Error(err.message || 'PUT failed');
    }

    githubSyncStatus.textContent = '✅ ซิงก์ข้อมูลไปยัง GitHub Repository สำเร็จเรียบร้อย!';
    showToast('🚀 ซิงก์ข้อมูลเข้าสู่ GitHub เรียบร้อยแล้ว');
  } catch (err) {
    console.error('GitHub Sync Error:', err);
    githubSyncStatus.textContent = `❌ ข้อผิดพลาด: ${err.message}`;
    alert(`การซิงก์ล้มเหลว: ${err.message}`);
  }
}

/* ==========================================================================
   Toast Notification
   ========================================================================== */
function showToast(message, duration = 3500) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

// Start application
window.addEventListener('DOMContentLoaded', initApp);
