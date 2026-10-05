"""
Taux sans risque par devise : un actif coté en euros se compare au taux de la BCE, un actif en dollars au bon du Trésor US, etc.
Sources FRED (Réserve fédérale de Saint-Louis), mises en cache 12 h dans rates_cache.json.
"""
import json
import os
import threading
import time
from datetime import datetime, timedelta

from i18n import T

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, "rates_cache.json")
TTL = 12 * 3600
DEFAULT_RATE = 0.02  # dernier recours si aucune donnée n'est disponible

# devise -> (série FRED, source en français, source en anglais)
SERIES = {
    "USD": ("DGS3MO", "bon du Trésor US à 3 mois", "3-month US Treasury bill"),
    "EUR": ("ECBDFR", "taux de dépôt de la BCE", "ECB deposit rate"),
    "GBP": ("IUDSOIA", "taux SONIA (Banque d'Angleterre)", "SONIA rate (Bank of England)"),
    "CHF": ("IR3TIB01CHM156N", "taux interbancaire suisse à 3 mois", "3-month Swiss interbank rate"),
    "JPY": ("IR3TIB01JPM156N", "taux interbancaire japonais à 3 mois", "3-month Japanese interbank rate"),
    "CAD": ("IR3TIB01CAM156N", "taux interbancaire canadien à 3 mois", "3-month Canadian interbank rate"),
    "SEK": ("IR3TIB01SEM156N", "taux interbancaire suédois à 3 mois", "3-month Swedish interbank rate"),
    "INR": ("IRSTCI01INM156N", "taux court indien", "Indian short-term rate"),
    "BRL": ("IRSTCI01BRM156N", "taux court brésilien (proche du Selic)", "Brazilian short-term rate (close to Selic)"),
}
ALIASES = {"DKK": "EUR"}  # la couronne danoise est arrimée à l'euro

CURRENCY_NAMES = {"USD": ("dollar", "dollar"), "EUR": ("euro", "euro"), "GBP": ("livre sterling", "pound sterling"),
                  "CHF": ("franc suisse", "Swiss franc"), "JPY": ("yen", "yen"), "CAD": ("dollar canadien", "Canadian dollar"),
                  "SEK": ("couronne suédoise", "Swedish krona"), "INR": ("roupie indienne", "Indian rupee"),
                  "BRL": ("réal brésilien", "Brazilian real"), "DKK": ("couronne danoise", "Danish krone"),
                  "NOK": ("couronne norvégienne", "Norwegian krone")}

# Devise de cotation selon le suffixe Yahoo (.PA = Paris…) ou l'indice
SUFFIX_CCY = {
    "PA": "EUR", "DE": "EUR", "F": "EUR", "AS": "EUR", "MI": "EUR", "MC": "EUR", "LS": "EUR", "BR": "EUR", "HE": "EUR",
    "VI": "EUR", "IR": "EUR", "L": "GBP", "SW": "CHF", "ST": "SEK", "T": "JPY", "TO": "CAD", "SA": "BRL", "NS": "INR", "CO": "DKK", "OL": "NOK",
}
INDEX_CCY = {
    "^FCHI": "EUR", "^GDAXI": "EUR", "^STOXX50E": "EUR", "^STOXX": "EUR", "^IBEX": "EUR", "^AEX": "EUR", "FTSEMIB.MI": "EUR",
    "^FTSE": "GBP", "^SSMI": "CHF", "^N225": "JPY", "^GSPTSE": "CAD", "^BVSP": "BRL", "^NSEI": "INR",
}

_lock = threading.Lock()
_mem = {"ts": 0.0, "rates": None}


def listing_currency(ticker: str) -> str:
    """Devise dans laquelle l'actif est coté (USD par défaut : actions US, crypto, matières premières, forex)."""
    t = ticker.upper()
    if t in INDEX_CCY:
        return INDEX_CCY[t]
    if t.endswith("=X") or t.endswith("=F"):
        return "USD"
    if "-" in t and t.rsplit("-", 1)[1] in ("USD", "EUR", "GBP"):
        return t.rsplit("-", 1)[1]
    if "." in t:
        return SUFFIX_CCY.get(t.rsplit(".", 1)[1], "USD")
    return "USD"


def _download() -> dict:
    """Une requête par série (FRED renvoie un CSV illisible quand on mélange séries journalières et mensuelles)."""
    import fixed_income  # curl_cffi : FRED bloque le client Python standard
    from concurrent.futures import ThreadPoolExecutor
    start = (datetime.now() - timedelta(days=400)).strftime("%Y-%m-%d")

    def one(item):
        ccy, (sid, _, _) = item
        try:
            s = fixed_income._fred([sid], start)[sid].dropna()
            return ccy, ({"rate": round(float(s.iloc[-1]), 3), "date": s.index[-1].strftime("%Y-%m-%d")} if not s.empty else None)
        except Exception:
            return ccy, None

    with ThreadPoolExecutor(max_workers=5) as ex:
        return {c: v for c, v in ex.map(one, SERIES.items()) if v}


def rates() -> dict:
    """{devise: {rate (en %), date}} : mémoire, puis téléchargement, puis fichier de cache en secours."""
    now = time.time()
    if _mem["rates"] and now - _mem["ts"] < TTL:
        return _mem["rates"]
    with _lock:
        if _mem["rates"] and now - _mem["ts"] < TTL:
            return _mem["rates"]
        data = None
        if os.path.exists(CACHE):
            try:
                cached = json.load(open(CACHE, encoding="utf-8"))
                if now - cached.get("ts", 0) < TTL:
                    data = cached["rates"]
            except Exception:
                pass
        if data is None:
            data = _download()
            if data:
                tmp = CACHE + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump({"ts": now, "rates": data}, f)
                os.replace(tmp, CACHE)
            else:  # FRED injoignable : dernier fichier connu, même ancien ; on réessaiera dans 10 minutes
                try:
                    data = json.load(open(CACHE, encoding="utf-8"))["rates"]
                except Exception:
                    data = {}
                _mem.update(ts=now - TTL + 600, rates=data)
                return data
        _mem.update(ts=now, rates=data)
        return data


def for_currency(ccy: str) -> dict:
    """Taux sans risque d'une devise : {rate (décimal), currency, source (texte lisible), date}."""
    ccy = ccy.upper()
    base = ALIASES.get(ccy, ccy)
    table = rates()
    hit = table.get(base)
    fallback = hit is None
    if fallback:
        base = "USD"
        hit = table.get("USD")
    rate = hit["rate"] / 100 if hit else DEFAULT_RATE
    sid, src_fr, src_en = SERIES[base]
    source = T(src_fr, src_en) if hit else T("taux par défaut de 2 %", "default 2% rate")
    if fallback and hit:
        name = CURRENCY_NAMES.get(ccy, (ccy, ccy))
        source += T(f", faute de donnée pour le {name[0]}", f", no data for the {name[1]}")
    return {"rate": rate, "currency": ccy, "source": source, "date": hit["date"] if hit else None}


def for_ticker(ticker: str) -> dict:
    return for_currency(listing_currency(ticker))


def for_portfolio(weights: dict) -> dict:
    """Portefeuille multi-devises : moyenne des taux pondérée par le poids de chaque ligne."""
    total = sum(weights.values()) or 1
    parts = {}
    for t, w in weights.items():
        c = listing_currency(t)
        parts[c] = parts.get(c, 0) + w / total
    if len(parts) == 1:
        return for_currency(next(iter(parts)))
    rate = sum(for_currency(c)["rate"] * w for c, w in parts.items())
    mix = ", ".join(f"{c} {round(w * 100)} %" for c, w in sorted(parts.items(), key=lambda x: -x[1]))
    return {"rate": rate, "currency": None, "source": T(f"moyenne des taux de chaque devise, pondérée ({mix})",
                                                        f"weighted average of each currency's rate ({mix})"), "date": None}
