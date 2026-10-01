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

RISK_FREE_RATE = 0.02  # taux sans risque annuel utilisé pour Sharpe, Sortino, Alpha

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
    """Formatage français d'un nombre pour les phrases (virgule décimale)."""
    if x is None:
        return "n.d."
    s = f"{x:+.{nd}f}" if signed else f"{x:.{nd}f}"
    return s.replace(".", ",")


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
    return (1 + RISK_FREE_RATE) ** (1 / ppy) - 1


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
    alpha_v = ret_a - (RISK_FREE_RATE + beta_v * (ret_b - RISK_FREE_RATE))
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
    })
    m.update(rel)
    m.update(monthly_stats(prices))
    return m


# =====================================================================
# 9. MÉTRIQUES SPÉCIFIQUES PAR CLASSE D'ACTIF
# =====================================================================

def _item(id_, label, value, unit="", definition="", interpretation="", tone="neutral"):
    return {"id": id_, "label": label, "value": value, "unit": unit,
            "definition": definition, "interpretation": interpretation, "tone": tone}


def _tone(v, good_if_positive=True):
    if v is None:
        return "neutral"
    return "pos" if (v >= 0) == good_if_positive else "neg"


def _rsi_item(close):
    v = rsi(close)
    if v is None:
        txt = "Historique trop court pour calculer le RSI."
    elif v >= 70:
        txt = f"RSI à {fr(v, 1)} : zone de surachat. La hausse récente est très forte ; un essoufflement ou une consolidation est fréquent à ce niveau, sans être garanti."
    elif v <= 30:
        txt = f"RSI à {fr(v, 1)} : zone de survente. Les vendeurs ont dominé récemment ; un rebond technique est fréquent, mais une tendance baissière peut aussi persister."
    else:
        txt = f"RSI à {fr(v, 1)} : zone neutre (entre 30 et 70), pas d'excès d'achat ni de vente."
    return _item("rsi", "RSI 14", v, "", "Relative Strength Index sur 14 séances : compare l'ampleur des hausses et des baisses récentes, sur une échelle de 0 à 100. Au-dessus de 70 = surachat, en dessous de 30 = survente.",
                 txt, "warn" if v is not None and (v >= 70 or v <= 30) else "neutral")


def _ma200_item(close):
    v = dist_to_ma(close, 200)
    if v is None:
        return _item("ma200", "Écart à la MM200", None, "%", "Écart entre le cours actuel et sa moyenne mobile 200 séances (tendance de fond).",
                     "Il faut au moins 200 séances d'historique : choisissez une période plus longue (1Y, 5Y ou MAX).")
    ma50 = dist_to_ma(close, 50)
    cross = ""
    if ma50 is not None:
        # MM50 au-dessus de la MM200 <=> (1+ma50)/(1+ma200) < 1 en termes de prix
        ma50_above = (1 + v / 100) / (1 + ma50 / 100) > 1
        cross = " La MM50 est au-dessus de la MM200 (configuration haussière de type « golden cross »)." if ma50_above else " La MM50 est sous la MM200 (configuration baissière de type « death cross »)."
    txt = (f"Le cours est {fr(abs(v))} % {'au-dessus' if v >= 0 else 'en dessous'} de sa moyenne des 200 dernières séances : "
           f"{'la tendance de fond est haussière' if v >= 0 else 'la tendance de fond est baissière'}." + cross)
    return _item("ma200", "Écart à la MM200", v, "%", "Écart entre le cours actuel et sa moyenne mobile 200 séances. Indicateur classique de tendance de long terme : au-dessus = tendance haussière, en dessous = baissière.",
                 txt, _tone(v))


def _high_item(close, label="Distance au plus haut"):
    v = current_drawdown(close)
    days_since = int((close.index[-1] - close.idxmax()).days)
    txt = ("Le cours est actuellement sur son plus haut de la période." if v == 0 else
           f"Le cours est {fr(abs(v))} % sous son plus haut de la période, atteint il y a {days_since} jours. Il faudrait une hausse de {fr((100 / (100 + v) - 1) * 100)} % pour le retrouver.")
    return _item("dist_high", label, v, "%", "Écart entre le dernier cours et le plus haut atteint sur la période analysée.", txt,
                 "neutral" if v > -20 else "neg")


def _perf_items(close, horizons):
    items = []
    for days, label in horizons:
        v = perf_over(close, days)
        items.append(_item(f"perf_{days}", f"Perf. {label}", v, "%", f"Variation du cours sur les {label} écoulés.",
                           "Historique insuffisant sur la période choisie." if v is None else
                           f"Sur {label}, le cours a {'progressé' if v >= 0 else 'reculé'} de {fr(abs(v))} %.", _tone(v)))
    return items


def _ytd_item(close):
    v = perf_ytd(close)
    return _item("ytd", "Perf. depuis le 1er janv.", v, "%", "Variation depuis la dernière clôture de l'année précédente (YTD = Year To Date).",
                 "La période analysée ne couvre pas la fin de l'année dernière." if v is None else
                 f"Depuis le début de l'année, {'+' if v >= 0 else ''}{fr(v)} %.", _tone(v))


def _atr_item(df):
    v = atr_pct(df)
    return _item("atr", "ATR 14 (amplitude/séance)", v, "%",
                 "Average True Range : amplitude moyenne d'une séance (écart plus haut/plus bas, en tenant compte des gaps d'ouverture), en % du cours. Utile pour placer un stop-loss cohérent.",
                 "Indisponible (données intrajournalières manquantes)." if v is None else
                 f"En moyenne, le cours varie de {fr(v)} % entre son plus haut et son plus bas sur une séance. Un stop-loss placé à moins de cette distance risque d'être touché par le simple « bruit » du marché.")


def _vol_regime_item(close, ppy):
    r = close.pct_change().dropna()
    if len(r) < 60:
        return _item("vol_regime", "Volatilité 30 j vs période", None, "", "Rapport entre la volatilité récente (30 séances) et celle de toute la période.", "Historique trop court.")
    v30 = r.tail(30).std() * np.sqrt(ppy) * 100
    vall = r.std() * np.sqrt(ppy) * 100
    ratio = v30 / vall if vall > 0 else None
    txt = (f"Volatilité annualisée sur 30 séances : {fr(v30)} % contre {fr(vall)} % en moyenne sur la période. " +
           ("Le marché est actuellement plus agité que d'habitude." if ratio and ratio > 1.2 else
            "Le marché est actuellement plus calme que d'habitude." if ratio and ratio < 0.8 else
            "La volatilité récente est dans la norme."))
    return _item("vol_regime", "Volatilité 30 j (annualisée)", _r(v30), "%", "Volatilité des 30 dernières séances, annualisée, comparée à celle de toute la période pour savoir si le marché est plus nerveux qu'à l'accoutumée.",
                 txt, "warn" if ratio and ratio > 1.2 else "neutral")


def _liquidity_item(df):
    if "Volume" not in df.columns or df["Volume"].tail(63).sum() == 0:
        return None
    dv = (df["Close"] * df["Volume"]).tail(63).mean()
    if not dv or np.isnan(dv):
        return None
    v = dv / 1e6
    txt = ("Liquidité très élevée : vous pouvez acheter/vendre sans impact sur le prix." if v > 100 else
           "Liquidité correcte pour un investisseur particulier." if v > 5 else
           "Liquidité faible : écarts achat/vente potentiellement larges, privilégiez les ordres à cours limité.")
    return _item("liquidity", "Volume moyen / jour", _r(v, 1), "M",
                 "Montant moyen échangé chaque jour sur 3 mois (cours × volume), en millions de la devise de cotation. Mesure la facilité à acheter ou vendre.", txt)


def _dividend_item(dividends, last_price):
    if dividends is None or last_price is None:
        return None
    if len(dividends) == 0:
        return _item("div_yield", "Dividende (12 mois)", 0.0, "%", "Somme des dividendes versés sur les 12 derniers mois divisée par le cours actuel.",
                     "Aucun dividende versé sur les 12 derniers mois.")
    d = dividends.copy()
    d.index = pd.to_datetime(d.index).tz_localize(None) if getattr(d.index, "tz", None) else pd.to_datetime(d.index)
    last12 = d[d.index >= pd.Timestamp.today() - pd.Timedelta(days=365)].sum()
    v = last12 / last_price * 100 if last_price > 0 else None
    txt = ("Aucun dividende versé sur les 12 derniers mois." if not v else
           f"Les dividendes des 12 derniers mois représentent {fr(v)} % du cours actuel " +
           ("(rendement élevé : vérifiez qu'il est soutenable)." if v > 6 else "(rendement confortable)." if v > 3 else "(rendement modeste, valeur plutôt orientée croissance)."))
    return _item("div_yield", "Dividende (12 mois)", _r(v), "%",
                 "Somme des dividendes versés sur les 12 derniers mois divisée par le cours actuel. Note : les performances affichées incluent déjà les dividendes réinvestis (cours ajustés).", txt)


def asset_class_metrics(asset_class: str, df: pd.DataFrame, ppy: int, dividends=None) -> list:
    """Métriques propres à chaque type d'actif, avec définition et interprétation."""
    close = df["Close"].dropna()
    if len(close) < 5:
        return []
    returns = close.pct_change().dropna()
    items = []

    if asset_class in ("ACTION", "ETF", "INDEX"):
        items += [_ytd_item(close)]
        items += _perf_items(close, [(91, "3 mois"), (182, "6 mois"), (365, "1 an")])
        items += [_high_item(close), _ma200_item(close), _rsi_item(close), _atr_item(df)]
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
            items.append(_item("time_above_ma200", "Temps au-dessus de la MM200", _r(pct_above, 1), "%",
                               "Part des séances où l'indice cotait au-dessus de sa moyenne 200 séances : mesure la proportion du temps passée en tendance haussière.",
                               f"L'indice a passé {fr(pct_above, 1)} % du temps en tendance haussière de fond sur la période."))

    elif asset_class == "CRYPTO":
        items += _perf_items(close, [(7, "7 jours"), (30, "30 jours"), (90, "90 jours"), (365, "1 an")])
        items += [_high_item(close, "Distance au plus haut"), _vol_regime_item(close, ppy)]
        if len(close) >= 200:
            mayer = close.iloc[-1] / close.rolling(200).mean().iloc[-1]
            txt = (f"Multiple de Mayer à {fr(mayer)}. " +
                   ("Au-dessus de 2,4 : historiquement une zone de surchauffe (bulle)." if mayer > 2.4 else
                    "Entre 1 et 2,4 : tendance haussière sans excès majeur." if mayer >= 1 else
                    "Sous 1 : le cours est sous sa moyenne 200 jours, zone historiquement d'accumulation pour le Bitcoin."))
            items.append(_item("mayer", "Multiple de Mayer", _r(mayer), "", "Cours actuel divisé par sa moyenne mobile 200 jours. Indicateur popularisé pour le Bitcoin : > 2,4 = surchauffe, < 1 = cours déprimé.", txt,
                               "warn" if mayer > 2.4 else "neutral"))
        big = (returns.abs() > 0.05).mean() * 100
        items.append(_item("big_moves", "Jours à plus de ±5 %", _r(big, 1), "%", "Part des journées où le cours a bougé de plus de 5 % (à la hausse ou à la baisse).",
                           f"Environ 1 jour sur {max(1, round(100 / big)) if big > 0 else '∞'} connaît une variation de plus de 5 %." if big > 0 else "Aucune variation journalière supérieure à 5 % sur la période."))
        items.append(_rsi_item(close))

    elif asset_class == "FOREX":
        pip = 0.01 if "JPY" in str(df.attrs.get("ticker", "")).upper() else 0.0001
        last30 = close.tail(30)
        rng = (last30.max() - last30.min()) / pip
        items.append(_item("range_30", "Range 30 séances", _r(rng, 0), "pips", "Écart entre le plus haut et le plus bas des 30 dernières séances, exprimé en pips (0,0001, ou 0,01 pour les paires en yen).",
                           f"La paire a évolué dans un couloir de {fr(rng, 0)} pips sur les 30 dernières séances."))
        if {"High", "Low"}.issubset(df.columns):
            adr = ((df["High"] - df["Low"]).tail(20).mean()) / pip
            items.append(_item("adr", "Range journalier moyen (20 j)", _r(adr, 0), "pips", "Amplitude moyenne d'une séance (plus haut − plus bas) sur 20 jours, en pips.",
                               f"Une journée type fait bouger la paire d'environ {fr(adr, 0)} pips entre son plus haut et son plus bas."))
        items += _perf_items(close, [(30, "30 jours"), (91, "3 mois"), (365, "1 an")])
        hi, lo = close.tail(252).max(), close.tail(252).min()
        pos = (close.iloc[-1] - lo) / (hi - lo) * 100 if hi > lo else None
        items.append(_item("range_pos", "Position dans la range 1 an", _r(pos, 1), "%", "0 % = au plus bas de l'année, 100 % = au plus haut de l'année.",
                           "Indisponible." if pos is None else f"Le cours se situe à {fr(pos, 1)} % de sa fourchette annuelle (0 % = plus bas, 100 % = plus haut)."))
        items += [_vol_regime_item(close, ppy), _ma200_item(close), _rsi_item(close)]

    elif asset_class == "COMMODITY":
        items += [_ytd_item(close)]
        items += _perf_items(close, [(91, "3 mois"), (365, "1 an")])
        items += [_high_item(close), _vol_regime_item(close, ppy), _atr_item(df)]
        amp = (close.max() / close.min() - 1) * 100
        items.append(_item("amplitude", "Amplitude de la période", _r(amp), "%", "Écart entre le plus haut et le plus bas de la période, rapporté au plus bas.",
                           f"Entre son point bas et son point haut, le prix a varié de {fr(amp)} % sur la période."))
        months = close.resample("ME").last().pct_change().dropna()
        if months.index.year.nunique() >= 3:
            by_month = months.groupby(months.index.month).mean() * 100
            names = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]
            best, worst = int(by_month.idxmax()), int(by_month.idxmin())
            items.append(_item("seasonality", "Saisonnalité (meilleur mois)", _r(by_month.max()), "%",
                               "Performance moyenne par mois calendaire sur toute la période : certaines matières premières ont des cycles saisonniers (récoltes, chauffage, conduite estivale...).",
                               f"Historiquement, le meilleur mois est {names[best - 1]} ({fr(by_month.max(), 2, True)} % en moyenne) et le pire est {names[worst - 1]} ({fr(by_month.min(), 2, True)} %). Calculé sur {months.index.year.nunique()} années.",
                               "neutral"))
        items += [_ma200_item(close), _rsi_item(close)]

    return items


# =====================================================================
# 10. INTERPRÉTATIONS (PHRASES CHIFFRÉES)
# =====================================================================

def interpret_metrics(m: dict, benchmark_label: str = "l'indice de référence") -> dict:
    c = {}
    g = m.get

    v = g("total_change_pct")
    if v is not None:
        c["total_change"] = (f"Sur la période, 100 investis sont devenus {fr(100 + v)}. "
                             + ("Performance positive." if v >= 0 else "Performance négative : l'actif a perdu de la valeur."))

    v = g("cagr_pct")
    if v is not None:
        c["cagr"] = (f"En moyenne, l'actif a rapporté {fr(v)} % par an (intérêts composés). "
                     + ("C'est supérieur à la moyenne historique des actions mondiales (environ 7 à 8 % par an)." if v > 8 else
                        "C'est dans la moyenne historique des actions (environ 5 à 8 % par an)." if v >= 5 else
                        "C'est un rendement modeste." if v >= 0 else "Le rendement annuel est négatif."))

    v = g("sharpe_ratio")
    if v is not None:
        c["sharpe"] = (f"Sharpe de {fr(v)} : " + (
            "le rendement est inférieur au taux sans risque (2 %) ; un placement sans risque aurait fait mieux." if v < 0 else
            "le rendement compense faiblement le risque pris. Chaque unité de volatilité est peu rémunérée." if v < 0.5 else
            "rendement correct au regard du risque, typique d'un indice actions sur le long terme." if v < 1 else
            "très bon rapport rendement/risque." if v < 2 else
            "rapport rendement/risque exceptionnel. Sur une période courte, ce niveau est rarement durable."))

    v = g("sortino_ratio")
    if v is not None:
        sh = g("sharpe_ratio") or 0
        extra = (" Le Sortino est nettement supérieur au Sharpe : une bonne part de la volatilité vient de hausses, pas de baisses."
                 if v > sh * 1.3 and v > 0 else "")
        c["sortino"] = (f"Sortino de {fr(v)} : " + (
            "les baisses ne sont pas compensées par le rendement." if v < 0 else
            "rendement faible au regard des baisses subies." if v < 1 else
            "bonne rémunération du risque de baisse." if v < 2 else
            "excellente rémunération du risque de baisse.") + extra)

    v = g("calmar_ratio")
    if v is not None:
        c["calmar"] = (f"Calmar de {fr(v)} : le rendement annuel représente {fr(v)} fois la pire chute. " + (
            "La pire chute n'a pas été compensée par le rendement." if v < 0.5 else
            "Rapport correct entre gain annuel et pire perte." if v < 1 else
            "Le rendement annuel dépasse la pire chute subie : très bon profil." if v < 3 else
            "Rapport exceptionnel (souvent lié à une période courte sans krach)."))

    v = g("omega_ratio")
    if v is not None:
        c["omega"] = f"Omega de {fr(v)} : la somme des hausses vaut {fr(v)} fois la somme des baisses. " + (
            "Au-dessus de 1, le bilan des journées est gagnant." if v > 1 else "En dessous de 1, les baisses l'emportent.")

    v = g("win_rate_pct")
    if v is not None:
        c["win_rate"] = (f"{fr(v, 1)} % des séances ont fini en hausse. " +
                         "Un taux proche de 50 % est normal pour un actif coté : la rentabilité dépend surtout de la taille des gains par rapport aux pertes (voir Profit Factor).")

    v = g("profit_factor")
    if v is not None:
        c["profit_factor"] = f"Les hausses cumulées valent {fr(v)} fois les baisses cumulées. " + (
            "Les pertes l'emportent." if v < 1 else "Léger avantage aux gains, typique d'un actif haussier sur le long terme." if v < 1.2 else
            "Avantage net aux gains." if v < 1.5 else "Très net avantage aux gains.")

    v = g("max_drawdown_pct")
    if v is not None:
        a = abs(v)
        need = (100 / (100 - a) - 1) * 100 if a < 100 else None
        c["mdd"] = (f"La pire baisse depuis un sommet a été de {fr(a)} %" +
                    (f", ce qui exigeait ensuite une hausse de {fr(need)} % pour revenir au sommet. " if need else ". ") +
                    ("Baisse limitée : profil défensif." if a < 10 else
                     "Correction modérée, courante pour un actif actions." if a < 25 else
                     "Baisse sévère, typique d'un marché baissier." if a < 50 else
                     "Effondrement majeur : plus de la moitié de la valeur a été perdue à un moment."))

    v = g("mean_drawdown_pct")
    if v is not None:
        c["mean_dd"] = (f"Lorsqu'il est sous son dernier sommet, l'actif se trouve en moyenne {fr(abs(v))} % plus bas. "
                        "C'est la « douleur » typique que l'on ressent en le détenant, plus représentative que le seul pire cas.")

    v = g("current_drawdown_pct")
    if v is not None:
        c["current_dd"] = ("L'actif est actuellement sur un plus haut." if v == 0 else
                           f"L'actif est actuellement {fr(abs(v))} % sous son plus haut de la période.")

    v = g("mean_time_to_recovery_days")
    if v is not None:
        lng = g("longest_drawdown_days")
        c["recovery"] = (f"Une phase de baisse dure en moyenne {fr(v, 0)} séances avant le retour à un nouveau sommet" +
                         (f" ; la plus longue a duré {lng} séances" if lng else "") +
                         ". Une période encore en cours est comptée jusqu'à aujourd'hui.")

    v = g("ulcer_index")
    if v is not None:
        c["ulcer"] = f"Ulcer Index de {fr(v)} : " + (
            "baisses rares et peu profondes, détention très sereine." if v < 5 else
            "baisses modérées, comparables à un indice actions large." if v < 15 else
            "baisses profondes et/ou longues : détention éprouvante psychologiquement.")

    v = g("annualized_volatility_pct")
    if v is not None:
        c["vol"] = (f"Volatilité de {fr(v)} % par an : dans environ 2 années sur 3, le rendement annuel devrait rester à ± {fr(v)} points autour de sa moyenne. " + (
            "Faible (niveau obligataire ou défensif)." if v < 10 else
            "Modérée (proche d'un grand indice actions, ~15-20 %)." if v < 22 else
            "Élevée (action individuelle ou secteur cyclique)." if v < 40 else
            "Très élevée (crypto, small cap ou titre spéculatif)."))

    conf = g("var_confidence_selected") or 95
    v = g("var_historical_pct")
    if v is not None:
        c["var_h"] = (f"Historiquement, dans {fr(conf, 1)} % des séances la baisse n'a pas dépassé {fr(abs(v))} %. "
                      f"Les {fr(100 - conf, 1)} % de séances restantes (environ {max(1, round((100 - conf) / 100 * 252))} par an) ont été pires.")
    v = g("var_parametric_pct")
    if v is not None:
        vh = g("var_historical_pct")
        gap = ""
        if vh is not None and abs(vh) > abs(v) * 1.1:
            gap = " Elle est plus optimiste que la VaR historique : les vraies queues de distribution sont plus épaisses qu'une loi normale."
        c["var_p"] = f"Selon une loi normale ajustée aux données, la perte journalière ne dépasserait {fr(abs(v))} % que {fr(100 - conf, 1)} % du temps.{gap}"
    v = g("cvar_pct")
    if v is not None:
        c["cvar"] = (f"Lors des {fr(100 - conf, 1)} % pires séances, la perte moyenne a été de {fr(abs(v))} %. "
                     "C'est la réponse à la question : « quand ça va mal, ça va mal de combien ? »")

    bl = benchmark_label
    v = g("beta")
    if v is not None:
        c["beta"] = (f"Bêta de {fr(v)} : quand {bl} varie de 1 %, l'actif varie en moyenne de {fr(v)} %. " + (
            "Il évolue souvent à contre-courant du marché." if v < 0 else
            "Il est peu sensible au marché (profil défensif)." if v < 0.7 else
            "Il suit le marché à peu près au même rythme." if v <= 1.2 else
            "Il amplifie les mouvements du marché, à la hausse comme à la baisse."))

    v = g("alpha_annual_pct")
    if v is not None:
        c["alpha"] = (f"Alpha de {fr(v, 2, True)} % par an : " + (
            f"l'actif a fait mieux que ce que son exposition à {bl} laissait prévoir." if v > 1 else
            f"l'actif a fait moins bien que ce que son exposition à {bl} laissait prévoir." if v < -1 else
            "la performance s'explique presque entièrement par l'exposition au marché."))

    v = g("correlation")
    if v is not None:
        c["correlation"] = f"Corrélation de {fr(v)} avec {bl} : " + (
            "mouvements très liés, faible apport en diversification." if v > 0.8 else
            "lien marqué avec le marché." if v > 0.5 else
            "lien modéré : bon potentiel de diversification." if v > 0.2 else
            "quasiment indépendant du marché : excellent diversifiant.")

    v = g("r_squared")
    if v is not None:
        c["r_squared"] = f"{fr(v, 1)} % des variations quotidiennes s'expliquent par celles de {bl}. Le reste est propre à l'actif."

    v = g("tracking_error_pct")
    if v is not None:
        c["tracking_error"] = (f"L'écart de performance avec {bl} fluctue de ± {fr(v)} % par an. " +
                               ("Très proche du benchmark (typique d'un ETF qui le réplique)." if v < 3 else
                                "Gestion qui s'éloigne nettement du benchmark." if v > 10 else "Écart modéré avec le benchmark."))

    v = g("information_ratio")
    if v is not None:
        c["information_ratio"] = f"Ratio d'information de {fr(v)} : " + (
            "surperformance régulière et significative face au benchmark." if v > 0.5 else
            "légère surperformance par rapport au benchmark." if v > 0 else
            "sous-performance par rapport au benchmark.")

    up, down = g("up_capture_pct"), g("down_capture_pct")
    if up is not None and down is not None:
        c["capture"] = (f"Les jours de hausse de {bl}, l'actif capte {fr(up, 0)} % de la hausse ; les jours de baisse, il subit {fr(down, 0)} % de la baisse. " +
                        ("Profil asymétrique favorable : il gagne plus qu'il ne perd par rapport au marché." if up > down else
                         "Profil défavorable : il subit davantage les baisses qu'il ne profite des hausses."))

    v = g("skewness")
    if v is not None:
        c["skew"] = f"Asymétrie de {fr(v)} : " + (
            "les fortes baisses ponctuelles sont plus fréquentes que les fortes hausses (risque de chute brutale)." if v < -0.5 else
            "les fortes hausses ponctuelles sont plus fréquentes que les fortes baisses (profil type « loterie »)." if v > 0.5 else
            "distribution à peu près symétrique entre hausses et baisses.")

    v = g("kurtosis")
    if v is not None:
        c["kurt"] = f"Excès de kurtosis de {fr(v)} (0 pour une loi normale) : " + (
            "les journées extrêmes sont rares, proches d'une loi normale." if v < 1 else
            "les journées extrêmes sont un peu plus fréquentes que prévu par une loi normale." if v < 5 else
            "les journées extrêmes (krachs ou envolées) sont beaucoup plus fréquentes que ne le prévoit une loi normale : la VaR paramétrique sous-estime le risque.")

    v = g("tail_ratio")
    if v is not None:
        c["tail_ratio"] = f"Les meilleures journées (top 5 %) sont {fr(v)} fois plus amples que les pires (bottom 5 %). " + (
            "Avantage aux hausses extrêmes." if v > 1.05 else "Avantage aux baisses extrêmes." if v < 0.95 else "Extrêmes équilibrés.")

    v = g("positive_months_pct")
    if v is not None:
        c["positive_months"] = (f"{fr(v, 0)} % des mois ont été positifs. Meilleur mois : {fr(g('best_month_pct'), 2, True)} %, "
                                f"pire mois : {fr(g('worst_month_pct'), 2, True)} %.")

    v = g("downside_volatility_pct")
    if v is not None:
        c["downside_vol"] = f"Volatilité calculée uniquement sur les journées de baisse : {fr(v)} % par an. C'est le dénominateur du ratio de Sortino."

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
