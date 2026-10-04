"""
Données obligataires (FRED, Réserve fédérale de Saint-Louis, sans clé API) et chaînes d'options (Yahoo).
"""
import io
import json
import math
import os
import time
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from curl_cffi import requests  # imite un navigateur : FRED bloque le client Python standard
import yfinance as yf

ROOT = os.path.dirname(os.path.abspath(__file__))
BONDS_CACHE = os.path.join(ROOT, "bonds_cache.json")
FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv"
BONDS_TTL = 6 * 3600

US_TENORS = [("DGS1MO", "1M", 1 / 12), ("DGS3MO", "3M", 0.25), ("DGS6MO", "6M", 0.5), ("DGS1", "1A", 1), ("DGS2", "2A", 2),
             ("DGS3", "3A", 3), ("DGS5", "5A", 5), ("DGS7", "7A", 7), ("DGS10", "10A", 10), ("DGS20", "20A", 20), ("DGS30", "30A", 30)]
EUROPE_10Y = [("IRLTLT01DEM156N", "Allemagne", "DE"), ("IRLTLT01FRM156N", "France", "FR"), ("IRLTLT01ITM156N", "Italie", "IT"),
              ("IRLTLT01ESM156N", "Espagne", "ES"), ("IRLTLT01GBM156N", "Royaume-Uni", "GB"), ("IRLTLT01JPM156N", "Japon", "JP"),
              ("IRLTLT01CHM156N", "Suisse", "CH")]
CREDIT = [("BAMLC0A0CM", "Investment Grade US"), ("BAMLH0A0HYM2", "High Yield US")]

# ETF obligataires (duration effective approximative, en années)
BOND_ETFS = [("BIL", "T-Bills 1-3 mois", 0.1), ("SHY", "Trésor US 1-3 ans", 1.9), ("IEF", "Trésor US 7-10 ans", 7.1),
             ("TLT", "Trésor US 20 ans et +", 16.5), ("TIP", "Obligations indexées inflation", 6.7), ("AGG", "Agrégat US", 6.0),
             ("BND", "Marché obligataire total", 5.9), ("LQD", "Entreprises Investment Grade", 8.3), ("HYG", "Entreprises High Yield", 3.1)]

_mem = {"ts": 0.0, "data": None}

ETF_NAMES_EN = {"BIL": "T-Bills 1-3 months", "SHY": "US Treasury 1-3 years", "IEF": "US Treasury 7-10 years", "TLT": "US Treasury 20+ years",
                "TIP": "Inflation-linked bonds", "AGG": "US aggregate", "BND": "Total bond market", "LQD": "Investment grade corporates", "HYG": "High yield corporates"}
COUNTRIES_EN = {"DE": "Germany", "FR": "France", "IT": "Italy", "ES": "Spain", "GB": "United Kingdom", "JP": "Japan", "CH": "Switzerland"}


def localize_bonds(data: dict, lang: str) -> dict:
    """Noms d'ETF et de pays en anglais si besoin (les données restent en cache dans une seule langue)."""
    if lang != "en":
        return data
    out = dict(data)
    out["etfs"] = [{**e, "name": ETF_NAMES_EN.get(e["ticker"], e["name"])} for e in data["etfs"]]
    out["europe"] = [{**e, "country": COUNTRIES_EN.get(e["code"], e["country"])} for e in data["europe"]]
    return out


def _fred(ids, start):
    r = requests.get(FRED_CSV, params={"id": ",".join(ids), "cosd": start}, timeout=60, impersonate="chrome")
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text), index_col=0, parse_dates=True)
    return df.apply(pd.to_numeric, errors="coerce")


def _curve_at(df, when):
    row = df[df.index <= when].ffill().iloc[-1] if (df.index <= when).any() else None
    if row is None:
        return None
    return [{"tenor": lab, "years": yrs, "yield": None if pd.isna(row[sid]) else round(float(row[sid]), 3)} for sid, lab, yrs in US_TENORS]


def _sample(series, step=5):
    s = series.dropna()
    s = s.iloc[::step] if len(s) > 400 else s
    return [{"date": d.strftime("%Y-%m-%d"), "value": round(float(v), 3)} for d, v in s.items()]


def build_bonds(screener_rows: dict) -> dict:
    now = datetime.now()
    us = _fred([s for s, _, _ in US_TENORS], (now - timedelta(days=365 * 5 + 30)).strftime("%Y-%m-%d"))
    us_ff = us.ffill()
    last_date = us["DGS10"].dropna().index[-1]
    curve_now = _curve_at(us_ff, last_date)
    curve_month = _curve_at(us_ff, last_date - timedelta(days=30))
    curve_year = _curve_at(us_ff, last_date - timedelta(days=365))

    s10_2 = (us_ff["DGS10"] - us_ff["DGS2"]).dropna()
    s10_3m = (us_ff["DGS10"] - us_ff["DGS3MO"]).dropna()

    eu = _fred([s for s, _, _ in EUROPE_10Y], (now - timedelta(days=500)).strftime("%Y-%m-%d"))
    bund = eu["IRLTLT01DEM156N"].dropna()
    europe = []
    for sid, name, code in EUROPE_10Y:
        s = eu[sid].dropna()
        if s.empty:
            continue
        europe.append({
            "country": name, "code": code, "yield": round(float(s.iloc[-1]), 2), "date": s.index[-1].strftime("%Y-%m"),
            "change_1y": round(float(s.iloc[-1] - s.iloc[-13]), 2) if len(s) > 13 else None,
            "spread_vs_de_bp": round(float((s.iloc[-1] - bund.iloc[-1]) * 100)) if not bund.empty and code != "DE" else None,
        })

    cr = _fred([s for s, _ in CREDIT], (now - timedelta(days=365 * 5 + 30)).strftime("%Y-%m-%d"))
    credit = []
    for sid, name in CREDIT:
        s = cr[sid].dropna()
        credit.append({"name": name, "value": round(float(s.iloc[-1]), 2), "median_5y": round(float(s.median()), 2),
                       "history": _sample(s)})

    etfs = []
    for t, name, dur in BOND_ETFS:
        row = screener_rows.get(t, {})
        etfs.append({"ticker": t, "name": name, "duration": dur, "last_price": row.get("last_price"),
                     "perf_1y_pct": row.get("perf_1y_pct"), "volatility_pct": row.get("annualized_volatility_pct"),
                     "max_drawdown_pct": row.get("max_drawdown_pct"), "sharpe": row.get("sharpe")})

    return {
        "updated": last_date.strftime("%Y-%m-%d"),
        "us_curve": {"now": curve_now, "month_ago": curve_month, "year_ago": curve_year},
        "spreads": {
            "s10_2": round(float(s10_2.iloc[-1]), 2), "s10_3m": round(float(s10_3m.iloc[-1]), 2),
            "s10_2_history": _sample(s10_2), "inverted_days_1y": int((s10_2[s10_2.index > last_date - timedelta(days=365)] < 0).sum()),
        },
        "europe": europe,
        "credit": credit,
        "etfs": etfs,
        "risk_free_3m": next((p["yield"] for p in curve_now if p["tenor"] == "3M"), None),
    }


def get_bonds(screener_rows: dict) -> dict:
    now = time.time()
    if _mem["data"] and now - _mem["ts"] < BONDS_TTL:
        return _mem["data"]
    try:
        data = build_bonds(screener_rows)
        with open(BONDS_CACHE, "w", encoding="utf-8") as f:
            json.dump(data, f)
    except Exception:
        if not os.path.exists(BONDS_CACHE):
            raise
        data = json.load(open(BONDS_CACHE, encoding="utf-8"))
        data["stale"] = True
    _mem.update(ts=now, data=data)
    return data


# ---------------------------------------------------------------------------
# OPTIONS
# ---------------------------------------------------------------------------
_opt_cache = {}


def get_option_chain(ticker: str, expiry: str = None, spot: float = None) -> dict:
    """Échéances disponibles + chaîne (calls/puts) pour une échéance, strikes limités à ±40 % du cours."""
    key = (ticker, expiry)
    hit = _opt_cache.get(key)
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    tk = yf.Ticker(ticker)
    try:
        expiries = list(tk.options)
    except Exception:
        expiries = []
    out = {"expiries": expiries, "expiry": None, "calls": [], "puts": []}
    if expiries:
        exp = expiry if expiry in expiries else expiries[min(2, len(expiries) - 1)]
        chain = tk.option_chain(exp)
        out["expiry"] = exp

        def rows(df):
            res = []
            for r in df.itertuples():
                if spot and not (spot * 0.6 <= r.strike <= spot * 1.4):
                    continue
                bid, ask = float(r.bid or 0), float(r.ask or 0)
                mid = (bid + ask) / 2 if bid > 0 and ask > 0 else float(r.lastPrice or 0)
                res.append({
                    "strike": float(r.strike), "last": round(float(r.lastPrice or 0), 2), "bid": round(bid, 2), "ask": round(ask, 2),
                    "mid": round(mid, 2), "iv": round(float(r.impliedVolatility) * 100, 1) if r.impliedVolatility and r.impliedVolatility > 0.001 else None,
                    "volume": int(r.volume) if r.volume == r.volume and r.volume else 0,
                    "open_interest": int(r.openInterest) if r.openInterest == r.openInterest and r.openInterest else 0,
                    "itm": bool(r.inTheMoney),
                })
            return res

        out["calls"], out["puts"] = rows(chain.calls), rows(chain.puts)
    _opt_cache[key] = (time.time(), out)
    return out


def historical_vol(close: pd.Series, days: int, ppy: int = 252):
    r = np.log(close / close.shift(1)).dropna().tail(days)
    return round(float(r.std() * math.sqrt(ppy) * 100), 2) if len(r) > 5 else None
