"""
Moteur de calcul : statistiques, ratios de risque/rendement, métriques
spécifiques par classe d'actif, interprétations en français et Monte-Carlo.

Conventions :
- Les rendements sont des rendements simples journaliers (par séance).
- `ppy` = nombre de séances par an (252 pour les marchés classiques,
  365 pour la crypto qui cote tous les jours).
- Les pourcentages renvoyés sont déjà multipliés par 100.
"""
import json
import math
import os

import numpy as np
import pandas as pd

from i18n import T, lang, num

import contextvars

RISK_FREE_RATE = 0.02  # dernier recours si aucun taux de marché n'est disponible
# Taux sans risque de la requête en cours (décimal) : fixé par l'API selon la devise de l'actif (risk_free.py)
_rf = contextvars.ContextVar("risk_free", default=RISK_FREE_RATE)


def set_risk_free(rate: float):
    _rf.set(rate)


def risk_free() -> float:
    return _rf.get()

# =====================================================================
# 0. OUTILS
# =====================================================================

def _r(x, nd=2):
    """Arrondi sûr : renvoie None pour NaN/inf (JSON-compatible)."""
    if x is None:
        return None
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(x) or math.isinf(x):
        return None
    return round(x, nd)


def fr(x, nd=2, signed=False):
    """Nombre pour les phrases, au format de la langue de la requête (virgule en français, point en anglais)."""
    return num(x, nd, signed)


_MONTHS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]


def fdate(d):
    """'2026-02-12' -> « 12 févr. 2026 » (français) ou « Feb 12, 2026 » (anglais)."""
    if not d:
        return ""
    ts = pd.Timestamp(d)
    return T(f"{ts.day} {_MONTHS_FR[ts.month - 1]} {ts.year}", ts.strftime("%b %d, %Y").replace(" 0", " "))


def sessions_word(ppy, n=2):
    """« séances » pour une place boursière, « jours » pour la crypto qui cote 7 j/7."""
    if ppy >= 365:
        return T("jour" if n < 2 else "jours", "day" if n < 2 else "days")
    return T("séance" if n < 2 else "séances", "session" if n < 2 else "sessions")


def one_session(ppy):
    """« une séance » ou « un jour » (crypto), avec le bon accord."""
    return T("un jour", "one day") if ppy >= 365 else T("une séance", "one session")


def fconf(x):
    """95.0 -> « 95 » ; 97.5 -> « 97,5 »."""
    return fr(x, 0) if x is not None and float(x).is_integer() else fr(x, 1)


def fdur(n, ppy=252):
    """Nombre de séances -> durée parlante : « environ 3 semaines », « environ 4 mois », « environ 1,5 an »."""
    if n is None:
        return ""
    per_week = 7 if ppy >= 365 else 5
    weeks = n / per_week
    if weeks < 1.5:
        return T(f"{round(n)} {sessions_word(ppy, round(n))}", f"{round(n)} {sessions_word(ppy, round(n))}")
    if weeks < 8:
        return T(f"environ {round(weeks)} semaines", f"about {round(weeks)} weeks")
    months = n / (ppy / 12)
    if months < 18:
        return T(f"environ {round(months)} mois", f"about {round(months)} months")
    return T(f"environ {fr(months / 12, 1)} ans", f"about {fr(months / 12, 1)} years")


# =====================================================================
# 1. CLASSIFICATION DES ACTIFS
# =====================================================================

_UNIVERSE_CATEGORY = None
_CATEGORY_TO_CLASS = {
    "Actions": "ACTION", "ETF": "ETF", "Indices": "INDEX",
    "Crypto": "CRYPTO", "Forex": "FOREX", "Matières 1ères": "COMMODITY",
}


def _universe_categories():
    global _UNIVERSE_CATEGORY
    if _UNIVERSE_CATEGORY is None:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "universe.json")
        try:
            with open(path, encoding="utf-8") as f:
                _UNIVERSE_CATEGORY = {a["ticker"]: a["category"] for a in json.load(f)}
        except Exception:
            _UNIVERSE_CATEGORY = {}
    return _UNIVERSE_CATEGORY


def detecter_classe_actif(ticker_name: str) -> str:
    """ACTION, ETF, INDEX, CRYPTO, FOREX ou COMMODITY."""
    ticker = ticker_name.upper().strip()
    cat = _universe_categories().get(ticker)
    if cat in _CATEGORY_TO_CLASS:
        return _CATEGORY_TO_CLASS[cat]
    if ticker.startswith("^"):
        return "INDEX"
    if any(ticker.endswith(s) for s in ["-USD", "-EUR", "-GBP", "-BTC", "-USDT", "-ETH"]):
        return "CRYPTO"
    if ticker.endswith("=F"):
        return "COMMODITY"
    if ticker.endswith("=X"):
        return "FOREX"
    return "ACTION"


def periods_per_year(asset_class: str) -> int:
    return 365 if asset_class == "CRYPTO" else 252


def fix_unit_glitches(df: pd.DataFrame) -> pd.DataFrame:
    """
    Corrige les erreurs d'unité de Yahoo (fréquentes à Londres : cours en livres au lieu de pence, soit ×100).
    Un point qui s'écarte d'un facteur > 30 de la médiane glissante est remis à l'échelle (÷100 ou ×100).
    Une vraie variation de ×30 en quelques jours n'existe pratiquement pas hors crypto (non concernée).
    """
    if df.empty or len(df) < 5:
        return df
    df = df.copy()
    cols = [c for c in ("Open", "High", "Low", "Close") if c in df.columns]

    # 1) Pics isolés (quelques jours dans la mauvaise unité)
    close = df["Close"]
    ratio = close / close.rolling(21, center=True, min_periods=3).median()
    high, low = ratio > 30, ratio < 1 / 30
    df.loc[high, cols] = df.loc[high, cols] / 100
    df.loc[low, cols] = df.loc[low, cols] * 100

    # 2) Changement d'unité définitif (saut ≈ ×100 ou ÷100 en une séance) : on aligne l'historique sur l'unité récente
    jump = (df["Close"] / df["Close"].shift(1)).to_numpy()
    for i in np.flatnonzero(((jump > 70) & (jump < 140)) | ((jump > 1 / 140) & (jump < 1 / 70)))[::-1]:
        factor = 100.0 if jump[i] > 1 else 0.01
        df.iloc[:i, [df.columns.get_loc(c) for c in cols]] *= factor
    return df


# =====================================================================
# 2. STATISTIQUES DESCRIPTIVES
# =====================================================================

def descriptive_stats(returns: pd.Series, ppy: int = 252) -> dict:
    r = returns.dropna()
    if r.empty:
        return {}
    return {
        "mean_daily_return_pct": _r(r.mean() * 100, 4),
        "median_daily_return_pct": _r(r.median() * 100, 4),
        "daily_volatility_pct": _r(r.std() * 100),
        "annualized_volatility_pct": _r(r.std() * np.sqrt(ppy) * 100),
        "downside_volatility_pct": _r(np.sqrt(np.mean(np.minimum(r, 0) ** 2)) * np.sqrt(ppy) * 100),
        "max_daily_return_pct": _r(r.max() * 100),
        "min_daily_return_pct": _r(r.min() * 100),
        "skewness": _r(r.skew()),
        "kurtosis": _r(r.kurtosis()),  # excès de kurtosis : 0 = loi normale
    }


def total_return_pct(prices: pd.Series) -> float:
    p = prices.dropna()
    if len(p) < 2:
        return 0.0
    return _r((p.iloc[-1] / p.iloc[0] - 1) * 100)


def cagr(prices: pd.Series) -> float:
    """Taux de croissance annuel composé, basé sur la durée calendaire réelle."""
    p = prices.dropna()
    if len(p) < 2 or p.iloc[0] <= 0:
        return 0.0
    years = (p.index[-1] - p.index[0]).days / 365.25
    if years <= 0:
        return 0.0
    growth = p.iloc[-1] / p.iloc[0]
    if growth <= 0:
        return -100.0
    return _r((growth ** (1 / years) - 1) * 100)


def win_rate(returns: pd.Series) -> float:
    r = returns.dropna()
    r = r[r != 0]
    return _r((r > 0).mean() * 100) if not r.empty else 0.0


def profit_factor(returns: pd.Series) -> float:
    r = returns.dropna()
    gains = r[r > 0].sum()
    losses = abs(r[r < 0].sum())
    if losses == 0:
        return None if gains > 0 else 0.0
    return _r(gains / losses)


def omega_ratio(returns: pd.Series, threshold: float = 0.0) -> float:
    r = returns.dropna() - threshold
    up = r[r > 0].sum()
    down = -r[r < 0].sum()
    return _r(up / down) if down > 0 else None


def tail_ratio(returns: pd.Series) -> float:
    """|quantile 95 %| / |quantile 5 %| : taille des meilleurs jours vs des pires."""
    r = returns.dropna()
    if len(r) < 20:
        return None
    q5 = abs(r.quantile(0.05))
    return _r(abs(r.quantile(0.95)) / q5) if q5 > 0 else None


def monthly_stats(prices: pd.Series) -> dict:
    p = prices.dropna()
    if len(p) < 40:
        return {}
    m = p.resample("ME").last().pct_change().dropna()
    if m.empty:
        return {}
    return {
        "positive_months_pct": _r((m > 0).mean() * 100),
        "best_month_pct": _r(m.max() * 100),
        "worst_month_pct": _r(m.min() * 100),
    }


# =====================================================================
# 3. DRAWDOWNS
# =====================================================================

def compute_drawdown_series(prices: pd.Series) -> pd.Series:
    p = prices.dropna()
    if p.empty:
        return pd.Series(dtype=float)
    return (p / p.cummax() - 1) * 100


def max_drawdown(prices: pd.Series) -> float:
    dd = compute_drawdown_series(prices)
    return _r(dd.min()) if not dd.empty else 0.0


def mean_drawdown(prices: pd.Series) -> float:
    dd = compute_drawdown_series(prices)
    under = dd[dd < 0]
    return _r(under.mean()) if not under.empty else 0.0


def current_drawdown(prices: pd.Series) -> float:
    dd = compute_drawdown_series(prices)
    return _r(dd.iloc[-1]) if not dd.empty else 0.0


def drawdown_episodes(prices: pd.Series) -> list:
    """Liste des durées (en séances) de chaque période passée sous un ancien sommet."""
    p = prices.dropna()
    if p.empty:
        return []
    under = (p < p.cummax()).to_numpy()
    if not under.any():
        return []
    episode_id = np.cumsum(~under)[under]
    _, counts = np.unique(episode_id, return_counts=True)
    return counts.tolist()


def drawdown_details(prices: pd.Series) -> dict:
    """Dates de la pire baisse (sommet, creux, retour au sommet) et de la plus longue période sous un ancien record."""
    p = prices.dropna()
    if len(p) < 2:
        return {}
    peak = p.cummax()
    dd = p / peak - 1
    out = {"days_below_peak_pct": _r((dd < 0).mean() * 100, 1), "high_date": p.idxmax().strftime("%Y-%m-%d"), "high_scope": "period"}
    trough = dd.idxmin()
    if dd.loc[trough] < 0:
        peak_date = p.loc[:trough].idxmax()
        after = p.loc[trough:]
        rec = after[after >= p.loc[peak_date]]
        out.update({"mdd_peak_date": peak_date.strftime("%Y-%m-%d"), "mdd_trough_date": trough.strftime("%Y-%m-%d"),
                    "mdd_recovery_date": rec.index[0].strftime("%Y-%m-%d") if not rec.empty else None})
    under = (dd < 0).to_numpy()
    if under.any():
        ep_id = np.cumsum(~under)
        ep_id = np.where(under, ep_id, -1)
        ids, counts = np.unique(ep_id[ep_id >= 0], return_counts=True)
        longest = ids[counts.argmax()]
        idx = np.where(ep_id == longest)[0]
        start = idx[0] - 1 if idx[0] > 0 else idx[0]  # le dernier record avant la baisse
        out.update({"longest_dd_start": p.index[start].strftime("%Y-%m-%d"), "longest_dd_end": p.index[idx[-1]].strftime("%Y-%m-%d"),
                    "longest_dd_ongoing": bool(idx[-1] == len(p) - 1), "drawdown_count": int(len(ids)),
                    "drawdown_count_5pct": int(sum(dd.to_numpy()[ep_id == i].min() <= -0.05 for i in ids))})
    return out


def mean_time_to_recovery(prices: pd.Series) -> float:
    ep = drawdown_episodes(prices)
    return _r(np.mean(ep), 1) if ep else 0.0


def longest_drawdown(prices: pd.Series) -> int:
    ep = drawdown_episodes(prices)
    return int(max(ep)) if ep else 0


def ulcer_index(prices: pd.Series) -> float:
    dd = compute_drawdown_series(prices)
    return _r(np.sqrt((dd ** 2).mean())) if not dd.empty else 0.0


# =====================================================================
# 4. RATIOS RENDEMENT / RISQUE
# =====================================================================

def _daily_rf(ppy):
    return (1 + risk_free()) ** (1 / ppy) - 1


def sharpe_ratio(returns: pd.Series, ppy: int = 252) -> float:
    r = returns.dropna()
    if len(r) < 2 or r.std() == 0:
        return 0.0
    return _r((r.mean() - _daily_rf(ppy)) / r.std() * np.sqrt(ppy))


def sortino_ratio(returns: pd.Series, ppy: int = 252) -> float:
    r = returns.dropna()
    if r.empty:
        return 0.0
    rf = _daily_rf(ppy)
    downside = np.sqrt(np.mean(np.minimum(0, r - rf) ** 2))
    if downside == 0:
        return 0.0
    return _r((r.mean() - rf) / downside * np.sqrt(ppy))


def calmar_ratio(prices: pd.Series) -> float:
    """CAGR / |Max Drawdown|."""
    mdd = abs(max_drawdown(prices) or 0)
    if mdd == 0:
        return 0.0
    return _r(cagr(prices) / mdd)


# =====================================================================
# 5. RELATION AU MARCHÉ
# =====================================================================

def market_relation(asset_returns: pd.Series, bench_returns: pd.Series, ppy: int = 252) -> dict:
    """Bêta, alpha de Jensen, corrélation, R², tracking error, ratio d'information, captures."""
    data = pd.concat([asset_returns, bench_returns], axis=1, join="inner").dropna()
    empty = {k: None for k in ["beta", "alpha_annual_pct", "correlation", "r_squared",
                               "tracking_error_pct", "information_ratio", "up_capture_pct", "down_capture_pct"]}
    if len(data) < 10:
        return empty
    a, b = data.iloc[:, 0], data.iloc[:, 1]
    var_b = b.var()
    if var_b == 0:
        return empty
    beta_v = a.cov(b) / var_b
    ret_a, ret_b = a.mean() * ppy, b.mean() * ppy
    rf = risk_free()
    alpha_v = ret_a - (rf + beta_v * (ret_b - rf))
    corr = a.corr(b)
    active = a - b
    te = active.std() * np.sqrt(ppy)
    ir = (active.mean() * ppy) / te if te > 0 else None
    up, down = b > 0, b < 0
    up_cap = (a[up].mean() / b[up].mean() * 100) if up.sum() > 5 and b[up].mean() != 0 else None
    down_cap = (a[down].mean() / b[down].mean() * 100) if down.sum() > 5 and b[down].mean() != 0 else None
    return {
        "beta": _r(beta_v),
        "alpha_annual_pct": _r(alpha_v * 100),
        "correlation": _r(corr),
        "r_squared": _r(corr ** 2 * 100, 1),
        "tracking_error_pct": _r(te * 100),
        "information_ratio": _r(ir),
        "up_capture_pct": _r(up_cap, 1),
        "down_capture_pct": _r(down_cap, 1),
    }


# =====================================================================
# 6. VALUE AT RISK
# =====================================================================

def calculate_z_score(confidence_level: float) -> float:
    """Quantile de la loi normale (inverse exacte via statistics.NormalDist)."""
    from statistics import NormalDist
    if not 0 < confidence_level < 1:
        return 1.645
    return NormalDist().inv_cdf(confidence_level)


def value_at_risk_h(returns: pd.Series, confidence_level: float = 0.95) -> float:
    r = returns.dropna()
    return _r(r.quantile(1 - confidence_level) * 100) if not r.empty else 0.0


def value_at_risk_p(returns: pd.Series, confidence_level: float = 0.95) -> float:
    r = returns.dropna()
    if r.empty:
        return 0.0
    return _r((r.mean() - calculate_z_score(confidence_level) * r.std()) * 100)


def conditional_var(returns: pd.Series, confidence_level: float = 0.95) -> float:
    """Expected Shortfall : perte moyenne des journées au-delà de la VaR historique."""
    r = returns.dropna()
    if r.empty:
        return 0.0
    q = r.quantile(1 - confidence_level)
    tail = r[r <= q]
    return _r(tail.mean() * 100) if not tail.empty else _r(q * 100)


# =====================================================================
# 7. INDICATEURS TECHNIQUES
# =====================================================================

def rsi(prices: pd.Series, window: int = 14) -> float:
    p = prices.dropna()
    if len(p) <= window:
        return None
    delta = p.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / window, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / window, adjust=False).mean()
    if loss.iloc[-1] == 0:
        return 100.0
    rs = gain.iloc[-1] / loss.iloc[-1]
    return _r(100 - 100 / (1 + rs), 1)


def dist_to_ma(prices: pd.Series, window: int) -> float:
    p = prices.dropna()
    if len(p) < window:
        return None
    ma = p.rolling(window).mean().iloc[-1]
    return _r((p.iloc[-1] / ma - 1) * 100)


def atr_pct(df: pd.DataFrame, window: int = 14) -> float:
    """Average True Range en % du cours (amplitude moyenne d'une séance, gaps inclus)."""
    if len(df) <= window or not {"High", "Low", "Close"}.issubset(df.columns):
        return None
    prev = df["Close"].shift(1)
    tr = pd.concat([df["High"] - df["Low"], (df["High"] - prev).abs(), (df["Low"] - prev).abs()], axis=1).max(axis=1)
    atr = tr.rolling(window).mean().iloc[-1]
    return _r(atr / df["Close"].iloc[-1] * 100)


def perf_over(prices: pd.Series, days: int) -> float:
    """Performance sur les `days` derniers jours calendaires (None si historique trop court)."""
    p = prices.dropna()
    if p.empty:
        return None
    start = p.index[-1] - pd.Timedelta(days=days)
    if p.index[0] > start + pd.Timedelta(days=3):
        return None
    base = p[p.index <= start]
    base_val = base.iloc[-1] if not base.empty else p.iloc[0]
    return _r((p.iloc[-1] / base_val - 1) * 100)


def perf_ytd(prices: pd.Series) -> float:
    p = prices.dropna()
    if p.empty:
        return None
    prev_year = p[p.index.year < p.index[-1].year]
    if prev_year.empty:
        return None
    return _r((p.iloc[-1] / prev_year.iloc[-1] - 1) * 100)


# =====================================================================
# 8. MÉTRIQUES PRINCIPALES (ACTIF OU PORTEFEUILLE)
# =====================================================================

def compute_core_metrics(prices: pd.Series, bench_prices: pd.Series, conf: float, ppy: int) -> dict:
    """Toutes les métriques communes, calculées sur la série de prix (ou de valeur)."""
    prices = prices.dropna()
    returns = prices.pct_change().dropna()

    # Rendements du benchmark alignés sur les mêmes dates (évite les décalages crypto 7j/7 vs bourse 5j/7)
    aligned = pd.concat([prices, bench_prices], axis=1, join="inner").dropna()
    rel = market_relation(aligned.iloc[:, 0].pct_change(), aligned.iloc[:, 1].pct_change(), ppy) if len(aligned) > 10 else market_relation(pd.Series(dtype=float), pd.Series(dtype=float))

    m = descriptive_stats(returns, ppy)
    m.update({
        "total_change_pct": total_return_pct(prices),
        "cagr_pct": cagr(prices),
        "win_rate_pct": win_rate(returns),
        "profit_factor": profit_factor(returns),
        "omega_ratio": omega_ratio(returns),
        "tail_ratio": tail_ratio(returns),
        "max_drawdown_pct": max_drawdown(prices),
        "mean_drawdown_pct": mean_drawdown(prices),
        "current_drawdown_pct": current_drawdown(prices),
        "mean_time_to_recovery_days": mean_time_to_recovery(prices),
        "longest_drawdown_days": longest_drawdown(prices),
        "ulcer_index": ulcer_index(prices),
        "sharpe_ratio": sharpe_ratio(returns, ppy),
        "sortino_ratio": sortino_ratio(returns, ppy),
        "calmar_ratio": calmar_ratio(prices),
        "var_confidence_selected": _r(conf * 100),
        "var_historical_pct": value_at_risk_h(returns, conf),
        "var_parametric_pct": value_at_risk_p(returns, conf),
        "cvar_pct": conditional_var(returns, conf),
        "observations": int(len(returns)),
        "periods_per_year": ppy,
        "period_years": _r((prices.index[-1] - prices.index[0]).days / 365.25, 3) if len(prices) > 1 else 0,
        "risk_free_pct": _r(risk_free() * 100),
    })
    m.update(rel)
    m.update(monthly_stats(prices))
    m.update(drawdown_details(prices))
    if not returns.empty:
        m["best_day_date"] = returns.idxmax().strftime("%Y-%m-%d")
        m["worst_day_date"] = returns.idxmin().strftime("%Y-%m-%d")
    return m


# =====================================================================
# 9. MÉTRIQUES SPÉCIFIQUES PAR CLASSE D'ACTIF
# =====================================================================

def _item(id_, label, value, unit="", definition="", interpretation="", tone="neutral", nd=None):
    out = {"id": id_, "label": label, "value": value, "unit": unit,
           "definition": definition, "interpretation": interpretation, "tone": tone}
    if nd is not None:
        out["nd"] = nd
    return out


def _tone(v, good_if_positive=True):
    if v is None:
        return "neutral"
    return "pos" if (v >= 0) == good_if_positive else "neg"


def _rsi_item(close):
    v = rsi(close)
    if v is None:
        txt = T("Historique trop court pour calculer le RSI.", "History too short to compute the RSI.")
    elif v >= 70:
        txt = T(f"RSI à {fr(v, 1)} : zone de surachat. La hausse récente est très forte ; un essoufflement ou une consolidation est fréquent à ce niveau, sans être garanti.",
                f"RSI at {fr(v, 1)}: overbought zone. The recent rise is very strong; a pause or consolidation is common at this level, but not guaranteed.")
    elif v <= 30:
        txt = T(f"RSI à {fr(v, 1)} : zone de survente. Les vendeurs ont dominé récemment ; un rebond technique est fréquent, mais une tendance baissière peut aussi persister.",
                f"RSI at {fr(v, 1)}: oversold zone. Sellers have dominated recently; a technical rebound is common, but a downtrend can also persist.")
    else:
        txt = T(f"RSI à {fr(v, 1)} : zone neutre (entre 30 et 70), pas d'excès d'achat ni de vente.",
                f"RSI at {fr(v, 1)}: neutral zone (between 30 and 70), no excess buying or selling.")
    return _item("rsi", "RSI 14", v, "", T(
        "Relative Strength Index sur 14 séances : compare l'ampleur des hausses et des baisses récentes, sur une échelle de 0 à 100. Au-dessus de 70 = surachat, en dessous de 30 = survente.",
        "Relative Strength Index over 14 sessions: compares the size of recent gains and losses on a 0–100 scale. Above 70 = overbought, below 30 = oversold."),
        txt, "warn" if v is not None and (v >= 70 or v <= 30) else "neutral")


def _ma50_item(close):
    v = dist_to_ma(close, 50)
    label = T("Écart à la MM50", "Distance to 50-day MA")
    definition = T("Écart entre le cours actuel et sa moyenne mobile 50 séances (environ 2 mois et demi de cotation). Indicateur de tendance de moyen terme : "
                   "il réagit plus vite que la MM200. Au-dessus = tendance de moyen terme haussière, en dessous = baissière. "
                   "Quand la MM50 passe au-dessus de la MM200, on parle de « golden cross » ; en dessous, de « death cross ».",
                   "Gap between the current price and its 50-session moving average (about two and a half months of trading). A medium-term trend gauge: "
                   "it reacts faster than the 200-day MA. Above = medium-term uptrend, below = downtrend. "
                   "When the 50-day MA crosses above the 200-day MA it is called a “golden cross”; below, a “death cross”.")
    if v is None:
        return _item("ma50", label, None, "%", definition,
                     T("Il faut au moins 50 séances d'historique : choisissez une période plus longue.", "At least 50 sessions of history are needed: choose a longer period."))
    up = v >= 0
    txt = T(f"Le cours est {fr(abs(v))} % {'au-dessus' if up else 'en dessous'} de sa moyenne des 50 dernières séances : "
            f"la tendance de moyen terme est {'haussière' if up else 'baissière'}.",
            f"The price is {fr(abs(v))}% {'above' if up else 'below'} its 50-session average: the medium-term trend is {'up' if up else 'down'}.")
    ma200 = dist_to_ma(close, 200)
    if ma200 is not None:
        if up == (ma200 >= 0):
            txt += T(" Elle va dans le même sens que la tendance de fond (MM200).", " It points the same way as the long-term trend (200-day MA).")
        elif up:
            txt += T(" Mais le cours reste sous sa MM200 : c'est un rebond au sein d'une tendance de fond baissière.",
                     " But the price is still below its 200-day MA: a rebound within a long-term downtrend.")
        else:
            txt += T(" Mais le cours reste au-dessus de sa MM200 : c'est un repli au sein d'une tendance de fond haussière.",
                     " But the price is still above its 200-day MA: a pullback within a long-term uptrend.")
    return _item("ma50", label, v, "%", definition, txt, _tone(v))


def _ma200_item(close):
    v = dist_to_ma(close, 200)
    label = T("Écart à la MM200", "Distance to 200-day MA")
    if v is None:
        return _item("ma200", label, None, "%", T("Écart entre le cours actuel et sa moyenne mobile 200 séances (tendance de fond).",
                                                 "Gap between the current price and its 200-session moving average (long-term trend)."),
                     T("Il faut au moins 200 séances d'historique : choisissez une période plus longue (1A, 5A ou MAX).",
                       "At least 200 sessions of history are needed: choose a longer period (1Y, 5Y or MAX)."))
    ma50 = dist_to_ma(close, 50)
    cross = ""
    if ma50 is not None:
        # MM50 au-dessus de la MM200 <=> (1+ma200)/(1+ma50) > 1 en termes de prix
        ma50_above = (1 + v / 100) / (1 + ma50 / 100) > 1
        cross = (T(" La MM50 est au-dessus de la MM200 (configuration haussière de type « golden cross »).",
                   " The 50-day MA is above the 200-day MA (bullish “golden cross” setup).") if ma50_above else
                 T(" La MM50 est sous la MM200 (configuration baissière de type « death cross »).",
                   " The 50-day MA is below the 200-day MA (bearish “death cross” setup)."))
    up = v >= 0
    txt = T(f"Le cours est {fr(abs(v))} % {'au-dessus' if up else 'en dessous'} de sa moyenne des 200 dernières séances : "
            f"{'la tendance de fond est haussière' if up else 'la tendance de fond est baissière'}.",
            f"The price is {fr(abs(v))}% {'above' if up else 'below'} its 200-session average: "
            f"{'the long-term trend is up' if up else 'the long-term trend is down'}.") + cross
    return _item("ma200", label, v, "%", T(
        "Écart entre le cours actuel et sa moyenne mobile 200 séances. Indicateur classique de tendance de long terme : au-dessus = tendance haussière, en dessous = baissière.",
        "Gap between the current price and its 200-session moving average. A classic long-term trend gauge: above = uptrend, below = downtrend."),
        txt, _tone(v))


def _high_item(close):
    v = current_drawdown(close)
    days_since = int((close.index[-1] - close.idxmax()).days)
    need = (100 / (100 + v) - 1) * 100
    txt = (T("Le cours est actuellement sur son plus haut de la période.", "The price is currently at its high for the period.") if v == 0 else
           T(f"Le cours est {fr(abs(v))} % sous son plus haut de la période, atteint il y a {days_since} jours. Il faudrait une hausse de {fr(need)} % pour le retrouver.",
             f"The price is {fr(abs(v))}% below its period high, reached {days_since} days ago. It would take a {fr(need)}% rise to get back there."))
    return _item("dist_high", T("Distance au plus haut", "Distance from high"), v, "%",
                 T("Écart entre le dernier cours et le plus haut atteint sur la période analysée.", "Gap between the last price and the highest price of the analysed period."),
                 txt, "neutral" if v > -20 else "neg")


def _horizon(days):
    labels = {7: ("7 jours", "7 days"), 30: ("30 jours", "30 days"), 90: ("90 jours", "90 days"),
              91: ("3 mois", "3 months"), 182: ("6 mois", "6 months"), 365: ("1 an", "1 year")}
    f, e = labels.get(days, (f"{days} jours", f"{days} days"))
    return T(f, e)


def _perf_items(close, horizons):
    items = []
    for days in horizons:
        label = _horizon(days)
        v = perf_over(close, days)
        if v is None:
            txt = T("Historique insuffisant sur la période choisie.", "Not enough history in the chosen period.")
        else:
            txt = T(f"Sur {label}, le cours a {'progressé' if v >= 0 else 'reculé'} de {fr(abs(v))} %.",
                    f"Over {label}, the price {'rose' if v >= 0 else 'fell'} {fr(abs(v))}%.")
        items.append(_item(f"perf_{days}", T(f"Perf. {label}", f"Return {label}"), v, "%",
                           T(f"Variation du cours sur les {label} écoulés.", f"Price change over the past {label}."), txt, _tone(v)))
    return items


def _ytd_item(close):
    v = perf_ytd(close)
    return _item("ytd", T("Perf. depuis le 1er janv.", "Year-to-date return"), v, "%",
                 T("Variation depuis la dernière clôture de l'année précédente (YTD = Year To Date).", "Change since the last close of the previous year (YTD = Year To Date)."),
                 T("La période analysée ne couvre pas la fin de l'année dernière.", "The analysed period does not cover the end of last year.") if v is None else
                 T(f"Depuis le début de l'année, {fr(v, 2, True)} %.", f"Since the start of the year, {fr(v, 2, True)}%."), _tone(v))


def _atr_item(df):
    v = atr_pct(df)
    return _item("atr", T("ATR 14 (amplitude/séance)", "ATR 14 (range/session)"), v, "%",
                 T("Average True Range : amplitude moyenne d'une séance (écart plus haut/plus bas, en tenant compte des gaps d'ouverture), en % du cours. Utile pour placer un stop-loss cohérent.",
                   "Average True Range: average range of a session (high–low, including opening gaps), as a % of the price. Useful to place a sensible stop-loss."),
                 T("Indisponible (données intrajournalières manquantes).", "Unavailable (missing intraday data).") if v is None else
                 T(f"En moyenne, le cours varie de {fr(v)} % entre son plus haut et son plus bas sur une séance. Un stop-loss placé à moins de cette distance risque d'être touché par le simple « bruit » du marché.",
                   f"On average, the price moves {fr(v)}% between its high and low in a session. A stop-loss placed closer than that is likely to be hit by mere market “noise”."))


def _vol_regime_item(close, ppy):
    r = close.pct_change().dropna()
    label = T("Volatilité 30 j (annualisée)", "30-day volatility (annualised)")
    definition = T("Volatilité des 30 dernières séances, annualisée, comparée à celle de toute la période pour savoir si le marché est plus nerveux qu'à l'accoutumée.",
                   "Volatility of the last 30 sessions, annualised, compared with the whole period to see whether the market is more nervous than usual.")
    if len(r) < 60:
        return _item("vol_regime", label, None, "", definition, T("Historique trop court.", "History too short."))
    v30 = r.tail(30).std() * np.sqrt(ppy) * 100
    vall = r.std() * np.sqrt(ppy) * 100
    ratio = v30 / vall if vall > 0 else None
    txt = T(f"Volatilité annualisée sur 30 séances : {fr(v30)} % contre {fr(vall)} % en moyenne sur la période. ",
            f"Annualised 30-session volatility: {fr(v30)}% versus {fr(vall)}% on average over the period. ") + (
        T("Le marché est actuellement plus agité que d'habitude.", "The market is currently more agitated than usual.") if ratio and ratio > 1.2 else
        T("Le marché est actuellement plus calme que d'habitude.", "The market is currently calmer than usual.") if ratio and ratio < 0.8 else
        T("La volatilité récente est dans la norme.", "Recent volatility is in line with normal."))
    return _item("vol_regime", label, _r(v30), "%", definition, txt, "warn" if ratio and ratio > 1.2 else "neutral")


def _liquidity_item(df):
    if "Volume" not in df.columns or df["Volume"].tail(63).sum() == 0:
        return None
    dv = (df["Close"] * df["Volume"]).tail(63).mean()
    if not dv or np.isnan(dv):
        return None
    v = dv / 1e6
    txt = (T("Liquidité très élevée : vous pouvez acheter/vendre sans impact sur le prix.", "Very high liquidity: you can buy/sell without moving the price.") if v > 100 else
           T("Liquidité correcte pour un investisseur particulier.", "Adequate liquidity for an individual investor.") if v > 5 else
           T("Liquidité faible : écarts achat/vente potentiellement larges, privilégiez les ordres à cours limité.", "Low liquidity: bid/ask spreads may be wide, prefer limit orders."))
    return _item("liquidity", T("Volume moyen / jour", "Average daily volume"), _r(v, 1), "M",
                 T("Montant moyen échangé chaque jour sur 3 mois (cours × volume), en millions de la devise de cotation. Mesure la facilité à acheter ou vendre.",
                   "Average amount traded per day over 3 months (price × volume), in millions of the quote currency. Measures how easy it is to buy or sell."), txt)


def _dividend_item(dividends, last_price):
    if dividends is None or last_price is None:
        return None
    label = T("Dividende (12 mois)", "Dividend yield (12 months)")
    if len(dividends) == 0:
        return _item("div_yield", label, 0.0, "%", T("Somme des dividendes versés sur les 12 derniers mois divisée par le cours actuel.",
                                                      "Sum of dividends paid over the last 12 months divided by the current price."),
                     T("Aucun dividende versé sur les 12 derniers mois.", "No dividend paid over the last 12 months."))
    d = dividends.copy()
    d.index = pd.to_datetime(d.index).tz_localize(None) if getattr(d.index, "tz", None) else pd.to_datetime(d.index)
    last12 = d[d.index >= pd.Timestamp.today() - pd.Timedelta(days=365)].sum()
    v = last12 / last_price * 100 if last_price > 0 else None
    if not v:
        txt = T("Aucun dividende versé sur les 12 derniers mois.", "No dividend paid over the last 12 months.")
    else:
        txt = T(f"Les dividendes des 12 derniers mois représentent {fr(v)} % du cours actuel ", f"Dividends over the last 12 months represent {fr(v)}% of the current price ") + (
            T("(rendement élevé : vérifiez qu'il est soutenable).", "(high yield: check that it is sustainable).") if v > 6 else
            T("(rendement confortable).", "(comfortable yield).") if v > 3 else
            T("(rendement modeste, valeur plutôt orientée croissance).", "(modest yield, rather a growth stock)."))
    return _item("div_yield", label, _r(v), "%", T(
        "Somme des dividendes versés sur les 12 derniers mois divisée par le cours actuel. Note : les performances affichées incluent déjà les dividendes réinvestis (cours ajustés).",
        "Sum of dividends paid over the last 12 months divided by the current price. Note: displayed returns already include reinvested dividends (adjusted prices)."), txt)


# Noms des devises avec leur genre (pour accorder les phrases sur le sens d'une paire) : (français, genre, anglais)
_FX_NAMES = {
    "EUR": ("l'euro", "m", "the euro"), "USD": ("le dollar", "m", "the US dollar"), "GBP": ("la livre sterling", "f", "the pound"),
    "JPY": ("le yen", "m", "the yen"), "CHF": ("le franc suisse", "m", "the Swiss franc"), "CAD": ("le dollar canadien", "m", "the Canadian dollar"),
    "AUD": ("le dollar australien", "m", "the Australian dollar"), "NZD": ("le dollar néo-zélandais", "m", "the New Zealand dollar"),
    "CNY": ("le yuan", "m", "the yuan"), "MXN": ("le peso mexicain", "m", "the Mexican peso"), "TRY": ("la livre turque", "f", "the Turkish lira"),
    "INR": ("la roupie indienne", "f", "the Indian rupee"), "BRL": ("le réal brésilien", "m", "the Brazilian real"), "ZAR": ("le rand", "m", "the rand"),
    "SEK": ("la couronne suédoise", "f", "the Swedish krona"), "NOK": ("la couronne norvégienne", "f", "the Norwegian krone"),
    "SGD": ("le dollar de Singapour", "m", "the Singapore dollar"), "HKD": ("le dollar de Hong Kong", "m", "the Hong Kong dollar"),
}


def _fx_pair(ticker: str):
    """'EURUSD=X' -> ('EUR', 'USD') ; 'JPY=X' (notation Yahoo de USD/JPY) -> ('USD', 'JPY')."""
    if not ticker.endswith("=X"):
        return None
    code = ticker[:-2]
    if len(code) == 6:
        return code[:3], code[3:]
    if len(code) == 3:
        return "USD", code
    return None


def _fx_name(ccy):
    return _FX_NAMES.get(ccy, (ccy, "m", ccy))


def _fx_a(ccy):
    """« au dollar », « à la livre sterling », « à l'euro »."""
    name = _fx_name(ccy)[0]
    return "au " + name[3:] if name.startswith("le ") else "à " + name


def _cap(s):
    return s[:1].upper() + s[1:]


def _fx_reading_item(pair, last, nd):
    base, quote = pair
    nb, nq = _fx_name(base), _fx_name(quote)
    return _item("fx_reading", T(f"Cours {base}/{quote}", f"{base}/{quote} rate"), round(last, nd), quote, T(
        f"Une paire de devises indique combien d'unités de la seconde devise ({quote}, la devise de cotation) il faut pour acheter "
        f"1 unité de la première ({base}, la devise de base). Quand la paire monte, {nb[0]} se renforce face {_fx_a(quote)} ; "
        f"quand elle baisse, c'est {nq[0]} qui se renforce.",
        f"A currency pair shows how many units of the second currency ({quote}, the quote currency) it takes to buy 1 unit of the first "
        f"({base}, the base currency). When the pair rises, {nb[2]} strengthens against {nq[2]}; when it falls, {nq[2]} strengthens."),
        T(f"Aujourd'hui, 1 {base} = {fr(last, nd)} {quote}. Si ce chiffre monte, {nb[0]} gagne en valeur face {_fx_a(quote)} ; "
          f"s'il baisse, c'est {nq[0]} qui gagne en valeur face {_fx_a(base)}.",
          f"Today, 1 {base} = {fr(last, nd)} {quote}. If this number rises, {nb[2]} gains value against {nq[2]}; "
          f"if it falls, {nq[2]} gains value against {nb[2]}."), nd=nd)


def _fx_move_text(pair, v, last, nd):
    """Traduit une variation de la paire en « quelle devise s'est renforcée »."""
    base, quote = pair
    before = last / (1 + v / 100)
    strong, weak = (base, quote) if v >= 0 else (quote, base)
    ns = _fx_name(strong)
    verb = "s'est appréciée" if ns[1] == "f" else "s'est apprécié"
    return T(f"{_cap(ns[0])} {verb} face {_fx_a(weak)} : 1 {base} valait {fr(before, nd)} {quote}, il en vaut maintenant {fr(last, nd)}.",
             f"{_cap(ns[2])} strengthened against {_fx_name(weak)[2]}: 1 {base} was worth {fr(before, nd)} {quote}, it is now worth {fr(last, nd)}.")


def _range_pos_item(close, pair, pip, nd):
    year = close.tail(252)
    hi, lo, last = float(year.max()), float(year.min()), float(close.iloc[-1])
    pos = (last - lo) / (hi - lo) * 100 if hi > lo else None
    label = T("Position dans la fourchette 1 an", "Position in the 1-year range")
    definition = T(
        "Situe le cours actuel entre le plus bas et le plus haut des 12 derniers mois (252 séances). "
        "Calcul : (cours − plus bas) ÷ (plus haut − plus bas). 0 % = au plus bas de l'année, 50 % = exactement à mi-chemin, 100 % = au plus haut. "
        "C'est une photo de l'endroit où se trouve le cours, pas une prévision : un cours près de son plus haut peut continuer de monter.",
        "Places the current price between the low and the high of the last 12 months (252 sessions). "
        "Formula: (price − low) ÷ (high − low). 0% = at the yearly low, 50% = exactly halfway, 100% = at the yearly high. "
        "It is a snapshot of where the price stands, not a forecast: a price near its high can keep rising.")
    if pos is None:
        return _item("range_pos", label, None, "%", definition, T("Indisponible (cours constant sur l'année).", "Unavailable (flat price over the year)."))
    up_pips, down_pips = (hi - last) / pip, (last - lo) / pip
    txt = T(f"Sur 12 mois, la paire a évolué entre {fr(lo, nd)} et {fr(hi, nd)}. À {fr(last, nd)}, elle a parcouru {fr(pos, 0)} % du chemin entre ce plus bas et ce plus haut "
            f"({fr(up_pips, 0)} pips sous le plus haut, {fr(down_pips, 0)} pips au-dessus du plus bas). ",
            f"Over 12 months the pair ranged between {fr(lo, nd)} and {fr(hi, nd)}. At {fr(last, nd)} it has covered {fr(pos, 0)}% of the way from that low to that high "
            f"({fr(up_pips, 0)} pips below the high, {fr(down_pips, 0)} pips above the low). ")
    if pair:
        base, quote = pair
        nb, nq = _fx_name(base), _fx_name(quote)
        if pos >= 80:
            txt += T(f"Elle est près de son sommet annuel : {nb[0]} est proche de son niveau le plus fort de l'année face {_fx_a(quote)}.",
                     f"It is near its yearly top: {nb[2]} is close to its strongest level of the year against {nq[2]}.")
        elif pos <= 20:
            txt += T(f"Elle est près de son plancher annuel : {nb[0]} est proche de son niveau le plus faible de l'année face {_fx_a(quote)}.",
                     f"It is near its yearly floor: {nb[2]} is close to its weakest level of the year against {nq[2]}.")
        else:
            txt += T("Elle est en milieu de fourchette : ni au plus fort, ni au plus faible de l'année.", "It is mid-range: neither at its strongest nor at its weakest of the year.")
    return _item("range_pos", label, _r(pos, 1), "%", definition, txt, "warn" if pos >= 90 or pos <= 10 else "neutral")


def asset_class_metrics(asset_class: str, df: pd.DataFrame, ppy: int, dividends=None) -> list:
    """Métriques propres à chaque type d'actif, avec définition et interprétation."""
    close = df["Close"].dropna()
    if len(close) < 5:
        return []
    returns = close.pct_change().dropna()
    items = []

    if asset_class in ("ACTION", "ETF", "INDEX"):
        items += [_ytd_item(close)]
        items += _perf_items(close, [91, 182, 365])
        items += [_high_item(close), _ma50_item(close), _ma200_item(close), _rsi_item(close), _atr_item(df)]
        if asset_class != "INDEX":
            div = _dividend_item(dividends, float(close.iloc[-1]))
            if div:
                items.append(div)
            liq = _liquidity_item(df)
            if liq:
                items.append(liq)
        if asset_class == "INDEX" and len(close) >= 200:
            ma = close.rolling(200).mean()
            pct_above = (close[ma.notna()] > ma.dropna()).mean() * 100
            items.append(_item("time_above_ma200", T("Temps au-dessus de la MM200", "Time above 200-day MA"), _r(pct_above, 1), "%",
                               T("Part des séances où l'indice cotait au-dessus de sa moyenne 200 séances : mesure la proportion du temps passée en tendance haussière.",
                                 "Share of sessions where the index traded above its 200-session average: measures how much time was spent in an uptrend."),
                               T(f"L'indice a passé {fr(pct_above, 1)} % du temps en tendance haussière de fond sur la période.",
                                 f"The index spent {fr(pct_above, 1)}% of the time in a long-term uptrend over the period.")))

    elif asset_class == "CRYPTO":
        items += _perf_items(close, [7, 30, 90, 365])
        items += [_high_item(close), _vol_regime_item(close, ppy)]
        if len(close) >= 200:
            mayer = close.iloc[-1] / close.rolling(200).mean().iloc[-1]
            txt = T(f"Multiple de Mayer à {fr(mayer)}. ", f"Mayer multiple at {fr(mayer)}. ") + (
                T("Au-dessus de 2,4 : historiquement une zone de surchauffe (bulle).", "Above 2.4: historically an overheating (bubble) zone.") if mayer > 2.4 else
                T("Entre 1 et 2,4 : tendance haussière sans excès majeur.", "Between 1 and 2.4: uptrend without major excess.") if mayer >= 1 else
                T("Sous 1 : le cours est sous sa moyenne 200 jours, zone historiquement d'accumulation pour le Bitcoin.",
                  "Below 1: the price is under its 200-day average, historically an accumulation zone for Bitcoin."))
            items.append(_item("mayer", T("Multiple de Mayer", "Mayer multiple"), _r(mayer), "", T(
                "Cours actuel divisé par sa moyenne mobile 200 jours. Indicateur popularisé pour le Bitcoin : > 2,4 = surchauffe, < 1 = cours déprimé.",
                "Current price divided by its 200-day moving average. Popularised for Bitcoin: > 2.4 = overheating, < 1 = depressed price."), txt,
                "warn" if mayer > 2.4 else "neutral"))
        big = (returns.abs() > 0.05).mean() * 100
        items.append(_item("big_moves", T("Jours à plus de ±5 %", "Days moving more than ±5%"), _r(big, 1), "%",
                           T("Part des journées où le cours a bougé de plus de 5 % (à la hausse ou à la baisse).", "Share of days when the price moved more than 5% (up or down)."),
                           T(f"Environ 1 jour sur {max(1, round(100 / big))} connaît une variation de plus de 5 %.", f"About 1 day in {max(1, round(100 / big))} sees a move of more than 5%.") if big > 0 else
                           T("Aucune variation journalière supérieure à 5 % sur la période.", "No daily move above 5% over the period.")))
        items.append(_rsi_item(close))

    elif asset_class == "FOREX":
        tk = str(df.attrs.get("ticker", "")).upper()
        pip = 0.01 if "JPY" in tk else 0.0001
        nd = 2 if "JPY" in tk else 4
        pair = _fx_pair(tk)
        last = float(close.iloc[-1])
        if pair:
            items.append(_fx_reading_item(pair, last, nd))
        last30 = close.tail(30)
        rng = (last30.max() - last30.min()) / pip
        items.append(_item("range_30", T("Range 30 séances", "30-session range"), _r(rng, 0), "pips",
                           T("Écart entre le plus haut et le plus bas des 30 dernières séances, exprimé en pips (0,0001, ou 0,01 pour les paires en yen).",
                             "Gap between the high and low of the last 30 sessions, in pips (0.0001, or 0.01 for yen pairs)."),
                           T(f"La paire a évolué dans un couloir de {fr(rng, 0)} pips sur les 30 dernières séances.", f"The pair traded within a {fr(rng, 0)}-pip channel over the last 30 sessions.")))
        if {"High", "Low"}.issubset(df.columns):
            adr = ((df["High"] - df["Low"]).tail(20).mean()) / pip
            items.append(_item("adr", T("Range journalier moyen (20 j)", "Average daily range (20 d)"), _r(adr, 0), "pips",
                               T("Amplitude moyenne d'une séance (plus haut − plus bas) sur 20 jours, en pips.", "Average session range (high − low) over 20 days, in pips."),
                               T(f"Une journée type fait bouger la paire d'environ {fr(adr, 0)} pips entre son plus haut et son plus bas.",
                                 f"A typical day moves the pair about {fr(adr, 0)} pips between its high and low.")))
        perf = _perf_items(close, [30, 91, 365])
        if pair:
            for it in perf:
                if it["value"] is not None:
                    it["interpretation"] += " " + _fx_move_text(pair, it["value"], last, nd)
        items += perf
        items.append(_range_pos_item(close, pair, pip, nd))
        items += [_vol_regime_item(close, ppy), _ma50_item(close), _ma200_item(close), _rsi_item(close)]

    elif asset_class == "COMMODITY":
        items += [_ytd_item(close)]
        items += _perf_items(close, [91, 365])
        items += [_high_item(close), _vol_regime_item(close, ppy), _atr_item(df)]
        amp = (close.max() / close.min() - 1) * 100
        items.append(_item("amplitude", T("Amplitude de la période", "Range over the period"), _r(amp), "%",
                           T("Écart entre le plus haut et le plus bas de la période, rapporté au plus bas.", "Gap between the period high and low, relative to the low."),
                           T(f"Entre son point bas et son point haut, le prix a varié de {fr(amp)} % sur la période.", f"Between its low and high, the price moved {fr(amp)}% over the period.")))
        months = close.resample("ME").last().pct_change().dropna()
        if months.index.year.nunique() >= 3:
            by_month = months.groupby(months.index.month).mean() * 100
            names = (["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."] if lang() == "fr" else
                     ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"])
            best, worst = int(by_month.idxmax()), int(by_month.idxmin())
            n_years = months.index.year.nunique()
            items.append(_item("seasonality", T("Saisonnalité (meilleur mois)", "Seasonality (best month)"), _r(by_month.max()), "%",
                               T("Performance moyenne par mois calendaire sur toute la période : certaines matières premières ont des cycles saisonniers (récoltes, chauffage, conduite estivale...).",
                                 "Average return per calendar month over the whole period: some commodities have seasonal cycles (harvests, heating, summer driving…)."),
                               T(f"Historiquement, le meilleur mois est {names[best - 1]} ({fr(by_month.max(), 2, True)} % en moyenne) et le pire est {names[worst - 1]} ({fr(by_month.min(), 2, True)} %). Calculé sur {n_years} années.",
                                 f"Historically, the best month is {names[best - 1]} ({fr(by_month.max(), 2, True)}% on average) and the worst is {names[worst - 1]} ({fr(by_month.min(), 2, True)}%). Computed over {n_years} years."),
                               "neutral"))
        items += [_ma50_item(close), _ma200_item(close), _rsi_item(close)]

    return items


# =====================================================================
# 10. INTERPRÉTATIONS (PHRASES CHIFFRÉES)
# =====================================================================

def interpret_metrics(m: dict, benchmark_label: str = None, portfolio: bool = False) -> dict:
    c = {}
    g = m.get
    bl = benchmark_label or T("l'indice de référence", "the benchmark")
    ppy = g("periods_per_year") or 252
    years = g("period_years") or 0
    rf_txt = T(f"{fr(risk_free() * 100)} %", f"{fr(risk_free() * 100)}%") + (f", {g('risk_free_source')}" if g("risk_free_source") else "")
    vol = g("annualized_volatility_pct")
    daily_move = vol / math.sqrt(ppy) if vol else None  # amplitude d'une séance « normale »

    v = g("total_change_pct")
    if v is not None:
        c["total_change"] = T(f"Sur la période, le cours a varié de {fr(v, 2, True)} % : 100 placés au départ valent {fr(100 + v)} à la fin. ",
                              f"Over the period, the price changed by {fr(v, 2, True)}%: 100 invested at the start is worth {fr(100 + v)} at the end. ") + (
            T("Performance positive.", "Positive performance.") if v >= 0 else T("Performance négative : l'actif a perdu de la valeur.", "Negative performance: the asset lost value."))

    v = g("cagr_pct")
    if v is not None:
        if 0 < years < 0.95:
            c["cagr"] = T(f"La période dure moins d'un an ({fdur(g('observations'), ppy)}) : ces {fr(v, 2, True)} % par an supposent que le rythme observé continue toute une année. Chiffre extrapolé, à prendre avec prudence.",
                          f"The period is shorter than a year ({fdur(g('observations'), ppy)}): this {fr(v, 2, True)}% a year assumes the observed pace lasts a full year. An extrapolated figure, to be taken with caution.")
        elif 0.95 <= years <= 1.05:
            c["cagr"] = T(f"Sur une période d'un an, le rendement annuel ({fr(v, 2, True)} %) est logiquement presque identique à la variation totale. Cet indicateur devient utile pour comparer des périodes de durées différentes.",
                          f"Over a one-year period, the annual return ({fr(v, 2, True)}%) is naturally almost the same as the total change. This indicator becomes useful to compare periods of different lengths.")
        else:
            c["cagr"] = T(f"En moyenne, l'actif a rapporté {fr(v)} % par an (intérêts composés). ", f"On average, the asset returned {fr(v)}% per year (compounded). ") + (
                T("C'est supérieur à la moyenne historique des actions mondiales (environ 7 à 8 % par an).", "That is above the long-run average of global equities (about 7–8% a year).") if v > 8 else
                T("C'est dans la moyenne historique des actions (environ 5 à 8 % par an).", "That is in line with the long-run average of equities (about 5–8% a year).") if v >= 5 else
                T("C'est un rendement modeste.", "That is a modest return.") if v >= 0 else T("Le rendement annuel est négatif.", "The annual return is negative."))

    v = g("sharpe_ratio")
    if v is not None:
        c["sharpe"] = T(f"Sharpe de {fr(v)} : ", f"Sharpe of {fr(v)}: ") + (
            T(f"le rendement est inférieur au taux sans risque ({rf_txt}) ; un placement sans risque aurait fait mieux.", f"the return is below the risk-free rate ({rf_txt}); a risk-free investment would have done better.") if v < 0 else
            T("le rendement compense faiblement le risque pris. Chaque unité de volatilité est peu rémunérée.", "the return barely compensates the risk taken. Each unit of volatility is poorly rewarded.") if v < 0.5 else
            T("rendement correct au regard du risque, typique d'un indice actions sur le long terme.", "a decent return for the risk, typical of an equity index over the long run.") if v < 1 else
            T("très bon rapport rendement/risque.", "a very good risk/return trade-off.") if v < 2 else
            T("rapport rendement/risque exceptionnel. Sur une période courte, ce niveau est rarement durable.", "an exceptional risk/return trade-off. Over a short period, this level is rarely sustainable."))

    v = g("sortino_ratio")
    if v is not None:
        sh = g("sharpe_ratio") or 0
        extra = (T(" Le Sortino est nettement supérieur au Sharpe : une bonne part de la volatilité vient de hausses, pas de baisses.",
                   " Sortino is well above Sharpe: much of the volatility comes from rises, not falls.") if v > sh * 1.3 and v > 0 else "")
        c["sortino"] = T(f"Sortino de {fr(v)} : ", f"Sortino of {fr(v)}: ") + (
            T("les baisses ne sont pas compensées par le rendement.", "the falls are not compensated by the return.") if v < 0 else
            T("rendement faible au regard des baisses subies.", "a weak return relative to the falls suffered.") if v < 1 else
            T("bonne rémunération du risque de baisse.", "good reward for downside risk.") if v < 2 else
            T("excellente rémunération du risque de baisse.", "excellent reward for downside risk.")) + extra

    v = g("calmar_ratio")
    if v is not None:
        c["calmar"] = T(f"Calmar de {fr(v)} : le rendement annuel représente {fr(v)} fois la pire chute. ", f"Calmar of {fr(v)}: the annual return is {fr(v)} times the worst drop. ") + (
            T("La pire chute n'a pas été compensée par le rendement.", "The worst drop was not offset by the return.") if v < 0.5 else
            T("Rapport correct entre gain annuel et pire perte.", "A reasonable ratio between annual gain and worst loss.") if v < 1 else
            T("Le rendement annuel dépasse la pire chute subie : très bon profil.", "The annual return exceeds the worst drop: a very good profile.") if v < 3 else
            T("Rapport exceptionnel (souvent lié à une période courte sans krach).", "An exceptional ratio (often due to a short period without a crash)."))

    v = g("omega_ratio")
    if v is not None:
        c["omega"] = T(f"Omega de {fr(v)} : si l'on additionne toutes les hausses d'un côté et toutes les baisses de l'autre, les hausses valent {fr(v)} fois les baisses. ",
                       f"Omega of {fr(v)}: adding up all the rises on one side and all the falls on the other, the rises are worth {fr(v)} times the falls. ") + (
            T("Les pertes l'emportent sur les gains.", "Losses outweigh gains.") if v < 1 else
            T("Léger avantage aux gains, typique d'un actif qui monte lentement sur le long terme.", "A slight edge to gains, typical of an asset rising slowly over the long run.") if v < 1.1 else
            T("Avantage net aux gains.", "A clear edge to gains.") if v < 1.3 else T("Très net avantage aux gains.", "A very clear edge to gains."))

    v = g("win_rate_pct")
    if v is not None:
        c["win_rate"] = T(f"{fr(v, 1)} % des {sessions_word(ppy)} ont fini en hausse. Un taux proche de 50 % est normal pour un actif coté : la rentabilité dépend surtout de la taille des gains par rapport aux pertes (voir le ratio Omega).",
                          f"{fr(v, 1)}% of {sessions_word(ppy)} closed higher. A rate near 50% is normal for a listed asset: profitability depends mostly on the size of gains versus losses (see the Omega ratio).")

    v = g("max_drawdown_pct")
    if v is not None:
        a = abs(v)
        need = (100 / (100 - a) - 1) * 100 if a < 100 else None
        txt = T(f"Au pire moment, l'actif a perdu {fr(a)} %", f"At the worst point, the asset lost {fr(a)}%")
        if g("mdd_peak_date"):
            txt += T(f", entre son sommet du {fdate(g('mdd_peak_date'))} et son point bas du {fdate(g('mdd_trough_date'))}",
                     f", between its peak on {fdate(g('mdd_peak_date'))} and its low on {fdate(g('mdd_trough_date'))}")
        txt += ". "
        if g("mdd_peak_date"):
            txt += (T(f"Il a retrouvé ce sommet le {fdate(g('mdd_recovery_date'))}. ", f"It got back to that peak on {fdate(g('mdd_recovery_date'))}. ") if g("mdd_recovery_date")
                    else T("Il n'a pas encore retrouvé ce sommet. ", "It has not yet got back to that peak. "))
        if need and a >= 1:
            done = bool(g("mdd_recovery_date")) or not g("mdd_peak_date")
            txt += (T(f"Pour revenir au sommet, il a fallu +{fr(need)} %", f"To get back to the peak, it took +{fr(need)}%") if done else
                    T(f"Depuis ce point bas, il faudrait +{fr(need)} % pour revenir au sommet", f"From that low, it would take +{fr(need)}% to get back to the peak")) + T(
                f" : 100 tombés à {fr(100 - a)} doivent regagner {fr(a)}, et {fr(a)} représente {fr(need)} % de {fr(100 - a)}. Une chute se rattrape toujours avec une hausse plus grande (−50 % exige +100 %). ",
                f": 100 that fell to {fr(100 - a)} must regain {fr(a)}, and {fr(a)} is {fr(need)}% of {fr(100 - a)}. A fall always takes a bigger rise to recover (−50% requires +100%). ")
        c["mdd"] = txt + (
            T("Baisse limitée : profil défensif.", "Limited fall: defensive profile.") if a < 10 else
            T("Correction modérée, courante pour un actif actions.", "Moderate correction, common for an equity asset.") if a < 25 else
            T("Baisse sévère, typique d'un marché baissier.", "Severe fall, typical of a bear market.") if a < 50 else
            T("Effondrement majeur : plus de la moitié de la valeur a été perdue à un moment.", "Major collapse: more than half of the value was lost at some point."))

    v = g("mean_drawdown_pct")
    if v is not None:
        below = g("days_below_peak_pct")
        mdd = abs(g("max_drawdown_pct") or 0)
        txt = (T(f"L'actif a passé {fr(below, 0)} % des {sessions_word(ppy)} sous un ancien record, en moyenne {fr(abs(v))} % en dessous. ",
                 f"The asset spent {fr(below, 0)}% of {sessions_word(ppy)} below a previous record, on average {fr(abs(v))}% below it. ") if below is not None else
               T(f"Sous un ancien record, l'actif se trouvait en moyenne {fr(abs(v))} % plus bas. ", f"Below a previous record, the asset sat on average {fr(abs(v))}% lower. "))
        if v and mdd > abs(v) * 1.5:
            txt += T(f"C'est le recul « habituel » ressenti en le détenant ; la pire chute ({fr(mdd)} %) a été {fr(mdd / abs(v), 1)} fois plus profonde.",
                     f"That is the “usual” dip felt while holding it; the worst fall ({fr(mdd)}%) was {fr(mdd / abs(v), 1)} times deeper.")
        else:
            txt += T("C'est le recul « habituel » ressenti en le détenant.", "That is the “usual” dip felt while holding it.")
        c["mean_dd"] = txt

    v = g("current_drawdown_pct")
    if v is not None:
        scope_all = g("high_scope") == "all"
        ref = T("son record historique", "its all-time high") if scope_all else T("son plus haut de la période", "its high for the period")
        when = T(f" (atteint le {fdate(g('high_date'))})", f" (reached on {fdate(g('high_date'))})") if g("high_date") else ""
        if v == 0:
            c["current_dd"] = T(f"L'actif est actuellement sur {ref}.", f"The asset is currently at {ref}.")
        else:
            back = (100 / (100 + v) - 1) * 100 if v > -100 else None
            c["current_dd"] = T(f"L'actif est aujourd'hui {fr(abs(v))} % sous {ref}{when}.", f"The asset is currently {fr(abs(v))}% below {ref}{when}.") + (
                T(f" Il lui faudrait gagner {fr(back)} % pour y revenir.", f" It would need to gain {fr(back)}% to get back there.") if back else "")

    v = g("mean_time_to_recovery_days")
    if v is not None and g("drawdown_count"):
        lng = g("longest_drawdown_days")
        n, n5 = g("drawdown_count"), g("drawdown_count_5pct")
        start = fdate(g("longest_dd_start"))
        if n == 1 and g("longest_dd_ongoing"):
            txt = T(f"L'actif est sous son record depuis le {start}, soit {lng} {sessions_word(ppy)} ({fdur(lng, ppy)}), et ne l'a pas encore retrouvé. ",
                    f"The asset has been below its record since {start}, i.e. {lng} {sessions_word(ppy)} ({fdur(lng, ppy)}), and has not yet got back to it. ")
        else:
            txt = T(f"Chaque fois que l'actif est passé sous un record, il lui a fallu en moyenne {fr(v, 0)} {sessions_word(ppy)} ({fdur(v, ppy)}) pour en établir un nouveau. ",
                    f"Each time the asset fell below a record, it took on average {fr(v, 0)} {sessions_word(ppy)} ({fdur(v, ppy)}) to set a new one. ")
            txt += T(f"C'est arrivé {n} fois sur la période, dont {n5} avec une baisse de plus de 5 %. ", f"It happened {n} times over the period, {n5} of them with a fall of more than 5%. ")
            if lng and g("longest_dd_start"):
                span = (T(f"du {start} à aujourd'hui (toujours en cours)", f"from {start} to today (still ongoing)") if g("longest_dd_ongoing")
                        else T(f"du {start} au {fdate(g('longest_dd_end'))}", f"from {start} to {fdate(g('longest_dd_end'))}"))
                txt += T(f"La plus longue attente a duré {lng} {sessions_word(ppy)} ({fdur(lng, ppy)}), {span}. ",
                         f"The longest wait lasted {lng} {sessions_word(ppy)} ({fdur(lng, ppy)}), {span}. ")
        c["recovery"] = txt + (
            T("Les replis sont vite effacés.", "Dips are quickly erased.") if v < 10 else
            T("Délai de récupération modéré.", "A moderate recovery time.") if v < 60 else
            T("Les replis mettent longtemps à être effacés : il faut de la patience.", "Dips take a long time to be erased: patience is needed."))

    v = g("ulcer_index")
    if v is not None:
        c["ulcer"] = T(f"Ulcer Index de {fr(v)} : il résume en un chiffre le stress de détenir l'actif. Il vaut à peu près la baisse « typique » sous le record, en donnant plus de poids aux chutes profondes et longues. ",
                       f"Ulcer Index of {fr(v)}: it sums up in one number how stressful the asset was to hold. It is roughly the “typical” distance below the record, giving more weight to deep and long falls. ") + (
            T("Baisses rares et peu profondes : détention très sereine.", "Rare and shallow falls: a very calm holding.") if v < 5 else
            T("Baisses modérées, comparables à un indice actions large.", "Moderate falls, comparable to a broad equity index.") if v < 15 else
            T("Baisses profondes et/ou longues : détention éprouvante.", "Deep and/or long falls: a trying holding.")) + T(
            " À rendement égal, l'actif à l'Ulcer Index le plus bas est le plus confortable à garder.", " For the same return, the asset with the lowest Ulcer Index is the most comfortable to hold.")

    v = vol
    if v is not None:
        mean = g("cagr_pct")
        rng = (T(f" Avec le rendement moyen observé ({fr(mean, 1, True)} % par an), cela donne à peu près entre {fr(mean - v, 1, True)} % et {fr(mean + v, 1, True)} % sur une année.",
                 f" With the observed average return ({fr(mean, 1, True)}% a year), that gives roughly between {fr(mean - v, 1, True)}% and {fr(mean + v, 1, True)}% over a year.")
               if mean is not None and years >= 0.95 else "")
        c["vol"] = T(f"Volatilité de {fr(v)} % par an. Un jour normal, le cours bouge d'environ ± {fr(daily_move)} %. Sur un an, environ 2 années sur 3, le rendement s'écarte de moins de {fr(v)} % de sa moyenne.",
                     f"Volatility of {fr(v)}% a year. On a normal day, the price moves about ± {fr(daily_move)}%. Over a year, in about 2 years out of 3, the return stays within {fr(v)}% of its average.") + rng + " " + (
            T("Niveau faible (obligataire ou défensif).", "Low level (bond-like or defensive).") if v < 10 else
            T("Niveau modéré (proche d'un grand indice actions, ~15-20 %).", "Moderate level (close to a major equity index, ~15–20%).") if v < 22 else
            T("Niveau élevé (action individuelle ou secteur cyclique).", "High level (single stock or cyclical sector).") if v < 40 else
            T("Niveau très élevé (crypto, petite capitalisation ou titre spéculatif).", "Very high level (crypto, small cap or speculative stock)."))

    conf = g("var_confidence_selected") or 95
    v = g("var_historical_pct")
    if v is not None:
        per_year = max(1, round((100 - conf) / 100 * ppy))
        every = round(100 / (100 - conf)) if conf < 100 else None
        c["var_h"] = T(f"Sur {fconf(conf)} % des {sessions_word(ppy)} de la période, la baisse n'a pas dépassé {fr(abs(v))} %. Les {fconf(100 - conf)} % restants, soit environ {per_year} {sessions_word(ppy, per_year)} par an, ont été pires. ",
                       f"On {fconf(conf)}% of the {sessions_word(ppy)} in the period, the loss did not exceed {fr(abs(v))}%. The remaining {fconf(100 - conf)}%, about {per_year} {sessions_word(ppy, per_year)} a year, were worse. ") + (
            T(f"En pratique : environ {one_session(ppy)} sur {every}, attendez-vous à perdre au moins {fr(abs(v))} %.", f"In practice: about {one_session(ppy)} in {every}, expect to lose at least {fr(abs(v))}%.") if every else "")
    v = g("var_parametric_pct")
    if v is not None:
        vh = g("var_historical_pct")
        gap = ""
        if vh is not None and abs(vh) > abs(v) * 1.1:
            gap = T(" Elle est plus optimiste que la VaR historique : dans la réalité, les très mauvais jours arrivent plus souvent que ne le prévoit la courbe en cloche.",
                    " It is more optimistic than the historical VaR: in reality, very bad days happen more often than the bell curve predicts.")
        c["var_p"] = T(f"Si les variations suivaient une courbe en cloche parfaite, la perte journalière ne dépasserait {fr(abs(v))} % que {fconf(100 - conf)} % du temps.",
                       f"If daily moves followed a perfect bell curve, the daily loss would exceed {fr(abs(v))}% only {fconf(100 - conf)}% of the time.") + gap
    v = g("cvar_pct")
    if v is not None:
        c["cvar"] = T(f"Lors des {fconf(100 - conf)} % pires {sessions_word(ppy)}, la perte moyenne a été de {fr(abs(v))} %. C'est la réponse à la question : « quand ça va mal, ça va mal de combien ? »",
                      f"On the worst {fconf(100 - conf)}% of {sessions_word(ppy)}, the average loss was {fr(abs(v))}%. It answers the question: “when things go wrong, how wrong?”")

    v = g("beta")
    if v is not None:
        c["beta"] = T(f"Bêta de {fr(v)} : quand {bl} varie de 1 %, l'actif varie en moyenne de {fr(v)} %. ", f"Beta of {fr(v)}: when {bl} moves 1%, the asset moves {fr(v)}% on average. ") + (
            T("Il évolue souvent à contre-courant du marché.", "It often moves against the market.") if v < 0 else
            T("Il est peu sensible au marché (profil défensif).", "It is not very sensitive to the market (defensive profile).") if v < 0.7 else
            T("Il suit le marché à peu près au même rythme.", "It follows the market at roughly the same pace.") if v <= 1.2 else
            T("Il amplifie les mouvements du marché, à la hausse comme à la baisse.", "It amplifies market moves, both up and down."))

    v = g("alpha_annual_pct")
    if v is not None:
        c["alpha"] = T(f"Alpha de {fr(v, 2, True)} % par an : ", f"Alpha of {fr(v, 2, True)}% a year: ") + (
            T(f"l'actif a fait mieux que ce que son lien avec {bl} laissait attendre.", f"the asset did better than its link with {bl} would suggest.") if v > 1 else
            T(f"l'actif a fait moins bien que ce que son lien avec {bl} laissait attendre.", f"the asset did worse than its link with {bl} would suggest.") if v < -1 else
            T(f"la performance s'explique presque entièrement par les mouvements de {bl}.", f"the performance is almost entirely explained by the moves of {bl}.")) + T(
            f" Taux sans risque utilisé : {rf_txt}.", f" Risk-free rate used: {rf_txt}.")

    v = g("correlation")
    if v is not None:
        c["correlation"] = T(f"Corrélation de {fr(v)} avec {bl} : ", f"Correlation of {fr(v)} with {bl}: ") + (
            T("mouvements très liés, faible apport en diversification.", "very linked moves, little diversification benefit.") if v > 0.8 else
            T("lien marqué avec le marché.", "a marked link with the market.") if v > 0.5 else
            T("lien modéré : bon potentiel de diversification.", "a moderate link: good diversification potential.") if v > 0.2 else
            T("quasiment indépendant du marché : excellent diversifiant.", "almost independent of the market: an excellent diversifier."))

    v = g("r_squared")
    if v is not None:
        words = next((w for target, w in [(10, T("un dixième", "a tenth")), (20, T("un cinquième", "a fifth")), (25, T("un quart", "a quarter")),
                                          (33, T("un tiers", "a third")), (50, T("la moitié", "half")), (67, T("deux tiers", "two thirds")),
                                          (75, T("trois quarts", "three quarters")), (90, T("neuf dixièmes", "nine tenths"))] if abs(v - target) <= 4), None)
        approx = T(f", soit environ {words}", f", roughly {words}") if words else ""
        c["r_squared"] = T(f"{fr(v, 1)} % des variations quotidiennes de l'actif vont de pair avec celles de {bl}{approx} ; le reste lui est propre. ",
                           f"{fr(v, 1)}% of the asset's daily moves go hand in hand with those of {bl}{approx}; the rest is specific to it. ") + (
            T(f"Cela ne veut pas dire que {bl} fait bouger l'actif : les deux réagissent souvent aux mêmes nouvelles (taux d'intérêt, appétit pour le risque, liquidité).",
              f"It does not mean that {bl} moves the asset: both often react to the same news (interest rates, risk appetite, liquidity).") if v < 70 else
            T(f"L'actif se comporte presque comme {bl}.", f"The asset behaves almost like {bl}."))

    v = g("tracking_error_pct")
    if v is not None:
        c["tracking_error"] = T(f"Chaque jour, l'actif fait un peu mieux ou un peu moins bien que {bl}. Sur un an, ces écarts s'additionnent : avec {fr(v)} %, l'actif termine typiquement l'année entre {fr(v)} % au-dessus et {fr(v)} % en dessous de {bl} (environ 2 années sur 3). ",
                                f"Each day, the asset does a little better or a little worse than {bl}. Over a year these gaps add up: at {fr(v)}%, the asset typically ends the year between {fr(v)}% above and {fr(v)}% below {bl} (about 2 years out of 3). ") + (
            T("Très proche de l'indice (typique d'un ETF qui le réplique).", "Very close to the index (typical of an ETF that tracks it).") if v < 3 else
            T("Comportement nettement différent de l'indice.", "Behaves clearly differently from the index.") if v > 10 else
            T("Écart modéré avec l'indice.", "A moderate gap with the index."))

    v = g("information_ratio")
    if v is not None:
        c["information_ratio"] = T(f"Ratio d'information de {fr(v)} : ", f"Information ratio of {fr(v)}: ") + (
            T("surperformance régulière et significative face au benchmark.", "consistent and significant outperformance versus the benchmark.") if v > 0.5 else
            T("légère surperformance par rapport au benchmark.", "slight outperformance versus the benchmark.") if v > 0 else
            T("sous-performance par rapport au benchmark.", "underperformance versus the benchmark."))

    up, down = g("up_capture_pct"), g("down_capture_pct")
    if up is not None and down is not None:
        c["capture"] = T(f"Les jours de hausse de {bl}, l'actif capte {fr(up, 0)} % de la hausse ; les jours de baisse, il subit {fr(down, 0)} % de la baisse. ",
                         f"On days when {bl} rises, the asset captures {fr(up, 0)}% of the rise; on falling days, it takes {fr(down, 0)}% of the fall. ") + (
            T("Profil asymétrique favorable : il gagne plus qu'il ne perd par rapport au marché.", "Favourable asymmetric profile: it gains more than it loses relative to the market.") if up > down else
            T("Profil défavorable : il subit davantage les baisses qu'il ne profite des hausses.", "Unfavourable profile: it suffers more from falls than it benefits from rises."))

    v = g("skewness")
    if v is not None:
        c["skew"] = T(f"Asymétrie de {fr(v)} : ", f"Skewness of {fr(v)}: ") + (
            T("les fortes baisses ponctuelles sont plus fréquentes que les fortes hausses (risque de chute brutale).", "sharp one-off falls are more frequent than sharp rises (risk of sudden drop).") if v < -0.5 else
            T("les fortes hausses ponctuelles sont plus fréquentes que les fortes baisses (profil type « loterie »).", "sharp one-off rises are more frequent than sharp falls (“lottery”-like profile).") if v > 0.5 else
            T("distribution à peu près symétrique entre hausses et baisses.", "a roughly symmetric distribution of rises and falls."))

    v = g("kurtosis")
    if v is not None:
        c["kurt"] = T(f"Excès de kurtosis de {fr(v)} (0 pour une loi normale) : ", f"Excess kurtosis of {fr(v)} (0 for a normal distribution): ") + (
            T("les journées extrêmes sont rares, proches d'une loi normale.", "extreme days are rare, close to a normal distribution.") if v < 1 else
            T("les journées extrêmes sont un peu plus fréquentes que prévu par une loi normale.", "extreme days are slightly more frequent than a normal distribution predicts.") if v < 5 else
            T("les journées extrêmes (krachs ou envolées) sont beaucoup plus fréquentes que ne le prévoit une loi normale : la VaR paramétrique sous-estime le risque.",
              "extreme days (crashes or surges) are much more frequent than a normal distribution predicts: parametric VaR underestimates the risk."))

    v = g("tail_ratio")
    if v is not None:
        c["tail_ratio"] = T(f"Les meilleures journées (top 5 %) sont {fr(v)} fois plus amples que les pires (bottom 5 %). ", f"The best days (top 5%) are {fr(v)} times as large as the worst (bottom 5%). ") + (
            T("Avantage aux hausses extrêmes.", "Edge to extreme rises.") if v > 1.05 else
            T("Avantage aux baisses extrêmes.", "Edge to extreme falls.") if v < 0.95 else T("Extrêmes équilibrés.", "Balanced extremes."))

    v = g("positive_months_pct")
    if v is not None:
        c["positive_months"] = T(f"{fr(v, 0)} % des mois ont été positifs. Meilleur mois : {fr(g('best_month_pct'), 2, True)} %, pire mois : {fr(g('worst_month_pct'), 2, True)} %.",
                                 f"{fr(v, 0)}% of months were positive. Best month: {fr(g('best_month_pct'), 2, True)}%, worst month: {fr(g('worst_month_pct'), 2, True)}%.")

    v = g("downside_volatility_pct")
    if v is not None and vol:
        ratio = v / (vol / math.sqrt(2))  # ~1 quand hausses et baisses ont la même ampleur
        c["downside_vol"] = T(f"Volatilité baissière de {fr(v)} % par an, pour une volatilité totale de {fr(vol)} %. ", f"Downside volatility of {fr(v)}% a year, for a total volatility of {fr(vol)}%. ") + (
            T("Les baisses sont plus brutales que les hausses : quand l'actif recule, il le fait plus fort qu'il ne monte.", "Falls are sharper than rises: when the asset drops, it does so harder than it climbs.") if ratio > 1.1 else
            T("Les hausses sont plus amples que les baisses : une bonne partie de la volatilité vient de mouvements vers le haut, ce qui est plutôt bon signe.", "Rises are larger than falls: much of the volatility comes from upward moves, which is rather a good sign.") if ratio < 0.9 else
            T("Hausses et baisses ont à peu près la même ampleur.", "Rises and falls are roughly the same size.")) + T(
            " C'est cette mesure qu'utilise le ratio de Sortino.", " This is the measure used by the Sortino ratio.")

    for key, field, date_key in (("best_day", "max_daily_return_pct", "best_day_date"), ("worst_day", "min_daily_return_pct", "worst_day_date")):
        v = g(field)
        if v is None or not daily_move:
            continue
        x = abs(v) / daily_move
        when = T(f"Le {fdate(g(date_key))}, l'actif ", f"On {fdate(g(date_key))}, the asset ") if g(date_key) else T("L'actif ", "The asset ")
        c[key] = when + (T(f"a gagné {fr(v, 2, True)} % en {one_session(ppy)}", f"gained {fr(v, 2, True)}% in {one_session(ppy)}") if v >= 0 else
                         T(f"a perdu {fr(abs(v))} % en {one_session(ppy)}", f"lost {fr(abs(v))}% in {one_session(ppy)}")) + T(
            f", soit environ {fr(x, 0)} fois un mouvement habituel (± {fr(daily_move)} %). ", f", about {fr(x, 0)} times a usual move (± {fr(daily_move)}%). ") + (
            T("Mouvement exceptionnel, souvent lié à une annonce (résultats, décision de banque centrale, rachat…).", "An exceptional move, often tied to news (earnings, central bank decision, takeover…).") if x >= 4.5 else
            T("Mouvement marqué mais pas extrême pour cet actif.", "A marked but not extreme move for this asset."))

    if portfolio:  # même phrases, sujet adapté
        swaps = [("de l'actif", "du portefeuille"), ("à l'actif", "au portefeuille"), ("L'actif", "Le portefeuille"), ("l'actif", "le portefeuille"),
                 ("the asset's", "the portfolio's"), ("The asset", "The portfolio"), ("the asset", "the portfolio")]
        for k, txt in c.items():
            for x, y in swaps:
                txt = txt.replace(x, y)
            c[k] = txt
    return c


# =====================================================================
# 11. SIMULATION HISTORIQUE & MONTE CARLO
# =====================================================================

def monte_carlo_simulation(prices: pd.Series, days_forecast: int = 252, n_simulations: int = 5000,
                           initial_capital: float = 1000.0) -> dict:
    """Mouvement brownien géométrique calibré sur les rendements log historiques."""
    p = prices.dropna()
    log_ret = np.log(p / p.shift(1)).dropna()
    if log_ret.empty:
        return {"summary": {}, "chart_data": []}

    mu, sigma = float(log_ret.mean()), float(log_ret.std())
    rng = np.random.default_rng()
    step = max(1, days_forecast // 250)
    sampled = list(range(0, days_forecast + 1, step))
    if sampled[-1] != days_forecast:
        sampled.append(days_forecast)

    # Somme cumulée des log-rendements, puis on ne garde que les jours échantillonnés
    cum = np.cumsum(mu + sigma * rng.standard_normal((days_forecast, n_simulations), dtype=np.float32), axis=0)
    cum = np.vstack([np.zeros((1, n_simulations), dtype=np.float32), cum])[sampled]
    paths = initial_capital * np.exp(cum)
    p5, p50, p95 = np.percentile(paths, [5, 50, 95], axis=1)

    last = paths[-1]
    prob_loss = float((last < initial_capital).mean() * 100)
    summary = {
        "scenario_pessimiste_5pct": _r(p5[-1]),
        "scenario_median_50pct": _r(p50[-1]),
        "scenario_optimiste_95pct": _r(p95[-1]),
        "gain_espere_median_pct": _r((p50[-1] / initial_capital - 1) * 100),
        "probabilite_perte_pct": _r(prob_loss, 1),
        "initial": initial_capital,
    }
    chart = [{"day": f"J+{d}", "pessimiste": _r(a), "median": _r(b), "optimiste": _r(c)}
             for d, a, b, c in zip(sampled, p5, p50, p95)]
    return {"summary": summary, "chart_data": chart}


# =====================================================================
# 12. PORTEFEUILLE
# =====================================================================

def portfolio_value_series(prices_df: pd.DataFrame, weights: np.ndarray, rebalance: str = "none") -> pd.Series:
    """
    Valeur du portefeuille en base 100.
    - none    : achat initial puis conservation (les poids dérivent avec les cours)
    - monthly : retour aux poids cibles chaque début de mois
    - daily   : poids constants chaque jour
    """
    prices_df = prices_df.dropna()
    if rebalance == "daily":
        rets = prices_df.pct_change().fillna(0).to_numpy() @ weights
        return pd.Series(np.cumprod(1 + rets) * 100, index=prices_df.index)

    norm = prices_df / prices_df.iloc[0]
    if rebalance != "monthly":
        return pd.Series(norm.to_numpy() @ weights * 100, index=prices_df.index)

    values = np.empty(len(prices_df))
    px = prices_df.to_numpy()
    month_key = prices_df.index.year * 12 + prices_df.index.month
    starts = np.r_[0, np.flatnonzero(np.diff(month_key)) + 1]
    value = 100.0
    for i, s in enumerate(starts):
        e = starts[i + 1] if i + 1 < len(starts) else len(px)
        # on rééquilibre à la clôture de la veille du nouveau mois (ou au départ)
        ref = px[s - 1] if s > 0 else px[0]
        units = value * weights / ref
        seg = px[s:e] @ units
        values[s:e] = seg
        value = seg[-1]
    return pd.Series(values, index=prices_df.index)


def portfolio_breakdown(prices_df: pd.DataFrame, weights: np.ndarray, ppy: int) -> dict:
    """Statistiques par ligne + contributions au rendement et au risque + corrélations."""
    rets = prices_df.pct_change().dropna()
    cov = rets.cov().to_numpy() * ppy
    port_var = float(weights @ cov @ weights)
    marginal = cov @ weights
    risk_contrib = weights * marginal / port_var * 100 if port_var > 0 else np.zeros_like(weights)

    rows = []
    for i, t in enumerate(prices_df.columns):
        p = prices_df[t]
        tr = (p.iloc[-1] / p.iloc[0] - 1) * 100
        rows.append({
            "ticker": t,
            "weight_pct": _r(weights[i] * 100),
            "total_return_pct": _r(tr),
            "cagr_pct": cagr(p),
            "volatility_pct": _r(rets[t].std() * np.sqrt(ppy) * 100),
            "max_drawdown_pct": max_drawdown(p),
            "sharpe_ratio": sharpe_ratio(rets[t], ppy),
            "return_contribution_pct": _r(weights[i] * tr),
            "risk_contribution_pct": _r(risk_contrib[i], 1),
        })
    corr = rets.corr().round(2)
    avg_corr = None
    if len(corr) > 1:
        mask = ~np.eye(len(corr), dtype=bool)
        avg_corr = _r(corr.to_numpy()[mask].mean())
    vols = np.array([rets[t].std() * np.sqrt(ppy) for t in prices_df.columns])
    div_ratio = _r(float(weights @ vols) / np.sqrt(port_var)) if port_var > 0 else None
    return {
        "assets": rows,
        "correlation": {"tickers": list(corr.columns), "matrix": corr.fillna(0).to_numpy().tolist()},
        "average_correlation": avg_corr,
        "diversification_ratio": div_ratio,
    }


# =====================================================================
# 13. MÉTRIQUES DU SCREENER (une seule source de vérité)
# =====================================================================

def screener_metrics(df: pd.DataFrame, bench_close: pd.Series, ppy: int = 252) -> dict:
    """Métriques calculées pour le screener : risque sur 1 an glissant, momentum, technique."""
    close = df["Close"].dropna()
    if len(close) < 60:
        return {}
    window = close[close.index >= close.index[-1] - pd.Timedelta(days=365)]
    returns = window.pct_change().dropna()
    if returns.empty or returns.std() == 0:
        return {}

    aligned = pd.concat([window, bench_close], axis=1, join="inner").dropna()
    rel = market_relation(aligned.iloc[:, 0].pct_change(), aligned.iloc[:, 1].pct_change(), ppy) if len(aligned) > 20 else {}

    dv = None
    if "Volume" in df.columns:
        v = (df["Close"] * df["Volume"]).tail(63).mean()
        dv = _r(v / 1e6, 2) if v and not np.isnan(v) and v > 0 else None

    out = {
        "last_price": _r(close.iloc[-1]),
        "perf_1m_pct": perf_over(close, 30),
        "perf_3m_pct": perf_over(close, 91),
        "perf_6m_pct": perf_over(close, 182),
        "perf_ytd_pct": perf_ytd(close),
        "perf_1y_pct": perf_over(close, 365),
        "annualized_volatility_pct": _r(returns.std() * np.sqrt(ppy) * 100),
        "downside_volatility_pct": _r(np.sqrt(np.mean(np.minimum(returns, 0) ** 2)) * np.sqrt(ppy) * 100),
        "sharpe": sharpe_ratio(returns, ppy),
        "sortino": sortino_ratio(returns, ppy),
        "calmar": calmar_ratio(window),
        "omega": omega_ratio(returns),
        "max_drawdown_pct": max_drawdown(window),
        "mean_drawdown_pct": mean_drawdown(window),
        "current_drawdown_pct": current_drawdown(window),
        "ulcer_index": ulcer_index(window),
        "recovery_days": mean_time_to_recovery(window),
        "win_rate_pct": win_rate(returns),
        "profit_factor": profit_factor(returns),
        "var_95_historical_pct": value_at_risk_h(returns, 0.95),
        "var_95_parametric_pct": value_at_risk_p(returns, 0.95),
        "cvar_95_pct": conditional_var(returns, 0.95),
        "skewness": _r(returns.skew()),
        "kurtosis": _r(returns.kurtosis()),
        "best_day_pct": _r(returns.max() * 100),
        "worst_day_pct": _r(returns.min() * 100),
        "beta": rel.get("beta"),
        "alpha_annual_pct": rel.get("alpha_annual_pct"),
        "correlation": rel.get("correlation"),
        "rsi_14": rsi(close),
        "dist_ma50_pct": dist_to_ma(close, 50),
        "dist_ma200_pct": dist_to_ma(close, 200),
        "atr_pct": atr_pct(df),
        "avg_dollar_volume_m": dv,
    }
    return out
