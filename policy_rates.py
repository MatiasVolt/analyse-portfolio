"""
Taux directeurs des grandes banques centrales : taux en vigueur, dernière décision, dernier changement, prochaine réunion.
Source : les décisions de taux du calendrier économique (TradingView), lues sur ~7 mois passés et ~5 mois à venir.
Résultat gardé 12 h en mémoire, avec une copie disque en secours si la source ne répond pas.
"""
import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import econ_calendar

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, "policy_cache.json")
TTL = 12 * 3600
# La source renvoie au plus 2 000 annonces par appel (environ 2 mois) : on l'interroge par tranches
CHUNK_DAYS, PAST_CHUNKS, FUTURE_CHUNKS = 50, 5, 3

# (code, nom français, nom anglais, devise, annonce qui porte la décision, précision sur le taux affiché fr / en)
BANKS = [
    ("US", "Réserve fédérale (Fed)", "Federal Reserve (Fed)", "USD", r"^Fed Interest Rate Decision$",
     "haut de la fourchette cible des fonds fédéraux", "upper bound of the federal funds target range"),
    ("EU", "Banque centrale européenne (BCE)", "European Central Bank (ECB)", "EUR", r"^Deposit Facility Rate$",
     "taux de la facilité de dépôt, celui qui guide les taux courts en zone euro", "deposit facility rate, the one steering short-term rates in the euro area"),
    ("GB", "Banque d'Angleterre", "Bank of England", "GBP", r"^BoE Interest Rate Decision$", "Bank Rate", "Bank Rate"),
    ("JP", "Banque du Japon", "Bank of Japan", "JPY", r"^BoJ Interest Rate Decision$", "taux au jour le jour", "overnight call rate"),
    ("CH", "Banque nationale suisse", "Swiss National Bank", "CHF", r"^SNB Interest Rate Decision$", "taux directeur de la BNS", "SNB policy rate"),
    ("CA", "Banque du Canada", "Bank of Canada", "CAD", r"^BoC Interest Rate Decision$", "taux cible du financement à un jour", "overnight rate target"),
    ("AU", "Banque de réserve d'Australie", "Reserve Bank of Australia", "AUD", r"^RBA Interest Rate Decision$", "taux cible au jour le jour", "cash rate target"),
    ("NZ", "Banque de réserve de Nouvelle-Zélande", "Reserve Bank of New Zealand", "NZD", r"^RBNZ Interest Rate Decision$", "taux officiel au jour le jour", "official cash rate"),
    ("CN", "Banque populaire de Chine", "People's Bank of China", "CNY", r"^Loan Prime Rate 1Y$",
     "taux préférentiel de prêt à 1 an (LPR), fixé chaque mois", "1-year loan prime rate (LPR), set every month"),
]

_lock = threading.Lock()
_mem = {"ts": 0.0, "data": None}


def _fetch_window(start: datetime, end: datetime) -> list:
    r = econ_calendar.requests.get(
        econ_calendar.TV_URL,
        params={"from": start.strftime("%Y-%m-%dT00:00:00.000Z"), "to": end.strftime("%Y-%m-%dT00:00:00.000Z"),
                "countries": ",".join(b[0] for b in BANKS)},
        headers={"Origin": "https://www.tradingview.com", "User-Agent": "Mozilla/5.0"}, timeout=30)
    r.raise_for_status()
    wanted = re.compile("|".join(b[4] for b in BANKS))
    return [e for e in r.json().get("result", []) if wanted.search((e.get("title") or "").strip())]


def _download() -> dict:
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    windows = [(today + timedelta(days=CHUNK_DAYS * k), today + timedelta(days=CHUNK_DAYS * (k + 1)))
               for k in range(-PAST_CHUNKS, FUTURE_CHUNKS)]
    with ThreadPoolExecutor(max_workers=4) as ex:
        chunks = list(ex.map(lambda w: _fetch_window(*w), windows))
    events = {e["id"]: e for chunk in chunks for e in chunk}.values()  # les tranches se touchent : on dédoublonne

    now = datetime.now(timezone.utc)
    banks = []
    for code, fr, en, ccy, pattern, note_fr, note_en in BANKS:
        rows = sorted((e for e in events if e.get("country") == code and re.search(pattern, (e.get("title") or "").strip())),
                      key=lambda e: e["date"])
        when = lambda e: datetime.fromisoformat(e["date"].replace("Z", "+00:00"))
        past = [e for e in rows if e.get("actual") is not None and when(e) <= now]
        future = [e for e in rows if when(e) > now]
        if not past:
            continue
        last = past[-1]
        # Dernier changement : la décision la plus récente où le taux a bougé
        change = next((e for e in reversed(past) if e.get("previous") is not None and e["actual"] != e["previous"]), None)
        nxt = future[0] if future else None
        banks.append({
            "code": code, "name_fr": fr, "name_en": en, "currency": ccy, "note_fr": note_fr, "note_en": note_en,
            "rate": last["actual"],
            "last_decision": {"date": last["date"], "previous": last.get("previous"),
                              "change": round(last["actual"] - last["previous"], 4) if last.get("previous") is not None else None,
                              "forecast": last.get("forecast")},
            "last_change": ({"date": change["date"], "from": change["previous"], "to": change["actual"]} if change else None),
            "next_meeting": ({"date": nxt["date"], "forecast": nxt.get("forecast")} if nxt else None),
            "history": [{"date": e["date"][:10], "rate": e["actual"]} for e in past],
            "publisher": last.get("source"), "publisher_url": last.get("source_url"),
        })
    if not banks:
        raise RuntimeError("aucune décision de taux trouvée")
    first = min((e["date"] for e in events), default=None)
    return {"updated": now.strftime("%Y-%m-%d %H:%M"), "source": "TradingView", "history_start": first[:10] if first else None, "banks": banks}


def get() -> dict:
    """Taux directeurs ; `stale` = True si l'on sert la copie disque faute de réponse de la source."""
    now = time.time()
    if _mem["data"] and now - _mem["ts"] < TTL:
        return _mem["data"]
    with _lock:
        if _mem["data"] and now - _mem["ts"] < TTL:
            return _mem["data"]
        try:
            data = _download()
            tmp = CACHE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            os.replace(tmp, CACHE)
            _mem.update(ts=now, data=data)
        except Exception:
            if not os.path.exists(CACHE):
                raise
            data = {**json.load(open(CACHE, encoding="utf-8")), "stale": True}
            _mem.update(ts=now - TTL + 600, data=data)  # nouvel essai dans 10 minutes
        return data


def localize(data: dict, lang: str) -> dict:
    key = "_en" if lang == "en" else "_fr"
    banks = []
    for b in data["banks"]:
        out = {k: v for k, v in b.items() if not k.endswith(("_fr", "_en"))}
        out["name"], out["note"] = b["name" + key], b["note" + key]
        banks.append(out)
    return {**data, "banks": banks}
