/**
 * Watchvest Search API Handler
 * Proxies and normalizes search autocomplete queries
 */

const THAI_TOP_STOCKS = [
  { symbol: 'BKK:CPALL', name: 'CP ALL Public Company Limited', type: 'STOCK', exchange: 'SET' },
  { symbol: 'BKK:BDMS', name: 'Bangkok Dusit Medical Services', type: 'STOCK', exchange: 'SET' },
  { symbol: 'BKK:GULF', name: 'Gulf Energy Development', type: 'STOCK', exchange: 'SET' },
  { symbol: 'BKK:PTTEP', name: 'PTT Exploration and Production', type: 'STOCK', exchange: 'SET' },
  { symbol: 'BKK:PTT', name: 'PTT Public Company Limited', type: 'STOCK', exchange: 'SET' },
  { symbol: 'BKK:AOT', name: 'Airports of Thailand', type: 'STOCK', exchange: 'SET' },
  { symbol: 'BKK:ADVANC', name: 'Advanced Info Service', type: 'STOCK', exchange: 'SET' },
  { symbol: 'BKK:KBANK', name: 'Kasikornbank Public Company Limited', type: 'STOCK', exchange: 'SET' },
  { symbol: 'BKK:SCB', name: 'SCB X Public Company Limited', type: 'STOCK', exchange: 'SET' },
  { symbol: 'BKK:DELTA', name: 'Delta Electronics (Thailand)', type: 'STOCK', exchange: 'SET' }
];

export async function handleSearch(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();

  if (!q || q.length < 1) {
    return new Response(JSON.stringify({ status: 200, results: [] }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  const queryUpper = q.toUpperCase();
  const matchedThai = THAI_TOP_STOCKS.filter(
    s => s.symbol.includes(queryUpper) || s.name.toUpperCase().includes(queryUpper)
  );

  let externalResults = [];
  try {
    const saUrl = `https://stockanalysis.com/api/search?q=${encodeURIComponent(q)}`;
    const saRes = await fetch(saUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    if (saRes.ok) {
      const data = await saRes.json();
      if (Array.isArray(data.data)) {
        externalResults = data.data.slice(0, 10).map(item => {
          let assetType = 'STOCK';
          if (item.t === 'e' || item.st === 'e') assetType = 'ETF';
          else if (item.t === 'c' || item.st === 'c') assetType = 'CRYPTO';

          let symbol = item.s || item.id;
          if (symbol.includes('/')) {
            const parts = symbol.split('/');
            symbol = `${parts[0].toUpperCase()}:${parts[1].toUpperCase()}`;
          }

          let linkUrl = `https://stockanalysis.com/stocks/${(item.s || item.id).toLowerCase()}/`;
          if (assetType === 'ETF') {
            linkUrl = `https://stockanalysis.com/etf/${(item.s || item.id).toLowerCase()}/`;
          } else if (symbol.includes(':')) {
            const p = symbol.split(':');
            linkUrl = `https://stockanalysis.com/quote/${p[0].toLowerCase()}/${p[1].toUpperCase()}/`;
          }

          return {
            symbol: symbol,
            name: item.n || item.name || symbol,
            type: assetType,
            url: linkUrl
          };
        });
      }
    }
  } catch (err) {
    console.error('StockAnalysis search error:', err);
  }

  // Combine results with Thai stocks
  const combined = [...matchedThai, ...externalResults];
  const seen = new Set();
  const deduplicated = [];
  for (const item of combined) {
    if (!seen.has(item.symbol)) {
      seen.add(item.symbol);
      deduplicated.push(item);
    }
  }

  return new Response(JSON.stringify({ status: 200, results: deduplicated }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300'
    }
  });
}
