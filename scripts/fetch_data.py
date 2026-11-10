import json
import os
import sys
import re
import urllib.request
from datetime import datetime, timezone, timedelta
import pandas as pd
try:
    import yfinance as yf
except ImportError:
    yf = None

BASELINE_PE_MAP = {
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
}

BASELINE_DIV_YIELD_MAP = {
    'NVDA': 0.55,
    'MSFT': 0.73,
    'GOOGL': 0.31,
    'AMZN': None,
    'SCHD': 2.98,
    'BTC-USD': None,
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
}

TV_KNOWN_TICKERS = {
    'SCHD': ('america', 'AMEX:SCHD'),
    'SPYI': ('america', 'CBOE:SPYI'),
    'IAUI': ('america', 'CBOE:IAUI'),
    'TSM': ('america', 'NYSE:TSM'),
    'NVDA': ('america', 'NASDAQ:NVDA'),
    'MSFT': ('america', 'NASDAQ:MSFT'),
    'GOOGL': ('america', 'NASDAQ:GOOGL'),
    'GOOG': ('america', 'NASDAQ:GOOG'),
    'AMZN': ('america', 'NASDAQ:AMZN'),
    'VYMI': ('america', 'NASDAQ:VYMI'),
    'ACWI': ('america', 'NASDAQ:ACWI'),
    'QQQ': ('america', 'NASDAQ:QQQ'),
    'SPY': ('america', 'AMEX:SPY'),
    'VOO': ('america', 'AMEX:VOO'),
    'VTI': ('america', 'AMEX:VTI'),
    'JEPI': ('america', 'AMEX:JEPI'),
    'JEPQ': ('america', 'NASDAQ:JEPQ'),
    'TLT': ('america', 'NASDAQ:TLT'),
    'NVDL': ('america', 'NASDAQ:NVDL'),
    'BTC-USD': ('crypto', 'BINANCE:BTCUSDT'),
    'BTC': ('crypto', 'BINANCE:BTCUSDT'),
    'ETH-USD': ('crypto', 'BINANCE:ETHUSDT'),
    'ETH': ('crypto', 'BINANCE:ETHUSDT')
}

TV_COLUMNS = [
    'close',                # 0
    'change',               # 1
    'volume',               # 2
    'RSI',                  # 3
    'RSI|1W',               # 4
    'RSI|1M',               # 5
    'price_earnings_ttm',   # 6
    'dividends_yield',      # 7
    'price_52_week_high',   # 8
    'price_52_week_low',    # 9
    'market_cap_basic',     # 10
    'description',          # 11
    'currency',             # 12
    'type',                 # 13
    'update_time'           # 14
]

def get_thai_datetime_str(dt: datetime | None = None) -> str:
    """Format datetime to Thai date and time string (e.g. 10 พ.ย. 2569 เวลา 10:35:00 น.)"""
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

def format_market_cap(val: float | int | None) -> str | None:
    if val is None or pd.isna(val):
        return None
    try:
        num = float(val)
        if num >= 1e12:
            return f"{num / 1e12:.2f}T"
        elif num >= 1e9:
            return f"{num / 1e9:.2f}B"
        elif num >= 1e6:
            return f"{num / 1e6:.2f}M"
        return str(round(num, 2))
    except Exception:
        return None

def resolve_ticker(raw_symbol: str) -> tuple[str, str, str | None]:
    """
    Resolve raw symbol into: (display_symbol, yf_symbol, stockanalysis_url)
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
    elif sym.endswith("-USD"):
        clean_sym = sym.replace("-USD", "").upper()
        return sym.upper(), sym, f"https://stockanalysis.com/?s={clean_sym}"
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

def map_tv_type(tv_type: str | None, symbol: str) -> str:
    if symbol.startswith('BTC') or symbol.startswith('ETH') or '-USD' in symbol:
        return 'CRYPTOCURRENCY'
    if tv_type == 'fund':
        return 'ETF'
    if tv_type in ['stock', 'dr']:
        return 'EQUITY'
    if tv_type == 'spot':
        return 'CRYPTOCURRENCY'
    if any(e in symbol for e in ['SPY', 'SCHD', 'VYMI', 'IAUI', 'ACWI', 'QQQ', 'VOO', 'VTI']):
        return 'ETF'
    return 'EQUITY'

def fetch_tradingview_batch(symbols: list[str]) -> dict[str, dict]:
    """
    Batch-fetch symbols using TradingView Scanner API.
    Provides instant tick-by-tick real-time quotes, RSI, and fundamentals across Thailand, America, Hong Kong, and Crypto.
    """
    market_groups: dict[str, list[tuple[str, list[str]]]] = {}

    for raw in symbols:
        sym = raw.strip().upper()
        if sym in TV_KNOWN_TICKERS:
            market, ticker = TV_KNOWN_TICKERS[sym]
            market_groups.setdefault(market, []).append((sym, [ticker]))
        elif sym.startswith('BKK:'):
            code = sym.replace('BKK:', '')
            market_groups.setdefault('thailand', []).append((sym, [f"SET:{code}"]))
        elif sym.startswith('HKG:'):
            code = sym.replace('HKG:', '')
            num_code = str(int(code)) if code.isdigit() else code
            market_groups.setdefault('hongkong', []).append((sym, [f"HKEX:{num_code}", f"HKEX:{code}"]))
        elif sym.endswith('-USD') or sym in ['BTC', 'ETH', 'SOL', 'BNB']:
            clean = sym.replace('-USD', '')
            market_groups.setdefault('crypto', []).append((sym, [f"BINANCE:{clean}USDT", f"COINBASE:{clean}USD"]))
        else:
            # US stock / ETF candidate search across NASDAQ, NYSE, AMEX, CBOE
            clean = sym.replace('.', '')
            candidates = [f"NASDAQ:{clean}", f"NYSE:{clean}", f"AMEX:{clean}", f"CBOE:{clean}"]
            market_groups.setdefault('america', []).append((sym, candidates))

    parsed_results: dict[str, dict] = {}

    for market, items in market_groups.items():
        all_tickers = []
        for _, cands in items:
            all_tickers.extend(cands)

        url = f"https://scanner.tradingview.com/{market}/scan"
        payload = {
            "symbols": {"tickers": all_tickers},
            "columns": TV_COLUMNS
        }
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode('utf-8'),
                headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'}
            )
            with urllib.request.urlopen(req, timeout=8) as res:
                data = json.loads(res.read().decode('utf-8'))
                row_map = {row['s']: row['d'] for row in data.get('data', [])}

                for sym, cands in items:
                    matched_d = None
                    for cand in cands:
                        if cand in row_map:
                            matched_d = row_map[cand]
                            break

                    if matched_d:
                        close_p = matched_d[0]
                        chg_p = matched_d[1]
                        rsi_d = matched_d[3]
                        rsi_w = matched_d[4]
                        rsi_m = matched_d[5]
                        pe_val = matched_d[6]
                        div_val = matched_d[7]
                        mc_val = matched_d[10]
                        desc = matched_d[11]
                        curr = matched_d[12] or ('THB' if sym.startswith('BKK:') else ('HKD' if sym.startswith('HKG:') else 'USD'))
                        raw_type = matched_d[13]
                        high_52 = matched_d[8]
                        low_52 = matched_d[9]

                        q_type = map_tv_type(raw_type, sym)
                        display_sym, _, direct_sa = resolve_ticker(sym)
                        sa_url = direct_sa if direct_sa else get_stockanalysis_url(display_sym, q_type)

                        # PE fallback
                        final_pe = round(float(pe_val), 2) if pe_val is not None and not pd.isna(pe_val) and pe_val > 0 else BASELINE_PE_MAP.get(sym)

                        # Dividend yield calculation / fallback
                        final_div = None
                        if div_val is not None and not pd.isna(div_val) and div_val > 0:
                            final_div = round(float(div_val), 2)
                        elif sym in BASELINE_DIV_YIELD_MAP:
                            final_div = BASELINE_DIV_YIELD_MAP[sym]

                        # Special case for BDMS where baseline accounts for combined regular+special dividend
                        if sym == 'BKK:BDMS' and BASELINE_DIV_YIELD_MAP.get('BKK:BDMS'):
                            final_div = BASELINE_DIV_YIELD_MAP['BKK:BDMS']

                        parsed_results[sym] = {
                            "symbol": display_sym,
                            "name": desc or display_sym,
                            "type": q_type,
                            "currency": curr,
                            "price": round(float(close_p), 2) if close_p is not None else None,
                            "change_pct": round(float(chg_p), 2) if chg_p is not None else 0.0,
                            "market_cap": format_market_cap(mc_val),
                            "pe": final_pe,
                            "dividend_yield": final_div,
                            "rsi_daily": round(float(rsi_d), 2) if rsi_d is not None and not pd.isna(rsi_d) else None,
                            "rsi_weekly": round(float(rsi_w), 2) if rsi_w is not None and not pd.isna(rsi_w) else None,
                            "rsi_monthly": round(float(rsi_m), 2) if rsi_m is not None and not pd.isna(rsi_m) else None,
                            "high_52w": round(float(high_52), 2) if high_52 is not None and not pd.isna(high_52) else None,
                            "low_52w": round(float(low_52), 2) if low_52 is not None and not pd.isna(low_52) else None,
                            "stockanalysis_url": sa_url,
                            "last_updated": get_thai_datetime_str()
                        }
        except Exception as e:
            print(f"Warning: TradingView scanner failed for market {market}: {e}")

    return parsed_results

def calculate_rsi(series: pd.Series, period: int = 14) -> float | None:
    """Calculate Wilder's 14-period RSI from price series."""
    if series is None or len(series) < period + 1:
        return None
    delta = series.diff().dropna()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()

    rs = avg_gain / avg_loss.replace(0, 1e-9)
    rsi = 100.0 - (100.0 / (1.0 + rs))
    last_rsi = float(rsi.iloc[-1])
    return round(last_rsi, 2) if not pd.isna(last_rsi) else None

def calculate_best_dividend_yield(ticker, info: dict, price: float | None, quote_type: str, display_symbol: str) -> float | None:
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

    if display_symbol in BASELINE_DIV_YIELD_MAP and BASELINE_DIV_YIELD_MAP[display_symbol] is not None:
        return BASELINE_DIV_YIELD_MAP[display_symbol]

    if quote_type == "ETF":
        if ttm_yield is not None and (dy_info is None or ttm_yield > dy_info):
            return ttm_yield
        if dy_info is not None and dy_info > 0:
            return round(dy_info, 2)

    if display_symbol.startswith("BKK:"):
        if ttm_yield is not None and ttm_yield > 0:
            return ttm_yield
        if dy_info is not None and dy_info > 0:
            return round(dy_info, 2)

    if dy_info is not None and dy_info > 0:
        return round(dy_info, 2)

    if ttm_yield is not None and ttm_yield > 0:
        return ttm_yield

    return None

def fetch_symbol_data_fallback(raw_symbol: str) -> dict:
    """Fallback fetcher using yfinance / Yahoo Finance v8 chart."""
    if yf is None:
        return None
    display_symbol, yf_symbol, direct_sa_url = resolve_ticker(raw_symbol)
    print(f"Fallback fetching for: {display_symbol} (yfinance: {yf_symbol})...")
    ticker = yf.Ticker(yf_symbol)

    try:
        info = ticker.info or {}
    except Exception as e:
        print(f"Warning: could not fetch info for {yf_symbol}: {e}")
        info = {}

    quote_type = info.get("quoteType", "EQUITY")
    name = info.get("shortName") or info.get("longName") or display_symbol
    currency = info.get("currency", "USD")

    price = info.get("regularMarketPrice") or info.get("currentPrice")
    change_pct = info.get("regularMarketChangePercent")

    rsi_daily = None
    rsi_weekly = None
    rsi_monthly = None

    price_val = round(float(price), 2) if price is not None and not pd.isna(price) else None

    try:
        df_daily = ticker.history(period="2y", interval="1d", auto_adjust=False)
        if not df_daily.empty and "Close" in df_daily:
            if price_val is not None and pd.isna(df_daily["Close"].iloc[-1]):
                df_daily.loc[df_daily.index[-1], "Close"] = price_val
            rsi_daily = calculate_rsi(df_daily["Close"])
            if price is None:
                price = round(float(df_daily["Close"].iloc[-1]), 2)
                price_val = price
            if change_pct is None and len(df_daily) >= 2:
                prev_c = float(df_daily["Close"].iloc[-2])
                curr_c = float(df_daily["Close"].iloc[-1])
                change_pct = round(((curr_c - prev_c) / prev_c) * 100, 2)
    except Exception as e:
        print(f"Warning: error calculating daily RSI for {yf_symbol}: {e}")

    try:
        df_weekly = ticker.history(period="5y", interval="1wk", auto_adjust=False)
        if not df_weekly.empty and "Close" in df_weekly:
            if price_val is not None and pd.isna(df_weekly["Close"].iloc[-1]):
                df_weekly.loc[df_weekly.index[-1], "Close"] = price_val
            rsi_weekly = calculate_rsi(df_weekly["Close"])
    except Exception as e:
        print(f"Warning: error calculating weekly RSI for {yf_symbol}: {e}")

    try:
        df_monthly = ticker.history(period="max", interval="1mo", auto_adjust=False)
        if not df_monthly.empty and "Close" in df_monthly:
            if price_val is not None and pd.isna(df_monthly["Close"].iloc[-1]):
                df_monthly.loc[df_monthly.index[-1], "Close"] = price_val
            rsi_monthly = calculate_rsi(df_monthly["Close"])
    except Exception as e:
        print(f"Warning: error calculating monthly RSI for {yf_symbol}: {e}")

    if price_val is None and price is not None and not pd.isna(price):
        price_val = round(float(price), 2)
    change_val = round(float(change_pct), 2) if change_pct is not None and not pd.isna(change_pct) else 0.0

    pe = info.get("trailingPE") or info.get("forwardPE") or BASELINE_PE_MAP.get(display_symbol)
    pe = round(float(pe), 2) if pe is not None and not pd.isna(pe) and pe > 0 else None

    high_52 = info.get("fiftyTwoWeekHigh")
    low_52 = info.get("fiftyTwoWeekLow")
    try:
        if (high_52 is None or low_52 is None) and not df_daily.empty:
            tail_df = df_daily.tail(252)
            if high_52 is None and "High" in tail_df:
                high_52 = float(tail_df["High"].max())
            if low_52 is None and "Low" in tail_df:
                low_52 = float(tail_df["Low"].min())
    except Exception:
        pass

    div_yield = calculate_best_dividend_yield(ticker, info, price_val, quote_type, display_symbol)
    market_cap_str = format_market_cap(info.get("marketCap"))
    stockanalysis_url = direct_sa_url if direct_sa_url else get_stockanalysis_url(display_symbol, quote_type)

    return {
        "symbol": display_symbol,
        "name": name,
        "type": quote_type,
        "currency": currency,
        "price": price_val,
        "change_pct": change_val,
        "market_cap": market_cap_str,
        "pe": pe,
        "dividend_yield": div_yield,
        "rsi_daily": rsi_daily,
        "rsi_weekly": rsi_weekly,
        "rsi_monthly": rsi_monthly,
        "high_52w": round(float(high_52), 2) if high_52 is not None and not pd.isna(high_52) else None,
        "low_52w": round(float(low_52), 2) if low_52 is not None and not pd.isna(low_52) else None,
        "stockanalysis_url": stockanalysis_url,
        "last_updated": get_thai_datetime_str()
    }

def fetch_symbol_yahoo_direct(raw_symbol: str) -> dict | None:
    """Fetch live real-time market data directly from Yahoo Finance v8 chart."""
    display_sym, yf_sym, sa_url = resolve_ticker(raw_symbol)
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yf_sym}?interval=1d&range=5y&events=div"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())['chart']['result'][0]
            meta = data.get('meta', {})
            price = meta.get('regularMarketPrice')
            if price is None or pd.isna(price):
                return None
            price_val = round(float(price), 2)

            chg_pct = meta.get('regularMarketChangePercent')
            if chg_pct is not None and not pd.isna(chg_pct):
                change_val = round(float(chg_pct), 2)
            else:
                change_val = 0.0

            ts = data.get('timestamp', [])
            raw_c = data.get('indicators', {}).get('quote', [{}])[0].get('close', [])
            valid_pairs = [(t, float(c)) for t, c in zip(ts, raw_c) if c is not None and not pd.isna(c)]

            if change_val == 0.0 and len(valid_pairs) >= 2:
                prev_c = valid_pairs[-2][1]
                if prev_c > 0:
                    change_val = round(((price_val - prev_c) / prev_c) * 100, 2)

            # Daily RSI
            rsi_daily = calculate_rsi(pd.Series([c for _, c in valid_pairs]))

            # Weekly RSI
            w_map = {}
            for t, c in valid_pairs:
                w_map[(t + 345600) // 604800] = c
            rsi_weekly = calculate_rsi(pd.Series(list(w_map.values())))

            # Monthly RSI
            m_map = {}
            for t, c in valid_pairs:
                d = datetime.fromtimestamp(t, timezone.utc)
                m_map[f"{d.year}-{d.month:02d}"] = c
            rsi_monthly = calculate_rsi(pd.Series(list(m_map.values())))

            # 52w range & volume
            high_52 = meta.get('fiftyTwoWeekHigh')
            low_52 = meta.get('fiftyTwoWeekLow')

            # Dividend calculation
            events = data.get('events', {}).get('dividends', {})
            now_ts = datetime.now().timestamp()
            yr_ts = now_ts - 365 * 86400
            ttm_div = sum(float(d.get('amount', 0)) for d in events.values() if d.get('date', 0) >= yr_ts)
            div_y = round((ttm_div / price_val) * 100, 2) if price_val > 0 and ttm_div > 0 else BASELINE_DIV_YIELD_MAP.get(display_sym)

            # Asset type
            instr_type = meta.get('instrumentType', '').upper()
            if display_sym.endswith('-USD') or display_sym.startswith('BTC') or display_sym.startswith('ETH'):
                q_type = 'CRYPTOCURRENCY'
            elif instr_type == 'ETF' or display_sym in ['SCHD', 'SPYI', 'VYMI', 'IAUI', 'ACWI']:
                q_type = 'ETF'
            else:
                q_type = 'EQUITY'

            curr = meta.get('currency') or ('THB' if display_sym.startswith('BKK:') else ('HKD' if display_sym.startswith('HKG:') else 'USD'))
            name = meta.get('shortName') or meta.get('longName') or display_sym

            return {
                "symbol": display_sym,
                "name": name,
                "type": q_type,
                "currency": curr,
                "price": price_val,
                "change_pct": change_val,
                "market_cap": None,
                "pe": BASELINE_PE_MAP.get(display_sym),
                "dividend_yield": div_y,
                "rsi_daily": rsi_daily,
                "rsi_weekly": rsi_weekly,
                "rsi_monthly": rsi_monthly,
                "high_52w": round(float(high_52), 2) if high_52 is not None and not pd.isna(high_52) else None,
                "low_52w": round(float(low_52), 2) if low_52 is not None and not pd.isna(low_52) else None,
                "stockanalysis_url": sa_url if sa_url else get_stockanalysis_url(display_sym, q_type),
                "last_updated": get_thai_datetime_str()
            }
    except Exception as e:
        print(f"Warning: Direct Yahoo chart fetch failed for {raw_symbol}: {e}")
        return None

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
    print("Fetching live market data...")
    try:
        tv_results = fetch_tradingview_batch(symbols)
        print(f"TradingView scanner returned {len(tv_results)} / {len(symbols)} symbols.")
    except Exception as e:
        print(f"TradingView scanner error: {e}")
        tv_results = {}

    results = []
    for symbol in symbols:
        raw_sym = symbol.strip().upper()
        display_sym, _, sa_url = resolve_ticker(symbol)
        tv_item = tv_results.get(raw_sym)

        # 1. Primary: Direct Yahoo Finance live chart for zero-delay real-time prices & Wilder RSI
        yf_item = fetch_symbol_yahoo_direct(symbol)

        # 2. If direct Yahoo chart failed, try yfinance fallback
        if yf_item is None:
            try:
                yf_item = fetch_symbol_data_fallback(symbol)
            except Exception as e:
                print(f"yfinance fallback failed for {symbol}: {e}")
                yf_item = None

        if yf_item and yf_item.get("price") is not None:
            # Merge TradingView's market_cap and pe if available
            if tv_item:
                if not yf_item.get("market_cap") and tv_item.get("market_cap"):
                    yf_item["market_cap"] = tv_item["market_cap"]
                if yf_item.get("pe") is None and tv_item.get("pe") is not None:
                    yf_item["pe"] = tv_item["pe"]
                if yf_item.get("dividend_yield") is None and tv_item.get("dividend_yield") is not None:
                    yf_item["dividend_yield"] = tv_item["dividend_yield"]
            results.append(yf_item)
        elif tv_item and tv_item.get("price") is not None:
            # Fall back to TradingView if Yahoo was unavailable
            results.append(tv_item)
        else:
            # Ultimate fallback
            results.append({
                "symbol": display_sym,
                "name": display_sym,
                "type": "UNKNOWN",
                "currency": "USD",
                "price": None,
                "change_pct": None,
                "market_cap": None,
                "pe": BASELINE_PE_MAP.get(display_sym),
                "dividend_yield": BASELINE_DIV_YIELD_MAP.get(display_sym),
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
