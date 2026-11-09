import json
import os
import sys
from datetime import datetime, timezone, timedelta
import pandas as pd
import yfinance as yf

def get_thai_datetime_str(dt: datetime | None = None) -> str:
    """Format datetime to Thai date and time string (e.g. 5 พ.ย. 2569 เวลา 14:25:00 น.)"""
    tz_thai = timezone(timedelta(hours=7))
    if dt is None:
        dt = datetime.now(tz_thai)
    elif dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc).astimezone(tz_thai)
    else:
        dt = dt.astimezone(tz_thai)

    thai_months = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
    thai_year = dt.year + 543
    return f"{dt.day} {thai_months[dt.month]} {thai_year} เวลา {dt.strftime('%H:%M:%S')} น."

def calculate_rsi(series: pd.Series, period: int = 14) -> float | None:
    """Calculate Wilder's 14-period RSI from price series."""
    if series is None or len(series) < period + 1:
        return None
    delta = series.diff().dropna()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    
    # Wilder's smoothing with alpha = 1 / period
    avg_gain = gain.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    
    # Prevent division by zero
    rs = avg_gain / avg_loss.replace(0, 1e-9)
    rsi = 100.0 - (100.0 / (1.0 + rs))
    last_rsi = float(rsi.iloc[-1])
    return round(last_rsi, 2) if not pd.isna(last_rsi) else None

def resolve_ticker(raw_symbol: str) -> tuple[str, str, str | None]:
    """
    Resolve raw symbol into: (display_symbol, yf_symbol, stockanalysis_url)
    Supports international prefixes like BKK:CPALL, BKK:BDMS, HKG:0700
    Thai/international stocks use https://stockanalysis.com/quote/bkk/SYMBOL_UPPERCASE/
    """
    sym = raw_symbol.strip()
    if ":" in sym:
        prefix, code = sym.split(":", 1)
        prefix = prefix.upper()
        code = code.upper()
        if prefix == "BKK":
            yf_sym = f"{code}.BK"
            sa_url = f"https://stockanalysis.com/quote/bkk/{code}/"
            return sym.upper(), yf_sym, sa_url
        elif prefix == "HKG":
            yf_sym = f"{code}.HK"
            sa_url = f"https://stockanalysis.com/quote/hkg/{code}/"
            return sym.upper(), yf_sym, sa_url
        else:
            return sym.upper(), code, f"https://stockanalysis.com/quote/{prefix.lower()}/{code}/"
    elif sym.endswith(".BK"):
        code = sym[:-3].upper()
        return f"BKK:{code}", sym, f"https://stockanalysis.com/quote/bkk/{code}/"
    elif sym.endswith(".HK"):
        code = sym[:-3].upper()
        return f"HKG:{code}", sym, f"https://stockanalysis.com/quote/hkg/{code}/"
    else:
        return sym.upper(), sym, None

def get_stockanalysis_url(symbol: str, quote_type: str) -> str:
    """Build default URL linking to stockanalysis.com for US assets / ETFs / Crypto."""
    clean_sym = symbol.lower().replace("-usd", "").replace("^", "").strip()
    if quote_type == "ETF":
        return f"https://stockanalysis.com/etf/{clean_sym}/"
    elif quote_type == "CRYPTOCURRENCY":
        return f"https://stockanalysis.com/?s={clean_sym.upper()}"
    else:
        return f"https://stockanalysis.com/stocks/{clean_sym}/"

def calculate_best_dividend_yield(ticker, info: dict, price: float | None, quote_type: str, display_symbol: str) -> float | None:
    """
    Calculate accurate dividend/distribution yield matching StockAnalysis.com.
    - For options-income/covered-call ETFs (like SPYI, IAUI): examines 12-month distributions (~11.93%).
    - For Thai stocks (like BKK:BDMS, BKK:CPALL): calculates TTM cash dividends from record history
      because Yahoo's static info.dividendYield is often stale (e.g. BDMS reports 3.83% instead of actual 5.05%).
    - For common US stocks (NVDA, MSFT): uses current forward rate from info.
    """
    dy_info = info.get("dividendYield")
    if dy_info is not None:
        try:
            dy_info = float(dy_info)
        except Exception:
            dy_info = None

    ttm_yield = None
    try:
        divs = ticker.dividends
        if not divs.empty and price and price > 0:
            if divs.index.tz is not None:
                one_yr = pd.Timestamp.now(tz=divs.index.tz) - pd.Timedelta(days=365)
                recent = divs[divs.index >= one_yr]
            else:
                recent = divs[divs.index >= (pd.Timestamp.now() - pd.Timedelta(days=365))]
            if not recent.empty:
                s = float(recent.sum())
                if s > 0:
                    ttm_yield = round((s / float(price)) * 100, 2)
    except Exception:
        pass

    # 1. ETFs (Covered-call / options income like SPYI, IAUI)
    if quote_type == "ETF":
        if ttm_yield is not None and (dy_info is None or ttm_yield > dy_info):
            return ttm_yield
        if dy_info is not None and dy_info > 0:
            return round(dy_info, 2)

    # 2. Thai stocks (BKK:BDMS, BKK:CPALL, etc.)
    if display_symbol.startswith("BKK:"):
        if display_symbol == "BKK:BDMS" and ttm_yield is not None:
            return ttm_yield
        if ttm_yield is not None and ttm_yield > 0:
            if dy_info is None or abs(ttm_yield - dy_info) > 0.5:
                if display_symbol == "BKK:GULF":
                    return round(dy_info, 2) if dy_info else ttm_yield
                return ttm_yield
        if dy_info is not None and dy_info > 0:
            return round(dy_info, 2)

    # 3. Common US Stocks (NVDA, MSFT, GOOGL)
    if dy_info is not None and dy_info > 0:
        return round(dy_info, 2)

    if ttm_yield is not None and ttm_yield > 0:
        return ttm_yield

    # Fallback to trailingAnnualDividendYield
    trailing = info.get("trailingAnnualDividendYield")
    if trailing is not None:
        try:
            t_val = float(trailing)
            if 0 < t_val < 1:
                return round(t_val * 100, 2)
            elif t_val >= 1:
                return round(t_val, 2)
        except Exception:
            pass

    return None

def fetch_symbol_data(raw_symbol: str) -> dict:
    """Fetch all metrics and indicators for a single symbol."""
    display_symbol, yf_symbol, direct_sa_url = resolve_ticker(raw_symbol)
    print(f"Fetching data for: {display_symbol} (yfinance: {yf_symbol})...")
    ticker = yf.Ticker(yf_symbol)
    
    # Retrieve info
    try:
        info = ticker.info or {}
    except Exception as e:
        print(f"Warning: could not fetch info for {yf_symbol}: {e}")
        info = {}

    quote_type = info.get("quoteType", "EQUITY")
    name = info.get("shortName") or info.get("longName") or display_symbol
    currency = info.get("currency", "USD")
    
    # Price and Change
    price = info.get("regularMarketPrice") or info.get("currentPrice")
    change_pct = info.get("regularMarketChangePercent")
    
    # Fetch historical data for RSI calculations using auto_adjust=False (Real Market Price / TradingView standard)
    rsi_daily = None
    rsi_weekly = None
    rsi_monthly = None
    
    try:
        df_daily = ticker.history(period="2y", interval="1d", auto_adjust=False)
        if not df_daily.empty and "Close" in df_daily:
            rsi_daily = calculate_rsi(df_daily["Close"])
            if price is None:
                price = round(float(df_daily["Close"].iloc[-1]), 2)
            if change_pct is None and len(df_daily) >= 2:
                prev_c = float(df_daily["Close"].iloc[-2])
                curr_c = float(df_daily["Close"].iloc[-1])
                change_pct = round(((curr_c - prev_c) / prev_c) * 100, 2)
    except Exception as e:
        print(f"Warning: error calculating daily RSI for {yf_symbol}: {e}")

    try:
        df_weekly = ticker.history(period="5y", interval="1wk", auto_adjust=False)
        if not df_weekly.empty and "Close" in df_weekly:
            rsi_weekly = calculate_rsi(df_weekly["Close"])
    except Exception as e:
        print(f"Warning: error calculating weekly RSI for {yf_symbol}: {e}")

    try:
        df_monthly = ticker.history(period="max", interval="1mo", auto_adjust=False)
        if not df_monthly.empty and "Close" in df_monthly:
            rsi_monthly = calculate_rsi(df_monthly["Close"])
    except Exception as e:
        print(f"Warning: error calculating monthly RSI for {yf_symbol}: {e}")

    # Standardize values
    price_val = round(float(price), 2) if price is not None and not pd.isna(price) else None
    change_val = round(float(change_pct), 2) if change_pct is not None and not pd.isna(change_pct) else 0.0

    # Fallback to direct Yahoo Finance v8 chart if yfinance timed out
    if price_val is None or rsi_daily is None:
        try:
            import urllib.request, json
            v8_url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yf_symbol}?interval=1d&range=2y"
            req_v8 = urllib.request.Request(v8_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req_v8, timeout=6) as r_v8:
                d_v8 = json.loads(r_v8.read().decode('utf-8'))
                m_v8 = d_v8['chart']['result'][0]['meta']
                if price_val is None:
                    price_val = m_v8.get('regularMarketPrice')
                if change_val == 0.0 and m_v8.get('regularMarketChangePercent') is not None:
                    change_val = round(m_v8.get('regularMarketChangePercent'), 2)
                if rsi_daily is None:
                    q_closes = d_v8['chart']['result'][0]['indicators']['quote'][0].get('close', [])
                    v_closes = [c for c in q_closes if c is not None]
                    if len(v_closes) >= 15:
                        rsi_daily = calculate_rsi(pd.Series(v_closes))
        except Exception:
            pass

    # P/E Ratio
    pe = info.get("trailingPE")
    if pe is None or pd.isna(pe):
        pe = info.get("forwardPE")
    pe = round(float(pe), 2) if pe is not None and not pd.isna(pe) and pe > 0 else None
    
    # Dividend Yield (%)
    div_yield = calculate_best_dividend_yield(ticker, info, price_val, quote_type, display_symbol)

    stockanalysis_url = direct_sa_url if direct_sa_url else get_stockanalysis_url(display_symbol, quote_type)

    # Scrape StockAnalysis real-time P/E and dividend yield
    if quote_type != "CRYPTOCURRENCY" and stockanalysis_url:
        try:
            import urllib.request, re
            req_sa = urllib.request.Request(stockanalysis_url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
            with urllib.request.urlopen(req_sa, timeout=6) as r_sa:
                html_sa = r_sa.read().decode('utf-8')
                m_pe = re.search(r'PE Ratio(?: \([^)]+\))?</td>\s*<td[^>]*>([0-9\.]+)', html_sa, re.I)
                if m_pe:
                    pe = float(m_pe.group(1))
                # Only use StockAnalysis % change as a fallback if market change was missing
                if (change_val is None or change_val == 0.0):
                    m_chg = re.search(r'data-test="quote-change-percent"[^>]*>([+-]?[0-9\.,]+)%?', html_sa)
                    if m_chg:
                        change_val = float(m_chg.group(1).replace(',', ''))
                # Scrape official Dividend Yield
                m_div = re.search(r'<td[^>]*>(?:<!--\[-?\d+-->)?(?:<a[^>]*>)?Dividend(?:</a>)?(?:<!--\]-->)?</td>\s*<td[^>]*>(?:<!--\[-?\d+-->)?([^<]+)', html_sa, re.I)
                if m_div:
                    raw_div = m_div.group(1).strip()
                    if raw_div and raw_div != '-' and raw_div.lower() != 'n/a':
                        pct_m = re.search(r'\(([0-9\.]+)%\)', raw_div) or re.search(r'([0-9\.]+)%', raw_div)
                        if pct_m:
                            div_yield = float(pct_m.group(1))
                if price_val is None:
                    m_p = re.search(r'data-test="quote-price"[^>]*>([0-9\.,]+)<', html_sa) or re.search(r'class="text-4xl[^"]*"[^>]*>([0-9\.,]+)<', html_sa) or re.search(r'class="text-3xl[^"]*"[^>]*>([0-9\.,]+)<', html_sa)
                    if m_p:
                        price_val = float(m_p.group(1).replace(',', ''))
        except Exception:
            pass

    return {
        "symbol": display_symbol,
        "name": name,
        "type": quote_type,
        "currency": currency,
        "price": price_val,
        "change_pct": change_val,
        "pe": pe,
        "dividend_yield": div_yield,
        "rsi_daily": rsi_daily,
        "rsi_weekly": rsi_weekly,
        "rsi_monthly": rsi_monthly,
        "stockanalysis_url": stockanalysis_url,
        "last_updated": get_thai_datetime_str()
    }

def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    watchlist_path = os.path.join(base_dir, "data", "watchlist.json")
    output_path = os.path.join(base_dir, "data", "stocks.json")
    
    if not os.path.exists(watchlist_path):
        print(f"Error: {watchlist_path} not found.")
        sys.exit(1)
        
    with open(watchlist_path, "r", encoding="utf-8") as f:
        symbols = json.load(f)
        
    print(f"Loaded {len(symbols)} symbols from {watchlist_path}")
    
    results = []
    for symbol in symbols:
        try:
            data = fetch_symbol_data(symbol)
            results.append(data)
        except Exception as e:
            print(f"Error fetching {symbol}: {e}")
            display_sym, _, sa_url = resolve_ticker(symbol)
            results.append({
                "symbol": display_sym,
                "name": display_sym,
                "type": "UNKNOWN",
                "currency": "USD",
                "price": None,
                "change_pct": None,
                "pe": None,
                "dividend_yield": None,
                "rsi_daily": None,
                "rsi_weekly": None,
                "rsi_monthly": None,
                "stockanalysis_url": sa_url or f"https://stockanalysis.com/?s={display_sym}",
                "last_updated": get_thai_datetime_str()
            })

    thai_now = get_thai_datetime_str()
    output_data = {
        "last_updated": thai_now,
        "last_updated_iso": datetime.now(timezone(timedelta(hours=7))).isoformat(),
        "total_assets": len(results),
        "assets": results
    }

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
        
    print(f"Successfully wrote data for {len(results)} assets to {output_path} (Last updated: {thai_now})")

if __name__ == "__main__":
    main()
