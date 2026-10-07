from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel
from typing import Dict, Optional, List
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import threading
import yfinance as yf
import pandas as pd
import numpy as np
import backend
import risk_free
import i18n
from i18n import T
import json
import os
import re
import time
import subprocess
import sys

app = FastAPI(
    title="Portfolio & Asset Analyzer API",
    description="API financière : analyse d'actifs, portefeuilles, Monte-Carlo et screener.",
    version="3.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Les historiques longs (période MAX) et le screener pèsent lourd : compression automatique
app.add_middleware(GZipMiddleware, minimum_size=2000)


# Filet de sécurité : une valeur infinie ou NaN dans une réponse est envoyée comme null au lieu de faire planter le serveur
from fastapi.responses import JSONResponse as _BaseJSONResponse
import math as _math


def _clean(o):
    if isinstance(o, float):
        return o if _math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    return o


class SafeJSONResponse(_BaseJSONResponse):
    def render(self, content) -> bytes:
        return super().render(_clean(content))


app.router.default_response_class = SafeJSONResponse


@app.middleware("http")
async def language_middleware(request: Request, call_next):
    """?lang=en sur n'importe quelle route : les textes générés (interprétations, explications, erreurs) passent en anglais."""
    i18n.set_lang(request.query_params.get("lang", "fr"))
    # Taux sans risque par défaut (dollar) ; l'analyse d'un actif ou d'un portefeuille le remplace par celui de sa devise
    backend.set_risk_free(risk_free.for_currency("USD")["rate"])
    return await call_next(request)


def use_risk_free(rf: dict):
    """Applique le taux sans risque choisi (devise de l'actif) pour les calculs de la requête."""
    backend.set_risk_free(rf["rate"])


def with_override(rf: dict, pct: Optional[float]) -> dict:
    """Taux saisi par l'utilisateur (en %) à la place du taux de marché de la devise."""
    if pct is None:
        return rf
    if not -5 <= pct <= 30:
        raise ValueError(T("Le taux sans risque doit être compris entre −5 % et 30 %.", "The risk-free rate must be between −5% and 30%."))
    return {**rf, "rate": pct / 100, "source": T("taux saisi manuellement", "manually entered rate"), "date": None}

ROOT = os.path.dirname(os.path.abspath(__file__))

BENCHMARK_LABELS = {
    "^GSPC": "S&P 500", "^IXIC": "Nasdaq Composite", "^NDX": "Nasdaq 100", "^FCHI": "CAC 40",
    "^STOXX50E": "Euro Stoxx 50", "^GDAXI": "DAX 40", "URTH": "MSCI World", "BTC-USD": "Bitcoin",
    "^AEX": "AEX", "^IBEX": "IBEX 35", "FTSEMIB.MI": "FTSE MIB", "^FTSE": "FTSE 100", "^SSMI": "SMI", "^N225": "Nikkei 225",
    "^GSPTSE": "S&P/TSX", "^BVSP": "Bovespa", "^NSEI": "Nifty 50", "^OMX": "OMX Stockholm 30",
}


# Indice de comparaison automatique selon la place de cotation (une action française se compare au CAC 40, pas au S&P 500)
SUFFIX_BENCHMARK = {"PA": "^FCHI", "DE": "^GDAXI", "F": "^GDAXI", "AS": "^AEX", "MC": "^IBEX", "MI": "FTSEMIB.MI", "L": "^FTSE",
                    "SW": "^SSMI", "T": "^N225", "TO": "^GSPTSE", "SA": "^BVSP", "NS": "^NSEI", "ST": "^OMX"}


def default_benchmark(ticker: str, classe: str) -> str:
    if classe == "CRYPTO":
        return "BTC-USD" if ticker != "BTC-USD" else "^GSPC"
    t = ticker.upper()
    if "." in t and not t.startswith("^"):
        suffix = t.rsplit(".", 1)[1]
        if suffix in SUFFIX_BENCHMARK:
            return SUFFIX_BENCHMARK[suffix]
        if risk_free.listing_currency(t) == "EUR":
            return "^STOXX50E"
    return "^GSPC"


def benchmark_label(ticker: str) -> str:
    return BENCHMARK_LABELS.get(ticker, ticker)


class PortfolioRequest(BaseModel):
    weights: Dict[str, float]
    period: Optional[str] = "5y"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    benchmark: Optional[str] = "^GSPC"
    forecast_days: Optional[int] = 252
    var_confidence: Optional[float] = 0.95
    initial_capital: Optional[float] = None
    rebalance: Optional[str] = "none"
    risk_free_pct: Optional[float] = None  # None = taux de marché de la devise


# -------------------------------------------------------------
# TÉLÉCHARGEMENT AVEC CACHE MÉMOIRE
# -------------------------------------------------------------
CACHE_TTL = 15 * 60
_price_cache: Dict[tuple, tuple] = {}
_div_cache: Dict[str, tuple] = {}
_cache_lock = threading.Lock()
_executor = ThreadPoolExecutor(max_workers=4)


def _normalize_ohlc(raw: pd.DataFrame) -> pd.DataFrame:
    df = pd.DataFrame(index=raw.index)
    close_col = "Adj Close" if "Adj Close" in raw.columns else "Close"
    df["Close"] = raw[close_col].astype(float)
    for col in ("Open", "High", "Low"):
        df[col] = raw[col].astype(float) if col in raw.columns else df["Close"]
    df["Volume"] = raw["Volume"].astype(float) if "Volume" in raw.columns else 0.0
    # Cours nuls ou négatifs (premières cotations de certaines cryptos sur Yahoo) : inutilisables, ils créaient des divisions par zéro
    df = df.dropna(subset=["Close"])
    df = df[df["Close"] > 0]
    for col in ("Open", "High", "Low"):
        df[col] = df[col].fillna(df["Close"])
    df.index = pd.to_datetime(df.index).tz_localize(None) if getattr(df.index, "tz", None) else pd.to_datetime(df.index)
    return df


def fetch_many(tickers: List[str], period: Optional[str] = "5y", start: Optional[str] = None, end: Optional[str] = None) -> Dict[str, pd.DataFrame]:
    """Télécharge plusieurs tickers en un seul appel Yahoo, avec cache de 15 min."""
    tickers = [t.strip().upper() for t in tickers]
    span = (start, end) if (start and end) else (period or "5y",)
    now = time.time()
    result, missing = {}, []
    with _cache_lock:
        for t in dict.fromkeys(tickers):
            hit = _price_cache.get((t,) + span)
            if hit and now - hit[0] < CACHE_TTL:
                result[t] = hit[1]
            else:
                missing.append(t)

    if missing:
        # yfinance exclut la date de fin : +1 jour pour que la date choisie soit incluse
        kwargs = ({"start": start, "end": (pd.Timestamp(end) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")}
                  if (start and end) else {"period": period or "5y"})
        raw = yf.download(missing, progress=False, auto_adjust=True, group_by="ticker", threads=True, **kwargs)
        for t in missing:
            try:
                if isinstance(raw.columns, pd.MultiIndex):
                    lvl0 = raw.columns.get_level_values(0)
                    sub = raw[t] if t in lvl0 else raw.xs(t, axis=1, level=1)
                else:
                    sub = raw
                df = _normalize_ohlc(sub)
            except Exception:
                df = pd.DataFrame()
            if df.empty:
                raise ValueError(T(f"Aucune donnée disponible pour « {t} ». Vérifiez le symbole (format Yahoo Finance).", f"No data available for “{t}”. Check the symbol (Yahoo Finance format)."))
            if backend.detecter_classe_actif(t) != "CRYPTO":
                df = backend.fix_unit_glitches(df)
            df.attrs["ticker"] = t
            result[t] = df
            with _cache_lock:
                _price_cache[(t,) + span] = (now, df)
    return result


def fetch_dividends(ticker: str):
    now = time.time()
    hit = _div_cache.get(ticker)
    if hit and now - hit[0] < CACHE_TTL * 4:
        return hit[1]
    try:
        d = yf.Ticker(ticker).dividends
    except Exception:
        d = None
    _div_cache[ticker] = (now, d)
    return d


def parse_conf(value) -> float:
    conf = float(value or 0.95)
    if conf >= 1.0:
        conf /= 100.0
    return min(max(conf, 0.50), 0.999)


def build_chart_data(df_or_series, value_series: pd.Series, capital: Optional[float]) -> list:
    """Données graphiques vectorisées (beaucoup plus rapide qu'une boucle .loc)."""
    dd = backend.compute_drawdown_series(value_series)
    out = pd.DataFrame(index=value_series.index)
    out["date"] = value_series.index.strftime("%Y-%m-%d")
    out["value"] = (value_series / value_series.iloc[0] * 100).round(2)
    if isinstance(df_or_series, pd.DataFrame):
        for col in ("Open", "High", "Low", "Close"):
            out[col.lower()] = df_or_series[col].round(4 if df_or_series["Close"].iloc[-1] < 10 else 2)
    out["drawdown"] = dd.round(2)
    if capital:
        out["money_value"] = (value_series / value_series.iloc[0] * capital).round(2)
    return out.to_dict("records")


# -------------------------------------------------------------
# 1. ACTIF UNIQUE
# -------------------------------------------------------------
@app.get("/api/asset/{ticker}")
def get_asset_analysis(
    ticker: str,
    period: Optional[str] = "max",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    benchmark: Optional[str] = None,
    forecast_days: Optional[int] = 252,
    var_confidence: Optional[float] = 0.95,
    initial_capital: Optional[float] = None,
    risk_free_pct: Optional[float] = None
):
    try:
        ticker = ticker.strip().upper()
        classe = backend.detecter_classe_actif(ticker)
        ppy = backend.periods_per_year(classe)
        if not benchmark:
            benchmark = default_benchmark(ticker, classe)
        benchmark = benchmark.upper()

        div_future = _executor.submit(fetch_dividends, ticker) if classe in ("ACTION", "ETF") else None
        data = fetch_many([ticker, benchmark], period=period, start=start_date, end=end_date)
        df_asset, df_bench = data[ticker], data[benchmark]
        if len(df_asset) < 5:
            raise ValueError(T("Historique trop court pour une analyse (moins de 5 séances).", "History too short for an analysis (fewer than 5 sessions)."))

        conf = parse_conf(var_confidence)
        prices = df_asset["Close"]
        b_label = benchmark_label(benchmark)

        rf = with_override(risk_free.for_ticker(ticker), risk_free_pct)
        use_risk_free(rf)
        stats = backend.compute_core_metrics(prices, df_bench["Close"], conf, ppy)
        stats["risk_free_source"] = rf["source"]
        stats["currency"] = rf["currency"]
        # Drawdown actuel : toujours mesuré depuis le record historique, quelle que soit la période affichée
        try:
            whole = prices if (period == "max" and not (start_date and end_date)) else fetch_many([ticker], period="max")[ticker]["Close"].dropna()
            stats["current_drawdown_pct"] = round(float(whole.iloc[-1] / whole.max() - 1) * 100, 2)
            stats["high_date"] = whole.idxmax().strftime("%Y-%m-%d")
            stats["high_scope"] = "all"
        except Exception:
            pass
        interpretations = backend.interpret_metrics(stats, b_label)
        dividends = div_future.result(timeout=15) if div_future else None
        class_metrics = backend.asset_class_metrics(classe, df_asset, ppy, dividends)

        has_capital = bool(initial_capital and initial_capital > 0)
        mc = backend.monte_carlo_simulation(prices, days_forecast=int(forecast_days or 252), n_simulations=5000,
                                            initial_capital=float(initial_capital) if has_capital else 100.0)

        money_summary = None
        if has_capital:
            final_val = float(prices.iloc[-1] / prices.iloc[0] * initial_capital)
            money_summary = {
                "initial_capital": initial_capital,
                "final_value": round(final_val, 2),
                "profit_loss": round(final_val - initial_capital, 2),
                "performance_pct": round((final_val / initial_capital - 1) * 100, 2),
            }

        return {
            "ticker": ticker,
            "asset_class": classe,
            "benchmark_ticker": benchmark,
            "benchmark_label": b_label,
            "period_start": prices.index[0].strftime("%Y-%m-%d"),
            "period_end": prices.index[-1].strftime("%Y-%m-%d"),
            "metrics": stats,
            "interpretations": interpretations,
            "class_specific_metrics": class_metrics,
            "money_summary": money_summary,
            "monte_carlo": {"is_money": has_capital, "summary": mc["summary"], "chart_data": mc["chart_data"]},
            "chart_data": build_chart_data(df_asset, prices, initial_capital if has_capital else None),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# -------------------------------------------------------------
# 2. PORTEFEUILLE
# -------------------------------------------------------------
@app.post("/api/portfolio/analyze")
def analyze_portfolio(req: PortfolioRequest):
    try:
        weights_in = {k.strip().upper(): float(v) for k, v in req.weights.items() if float(v) > 0}
        if not weights_in:
            raise ValueError(T("Aucune pondération positive.", "No positive weight."))
        tickers = list(weights_in.keys())
        total_w = sum(weights_in.values())
        if abs(total_w - 100) > 0.5:
            raise ValueError(T(f"La somme des pondérations doit faire 100 % (actuellement {total_w:.1f} %).", f"Weights must add up to 100% (currently {total_w:.1f}%)."))

        bench_ticker = (req.benchmark or "^GSPC").upper()
        data = fetch_many(tickers + [bench_ticker], period=req.period, start=req.start_date, end=req.end_date)

        prices_df = pd.concat({t: data[t]["Close"] for t in tickers}, axis=1, join="inner").dropna()
        if len(prices_df) < 5:
            raise ValueError(T("Historique commun insuffisant : les actifs choisis n'ont pas assez de dates de cotation en commun.", "Not enough shared history: the chosen assets do not have enough trading dates in common."))

        classes = {t: backend.detecter_classe_actif(t) for t in tickers}
        ppy = 365 if all(c == "CRYPTO" for c in classes.values()) else 252
        w = np.array([weights_in[t] / total_w for t in tickers])

        value = backend.portfolio_value_series(prices_df, w, req.rebalance or "none")
        conf = parse_conf(req.var_confidence)
        b_label = benchmark_label(bench_ticker)

        rf = with_override(risk_free.for_portfolio(weights_in), req.risk_free_pct)
        use_risk_free(rf)
        stats = backend.compute_core_metrics(value, data[bench_ticker]["Close"], conf, ppy)
        stats["risk_free_source"] = rf["source"]
        # Crypto (7 j/7) mêlée à des actifs de bourse : seules les dates communes (jours de bourse) sont gardées
        n_crypto = sum(c == "CRYPTO" for c in classes.values())
        stats["mixed_crypto"] = 0 < n_crypto < len(classes)
        interpretations = backend.interpret_metrics(stats, b_label, portfolio=True)
        breakdown = backend.portfolio_breakdown(prices_df, w, ppy)

        has_capital = bool(req.initial_capital and req.initial_capital > 0)
        cap = float(req.initial_capital) if has_capital else None
        money_summary = None
        if has_capital:
            final_val = float(value.iloc[-1] / 100 * cap)
            money_summary = {
                "initial_capital": cap,
                "final_value": round(final_val, 2),
                "profit_loss": round(final_val - cap, 2),
                "performance_pct": round((final_val / cap - 1) * 100, 2),
            }

        mc = backend.monte_carlo_simulation(value, days_forecast=int(req.forecast_days or 252), n_simulations=5000,
                                            initial_capital=cap if has_capital else 100.0)

        # Courbe du benchmark en base 100 sur les mêmes dates, pour comparaison
        bench = data[bench_ticker]["Close"].reindex(value.index).ffill().bfill()
        chart = build_chart_data(None, value, cap)
        bench_vals = (bench / bench.iloc[0] * 100).round(2).tolist()
        for row, b in zip(chart, bench_vals):
            row["benchmark"] = b

        return {
            "tickers": tickers,
            "weights": weights_in,
            "asset_classes": classes,
            "rebalance": req.rebalance or "none",
            "benchmark_ticker": bench_ticker,
            "benchmark_label": b_label,
            "period_start": value.index[0].strftime("%Y-%m-%d"),
            "period_end": value.index[-1].strftime("%Y-%m-%d"),
            "metrics": stats,
            "interpretations": interpretations,
            "breakdown": breakdown,
            "money_summary": money_summary,
            "monte_carlo": {"is_money": has_capital, "summary": mc["summary"], "chart_data": mc["chart_data"]},
            "chart_data": chart,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# -------------------------------------------------------------
# 3. SCREENER
# -------------------------------------------------------------
SCREENER_FILE = os.path.join(ROOT, "screener_cache.json")
_screener_mem = {"mtime": None, "payload": None}


def load_screener_payload() -> dict:
    """Charge le cache une seule fois (rechargé seulement si le fichier change) et calcule les plages."""
    if not os.path.exists(SCREENER_FILE):
        raise HTTPException(status_code=503, detail=T("Cache du screener absent. Lancez une actualisation.", "Screener cache missing. Run a refresh."))
    mtime = os.path.getmtime(SCREENER_FILE)
    if _screener_mem["mtime"] != mtime:
        with open(SCREENER_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
        rows = list(raw.values()) if isinstance(raw, dict) else raw
        ranges = {}
        for row in rows:
            for k, v in row.items():
                if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v:
                    lo, hi = ranges.get(k, (v, v))
                    ranges[k] = (min(lo, v), max(hi, v))
        markets = sorted({r.get("market", "") for r in rows if r.get("market")})
        _screener_mem.update(mtime=mtime, payload={
            "updated": datetime.fromtimestamp(mtime).strftime("%d/%m/%Y à %H:%M"),
            "total": len(rows),
            "results": rows,
            "ranges": {k: [round(a, 2), round(b, 2)] for k, (a, b) in ranges.items()},
            "markets": markets,
        })
    return _screener_mem["payload"]


@app.get("/api/screener")
def screen_assets(request: Request, market: Optional[str] = "all", sort: Optional[str] = None, limit: Optional[int] = None):
    """
    Sans filtre : renvoie toute la base (le frontend filtre instantanément côté client).
    Filtres génériques possibles : ?min_sharpe=1&max_max_drawdown_pct=-10&...
    """
    payload = load_screener_payload()
    params = request.query_params
    filters = []
    for key, val in params.items():
        m = re.match(r"^(min|max)_(.+)$", key)
        if m and val != "":
            try:
                filters.append((m.group(1), m.group(2), float(val)))
            except ValueError:
                pass
    if not filters and (market in (None, "all")) and not sort and not limit:
        return payload

    rows = payload["results"]
    if market and market != "all":
        rows = [r for r in rows if r.get("market") == market]
    for kind, field, bound in filters:
        if kind == "min":
            rows = [r for r in rows if r.get(field) is not None and r[field] >= bound]
        else:
            rows = [r for r in rows if r.get(field) is not None and r[field] <= bound]
    if sort:
        desc = sort.startswith("-")
        f = sort.lstrip("-")
        rows = sorted(rows, key=lambda r: (r.get(f) is None, r.get(f) or 0), reverse=desc)
    return {**payload, "total_matches": len(rows), "results": rows[:limit] if limit else rows}


screener_sync_state = {
    "is_running": False,
    "progress_pct": 0,
    "progress_text": "",
    "last_updated": None,
    "last_updated_ts": 0.0
}
COOLDOWN_SECONDS = 4 * 3600


def task_update_screener_cache():
    try:
        screener_sync_state.update(is_running=True, progress_pct=2, progress_text="Construction de l'univers...")
        process = subprocess.Popen(
            [sys.executable, "-u", os.path.join(ROOT, "update_screener.py")],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", cwd=ROOT,
        )
        for line in iter(process.stdout.readline, ''):
            line_str = line.strip()
            m = re.search(r"(\d+)\s*/\s*(\d+)", line_str)
            if m and "groupe" in line_str.lower():
                done, total = int(m.group(1)), max(1, int(m.group(2)))
                screener_sync_state["progress_pct"] = min(98, 5 + int(done / total * 93))
                screener_sync_state["progress_text"] = line_str
            elif line_str:
                screener_sync_state["progress_text"] = line_str
        process.stdout.close()
        process.wait()

        if process.returncode == 0:
            screener_sync_state.update(progress_pct=100, progress_text="Terminé !", last_updated_ts=time.time(),
                                       last_updated=datetime.now().strftime("%d/%m/%Y à %H:%M"))
        else:
            screener_sync_state["progress_text"] = "Échec de l'actualisation (voir la console du serveur)."
    except Exception as e:
        screener_sync_state["progress_text"] = f"Erreur : {e}"
    finally:
        screener_sync_state["is_running"] = False


@app.get("/api/screener/status")
def get_screener_status():
    elapsed = time.time() - screener_sync_state["last_updated_ts"]
    can_refresh = (elapsed >= COOLDOWN_SECONDS) and not screener_sync_state["is_running"]
    remaining = max(0, int(COOLDOWN_SECONDS - elapsed)) if screener_sync_state["last_updated_ts"] > 0 else 0
    last = screener_sync_state["last_updated"]
    if not last and os.path.exists(SCREENER_FILE):
        last = datetime.fromtimestamp(os.path.getmtime(SCREENER_FILE)).strftime("%d/%m/%Y à %H:%M")
    return {
        "is_running": screener_sync_state["is_running"],
        "progress_pct": screener_sync_state["progress_pct"],
        "progress_text": screener_sync_state["progress_text"],
        "last_updated": last or "Jamais",
        "can_refresh": can_refresh,
        "remaining_cooldown_seconds": remaining
    }


@app.post("/api/screener/refresh")
def trigger_screener_refresh(background_tasks: BackgroundTasks):
    if screener_sync_state["is_running"]:
        raise HTTPException(status_code=409, detail=T("Actualisation déjà en cours.", "Refresh already running."))
    elapsed = time.time() - screener_sync_state["last_updated_ts"]
    if screener_sync_state["last_updated_ts"] > 0 and elapsed < COOLDOWN_SECONDS:
        rem_h = round((COOLDOWN_SECONDS - elapsed) / 3600, 1)
        raise HTTPException(status_code=429, detail=T(f"Attendez {rem_h} h avant la prochaine actualisation.", f"Wait {rem_h} h before the next refresh."))
    screener_sync_state.update(is_running=True, progress_pct=0, progress_text="Lancement...")
    background_tasks.add_task(task_update_screener_cache)
    return {"message": "Actualisation lancée en tâche de fond."}


# -------------------------------------------------------------
# 4. CALENDRIER ÉCONOMIQUE
# -------------------------------------------------------------
import econ_calendar


def _event_reactions(events: list) -> None:
    """Pour chaque annonce passée : variation de ses actifs de référence le jour concerné, comparée à un jour normal."""
    past = [e for e in events if e["timestamp"] < time.time() and e["impact"] in ("High", "Medium")]
    refs = sorted({a["ticker"] for e in past for a in e["assets"][:2]})
    if not refs:
        return
    try:
        data = fetch_many(refs, period="6mo")
    except Exception:
        data = {}
        for t in refs:  # un ticker en échec ne doit pas tout bloquer
            try:
                data.update(fetch_many([t], period="6mo"))
            except Exception:
                pass
    stats = {}
    for t, df in data.items():
        r = df["Close"].pct_change().dropna()
        stats[t] = (r, float(r.tail(60).abs().median()) if len(r) > 10 else None)

    for e in past:
        day = pd.Timestamp(econ_calendar.reaction_day(e["datetime"]))
        reactions = []
        for a in e["assets"][:2]:
            if a["ticker"] not in stats:
                continue
            r, typical = stats[a["ticker"]]
            after = r[r.index >= day]
            if after.empty or (after.index[0] - day).days > 3:
                continue
            chg = float(after.iloc[0])
            reactions.append({
                "ticker": a["ticker"], "name": a["name"], "date": after.index[0].strftime("%Y-%m-%d"),
                "change_pct": round(chg * 100, 2),
                "vs_normal": round(abs(chg) / typical, 1) if typical else None,
                # Variation habituelle : médiane des variations absolues des 60 dernières séances
                "normal_pct": round(typical * 100, 2) if typical else None,
            })
        e["reaction"] = reactions


@app.get("/api/calendar")
def get_calendar(tickers: Optional[str] = None, weights: Optional[str] = None):
    """
    Annonces de la semaine. Avec `tickers` (et éventuellement `weights`), renvoie aussi l'exposition
    par devise et ne garde que les annonces qui concernent ces actifs.
    """
    try:
        feed = econ_calendar.get_events()
        events = [econ_calendar.localize_event(e) for e in feed["events"]]
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
    _event_reactions(events)

    exposure = None
    if tickers:
        tl = [t.strip().upper() for t in tickers.split(",") if t.strip()]
        try:
            wl = [float(w) for w in weights.split(",")] if weights else [1.0] * len(tl)
        except ValueError:
            wl = [1.0] * len(tl)
        if len(wl) != len(tl):
            wl = [1.0] * len(tl)
        expo = {}
        for t, w in zip(tl, wl):
            ccys = econ_calendar.asset_currencies(t)
            for c in ccys:
                expo[c] = expo.get(c, 0.0) + w / len(ccys)
        total = sum(expo.values()) or 1.0
        exposure = sorted(({"currency": c, "country": econ_calendar.currencies_names().get(c, c), "pct": round(v / total * 100, 1)}
                           for c, v in expo.items()), key=lambda x: -x["pct"])
        wanted = set(expo)
        events = [e for e in events if e["currency"] in wanted]

    now = time.time()
    upcoming_high = [e for e in events if e["impact"] == "High" and e["timestamp"] >= now]
    return {
        "source": feed["source"],
        "updated": datetime.fromtimestamp(econ_calendar._mem["ts"] or now).strftime("%Y-%m-%d %H:%M"),
        "currencies": econ_calendar.currencies_names(),
        "exposure": exposure,
        "next_high": upcoming_high[0] if upcoming_high else None,
        "events": events,
    }


# -------------------------------------------------------------
# 5. OBLIGATIONS & DÉRIVÉS
# -------------------------------------------------------------
import fixed_income


@app.get("/api/bonds")
def get_bonds():
    try:
        rows = load_screener_payload()["results"]
        by_ticker = {r["ticker"]: r for r in rows}
    except Exception:
        by_ticker = {}
    try:
        return fixed_income.localize_bonds(fixed_income.get_bonds(by_ticker), i18n.lang())
    except Exception as e:
        raise HTTPException(status_code=503, detail=T(f"Données obligataires indisponibles : {e}", f"Bond data unavailable: {e}"))


@app.get("/api/options/{ticker}")
def get_options(ticker: str, expiry: Optional[str] = None):
    """Cours, volatilités historiques, taux sans risque et chaîne d'options (si Yahoo en fournit pour ce sous-jacent)."""
    try:
        t = ticker.strip().upper()
        df = fetch_many([t], period="1y")[t]
        close = df["Close"]
        classe = backend.detecter_classe_actif(t)
        ppy = backend.periods_per_year(classe)
        spot = float(close.iloc[-1])
        chain = fixed_income.get_option_chain(t, expiry, spot)
        rf = round(risk_free.for_ticker(t)["rate"] * 100, 2)
        return {
            "ticker": t, "spot": round(spot, 4 if spot < 10 else 2), "asset_class": classe,
            "hv_30": fixed_income.historical_vol(close, 30, ppy), "hv_1y": fixed_income.historical_vol(close, 252, ppy),
            "risk_free_pct": rf if rf is not None else 4.0,
            **chain,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))



# -------------------------------------------------------------
# 6. RAPPORT DE COMPARAISON (.xlsx avec graphiques)
# -------------------------------------------------------------
import report
import guide
import frontier


@app.post("/api/portfolio/frontier")
def portfolio_frontier(req: PortfolioRequest):
    """Frontière efficiente des actifs du portefeuille : mêmes actifs, autres dosages."""
    try:
        weights_in = {k.strip().upper(): float(v) for k, v in req.weights.items() if float(v) > 0}
        tickers = list(weights_in)
        if len(tickers) < 2:
            raise ValueError(T("Il faut au moins deux actifs pour chercher un meilleur dosage.", "At least two assets are needed to look for a better mix."))
        data = fetch_many(tickers, period=req.period, start=req.start_date, end=req.end_date)
        prices = pd.concat({t: data[t]["Close"] for t in tickers}, axis=1, join="inner").dropna()
        if len(prices) < 60:
            raise ValueError(T("Historique commun trop court (moins de 60 séances) pour une estimation fiable.", "Shared history too short (under 60 sessions) for a reliable estimate."))
        classes = {t: backend.detecter_classe_actif(t) for t in tickers}
        ppy = 365 if all(c == "CRYPTO" for c in classes.values()) else 252
        total = sum(weights_in.values())
        current = np.array([weights_in[t] / total for t in tickers])
        rf = with_override(risk_free.for_portfolio(weights_in), req.risk_free_pct)
        out = frontier.compute(prices, current, ppy, rf["rate"])
        out["risk_free_source"] = rf["source"]
        return out
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))



@app.get("/api/guide")
def get_guide():
    """Repères historiques de l'onglet « Bien démarrer » (calculés une fois, gardés 12 h)."""
    try:
        return guide.localize(guide.get(fetch_many), i18n.lang())
    except Exception as e:
        raise HTTPException(status_code=503, detail=T(f"Données historiques indisponibles pour le moment ({e}).", f"Historical data unavailable right now ({e})."))

from fastapi.responses import Response


class ComparisonRequest(BaseModel):
    portfolios: List[dict]
    period: Optional[str] = "5y"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    benchmark: Optional[str] = "^GSPC"
    capital: Optional[float] = 10000.0


@app.post("/api/export/comparison")
def export_comparison(req: ComparisonRequest):
    try:
        if len(req.portfolios) < 1:
            raise ValueError(T("Aucun portefeuille à exporter.", "No portfolio to export."))
        content = report.build_comparison(req.portfolios, fetch_many, period=req.period, start=req.start_date, end=req.end_date,
                                          benchmark=(req.benchmark or "^GSPC").upper(), capital=req.capital or 10000.0)
        return Response(content, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": 'attachment; filename="comparaison.xlsx"'})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
