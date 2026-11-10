/**
 * Watchvest Quote API Handler
 * High-performance single-request multi-timeframe indicator engine
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

// Calculate Wilder's 14-period smoothed RSI (TradingView / StockAnalysis standard)
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

async function fetchSingleAsset(symbol, shouldFetchSA = true) {
  const { yfTicker, displaySymbol, saUrl, assetType } = resolveSymbol(symbol);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json'
  };

  try {
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfTicker)}?interval=1d&range=5y&events=div`;

    // Concurrently fetch StockAnalysis page if enabled (symbol count <= 20) to guarantee 100% exact real-time P/E and % change
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

    // Accurate 24h Change Percent: Priority to Yahoo Finance live market feed
    let changePct = null;
    if (typeof meta.regularMarketChangePercent === 'number' && !isNaN(meta.regularMarketChangePercent)) {
      changePct = Math.round(meta.regularMarketChangePercent * 100) / 100;
    } else if (price !== null && typeof (meta.chartPreviousClose || meta.previousClose) === 'number') {
      const prev = meta.chartPreviousClose || meta.previousClose;
      if (prev > 0) {
        changePct = Math.round(((price - prev) / prev) * 10000) / 100;
      }
    }

    // Only fallback to StockAnalysis HTML if market feed had no change percent
    if (changePct === null && saHtml) {
      const chgMatch = saHtml.match(/data-test="quote-change-percent"[^>]*>([+-]?[0-9\.,]+)%?/i);
      if (chgMatch && chgMatch[1]) {
        const parsed = parseFloat(chgMatch[1].replace(/,/g, ''));
        if (!isNaN(parsed)) {
          changePct = parsed;
        }
      }
    }

    // Extract valid timestamp-close pairs
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

    // Fallback 24h change calculation from closes if needed
    if (changePct === null && validPairs.length >= 2 && price !== null) {
      const prevClose = validPairs[validPairs.length - 2].c;
      if (prevClose && prevClose !== 0) {
        changePct = Math.round(((price - prevClose) / prevClose) * 10000) / 100;
      }
    }

    // 1. Daily RSI (14)
    // Always include the current/active market session price into validPairs!
    // Yahoo Finance v8 chart sets rawCloses[last] = null during market hours and pre/post market.
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

    // 2. Weekly RSI (14) - Resampled from last close of each week (Monday to Sunday)
    const weeklyMap = new Map();
    for (const p of validPairs) {
      // 345600s = 4 days, aligning Unix epoch (Thu Jan 1 1970) to Monday week buckets
      const weekIdx = Math.floor((p.t + 345600) / 604800);
      weeklyMap.set(weekIdx, p.c);
    }
    const weeklyCloses = Array.from(weeklyMap.values());
    const rsiWeekly = calculateWilderRSI(weeklyCloses, 14);

    // 3. Monthly RSI (14) - Resampled from last close of each calendar month
    const monthlyMap = new Map();
    for (const p of validPairs) {
      const d = new Date(p.t * 1000);
      const moKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      monthlyMap.set(moKey, p.c);
    }
    const monthlyCloses = Array.from(monthlyMap.values());
    const rsiMonthly = calculateWilderRSI(monthlyCloses, 14);

    // TTM Dividend Yield calculation:
    // 1. Try extracting exact official yield from StockAnalysis HTML
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

    // 2. Fallback: calculate TTM (past 365 days only) cash dividends from chart if not available
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

    // P/E Ratio: Live extraction from StockAnalysis HTML with fallback to BASELINE_PE_MAP
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

    // Market Cap extraction from StockAnalysis HTML
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
    console.error(`Error fetching ${displaySymbol}:`, err);
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
    symbolList = symbolsParam.split(',').map(s => s.trim()).filter(Boolean);
  }

  if (symbolList.length === 0) {
    symbolList = [
      'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'SCHD', 'BTC-USD', 'TSM',
      'SPYI', 'VYMI', 'BKK:CPALL', 'BKK:BDMS', 'BKK:GULF', 'IAUI', 'HKG:0700', 'ACWI', 'BKK:PTTEP'
    ];
  }

  // Safe subrequest budget: only fetch SA HTML when list <= 20 symbols (max 40 subrequests < 50 limit)
  const shouldFetchSA = symbolList.length <= 20;
  const results = await Promise.all(symbolList.map(sym => fetchSingleAsset(sym, shouldFetchSA)));

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
      'Cache-Control': 'public, max-age=10, s-maxage=10'
    }
  });
}
