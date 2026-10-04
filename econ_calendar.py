"""
Calendrier économique.
Source principale : calendrier public de TradingView (10 jours passés + 3 semaines à venir, avec chiffre publié).
Source de secours : flux Forex Factory (semaine en cours seulement, sans chiffre publié).

- Cache mémoire de 30 min + copie disque (le flux limite le nombre d'appels).
- Chaque semaine récupérée est fusionnée dans calendar_history.json : l'historique s'enrichit au fil du temps.
- Lien avec les autres onglets : devise d'une annonce -> actifs qu'elle fait bouger, et devise(s) d'un actif.
"""
import json
import os
import re
import time
from datetime import datetime, timedelta, timezone

import requests

from i18n import T, lang

ROOT = os.path.dirname(os.path.abspath(__file__))
FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
TV_URL = "https://economic-calendar.tradingview.com/events"
TV_COUNTRIES = "US,EU,DE,FR,IT,ES,GB,JP,CH,CA,AU,NZ,CN"
TV_IMPORTANCE = {1: "High", 0: "Medium", -1: "Low"}
COUNTRY_FR = {"US": "États-Unis", "EU": "Zone euro", "DE": "Allemagne", "FR": "France", "IT": "Italie", "ES": "Espagne",
              "GB": "Royaume-Uni", "JP": "Japon", "CH": "Suisse", "CA": "Canada", "AU": "Australie", "NZ": "Nouvelle-Zélande", "CN": "Chine"}
CACHE_FILE = os.path.join(ROOT, "calendar_cache.json")
HISTORY_FILE = os.path.join(ROOT, "calendar_history.json")
TTL = 30 * 60

CURRENCIES = {
    "USD": "États-Unis", "EUR": "Zone euro", "GBP": "Royaume-Uni", "JPY": "Japon", "CHF": "Suisse",
    "CAD": "Canada", "AUD": "Australie", "NZD": "Nouvelle-Zélande", "CNY": "Chine",
}

# Actifs qu'une annonce dans cette devise fait typiquement bouger (le 1er sert de référence pour la réaction)
CURRENCY_ASSETS = {
    "USD": [("^GSPC", "S&P 500"), ("DX-Y.NYB", "Dollar Index"), ("EURUSD=X", "EUR/USD"), ("GC=F", "Or"), ("^TNX", "Taux US 10 ans"), ("BTC-USD", "Bitcoin")],
    "EUR": [("EURUSD=X", "EUR/USD"), ("^STOXX50E", "Euro Stoxx 50"), ("^FCHI", "CAC 40"), ("^GDAXI", "DAX 40")],
    "GBP": [("GBPUSD=X", "GBP/USD"), ("^FTSE", "FTSE 100"), ("EURGBP=X", "EUR/GBP")],
    "JPY": [("USDJPY=X", "USD/JPY"), ("^N225", "Nikkei 225")],
    "CHF": [("USDCHF=X", "USD/CHF"), ("^SSMI", "SMI"), ("EURCHF=X", "EUR/CHF")],
    "CAD": [("USDCAD=X", "USD/CAD"), ("^GSPTSE", "S&P/TSX"), ("CL=F", "Pétrole WTI")],
    "AUD": [("AUDUSD=X", "AUD/USD"), ("^AXJO", "ASX 200")],
    "NZD": [("NZDUSD=X", "NZD/USD")],
    "CNY": [("USDCNY=X", "USD/CNY"), ("^HSI", "Hang Seng"), ("000001.SS", "Shanghai Composite"), ("HG=F", "Cuivre")],
}

SUFFIX_CCY = {
    ".PA": "EUR", ".DE": "EUR", ".F": "EUR", ".AS": "EUR", ".MC": "EUR", ".MI": "EUR", ".BR": "EUR", ".HE": "EUR",
    ".LS": "EUR", ".VI": "EUR", ".IR": "EUR", ".L": "GBP", ".SW": "CHF", ".T": "JPY", ".TO": "CAD", ".AX": "AUD",
    ".HK": "CNY", ".SS": "CNY", ".SZ": "CNY", ".CO": "EUR", ".ST": "EUR", ".OL": "EUR",
}
INDEX_CCY = {
    "^FCHI": "EUR", "^GDAXI": "EUR", "^STOXX50E": "EUR", "^STOXX": "EUR", "^IBEX": "EUR", "FTSEMIB.MI": "EUR", "^AEX": "EUR",
    "^FTSE": "GBP", "^SSMI": "CHF", "^N225": "JPY", "^HSI": "CNY", "000001.SS": "CNY", "^AXJO": "AUD", "^GSPTSE": "CAD",
}

# Traductions / explications des annonces courantes (motif regex -> (titre français, pourquoi c'est important))
EXPLAIN = [
    (r"Non[- ]?Farm Payrolls", "Créations d'emplois hors agriculture (NFP)", "Le chiffre le plus suivi du marché : il mesure la vigueur de l'emploi américain et influence directement les décisions de la Fed."),
    (r"Jobless Claims", "Inscriptions hebdomadaires au chômage", "Indicateur avancé de l'emploi : une hausse signale un ralentissement de l'économie."),
    (r"Core Inflation Rate", "Inflation sous-jacente", "Inflation hors énergie et alimentation : c'est elle que les banques centrales surveillent pour fixer les taux."),
    (r"Inflation Rate|Harmonised Inflation", "Inflation (prix à la consommation)", "Une inflation plus forte que prévu fait craindre des taux plus élevés : souvent négatif pour les actions et positif pour la devise."),
    (r"Personal Spending", "Dépenses des ménages", "La consommation représente environ 70 % du PIB américain."),
    (r"Personal Income", "Revenus des ménages", "Des revenus en hausse soutiennent la consommation future."),
    (r"Tankan", "Enquête Tankan (grandes entreprises japonaises)", "Baromètre trimestriel suivi de près par la Banque du Japon."),
    (r"Balance of Trade", "Balance commerciale", "Différence exportations − importations : influence la demande pour la devise."),
    (r"Speech", "Discours d'un responsable", "Un discours peut donner des indices sur la future politique monétaire."),
    (r"JGB Purchase|Auction", "Adjudication d'obligations d'État", "Une demande faible pour la dette publique peut faire monter les taux longs."),
    (r"ADP", "Emplois privés ADP", "Estimation des créations d'emplois du secteur privé, publiée avant le NFP."),
    (r"Non-Farm Employment", "Créations d'emplois hors agriculture (NFP)", "Le chiffre le plus suivi du marché : il mesure la vigueur de l'emploi américain et influence directement les décisions de la Fed."),
    (r"Unemployment Claims", "Inscriptions hebdomadaires au chômage", "Indicateur avancé de l'emploi : une hausse signale un ralentissement de l'économie."),
    (r"Unemployment Rate", "Taux de chômage", "Un chômage bas soutient la consommation mais peut alimenter l'inflation et des taux plus élevés."),
    (r"Average (Hourly )?Earnings", "Salaire horaire moyen", "Mesure la pression salariale, un moteur de l'inflation surveillé par les banques centrales."),
    (r"JOLTS", "Offres d'emploi (JOLTS)", "Nombre de postes vacants : indique la tension sur le marché du travail."),
    (r"Core PCE", "Inflation PCE sous-jacente", "L'indicateur d'inflation préféré de la Fed (hors énergie et alimentation)."),
    (r"Core CPI", "Inflation sous-jacente (CPI hors énergie et alimentation)", "Une inflation plus forte que prévu fait craindre des taux plus élevés : souvent négatif pour les actions et positif pour la devise."),
    (r"\bCPI\b", "Inflation (indice des prix à la consommation)", "Une inflation plus forte que prévu fait craindre des taux plus élevés : souvent négatif pour les actions et positif pour la devise."),
    (r"\bPPI\b", "Prix à la production", "Inflation côté entreprises : elle se répercute souvent ensuite sur les prix à la consommation."),
    (r"Federal Funds Rate|Interest Rate Decision|Main Refinancing Rate|Official Bank Rate|Cash Rate|Overnight Rate|Policy Rate|SNB Policy Rate|BOJ Policy Rate", "Décision de taux directeur", "L'annonce la plus importante : le niveau des taux influence la devise, les obligations et la valorisation des actions."),
    (r"FOMC Statement|Monetary Policy Statement|Rate Statement", "Communiqué de politique monétaire", "Le ton du communiqué (plus ou moins restrictif) fait souvent plus bouger les marchés que la décision elle-même."),
    (r"Press Conference", "Conférence de presse de la banque centrale", "Les réponses aux questions peuvent changer les anticipations de taux en direct."),
    (r"Meeting Minutes|Minutes", "Compte rendu de réunion monétaire", "Détaille les débats internes : indique la direction probable des prochains taux."),
    (r"Speaks|Testifies", "Discours d'un responsable", "Un discours peut donner des indices sur la future politique monétaire."),
    (r"\bGDP\b", "PIB (croissance économique)", "Mesure la croissance de l'économie : une surprise forte soutient généralement la devise."),
    (r"Retail Sales", "Ventes au détail", "Reflète la consommation des ménages, principal moteur de la croissance."),
    (r"ISM Manufacturing|Manufacturing PMI", "PMI manufacturier", "Sondage auprès des directeurs d'achat : au-dessus de 50 = industrie en expansion, en dessous = contraction."),
    (r"ISM Services|Services PMI|Non-Manufacturing", "PMI des services", "Au-dessus de 50 = secteur des services en expansion. Les services pèsent la majorité du PIB."),
    (r"\bPMI\b", "Indice PMI", "Indicateur avancé de l'activité : 50 sépare expansion et contraction."),
    (r"Consumer Confidence|Consumer Sentiment", "Confiance des consommateurs", "Des ménages confiants consomment davantage."),
    (r"Trade Balance", "Balance commerciale", "Différence exportations − importations : influence la demande pour la devise."),
    (r"Crude Oil Inventories", "Stocks de pétrole brut (EIA)", "Une baisse des stocks plus forte que prévu fait souvent monter le prix du pétrole."),
    (r"Natural Gas Storage", "Stocks de gaz naturel", "Influence directement le prix du gaz naturel."),
    (r"Building Permits|Housing Starts|Home Sales|Pending Home", "Immobilier", "Indicateur de la santé du secteur immobilier, sensible aux taux d'intérêt."),
    (r"Durable Goods", "Commandes de biens durables", "Mesure les investissements des entreprises et des ménages en biens coûteux."),
    (r"Industrial Production|Factory Orders", "Production industrielle", "Mesure l'activité des usines."),
    (r"Bank Holiday|Holiday", "Jour férié", "Marché fermé ou liquidité réduite : les mouvements peuvent être plus erratiques."),
]

_mem = {"ts": 0.0, "events": None, "source": None}


def explain(title: str):
    """(titre traduit, pourquoi c'est important) dans la langue de la requête.
    En anglais, le titre d'origine est déjà lisible : on ne renvoie que l'explication."""
    for pattern, fr, why in EXPLAIN:
        if re.search(pattern, title, re.IGNORECASE):
            if lang() == "en":
                return None, EXPLAIN_EN.get(fr)
            return fr, why
    return None, None


EXPLAIN_EN = {
    "Créations d'emplois hors agriculture (NFP)": "The market's most watched number: it measures the strength of US employment and directly influences Fed decisions.",
    "Inscriptions hebdomadaires au chômage": "A leading labour indicator: a rise signals a slowing economy.",
    "Inflation sous-jacente": "Inflation excluding energy and food: the measure central banks watch when setting rates.",
    "Inflation (prix à la consommation)": "Higher-than-expected inflation raises fears of higher rates: often negative for stocks and positive for the currency.",
    "Dépenses des ménages": "Consumption is about 70% of US GDP.",
    "Revenus des ménages": "Rising incomes support future consumption.",
    "Enquête Tankan (grandes entreprises japonaises)": "A quarterly barometer closely watched by the Bank of Japan.",
    "Balance commerciale": "Exports minus imports: affects demand for the currency.",
    "Discours d'un responsable": "A speech can hint at future monetary policy.",
    "Adjudication d'obligations d'État": "Weak demand for government debt can push long-term rates up.",
    "Emplois privés ADP": "Estimate of private-sector job creation, released before the official jobs report.",
    "Taux de chômage": "Low unemployment supports consumption but can fuel inflation and higher rates.",
    "Salaire horaire moyen": "Measures wage pressure, a driver of inflation watched by central banks.",
    "Offres d'emploi (JOLTS)": "Number of job openings: shows how tight the labour market is.",
    "Inflation PCE sous-jacente": "The Fed's preferred inflation gauge (excluding energy and food).",
    "Inflation sous-jacente (CPI hors énergie et alimentation)": "Higher-than-expected inflation raises fears of higher rates: often negative for stocks and positive for the currency.",
    "Inflation (indice des prix à la consommation)": "Higher-than-expected inflation raises fears of higher rates: often negative for stocks and positive for the currency.",
    "Prix à la production": "Inflation at the producer level: it often feeds through to consumer prices later.",
    "Décision de taux directeur": "The most important release: the rate level drives the currency, bonds and stock valuations.",
    "Communiqué de politique monétaire": "The tone of the statement (more or less hawkish) often moves markets more than the decision itself.",
    "Conférence de presse de la banque centrale": "Answers to questions can shift rate expectations in real time.",
    "Compte rendu de réunion monétaire": "Details the internal debate: hints at the likely direction of future rates.",
    "PIB (croissance économique)": "Measures economic growth: a strong surprise usually supports the currency.",
    "Ventes au détail": "Reflects household consumption, the main driver of growth.",
    "PMI manufacturier": "Survey of purchasing managers: above 50 = manufacturing expanding, below = contracting.",
    "PMI des services": "Above 50 = services expanding. Services make up most of GDP.",
    "Indice PMI": "A leading activity indicator: 50 separates expansion from contraction.",
    "Confiance des consommateurs": "Confident households spend more.",
    "Stocks de pétrole brut (EIA)": "A larger-than-expected draw usually pushes oil prices up.",
    "Stocks de gaz naturel": "Directly affects natural gas prices.",
    "Immobilier": "A gauge of the housing market, which is sensitive to interest rates.",
    "Commandes de biens durables": "Measures business and household spending on expensive goods.",
    "Production industrielle": "Measures factory activity.",
    "Jour férié": "Market closed or thin liquidity: moves can be more erratic.",
}

COUNTRY_EN = {"US": "United States", "EU": "Euro area", "DE": "Germany", "FR": "France", "IT": "Italy", "ES": "Spain",
              "GB": "United Kingdom", "JP": "Japan", "CH": "Switzerland", "CA": "Canada", "AU": "Australia", "NZ": "New Zealand", "CN": "China"}
CURRENCY_EN = {"USD": "United States", "EUR": "Euro area", "GBP": "United Kingdom", "JPY": "Japan", "CHF": "Switzerland",
               "CAD": "Canada", "AUD": "Australia", "NZD": "New Zealand", "CNY": "China"}


def localize_event(e: dict) -> dict:
    """Traduit les champs textuels d'une annonce (copie) selon la langue de la requête."""
    e = dict(e)
    e["title_fr"], e["why"] = explain(e["title"])
    if lang() == "en":
        e["country"] = COUNTRY_EN.get(e.get("country_code") or "", CURRENCY_EN.get(e["currency"], e["currency"]))
        # Valeurs stockées avec la virgule française (« 51,4 % ») : point décimal en anglais
        for k in ("actual", "forecast", "previous"):
            if isinstance(e.get(k), str):
                e[k] = e[k].replace(",", ".")
    return e


def currencies_names() -> dict:
    return CURRENCY_EN if lang() == "en" else CURRENCIES


def asset_currencies(ticker: str) -> list:
    """Devise(s) qui pilotent un actif : forex -> les deux devises, actions -> la place de cotation, sinon USD."""
    t = ticker.upper()
    m = re.match(r"^([A-Z]{3})([A-Z]{3})=X$", t)
    if m:
        return [c for c in (m.group(1), m.group(2)) if c in CURRENCIES] or ["USD"]
    if t in INDEX_CCY:
        return [INDEX_CCY[t]]
    for suf, c in SUFFIX_CCY.items():
        if t.endswith(suf):
            return [c]
    return ["USD"]  # actions US, crypto (cotées en USD), matières premières, ETF US


def _fmt_value(v, unit, scale):
    """7.079 + M -> « 7,079 M » ; 3 + % -> « 3 % » ; 0.495 + A$ + B -> « A$0,495 B »."""
    if v is None:
        return None
    txt = f"{v:g}".replace(".", ",")
    if unit == "%":
        return f"{txt} %"
    pre = unit if unit and not unit.isalpha() else ""
    post = " ".join(x for x in [scale or "", unit if unit and unit.isalpha() else ""] if x)
    return f"{pre}{txt}{(' ' + post) if post else ''}"


def _base_event(uid, title, ccy, country_code, country_name, dt, impact, actual, forecast, previous, surprise=None):
    fr, why = explain(title)
    return {
        "id": uid, "title": title, "title_fr": fr, "why": why,
        "currency": ccy, "country_code": country_code, "country": country_name,
        "datetime": dt.isoformat(), "timestamp": dt.timestamp(), "impact": impact,
        "actual": actual, "forecast": forecast, "previous": previous, "surprise": surprise,
        "assets": [{"ticker": t, "name": n} for t, n in CURRENCY_ASSETS.get(ccy, [])],
    }


def _from_tradingview():
    now = datetime.now(timezone.utc)
    params = {"from": (now - timedelta(days=10)).strftime("%Y-%m-%dT00:00:00.000Z"),
              "to": (now + timedelta(days=24)).strftime("%Y-%m-%dT00:00:00.000Z"), "countries": TV_COUNTRIES}
    r = requests.get(TV_URL, params=params, headers={"Origin": "https://www.tradingview.com", "User-Agent": "Mozilla/5.0"}, timeout=20)
    r.raise_for_status()
    out = []
    for e in r.json().get("result", []):
        ccy = e.get("currency") or ""
        if ccy not in CURRENCIES:
            continue
        dt = datetime.fromisoformat(e["date"].replace("Z", "+00:00"))
        unit, scale = e.get("unit"), e.get("scale")
        a, f = e.get("actual"), e.get("forecast")
        surprise = None
        if a is not None and f is not None and f != a:
            surprise = "above" if a > f else "below"
        out.append(_base_event(f"tv{e['id']}", (e.get("title") or "").strip(), ccy, e.get("country"),
                               COUNTRY_FR.get(e.get("country"), e.get("country")), dt, TV_IMPORTANCE.get(e.get("importance"), "Low"),
                               _fmt_value(a, unit, scale), _fmt_value(f, unit, scale), _fmt_value(e.get("previous"), unit, scale), surprise))
    return out


def _from_forexfactory():
    r = requests.get(FEED_URL, headers={"User-Agent": "Mozilla/5.0 analyse-portfolio/1.0"}, timeout=15)
    r.raise_for_status()
    out = []
    for e in r.json():
        dt = datetime.fromisoformat(e["date"])
        ccy = e.get("country", "")
        out.append(_base_event(f"ff|{ccy}|{e.get('title')}|{e['date']}", e.get("title", ""), ccy, None, CURRENCIES.get(ccy, ccy), dt,
                               e.get("impact", "Low"), None, e.get("forecast") or None, e.get("previous") or None))
    return out


def _merge_history(events: list):
    try:
        hist = json.load(open(HISTORY_FILE, encoding="utf-8")) if os.path.exists(HISTORY_FILE) else {}
    except Exception:
        hist = {}
    for e in events:
        if e["actual"] is not None or e["id"] not in hist:
            hist[e["id"]] = {k: e[k] for k in ("title", "currency", "country", "datetime", "impact", "forecast", "previous", "actual")}
    tmp = HISTORY_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(hist, f, ensure_ascii=False)
    os.replace(tmp, HISTORY_FILE)


def get_events() -> dict:
    """{"source", "events"} triés chronologiquement ; cache 30 min, copie disque si toutes les sources échouent."""
    now = time.time()
    if _mem["events"] is not None and now - _mem["ts"] < TTL:
        return {"source": _mem["source"], "events": _mem["events"]}
    events, source = None, None
    for name, fn in (("TradingView", _from_tradingview), ("Forex Factory", _from_forexfactory)):
        try:
            events, source = fn(), name
            if events:
                break
        except Exception:
            continue
    if events:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump({"source": source, "events": events}, f, ensure_ascii=False)
    elif os.path.exists(CACHE_FILE):
        saved = json.load(open(CACHE_FILE, encoding="utf-8"))
        if isinstance(saved, dict):
            events, source = saved["events"], saved["source"] + " (copie locale)"
    if not events:
        raise RuntimeError(T("Calendrier économique indisponible (sources injoignables et aucune copie locale).", "Economic calendar unavailable (sources unreachable and no local copy)."))
    events.sort(key=lambda e: e["timestamp"])
    try:
        _merge_history(events)
    except Exception:
        pass
    _mem.update(ts=now, events=events, source=source)
    return {"source": source, "events": events}


def reaction_day(event_dt_iso: str):
    """Séance de bourse touchée : une annonce après 17 h (heure de New York) agit sur la séance suivante."""
    dt = datetime.fromisoformat(event_dt_iso)
    if dt.utcoffset() is not None:
        dt = dt.astimezone(timezone(timedelta(hours=-4)))  # heure de New York (approximation heure d'été)
    day = dt.date()
    if dt.hour >= 17:
        day = day + timedelta(days=1)
    while day.weekday() >= 5:
        day = day + timedelta(days=1)
    return day
