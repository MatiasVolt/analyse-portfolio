"""
Onglet « Bien démarrer » : des repères historiques calculés sur de vraies données (pas des promesses).
- Chances de gain selon la durée de placement (S&P 500 depuis 1927)
- Les grands krachs : profondeur et temps de récupération
- Rendement / risque des grandes familles de placements depuis 2008
- Le coût de rater les meilleures journées
- Trois profils types (prudent, équilibré, dynamique)
Les chiffres sont calculés une fois puis gardés 12 h en mémoire.
"""
import threading
import time

import numpy as np
import pandas as pd

import backend
from i18n import T

TTL = 12 * 3600
_lock = threading.Lock()
_mem = {"ts": 0.0, "data": None}

HORIZONS = [(1, "1 jour", "1 day"), (21, "1 mois", "1 month"), (252, "1 an", "1 year"), (1260, "5 ans", "5 years"),
            (2520, "10 ans", "10 years"), (5040, "20 ans", "20 years")]

# Grandes familles de placements, représentées par des ETF américains très liquides (historique commun depuis 2008)
CLASSES = [
    ("BIL", "Monétaire (bons du Trésor 1-3 mois)", "Cash (1-3 month T-bills)"),
    ("AGG", "Obligations (marché US global)", "Bonds (US aggregate)"),
    ("TLT", "Obligations d'État longues (20 ans +)", "Long government bonds (20y+)"),
    ("GLD", "Or", "Gold"),
    ("ACWI", "Actions monde", "World equities"),
    ("SPY", "Actions US (S&P 500)", "US equities (S&P 500)"),
    ("QQQ", "Actions tech US (Nasdaq 100)", "US tech equities (Nasdaq 100)"),
    ("EEM", "Actions émergentes", "Emerging markets equities"),
    ("BTC-USD", "Bitcoin (depuis 2014)", "Bitcoin (since 2014)"),
]
COMMON_START = "2008-04-01"

PROFILES = [
    ("prudent", "Prudent", "Cautious", {"ACWI": 30, "AGG": 60, "BIL": 10}),
    ("balanced", "Équilibré", "Balanced", {"ACWI": 60, "AGG": 40}),
    ("dynamic", "Dynamique", "Growth", {"ACWI": 90, "AGG": 10}),
]

# Nom des grands marchés baissiers selon l'année du sommet
CRASH_NAMES = {
    1929: ("Krach de 1929 et Grande Dépression", "1929 crash and Great Depression"),
    1937: ("Rechute de 1937-1938", "1937-38 relapse"),
    1946: ("Après-guerre", "Post-war slump"),
    1961: ("Krach « Kennedy » de 1962", "1962 “Kennedy slide”"),
    1966: ("Resserrement monétaire de 1966", "1966 credit crunch"),
    1968: ("Fin des années 60", "Late-1960s bear market"),
    1973: ("Choc pétrolier de 1973", "1973 oil shock"),
    1980: ("Taux record (Volcker)", "Record rates (Volcker)"),
    1987: ("Lundi noir de 1987", "Black Monday 1987"),
    2000: ("Éclatement de la bulle internet", "Dot-com bust"),
    2007: ("Crise financière des subprimes", "Subprime financial crisis"),
    2020: ("Covid-19", "Covid-19"),
    2022: ("Inflation et hausse des taux", "Inflation and rate hikes"),
}


def _cagr(s):
    years = (s.index[-1] - s.index[0]).days / 365.25
    return (s.iloc[-1] / s.iloc[0]) ** (1 / years) - 1 if years > 0 else None


def _stats(prices, ppy=252):
    r = prices.pct_change().dropna()
    dd = prices / prices.cummax() - 1
    yearly = prices.resample("YE").last().pct_change().dropna()
    return {"cagr": _cagr(prices), "vol": float(r.std() * np.sqrt(ppy)), "mdd": float(dd.min()),
            "worst_year": float(yearly.min()) if not yearly.empty else None, "best_year": float(yearly.max()) if not yearly.empty else None,
            "worst_12m": float(prices.pct_change(ppy).min()) if len(prices) > ppy else None}


def _horizons(spx):
    out = []
    for h, fr, en in HORIZONS:
        r = (spx.shift(-h) / spx - 1).dropna()
        if len(r) < 50:
            continue
        ann = (1 + r) ** (252 / h) - 1 if h >= 252 else None
        out.append({"days": h, "label_fr": fr, "label_en": en, "positive_pct": round(float((r > 0).mean() * 100), 1),
                    "median_pct": round(float(r.median() * 100), 2), "worst_pct": round(float(r.min() * 100), 1),
                    "best_pct": round(float(r.max() * 100), 1),
                    "median_annual_pct": round(float(ann.median() * 100), 1) if ann is not None else None,
                    "worst_annual_pct": round(float(ann.min() * 100), 1) if ann is not None else None,
                    "samples": int(len(r))})
    return out


def _crashes(spx, threshold=-0.19, top=10):
    peak = spx.cummax()
    dd = spx / peak - 1
    under = dd < 0
    episodes, start = [], None
    for i, (d, u) in enumerate(under.items()):
        if u and start is None:
            start = i
        if (not u or i == len(under) - 1) and start is not None:
            end = i if not u else None
            seg = dd.iloc[start:(end if end is not None else len(dd))]
            depth = seg.min()
            if depth <= threshold:
                trough = seg.idxmin()
                peak_date = spx.index[start - 1] if start > 0 else spx.index[start]
                episodes.append({"peak": peak_date, "trough": trough, "depth": depth,
                                 "recovery": spx.index[end] if end is not None else None})
            start = None
    episodes.sort(key=lambda e: e["depth"])
    out = []
    for e in sorted(episodes[:top], key=lambda e: e["peak"]):
        names = CRASH_NAMES.get(e["peak"].year) or CRASH_NAMES.get(e["peak"].year - 1)
        rec = e["recovery"]
        out.append({
            "name_fr": names[0] if names else f"Marché baissier de {e['peak'].year}",
            "name_en": names[1] if names else f"{e['peak'].year} bear market",
            "peak": e["peak"].strftime("%Y-%m-%d"), "trough": e["trough"].strftime("%Y-%m-%d"),
            "depth_pct": round(float(e["depth"] * 100), 1),
            "fall_months": round((e["trough"] - e["peak"]).days / 30.44),
            "recovery": rec.strftime("%Y-%m-%d") if rec is not None else None,
            "recovery_months": round((rec - e["trough"]).days / 30.44) if rec is not None else None,
        })
    return out


def _best_days(prices):
    r = prices.pct_change().dropna()
    full = _cagr(prices)
    years = (prices.index[-1] - prices.index[0]).days / 365.25
    out = {"start": prices.index[0].strftime("%Y-%m-%d"), "full_cagr_pct": round(full * 100, 2), "missed": []}
    dd = (prices / prices.cummax() - 1).reindex(r.index)
    for n in (5, 10, 20, 30):
        best = r.nlargest(n).index
        r2 = r.copy()
        r2.loc[best] = 0.0  # ces jours-là, on était hors du marché
        growth = float(np.prod(1 + r2.to_numpy()))
        out["missed"].append({"days": n, "cagr_pct": round((growth ** (1 / years) - 1) * 100, 2),
                              "final_100": round(100 * growth, 0)})
    best10 = r.nlargest(10).index
    out["final_100_full"] = round(100 * float(prices.iloc[-1] / prices.iloc[0]), 0)
    out["best10_in_bear_pct"] = round(float((dd.loc[best10] <= -0.2).mean() * 100))
    return out


def build(fetch) -> dict:
    tickers = ["^GSPC"] + [t for t, _, _ in CLASSES]
    data = fetch(tickers, period="max")
    spx = data["^GSPC"]["Close"].dropna()

    rf_cash = data["BIL"]["Close"].dropna().loc[COMMON_START:]
    cash_cagr = _cagr(rf_cash)
    classes = []
    for t, fr, en in CLASSES:
        s = data[t]["Close"].dropna()
        s = s.loc[COMMON_START:] if t != "BTC-USD" else s
        if len(s) < 300:
            continue
        ppy = 365 if t == "BTC-USD" else 252
        st = _stats(s, ppy)
        classes.append({"ticker": t, "name_fr": fr, "name_en": en, "start": s.index[0].strftime("%Y-%m-%d"),
                        "cagr_pct": round(st["cagr"] * 100, 2), "vol_pct": round(st["vol"] * 100, 1),
                        "mdd_pct": round(st["mdd"] * 100, 1), "worst_year_pct": round(st["worst_year"] * 100, 1) if st["worst_year"] is not None else None,
                        "sharpe": round((st["cagr"] - cash_cagr) / st["vol"], 2) if st["vol"] else None})

    prices = pd.concat({t: data[t]["Close"] for t in ("ACWI", "AGG", "BIL")}, axis=1, join="inner").dropna().loc[COMMON_START:]
    profiles = []
    for pid, fr, en, w in PROFILES:
        cols = list(w)
        weights = np.array([w[c] for c in cols], dtype=float) / 100
        v = backend.portfolio_value_series(prices[cols], weights, "monthly")
        st = _stats(v)
        dd = v / v.cummax() - 1
        trough = dd.idxmin()
        after = v.loc[trough:]
        rec = after[after >= v.loc[:trough].max()]
        profiles.append({"id": pid, "name_fr": fr, "name_en": en, "weights": w,
                         "cagr_pct": round(st["cagr"] * 100, 2), "vol_pct": round(st["vol"] * 100, 1), "mdd_pct": round(st["mdd"] * 100, 1),
                         "worst_year_pct": round(st["worst_year"] * 100, 1), "best_year_pct": round(st["best_year"] * 100, 1),
                         "worst_12m_pct": round(st["worst_12m"] * 100, 1),
                         "recovery_months": round((rec.index[0] - trough).days / 30.44) if not rec.empty else None,
                         "final_10000": round(10000 * float(v.iloc[-1] / v.iloc[0]), -1)})

    return {
        "updated": spx.index[-1].strftime("%Y-%m-%d"),
        "spx_start": spx.index[0].strftime("%Y-%m-%d"),
        "horizons": _horizons(spx),
        "crashes": _crashes(spx),
        "classes": classes,
        "classes_start": COMMON_START,
        "cash_cagr_pct": round(cash_cagr * 100, 2),
        "best_days": _best_days(data["SPY"]["Close"].dropna().loc[COMMON_START:]),
        "profiles": profiles,
    }


def get(fetch) -> dict:
    now = time.time()
    if _mem["data"] and now - _mem["ts"] < TTL:
        return _mem["data"]
    with _lock:
        if _mem["data"] and now - _mem["ts"] < TTL:
            return _mem["data"]
        data = build(fetch)
        _mem.update(ts=now, data=data)
        return data


def localize(data: dict, lang: str) -> dict:
    """Garde un seul jeu de données en cache, choisit les libellés de la langue demandée."""
    key = "_en" if lang == "en" else "_fr"

    def pick(o):
        if isinstance(o, list):
            return [pick(x) for x in o]
        if isinstance(o, dict):
            out = {}
            for k, v in o.items():
                if k.endswith("_fr") or k.endswith("_en"):
                    if k.endswith(key):
                        out[k[:-3]] = v
                else:
                    out[k] = pick(v)
            return out
        return o
    return pick(data)
