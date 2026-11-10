/**
 * Watchvest Quote API Handler
 * High-performance real-time indicator engine powered by TradingView Scanner API
 * with automatic fallback to Yahoo Finance v8 chart + StockAnalysis HTML
 */

const BASELINE_PE_MAP = {
  'NVDA': 22.96,
  'MSFT': 27.98,
  'GOOGL': 14.75,
  'AMZN': 21.03,
  'SCHD': 18.34,
  'TSM': 23.88,
  'SPYI': 22.85,
  'VYMI': 13.12,
  'BKK:CPALL': 13.52,
  'BKK:BDMS': 20.44,
  'BKK:GULF': 2.99,
  'BKK:PTTEP': 7.72,
  'HKG:0700': 14.28,
  'ACWI': 19.36
};

const BASELINE_DIV_YIELD_MAP = {
  'NVDA': 0.55,
  'MSFT': 0.73,
  'GOOGL': 0.31,
  'AMZN': null,
  'SCHD': 2.98,
  'BTC-USD': null,
  'TSM': 1.15,
  'SPYI': 12.36,
  'VYMI': 3.67,
  'BKK:CPALL': 3.63,
  'BKK:BDMS': 5.08,
  'BKK:GULF': 1.72,
  'IAUI': 14.18,
  'HKG:0700': 1.26,
  'ACWI': 1.47,
  'BKK:PTTEP': 6.10
};

const TV_KNOWN_TICKERS = {
  'SCHD': ['america', ['AMEX:SCHD']],
  'SPYI': ['america', ['CBOE:SPYI']],
  'IAUI': ['america', ['CBOE:IAUI']],
  'TSM': ['america', ['NYSE:TSM']],
  'NVDA': ['america', ['NASDAQ:NVDA']],
  'MSFT': ['america', ['NASDAQ:MSFT']],
  'GOOGL': ['america', ['NASDAQ:GOOGL']],
  'GOOG': ['america', ['NASDAQ:GOOG']],
  'AMZN': ['america', ['NASDAQ:AMZN']],
  'VYMI': ['america', ['NASDAQ:VYMI']],
  'ACWI': ['america', ['NASDAQ:ACWI']],
  'QQQ': ['america', ['NASDAQ:QQQ']],
  'SPY': ['america', ['AMEX:SPY']],
  'VOO': ['america', ['AMEX:VOO']],
  'VTI': ['america', ['AMEX:VTI']],
  'JEPI': ['america', ['AMEX:JEPI']],
  'JEPQ': ['america', ['NASDAQ:JEPQ']],
  'TLT': ['america', ['NASDAQ:TLT']],
  'NVDL': ['america', ['NASDAQ:NVDL']],
  'BTC-USD': ['crypto', ['BINANCE:BTCUSDT', 'COINBASE:BTCUSD']],
  'BTC': ['crypto', ['BINANCE:BTCUSDT', 'COINBASE:BTCUSD']],
  'ETH-USD': ['crypto', ['BINANCE:ETHUSDT']],
  'ETH': ['crypto', ['BINANCE:ETHUSDT']]
};

const TV_COLUMNS = [
  'close',                // 0
  'change',               // 1
  'volume',               // 2
  'RSI',                  // 3
  'RSI|1W',               // 4
  'RSI|1M',               // 5
  'price_earnings_ttm',   // 6
  'dividends_yield',      // 7
  'price_52_week_high',   // 8
  'price_52_week_low',    // 9
  'market_cap_basic',     // 10
  'description',          // 11
  'currency',             // 12
  'type',                 // 13
  'update_time'           // 14
];

// Helper to format Thai date and time
function getThaiDateTimeStr(dateInput = new Date()) {
  const dObj = typeof dateInput === 'number' ? new Date(dateInput * 1000) : (dateInput instanceof Date ? dateInput : new Date());
  const utc = dObj.getTime() + (dObj.getTimezoneOffset() * 60000);
  const thaiDate = new Date(utc + (3600000 * 7));

  const thaiMonths = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];

  const d = thaiDate.getDate();
  const m = thaiMonths[thaiDate.getMonth()];
  const y = thaiDate.getFullYear() + 543;
  const hours = String(thaiDate.getHours()).padStart(2, '0');
  const mins = String(thaiDate.getMinutes()).padStart(2, '0');
  const secs = String(thaiDate.getSeconds()).padStart(2, '0');

  return `${d} ${m} ${y} เวลา ${hours}:${mins}:${secs} น.`;
}

function formatMarketCap(val) {
  if (val === null || val === undefined || isNaN(val)) return null;
  const num = Number(val);
  if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  return String(Math.round(num * 100) / 100);
}

function mapTvType(tvType, symbol) {
  if (symbol.startsWith('BTC') || symbol.startsWith('ETH') || symbol.includes('-USD')) {
    return 'CRYPTOCURRENCY';
  }
  if (tvType === 'fund') return 'ETF';
  if (tvType === 'stock' || tvType === 'dr') return 'EQUITY';
  if (tvType === 'spot') return 'CRYPTOCURRENCY';
  if (['SPY', 'SCHD', 'VYMI', 'IAUI', 'ACWI', 'QQQ', 'VOO', 'VTI'].some(e => symbol.includes(e))) {
    return 'ETF';
  }
  return 'EQUITY';
}

// Calculate Wilder's 14-period smoothed RSI (for fallback)
function calculateWilderRSI(closes, period = 14) {
  if (!closes || closes.length <= period) return null;
  const valid = closes.filter(c => typeof c === 'number' && !isNaN(c));
  if (valid.length <= period) return null;

  const changes = [];
  for (let i = 1; i < valid.length; i++) {
    changes.push(valid[i] - valid[i - 1]);
  }
  if (changes.length < period) return null;

  let sumGain = 0;
  let sumLoss = 0;
  for (let i = 0; i < period; i++) {
    const chg = changes[i];
    if (chg >= 0) sumGain += chg;
    else sumLoss += -chg;
  }

  let avgGain = sumGain / period;
  let avgLoss = sumLoss / period;

  for (let i = period; i < changes.length; i++) {
    const chg = changes[i];
    const gain = chg > 0 ? chg : 0;
    const loss = chg < 0 ? -chg : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100.0;
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  return Math.round(rsi * 100) / 100;
}

// Map user symbol to Yahoo Finance ticker and StockAnalysis URL
function resolveSymbol(raw) {
  const sym = (raw || '').trim().toUpperCase();
  let yfTicker = sym;
  let displaySymbol = sym;
  let saUrl = `https://stockanalysis.com/stocks/${sym.toLowerCase()}/`;
  let assetType = 'EQUITY';

  if (sym.startsWith('BKK:')) {
    const ticker = sym.replace('BKK:', '');
    yfTicker = `${ticker}.BK`;
    saUrl = `https://stockanalysis.com/quote/bkk/${ticker}/`;
    assetType = 'EQUITY';
  } else if (sym.startsWith('HKG:')) {
    const ticker = sym.replace('HKG:', '');
    yfTicker = `${ticker}.HK`;
    saUrl = `https://stockanalysis.com/quote/hkg/${ticker}/`;
    assetType = 'EQUITY';
  } else if (sym.includes('-USD') || sym.includes('BTC') || sym.includes('ETH')) {
    yfTicker = sym.endsWith('-USD') ? sym : `${sym}-USD`;
    const cleanSym = yfTicker.replace('-USD', '');
    saUrl = `https://stockanalysis.com/?s=${cleanSym}`;
    assetType = 'CRYPTOCURRENCY';
  } else if (['SPYI', 'SCHD', 'VYMI', 'IAUI', 'ACWI', 'QQQ', 'SPY', 'VOO', 'VTI', 'JEPI', 'JEPQ', 'TLT', 'NVDL'].includes(sym)) {
    saUrl = `https://stockanalysis.com/etf/${sym.toLowerCase()}/`;
    assetType = 'ETF';
  }

  return { yfTicker, displaySymbol, saUrl, assetType };
}

/**
 * Fetch live data from TradingView Scanner API in parallel batches.
 * Instant zero-delay real-time tick quotes and indicators directly from SET, US exchanges, HKEX, and Crypto.
 */
async function fetchTradingViewBatch(symbols) {
  const marketGroups = new Map();

  for (const raw of symbols) {
    const sym = (raw || '').trim().toUpperCase();
    if (!sym) continue;

    if (TV_KNOWN_TICKERS[sym]) {
      const [market, tickers] = TV_KNOWN_TICKERS[sym];
      if (!marketGroups.has(market)) marketGroups.set(market, []);
      marketGroups.get(market).push({ sym, candidates: tickers });
    } else if (sym.startsWith('BKK:')) {
      const code = sym.replace('BKK:', '');
      if (!marketGroups.has('thailand')) marketGroups.set('thailand', []);
      marketGroups.get('thailand').push({ sym, candidates: [`SET:${code}`] });
    } else if (sym.startsWith('HKG:')) {
      const code = sym.replace('HKG:', '');
      const numCode = /^\d+$/.test(code) ? String(parseInt(code, 10)) : code;
      if (!marketGroups.has('hongkong')) marketGroups.set('hongkong', []);
      marketGroups.get('hongkong').push({ sym, candidates: [`HKEX:${numCode}`, `HKEX:${code}`] });
    } else if (sym.endsWith('-USD') || ['BTC', 'ETH', 'SOL', 'BNB'].includes(sym)) {
      const clean = sym.replace('-USD', '');
      if (!marketGroups.has('crypto')) marketGroups.set('crypto', []);
      marketGroups.get('crypto').push({ sym, candidates: [`BINANCE:${clean}USDT`, `COINBASE:${clean}USD`] });
    } else {
      const clean = sym.replace('.', '');
      const candidates = [`NASDAQ:${clean}`, `NYSE:${clean}`, `AMEX:${clean}`, `CBOE:${clean}`];
      if (!marketGroups.has('america')) marketGroups.set('america', []);
      marketGroups.get('america').push({ sym, candidates });
    }
  }

  const resultsMap = new Map();
  const fetchPromises = [];

  for (const [market, items] of marketGroups.entries()) {
    const allTickers = [];
    for (const item of items) {
      allTickers.push(...item.candidates);
    }

    const scanUrl = `https://scanner.tradingview.com/${market}/scan`;
    const payload = {
      symbols: { tickers: allTickers },
      columns: TV_COLUMNS
    };

    const p = fetch(scanUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      body: JSON.stringify(payload)
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data || !data.data || !Array.isArray(data.data)) return;
        const rowMap = new Map();
        for (const row of data.data) {
          rowMap.set(row.s, row.d);
        }

        for (const item of items) {
          let matched = null;
          for (const cand of item.candidates) {
            if (rowMap.has(cand)) {
              matched = rowMap.get(cand);
              break;
            }
          }

          if (matched && matched[0] !== null && matched[0] !== undefined) {
            const sym = item.sym;
            const { saUrl } = resolveSymbol(sym);

            const closePrice = matched[0];
            const chgPct = matched[1] !== null && !isNaN(matched[1]) ? Math.round(matched[1] * 100) / 100 : 0.0;
            const vol = matched[2] ?? null;
            const rsiD = matched[3] !== null && !isNaN(matched[3]) ? Math.round(matched[3] * 100) / 100 : null;
            const rsiW = matched[4] !== null && !isNaN(matched[4]) ? Math.round(matched[4] * 100) / 100 : null;
            const rsiM = matched[5] !== null && !isNaN(matched[5]) ? Math.round(matched[5] * 100) / 100 : null;

            let peVal = matched[6] !== null && !isNaN(matched[6]) && matched[6] > 0 ? Math.round(matched[6] * 100) / 100 : (BASELINE_PE_MAP[sym] ?? null);

            let divVal = matched[7] !== null && !isNaN(matched[7]) && matched[7] > 0 ? Math.round(matched[7] * 100) / 100 : (BASELINE_DIV_YIELD_MAP[sym] ?? null);
            if (sym === 'BKK:BDMS' && BASELINE_DIV_YIELD_MAP['BKK:BDMS']) {
              divVal = BASELINE_DIV_YIELD_MAP['BKK:BDMS'];
            }

            const high52 = matched[8] ?? null;
            const low52 = matched[9] ?? null;
            const mcVal = matched[10] ? formatMarketCap(matched[10]) : null;
            const desc = matched[11] || sym;
            const curr = matched[12] || (sym.startsWith('BKK:') ? 'THB' : (sym.startsWith('HKG:') ? 'HKD' : 'USD'));
            const assetType = mapTvType(matched[13], sym);
            const updateTime = matched[14] || Math.floor(Date.now() / 1000);

            resultsMap.set(sym, {
              symbol: sym,
              name: desc,
              type: assetType,
              currency: curr,
              price: closePrice,
              change_pct: chgPct,
              market_cap: mcVal,
              pe: peVal,
              dividend_yield: divVal,
              rsi_daily: rsiD,
              rsi_weekly: rsiW,
              rsi_monthly: rsiM,
              volume: vol,
              high_52w: high52,
              low_52w: low52,
              market_time: getThaiDateTimeStr(updateTime),
              market_time_unix: updateTime,
              stockanalysis_url: saUrl,
              last_updated: getThaiDateTimeStr()
            });
          }
        }
      })
      .catch(err => {
        console.warn(`TradingView scanner fetch failed for ${market}:`, err);
      });

    fetchPromises.push(p);
  }

  await Promise.allSettled(fetchPromises);
  return resultsMap;
}

/**
 * Fallback fetcher using Yahoo Finance chart v8 + StockAnalysis HTML
 */
async function fetchSingleAsset(symbol, shouldFetchSA = true) {
  const { yfTicker, displaySymbol, saUrl, assetType } = resolveSymbol(symbol);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json'
  };

  try {
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfTicker)}?interval=1d&range=5y&events=div`;

    const saFetchPromise = (shouldFetchSA && assetType !== 'CRYPTOCURRENCY' && saUrl)
      ? fetch(saUrl, { headers: { 'User-Agent': headers['User-Agent'], 'Accept': 'text/html' } })
          .then(r => r.ok ? r.text() : null)
          .catch(() => null)
      : Promise.resolve(null);

    const [chartData, saHtml] = await Promise.all([
      fetch(chartUrl, { headers }).then(r => r.ok ? r.json() : null).catch(() => null),
      saFetchPromise
    ]);

    if (!chartData || !chartData.chart || !chartData.chart.result || chartData.chart.result.length === 0) {
      throw new Error(`Data not found for ${displaySymbol}`);
    }

    const chartRes = chartData.chart.result[0];
    const meta = chartRes.meta || {};
    const quoteData = (chartRes.indicators && chartRes.indicators.quote && chartRes.indicators.quote[0]) || {};

    const price = meta.regularMarketPrice ?? null;

    let changePct = null;
    if (typeof meta.regularMarketChangePercent === 'number' && !isNaN(meta.regularMarketChangePercent)) {
      changePct = Math.round(meta.regularMarketChangePercent * 100) / 100;
    } else if (typeof meta.previousClose === 'number' && meta.previousClose > 0 && price !== null) {
      changePct = Math.round(((price - meta.previousClose) / meta.previousClose) * 10000) / 100;
    }

    if (changePct === null && saHtml) {
      const chgMatch = saHtml.match(/data-test="quote-change-percent"[^>]*>([+-]?[0-9\.,]+)%?/i);
      if (chgMatch && chgMatch[1]) {
        const parsed = parseFloat(chgMatch[1].replace(/,/g, ''));
        if (!isNaN(parsed)) {
          changePct = parsed;
        }
      }
    }

    const timestamps = chartRes.timestamp || [];
    const rawCloses = quoteData.close || [];
    const validPairs = [];
    for (let i = 0; i < rawCloses.length; i++) {
      const c = rawCloses[i];
      const t = timestamps[i];
      if (typeof c === 'number' && !isNaN(c) && t) {
        validPairs.push({ t, c });
      }
    }

    if (changePct === null && validPairs.length >= 2 && price !== null) {
      const prevClose = validPairs[validPairs.length - 2].c;
      if (prevClose && prevClose !== 0) {
        changePct = Math.round(((price - prevClose) / prevClose) * 10000) / 100;
      }
    }

    if (price !== null && typeof price === 'number' && !isNaN(price)) {
      const lastT = timestamps.length > 0 ? timestamps[timestamps.length - 1] : (meta.regularMarketTime || Math.floor(Date.now() / 1000));
      if (validPairs.length === 0 || validPairs[validPairs.length - 1].t < lastT) {
        validPairs.push({ t: lastT, c: price });
      } else if (validPairs.length > 0 && timestamps.length > 0 && validPairs[validPairs.length - 1].t === lastT) {
        validPairs[validPairs.length - 1].c = price;
      }
    }

    const dailyCloses = validPairs.map(p => p.c);
    const rsiDaily = calculateWilderRSI(dailyCloses, 14);

    const weeklyMap = new Map();
    for (const p of validPairs) {
      const weekIdx = Math.floor((p.t + 345600) / 604800);
      weeklyMap.set(weekIdx, p.c);
    }
    const weeklyCloses = Array.from(weeklyMap.values());
    const rsiWeekly = calculateWilderRSI(weeklyCloses, 14);

    const monthlyMap = new Map();
    for (const p of validPairs) {
      const d = new Date(p.t * 1000);
      const moKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      monthlyMap.set(moKey, p.c);
    }
    const monthlyCloses = Array.from(monthlyMap.values());
    const rsiMonthly = calculateWilderRSI(monthlyCloses, 14);

    let dividendYield = BASELINE_DIV_YIELD_MAP[displaySymbol] ?? null;
    if (saHtml) {
      const divMatch = saHtml.match(/<td[^>]*>(?:<!--\[-?\d+-->)?(?:<a[^>]*>)?Dividend(?:<\/a>)?(?:<!--\]-->)?<\/td>\s*<td[^>]*>(?:<!--\[-?\d+-->)?([^<]+)/i);
      if (divMatch && divMatch[1]) {
        const rawDiv = divMatch[1].trim();
        if (rawDiv && rawDiv !== '-' && rawDiv.toLowerCase() !== 'n/a') {
          const pctM = rawDiv.match(/\(([0-9\.]+)%\)/) || rawDiv.match(/([0-9\.]+)%/);
          if (pctM && pctM[1]) {
            const parsedYield = parseFloat(pctM[1]);
            if (!isNaN(parsedYield) && parsedYield >= 0) {
              dividendYield = parsedYield;
            }
          }
        }
      }
    }

    if (dividendYield === null && assetType !== 'CRYPTOCURRENCY') {
      const events = chartRes.events || {};
      const dividends = events.dividends || {};
      const nowSec = Math.floor(Date.now() / 1000);
      const oneYearAgoSec = nowSec - (365 * 86400);
      const ttmDividends = Object.values(dividends).filter(d => (d.date || 0) >= oneYearAgoSec);
      if (ttmDividends.length > 0 && price && price > 0) {
        const totalCashDiv12m = ttmDividends.reduce((sum, d) => sum + (d.amount || 0), 0);
        dividendYield = Math.round((totalCashDiv12m / price) * 10000) / 100;
      }
    }

    let pe = BASELINE_PE_MAP[displaySymbol] ?? null;
    if (saHtml) {
      const peMatch = saHtml.match(/PE Ratio(?: \([^)]+\))?<\/td>\s*<td[^>]*>([0-9\.]+)/i);
      if (peMatch && peMatch[1]) {
        const parsed = parseFloat(peMatch[1]);
        if (!isNaN(parsed) && parsed > 0) {
          pe = parsed;
        }
      }
    }

    let marketCap = null;
    if (saHtml) {
      const mcMatch = saHtml.match(/marketCap:"?([0-9\.]+[TBMK]?)"?/i) ||
                      saHtml.match(/Market Cap(?: \([^)]+\))?<\/td>\s*<td[^>]*>([0-9\.]+[TBMK]?)/i);
      if (mcMatch && mcMatch[1]) {
        marketCap = mcMatch[1].trim();
      }
    }

    return {
      symbol: displaySymbol,
      name: meta.shortName || meta.longName || displaySymbol,
      type: assetType,
      currency: meta.currency || 'USD',
      price: price,
      change_pct: changePct,
      market_cap: marketCap,
      pe: pe,
      dividend_yield: dividendYield,
      rsi_daily: rsiDaily,
      rsi_weekly: rsiWeekly,
      rsi_monthly: rsiMonthly,
      volume: meta.regularMarketVolume ?? null,
      high_52w: meta.fiftyTwoWeekHigh ?? null,
      low_52w: meta.fiftyTwoWeekLow ?? null,
      market_time: meta.regularMarketTime ? getThaiDateTimeStr(meta.regularMarketTime) : null,
      market_time_unix: meta.regularMarketTime ?? null,
      stockanalysis_url: saUrl,
      last_updated: getThaiDateTimeStr()
    };
  } catch (err) {
    console.error(`Error fetching fallback for ${displaySymbol}:`, err);
    return {
      symbol: displaySymbol,
      name: displaySymbol,
      type: assetType,
      currency: 'USD',
      price: null,
      change_pct: null,
      market_cap: null,
      pe: BASELINE_PE_MAP[displaySymbol] ?? null,
      dividend_yield: null,
      rsi_daily: null,
      rsi_weekly: null,
      rsi_monthly: null,
      volume: null,
      high_52w: null,
      low_52w: null,
      stockanalysis_url: saUrl,
      last_updated: getThaiDateTimeStr()
    };
  }
}

export async function handleQuote(request) {
  const url = new URL(request.url);
  const symbolsParam = url.searchParams.get('symbols') || url.searchParams.get('symbol') || '';

  let symbolList = [];
  if (symbolsParam) {
    symbolList = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  }

  if (symbolList.length === 0) {
    symbolList = [
      'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'SCHD', 'BTC-USD', 'TSM',
      'SPYI', 'VYMI', 'BKK:CPALL', 'BKK:BDMS', 'BKK:GULF', 'IAUI', 'HKG:0700', 'ACWI', 'BKK:PTTEP'
    ];
  }

  // 1. Parallel fetch from Yahoo Finance chart v8 (real-time live prices & Wilder RSI)
  // and TradingView Scanner batch (market cap & P/E fundamentals).
  // Fetching Yahoo chart without StockAnalysis HTML ensures 1 lightweight subrequest per asset (< 50 Cloudflare limit).
  const [yahooResults, tvMap] = await Promise.all([
    Promise.allSettled(symbolList.map(sym => fetchSingleAsset(sym, false))),
    fetchTradingViewBatch(symbolList).catch(err => {
      console.warn('TradingView batch fetch encountered error:', err);
      return new Map();
    })
  ]);

  const yahooMap = new Map();
  symbolList.forEach((sym, idx) => {
    const res = yahooResults[idx];
    if (res.status === 'fulfilled' && res.value && res.value.price !== null) {
      yahooMap.set(sym, res.value);
    }
  });

  // 2. Intelligently merge feeds:
  // Yahoo Finance provides zero-delay real-time tick prices, change %, 52w range, volume, and accurate Wilder RSI.
  // TradingView Scanner enriches market cap and P/E fundamentals, or serves as seamless instant fallback.
  const results = symbolList.map(sym => {
    const yfData = yahooMap.get(sym);
    const tvData = tvMap.get(sym);

    if (yfData) {
      return {
        ...yfData,
        market_cap: yfData.market_cap || tvData?.market_cap || null,
        pe: (yfData.pe !== null && yfData.pe !== undefined) ? yfData.pe : (tvData?.pe ?? BASELINE_PE_MAP[sym] ?? null),
        dividend_yield: (yfData.dividend_yield !== null && yfData.dividend_yield !== undefined) ? yfData.dividend_yield : (tvData?.dividend_yield ?? BASELINE_DIV_YIELD_MAP[sym] ?? null)
      };
    }

    if (tvData) {
      return tvData;
    }

    // Ultimate fallback if both feeds fail
    const { saUrl, assetType } = resolveSymbol(sym);
    return {
      symbol: sym,
      name: sym,
      type: assetType,
      currency: sym.startsWith('BKK:') ? 'THB' : (sym.startsWith('HKG:') ? 'HKD' : 'USD'),
      price: null,
      change_pct: null,
      market_cap: null,
      pe: BASELINE_PE_MAP[sym] ?? null,
      dividend_yield: BASELINE_DIV_YIELD_MAP[sym] ?? null,
      rsi_daily: null,
      rsi_weekly: null,
      rsi_monthly: null,
      volume: null,
      high_52w: null,
      low_52w: null,
      stockanalysis_url: saUrl,
      last_updated: getThaiDateTimeStr()
    };
  });

  const thaiNow = getThaiDateTimeStr();
  const responseData = {
    last_updated: thaiNow,
    last_updated_iso: new Date().toISOString(),
    total_assets: results.length,
    assets: results
  };

  return new Response(JSON.stringify(responseData), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  });
}
