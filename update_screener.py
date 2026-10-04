"""
Reconstruit screener_cache.json à partir de l'univers d'actifs (universe.py).
Les métriques sont calculées par backend.screener_metrics (même code que l'analyse d'actif).
Lancer : python update_screener.py
"""
import json
import os
import time

import pandas as pd
import yfinance as yf

import backend
import universe

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_FILE = os.path.join(ROOT, "screener_cache.json")
BATCH_SIZE = 120
SCREENED_CATEGORIES = {"Actions", "ETF", "Crypto", "Matières 1ères", "Forex", "Indices"}

# Benchmark utilisé pour bêta / alpha / corrélation selon le marché
BENCHMARKS = {"US": "^GSPC", "Europe": "^STOXX", "Crypto": "BTC-USD"}


def market_label(asset: dict) -> str:
    cat = asset["category"]
    if cat == "Actions":
        return asset["market"] if asset["market"] in ("US", "Europe", "Amériques", "Asie") else "Europe"
    return cat


def extract(raw: pd.DataFrame, ticker: str) -> pd.DataFrame:
    if isinstance(raw.columns, pd.MultiIndex):
        if ticker not in raw.columns.get_level_values(0):
            return pd.DataFrame()
        sub = raw[ticker]
    else:
        sub = raw
    df = pd.DataFrame(index=pd.to_datetime(sub.index))
    df["Close"] = sub["Close"].astype(float)
    for col in ("Open", "High", "Low"):
        df[col] = sub[col].astype(float) if col in sub.columns else df["Close"]
    df["Volume"] = sub["Volume"].astype(float) if "Volume" in sub.columns else 0.0
    return df.dropna(subset=["Close"])


def market_risk_free() -> float:
    """Taux du bon du Trésor US à 3 mois (copie FRED de l'onglet Obligations), 2 % à défaut."""
    try:
        data = json.load(open(os.path.join(ROOT, "bonds_cache.json"), encoding="utf-8"))
        return float(data["risk_free_3m"]) / 100
    except Exception:
        return backend.RISK_FREE_RATE


def build_screener_database():
    backend.set_risk_free(market_risk_free())
    print(f"Taux sans risque utilisé : {backend.risk_free() * 100:.2f} %")
    print("Construction de l'univers...")
    try:
        assets = universe.build_universe(verbose=False)
        universe.save_universe(assets)
    except Exception as e:
        print(f"Univers en ligne indisponible ({e}), utilisation de la version locale.")
        assets = universe.load_universe()

    assets = [a for a in assets if a["category"] in SCREENED_CATEGORIES]
    print(f"Total actifs dans l'univers : {len(assets)}")

    bench_raw = yf.download(list(set(BENCHMARKS.values())), period="2y", progress=False, auto_adjust=True, group_by="ticker")
    bench_close = {k: extract(bench_raw, t)["Close"] for k, t in BENCHMARKS.items()}

    database = {}
    n_batches = (len(assets) + BATCH_SIZE - 1) // BATCH_SIZE
    for b in range(n_batches):
        batch = assets[b * BATCH_SIZE:(b + 1) * BATCH_SIZE]
        print(f"Téléchargement du groupe {b + 1}/{n_batches}...")
        try:
            raw = yf.download([a["ticker"] for a in batch], period="2y", progress=False,
                              auto_adjust=True, group_by="ticker", threads=True)
        except Exception as e:
            print(f"Erreur sur le groupe {b + 1} : {e}")
            continue

        for a in batch:
            try:
                df = extract(raw, a["ticker"])
                if a["category"] != "Crypto":
                    df = backend.fix_unit_glitches(df)
                mkt = market_label(a)
                ppy = 365 if a["category"] == "Crypto" else 252
                bench = bench_close.get("Crypto" if mkt == "Crypto" else ("Europe" if mkt == "Europe" else "US"))
                metrics = backend.screener_metrics(df, bench, ppy)
                if not metrics:
                    continue
                metrics.update({
                    "ticker": a["ticker"], "name": a["name"], "market": mkt,
                    "category": a["category"], "country": a.get("country"), "sector": a.get("sector"),
                })
                database[a["ticker"]] = metrics
            except Exception as e:
                print(f"  {a['ticker']} ignoré : {e}")
        time.sleep(1)

    tmp = OUT_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(database, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT_FILE)  # écriture atomique : l'API ne lit jamais un fichier à moitié écrit
    print(f"Base de données générée avec succès : {len(database)} actifs analysés.")


if __name__ == "__main__":
    build_screener_database()
