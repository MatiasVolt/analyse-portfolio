"""
Construction de l'univers d'actifs (bibliothèque de tickers).

- Actions : composants des grands indices récupérés sur Wikipedia
  (S&P 500, S&P 400, CAC 40, DAX, MDAX, FTSE 100, FTSE 250, Euro Stoxx 50,
  SMI, AEX, IBEX 35, FTSE MIB) + listes complémentaires curées.
- ETF, indices, crypto, forex, matières premières : listes curées.

Produit `universe.json` (racine) et `frontend/src/data/universe.json`
(utilisé par la barre de recherche). Lancer : python universe.py
"""
import io
import json
import os
import re

import pandas as pd
import requests

HEADERS = {"User-Agent": "Mozilla/5.0 analyse-portfolio/1.0 (educational project)"}
ROOT = os.path.dirname(os.path.abspath(__file__))
UNIVERSE_FILE = os.path.join(ROOT, "universe.json")
FRONT_FILE = os.path.join(ROOT, "frontend", "src", "data", "universe.json")

# (clé, url, marché, suffixe Yahoo à ajouter si absent, pays)
WIKI_SOURCES = [
    ("sp500", "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies", "US", "", "États-Unis"),
    ("sp400", "https://en.wikipedia.org/wiki/List_of_S%26P_400_companies", "US", "", "États-Unis"),
    ("cac40", "https://en.wikipedia.org/wiki/CAC_40", "Europe", ".PA", "France"),
    ("dax", "https://en.wikipedia.org/wiki/DAX", "Europe", ".DE", "Allemagne"),
    ("mdax", "https://en.wikipedia.org/wiki/MDAX", "Europe", ".DE", "Allemagne"),
    ("ftse100", "https://en.wikipedia.org/wiki/FTSE_100_Index", "Europe", ".L", "Royaume-Uni"),
    ("ftse250", "https://en.wikipedia.org/wiki/FTSE_250_Index", "Europe", ".L", "Royaume-Uni"),
    ("es50", "https://en.wikipedia.org/wiki/Euro_Stoxx_50", "Europe", "", None),
    ("smi", "https://en.wikipedia.org/wiki/Swiss_Market_Index", "Europe", ".SW", "Suisse"),
    ("aex", "https://en.wikipedia.org/wiki/AEX_index", "Europe", ".AS", "Pays-Bas"),
    ("ibex", "https://en.wikipedia.org/wiki/IBEX_35", "Europe", ".MC", "Espagne"),
    ("mib", "https://en.wikipedia.org/wiki/FTSE_MIB", "Europe", ".MI", "Italie"),
]

SUFFIX_COUNTRY = {
    ".PA": "France", ".DE": "Allemagne", ".F": "Allemagne", ".L": "Royaume-Uni", ".SW": "Suisse",
    ".AS": "Pays-Bas", ".MC": "Espagne", ".MI": "Italie", ".BR": "Belgique", ".HE": "Finlande",
    ".CO": "Danemark", ".ST": "Suède", ".OL": "Norvège", ".LS": "Portugal", ".IR": "Irlande",
    ".VI": "Autriche",
}

# --- Compléments actions (hors indices scrapés) -----------------------------
EXTRA_STOCKS = [
    # US / ADR populaires hors S&P 500
    ("ASML", "ASML (ADR)", "US"), ("TSM", "TSMC (ADR)", "US"), ("BABA", "Alibaba (ADR)", "US"),
    ("NVO", "Novo Nordisk (ADR)", "US"), ("SHOP", "Shopify", "US"), ("SPOT", "Spotify", "US"),
    ("MSTR", "MicroStrategy (Strategy)", "US"), ("RIVN", "Rivian", "US"), ("LCID", "Lucid", "US"),
    ("SOFI", "SoFi Technologies", "US"), ("HOOD", "Robinhood", "US"), ("ARM", "Arm Holdings", "US"),
    ("SNOW", "Snowflake", "US"), ("NET", "Cloudflare", "US"), ("XYZ", "Block (Square)", "US"),
    ("ZM", "Zoom", "US"), ("ROKU", "Roku", "US"), ("U", "Unity Software", "US"),
    ("RBLX", "Roblox", "US"), ("SNAP", "Snap", "US"), ("PINS", "Pinterest", "US"),
    ("MRNA", "Moderna", "US"), ("BNTX", "BioNTech (ADR)", "US"), ("NIO", "NIO (ADR)", "US"),
    ("PDD", "PDD Holdings (Temu)", "US"), ("JD", "JD.com (ADR)", "US"), ("BIDU", "Baidu (ADR)", "US"),
    ("SONY", "Sony (ADR)", "US"), ("TM", "Toyota (ADR)", "US"), ("SAP", "SAP (ADR)", "US"),
    ("SHEL", "Shell (ADR)", "US"), ("BP", "BP (ADR)", "US"), ("RIO", "Rio Tinto (ADR)", "US"),
    ("BHP", "BHP (ADR)", "US"), ("MELI", "MercadoLibre", "US"), ("SE", "Sea Limited", "US"),
    ("TEAM", "Atlassian", "US"), ("MDB", "MongoDB", "US"), ("OKTA", "Okta", "US"),
    ("DOCU", "DocuSign", "US"), ("TWLO", "Twilio", "US"), ("PATH", "UiPath", "US"),
    ("AFRM", "Affirm", "US"), ("UPST", "Upstart", "US"), ("MARA", "MARA Holdings", "US"),
    ("RIOT", "Riot Platforms", "US"), ("GME", "GameStop", "US"), ("AMC", "AMC Entertainment", "US"),
    ("BYND", "Beyond Meat", "US"), ("PLUG", "Plug Power", "US"), ("IONQ", "IonQ", "US"),
    ("RKLB", "Rocket Lab", "US"), ("ASTS", "AST SpaceMobile", "US"), ("CELH", "Celsius Holdings", "US"),
    ("DUOL", "Duolingo", "US"), ("CRWV", "CoreWeave", "US"), ("RDDT", "Reddit", "US"),
    ("SMCI", "Super Micro Computer", "US"), ("TCEHY", "Tencent (ADR)", "US"),
    # France (SBF 120 hors CAC 40)
    ("ALO.PA", "Alstom", "Europe"), ("AMUN.PA", "Amundi", "Europe"), ("BIM.PA", "bioMérieux", "Europe"),
    ("BOL.PA", "Bolloré", "Europe"), ("COFA.PA", "Coface", "Europe"), ("COV.PA", "Covivio", "Europe"),
    ("DIM.PA", "Sartorius Stedim Biotech", "Europe"), ("EDEN.PA", "Edenred", "Europe"),
    ("ELIS.PA", "Elis", "Europe"), ("ERA.PA", "Eramet", "Europe"),
    ("FGR.PA", "Eiffage", "Europe"), ("FR.PA", "Valeo", "Europe"), ("GET.PA", "Getlink", "Europe"),
    ("GFC.PA", "Gecina", "Europe"), ("ICAD.PA", "Icade", "Europe"), ("IPN.PA", "Ipsen", "Europe"),
    ("IPS.PA", "Ipsos", "Europe"), ("LI.PA", "Klépierre", "Europe"), ("MMB.PA", "Lagardère", "Europe"),
    ("NEX.PA", "Nexans", "Europe"), ("NK.PA", "Imerys", "Europe"), ("OVH.PA", "OVHcloud", "Europe"),
    ("RCO.PA", "Rémy Cointreau", "Europe"), ("RUI.PA", "Rubis", "Europe"), ("RXL.PA", "Rexel", "Europe"),
    ("SCR.PA", "SCOR", "Europe"), ("SESG.PA", "SES", "Europe"), ("SK.PA", "SEB", "Europe"),
    ("SOI.PA", "Soitec", "Europe"), ("SOP.PA", "Sopra Steria", "Europe"), ("SPIE.PA", "SPIE", "Europe"),
    ("TFI.PA", "TF1", "Europe"), ("UBI.PA", "Ubisoft", "Europe"), ("VIE.PA", "Veolia", "Europe"),
    ("VK.PA", "Vallourec", "Europe"), ("VRLA.PA", "Verallia", "Europe"), ("WLN.PA", "Worldline", "Europe"),
    ("AF.PA", "Air France-KLM", "Europe"), ("ATO.PA", "Atos", "Europe"), ("CO.PA", "Casino Guichard", "Europe"),
    ("DBV.PA", "DBV Technologies", "Europe"), ("FNAC.PA", "Fnac Darty", "Europe"), ("JCQ.PA", "Jacquet Metals", "Europe"),
    ("MDM.PA", "Maisons du Monde", "Europe"), ("NANO.PA", "Nanobiotix", "Europe"), ("PLX.PA", "Pluxee", "Europe"),
    ("TRI.PA", "Trigano", "Europe"), ("VIRP.PA", "Virbac", "Europe"), ("AYV.PA", "Ayvens", "Europe"),
    ("EXENS.PA", "Exosens", "Europe"), ("CRI.PA", "Chargeurs", "Europe"),
    # Autres Europe
    ("NOVO-B.CO", "Novo Nordisk", "Europe"), ("MAERSK-B.CO", "A.P. Møller-Mærsk", "Europe"),
    ("DSV.CO", "DSV", "Europe"), ("VWS.CO", "Vestas Wind Systems", "Europe"), ("ORSTED.CO", "Ørsted", "Europe"),
    ("CARL-B.CO", "Carlsberg", "Europe"), ("VOLV-B.ST", "Volvo", "Europe"), ("ERIC-B.ST", "Ericsson", "Europe"),
    ("ATCO-A.ST", "Atlas Copco", "Europe"), ("INVE-B.ST", "Investor AB", "Europe"), ("HM-B.ST", "H&M", "Europe"),
    ("EQNR.OL", "Equinor", "Europe"), ("DNB.OL", "DNB Bank", "Europe"),
    ("NOKIA.HE", "Nokia", "Europe"), ("NESTE.HE", "Neste", "Europe"), ("KNEBV.HE", "Kone", "Europe"),
    ("ABI.BR", "AB InBev", "Europe"), ("UCB.BR", "UCB", "Europe"), ("KBC.BR", "KBC Group", "Europe"),
    ("EDP.LS", "EDP", "Europe"), ("GALP.LS", "Galp Energia", "Europe"), ("OMV.VI", "OMV", "Europe"),
]

ETFS = [
    # Monde / US
    ("CW8.PA", "Amundi MSCI World (CW8)", ["msci world", "world", "amundi"]),
    ("EWLD.PA", "Amundi PEA MSCI World", ["msci world", "pea", "world"]),
    ("WPEA.PA", "iShares MSCI World PEA", ["msci world", "pea"]),
    ("DCAM.PA", "Amundi PEA Monde (DCAM)", ["msci world", "pea"]),
    ("IWDA.AS", "iShares Core MSCI World (IWDA)", ["msci world", "ishares"]),
    ("VWCE.DE", "Vanguard FTSE All-World (VWCE)", ["all world", "vanguard"]),
    ("SPY", "SPDR S&P 500", ["etf sp500", "sp500"]), ("VOO", "Vanguard S&P 500", ["sp500", "vanguard"]),
    ("IVV", "iShares Core S&P 500", ["sp500"]), ("VTI", "Vanguard Total Stock Market", ["total market"]),
    ("VT", "Vanguard Total World Stock", ["world"]), ("URTH", "iShares MSCI World (US)", ["world"]),
    ("QQQ", "Invesco QQQ (Nasdaq 100)", ["nasdaq", "tech"]), ("QQQM", "Invesco Nasdaq 100 (QQQM)", ["nasdaq"]),
    ("DIA", "SPDR Dow Jones", ["dow jones"]), ("IWM", "iShares Russell 2000", ["small caps", "russell"]),
    ("RSP", "Invesco S&P 500 Equal Weight", ["equal weight"]),
    ("ESE.PA", "BNP Paribas Easy S&P 500 (ESE)", ["sp500", "pea"]),
    ("PE500.PA", "Amundi PEA S&P 500", ["sp500", "pea"]), ("PUST.PA", "Amundi PEA Nasdaq-100", ["nasdaq", "pea"]),
    ("CSPX.L", "iShares Core S&P 500 (CSPX)", ["sp500"]), ("SXR8.DE", "iShares Core S&P 500 (SXR8)", ["sp500"]),
    ("EQQQ.PA", "Invesco EQQQ Nasdaq-100", ["nasdaq"]),
    # Régions
    ("EEM", "iShares MSCI Emerging Markets", ["emergents", "emerging"]),
    ("VWO", "Vanguard Emerging Markets", ["emergents"]), ("PAEEM.PA", "Amundi PEA Emergents", ["emergents", "pea"]),
    ("AEEM.PA", "Amundi MSCI Emerging Markets", ["emergents"]),
    ("VGK", "Vanguard FTSE Europe", ["europe"]), ("EZU", "iShares MSCI Eurozone", ["zone euro"]),
    ("CAC.PA", "Amundi CAC 40", ["cac", "france"]), ("MSE.PA", "Amundi Euro Stoxx 50", ["euro stoxx"]),
    ("EWJ", "iShares MSCI Japan", ["japon", "japan"]), ("FXI", "iShares China Large-Cap", ["chine", "china"]),
    ("MCHI", "iShares MSCI China", ["chine"]), ("INDA", "iShares MSCI India", ["inde", "india"]),
    ("EWZ", "iShares MSCI Brazil", ["bresil"]),
    # Secteurs / thèmes
    ("XLK", "Technology Select Sector SPDR", ["tech"]), ("XLF", "Financial Select Sector SPDR", ["banques", "finance"]),
    ("XLE", "Energy Select Sector SPDR", ["energie", "petrole"]), ("XLV", "Health Care Select Sector SPDR", ["sante"]),
    ("XLI", "Industrial Select Sector SPDR", ["industrie"]), ("XLY", "Consumer Discretionary SPDR", ["consommation"]),
    ("XLP", "Consumer Staples SPDR", ["consommation de base"]), ("XLU", "Utilities Select Sector SPDR", ["services publics"]),
    ("XLRE", "Real Estate Select Sector SPDR", ["immobilier"]), ("XLB", "Materials Select Sector SPDR", ["materiaux"]),
    ("SMH", "VanEck Semiconductor", ["semi-conducteurs", "puces"]), ("SOXX", "iShares Semiconductor", ["semi-conducteurs"]),
    ("ARKK", "ARK Innovation", ["innovation", "cathie wood"]), ("ICLN", "iShares Global Clean Energy", ["energie propre"]),
    ("TAN", "Invesco Solar", ["solaire"]), ("LIT", "Global X Lithium & Battery", ["lithium", "batterie"]),
    ("BOTZ", "Global X Robotics & AI", ["robotique", "ia"]), ("HACK", "Amplify Cybersecurity", ["cybersecurite"]),
    ("VNQ", "Vanguard Real Estate", ["immobilier", "reit"]),
    ("SCHD", "Schwab US Dividend Equity", ["dividendes"]), ("VIG", "Vanguard Dividend Appreciation", ["dividendes"]),
    ("VYM", "Vanguard High Dividend Yield", ["dividendes"]), ("JEPI", "JPMorgan Equity Premium Income", ["dividendes", "income"]),
    # Obligations
    ("TLT", "iShares 20+ Year Treasury", ["obligations", "bonds", "treasury"]),
    ("IEF", "iShares 7-10 Year Treasury", ["obligations"]), ("SHY", "iShares 1-3 Year Treasury", ["obligations court terme"]),
    ("AGG", "iShares Core US Aggregate Bond", ["obligations"]), ("BND", "Vanguard Total Bond Market", ["obligations"]),
    ("LQD", "iShares Investment Grade Corporate", ["obligations entreprises"]), ("HYG", "iShares High Yield Corporate", ["high yield"]),
    ("TIP", "iShares TIPS Bond", ["inflation"]), ("BIL", "SPDR 1-3 Month T-Bill", ["monetaire", "cash"]),
    # Matières premières / or / crypto
    ("GLD", "SPDR Gold Shares", ["or", "gold"]), ("IAU", "iShares Gold Trust", ["or", "gold"]),
    ("SLV", "iShares Silver Trust", ["argent", "silver"]), ("USO", "United States Oil Fund", ["petrole"]),
    ("DBC", "Invesco DB Commodity", ["matieres premieres"]), ("GDX", "VanEck Gold Miners", ["mines d'or"]),
    ("IBIT", "iShares Bitcoin Trust", ["bitcoin etf"]), ("FBTC", "Fidelity Wise Origin Bitcoin", ["bitcoin etf"]),
    ("ETHA", "iShares Ethereum Trust", ["ethereum etf"]),
    # Levier
    ("TQQQ", "ProShares UltraPro QQQ (x3)", ["levier", "x3"]), ("SQQQ", "ProShares UltraPro Short QQQ (-3x)", ["short"]),
    ("SPXL", "Direxion S&P 500 Bull 3x", ["levier"]), ("LQQ.PA", "Amundi Nasdaq-100 Daily (2x) Leveraged", ["levier", "pea"]),
    ("CL2.PA", "Amundi MSCI USA Daily (2x) Leveraged", ["levier", "pea"]),
]

INDICES = [
    ("^GSPC", "S&P 500", ["sp500", "us500", "spx"]), ("^IXIC", "Nasdaq Composite", ["nasdaq", "tech"]),
    ("^NDX", "Nasdaq 100", ["nasdaq 100", "ndx"]), ("^DJI", "Dow Jones", ["dow", "djia"]),
    ("^RUT", "Russell 2000", ["small caps"]), ("^VIX", "VIX (Volatilité)", ["peur", "volatilite"]),
    ("^FCHI", "CAC 40", ["cac", "france", "paris"]), ("^GDAXI", "DAX 40", ["allemagne", "germany"]),
    ("^FTSE", "FTSE 100", ["londres", "uk"]), ("^STOXX50E", "Euro Stoxx 50", ["europe", "zone euro"]),
    ("^STOXX", "Stoxx Europe 600", ["europe 600"]), ("^IBEX", "IBEX 35", ["espagne"]),
    ("FTSEMIB.MI", "FTSE MIB", ["italie"]), ("^AEX", "AEX", ["pays-bas"]), ("^SSMI", "SMI", ["suisse"]),
    ("^N225", "Nikkei 225", ["japon"]), ("^HSI", "Hang Seng", ["hong kong", "chine"]),
    ("000001.SS", "Shanghai Composite", ["chine", "shanghai"]), ("^BSESN", "Sensex", ["inde"]),
    ("^KS11", "KOSPI", ["coree"]), ("^AXJO", "ASX 200", ["australie"]), ("^BVSP", "Bovespa", ["bresil"]),
    ("^GSPTSE", "S&P/TSX", ["canada"]), ("^TNX", "Taux US 10 ans", ["taux", "treasury yield"]),
    ("^IRX", "Taux US 3 mois", ["taux court"]), ("DX-Y.NYB", "Dollar Index (DXY)", ["dollar", "dxy"]),
]

CRYPTOS = [
    ("BTC", "Bitcoin", ["satoshis"]), ("ETH", "Ethereum", ["ether"]), ("SOL", "Solana", []),
    ("XRP", "Ripple (XRP)", ["ripple"]), ("BNB", "BNB (Binance)", ["binance"]), ("ADA", "Cardano", []),
    ("DOGE", "Dogecoin", ["doge"]), ("TRX", "TRON", []), ("AVAX", "Avalanche", []),
    ("DOT", "Polkadot", []), ("LINK", "Chainlink", []), ("LTC", "Litecoin", []),
    ("BCH", "Bitcoin Cash", []), ("XLM", "Stellar", []), ("ATOM", "Cosmos", []),
    ("UNI7083", "Uniswap", ["uni"]), ("XMR", "Monero", []), ("ETC", "Ethereum Classic", []),
    ("HBAR", "Hedera", []), ("FIL", "Filecoin", []), ("ALGO", "Algorand", []),
    ("NEAR", "NEAR Protocol", []), ("AAVE", "Aave", []), ("SHIB", "Shiba Inu", []),
    ("PEPE24478", "Pepe", ["pepe"]), ("SUI20947", "Sui", ["sui"]), ("TON11419", "Toncoin", ["ton"]),
    ("APT21794", "Aptos", ["aptos"]), ("ARB11841", "Arbitrum", ["arbitrum"]), ("ICP", "Internet Computer", []),
    ("VET", "VeChain", []), ("XTZ", "Tezos", []), ("EOS", "EOS", []), ("MKR", "Maker", []),
    ("USDT", "Tether (stablecoin)", ["stablecoin"]), ("USDC", "USD Coin (stablecoin)", ["stablecoin"]),
]

FOREX = [
    ("EURUSD=X", "EUR/USD", ["euro dollar"]), ("GBPUSD=X", "GBP/USD", ["cable", "livre"]),
    ("USDJPY=X", "USD/JPY", ["yen"]), ("USDCHF=X", "USD/CHF", ["franc suisse"]),
    ("AUDUSD=X", "AUD/USD", ["aussie"]), ("USDCAD=X", "USD/CAD", ["loonie"]),
    ("NZDUSD=X", "NZD/USD", ["kiwi"]), ("EURGBP=X", "EUR/GBP", []), ("EURJPY=X", "EUR/JPY", []),
    ("EURCHF=X", "EUR/CHF", []), ("GBPJPY=X", "GBP/JPY", []), ("EURCAD=X", "EUR/CAD", []),
    ("EURAUD=X", "EUR/AUD", []), ("USDCNY=X", "USD/CNY", ["yuan"]), ("USDMXN=X", "USD/MXN", ["peso"]),
    ("USDTRY=X", "USD/TRY", ["livre turque"]), ("USDINR=X", "USD/INR", ["roupie"]),
    ("USDBRL=X", "USD/BRL", ["real"]), ("USDZAR=X", "USD/ZAR", ["rand"]), ("USDSEK=X", "USD/SEK", []),
    ("USDNOK=X", "USD/NOK", []), ("USDSGD=X", "USD/SGD", []), ("USDHKD=X", "USD/HKD", []),
]

COMMODITIES = [
    ("GC=F", "Or (Gold)", ["or", "gold", "metal"]), ("SI=F", "Argent (Silver)", ["argent", "silver"]),
    ("PL=F", "Platine", ["platinum"]), ("PA=F", "Palladium", []), ("HG=F", "Cuivre (Copper)", ["cuivre", "copper"]),
    ("CL=F", "Pétrole WTI", ["petrole", "oil", "wti", "crude"]), ("BZ=F", "Pétrole Brent", ["brent", "petrole"]),
    ("NG=F", "Gaz naturel", ["gaz", "gas"]), ("RB=F", "Essence RBOB", ["essence"]), ("HO=F", "Fioul (Heating oil)", ["fioul"]),
    ("ZC=F", "Maïs (Corn)", ["mais", "corn"]), ("ZW=F", "Blé (Wheat)", ["ble", "wheat"]), ("ZS=F", "Soja (Soybeans)", ["soja"]),
    ("KC=F", "Café (Coffee)", ["cafe"]), ("CC=F", "Cacao (Cocoa)", ["cacao", "chocolat"]), ("SB=F", "Sucre (Sugar)", ["sucre"]),
    ("CT=F", "Coton (Cotton)", ["coton"]), ("OJ=F", "Jus d'orange", ["orange"]), ("LE=F", "Bétail (Live cattle)", ["boeuf"]),
    ("HE=F", "Porc (Lean hogs)", ["porc"]),
]


def _get_tables(url):
    r = requests.get(url, headers=HEADERS, timeout=25)
    r.raise_for_status()
    return pd.read_html(io.StringIO(r.text))


def _pick_columns(df):
    cols = {str(c).lower(): c for c in df.columns}
    tick = next((cols[c] for c in cols if c.startswith(("symbol", "ticker", "epic"))), None)
    name = next((cols[c] for c in cols if c.startswith(("security", "company", "name"))), None)
    sector = next((cols[c] for c in cols if "sector" in c or "industry" in c), None)
    return tick, name, sector


KNOWN_SUFFIXES = {"PA", "DE", "L", "SW", "AS", "MC", "MI", "F", "BR", "HE", "CO", "ST", "IR", "LS", "VI", "OL"}


def _normalize_ticker(raw, suffix):
    t = str(raw).strip().upper().replace("\xa0", " ")
    t = re.sub(r"\[.*?\]", "", t).strip()
    if not t or t == "NAN" or " " in t and not suffix:
        return None
    t = t.split(" ")[0]
    if "." in t and t.rsplit(".", 1)[1] in KNOWN_SUFFIXES:
        return t
    if suffix:
        # BT.A -> BT-A.L ; NOVN -> NOVN.SW
        return t.replace(".", "-").rstrip("-") + suffix
    return t.replace(".", "-")


def scrape_index(url, suffix):
    rows = []
    for df in _get_tables(url):
        if len(df) < 15:
            continue
        tick, name, sector = _pick_columns(df)
        if tick is None or name is None:
            continue
        for _, r in df.iterrows():
            t = _normalize_ticker(r[tick], suffix)
            n = str(r[name]).strip()
            if not t or n.lower() == "nan" or len(t) > 15:
                continue
            rows.append({"ticker": t, "name": n, "sector": (str(r[sector]).strip() if sector is not None and str(r[sector]) != "nan" else None)})
        if rows:
            break
    return rows


def country_for(ticker, default):
    for suf, c in SUFFIX_COUNTRY.items():
        if ticker.endswith(suf):
            return c
    return default or "États-Unis"


def build_universe(verbose=True):
    assets = {}

    def add(ticker, name, category, market, country=None, sector=None, aliases=None, index=None):
        key = ticker.upper()
        if key in assets:
            if index and index not in assets[key]["indices"]:
                assets[key]["indices"].append(index)
            return
        assets[key] = {
            "ticker": key, "name": name, "category": category, "market": market,
            "country": country, "sector": sector, "aliases": aliases or [],
            "indices": [index] if index else [],
        }

    for key, url, market, suffix, country in WIKI_SOURCES:
        try:
            rows = scrape_index(url, suffix)
            if verbose:
                print(f"  {key}: {len(rows)} actions")
            for r in rows:
                add(r["ticker"], r["name"], "Actions", market, country_for(r["ticker"], country), r["sector"], index=key)
        except Exception as e:
            print(f"  {key}: échec ({e})")

    for t, n, m in EXTRA_STOCKS:
        add(t, n, "Actions", m, country_for(t, None if m == "Europe" else "États-Unis"))
    for t, n, a in ETFS:
        add(t, n, "ETF", "ETF", country_for(t, "États-Unis"), aliases=a)
    for t, n, a in INDICES:
        add(t, n, "Indices", "Indices", aliases=a)
    for sym, n, a in CRYPTOS:
        add(f"{sym}-USD", n, "Crypto", "Crypto", aliases=[sym.lower()] + a)
    for t, n, a in FOREX:
        add(t, n, "Forex", "Forex", aliases=a)
    for t, n, a in COMMODITIES:
        add(t, n, "Matières 1ères", "Matières 1ères", aliases=a)

    return list(assets.values())


def save_universe(assets):
    with open(UNIVERSE_FILE, "w", encoding="utf-8") as f:
        json.dump(assets, f, ensure_ascii=False, indent=0)
    os.makedirs(os.path.dirname(FRONT_FILE), exist_ok=True)
    # Version compacte pour le frontend : [ticker, nom, catégorie, pays, alias?]
    compact = [[a["ticker"], a["name"], a["category"], a["country"] or ""] + ([a["aliases"]] if a["aliases"] else [])
               for a in assets]
    with open(FRONT_FILE, "w", encoding="utf-8") as f:
        json.dump(compact, f, ensure_ascii=False, separators=(",", ":"))


def load_universe():
    if not os.path.exists(UNIVERSE_FILE):
        assets = build_universe()
        save_universe(assets)
        return assets
    with open(UNIVERSE_FILE, encoding="utf-8") as f:
        return json.load(f)


if __name__ == "__main__":
    print("Construction de l'univers d'actifs...")
    universe = build_universe()
    save_universe(universe)
    by_cat = {}
    for a in universe:
        by_cat[a["category"]] = by_cat.get(a["category"], 0) + 1
    print(f"Univers : {len(universe)} actifs -> {by_cat}")
