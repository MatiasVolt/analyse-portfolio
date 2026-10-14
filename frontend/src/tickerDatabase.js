// frontend/src/tickerDatabase.js
// Bibliothèque de tickers = liste curée (alias + priorité d'affichage) + univers généré par `python universe.py`
// (S&P 500, S&P 400, CAC 40, SBF 120, DAX, MDAX, FTSE 100/250, Euro Stoxx 50, SMI, AEX, IBEX, FTSE MIB,
//  ETF, indices, crypto, forex, matières premières : ~1 800 actifs).
import UNIVERSE from './data/universe.json';

// tier 1 = remonte en premier dans les suggestions
const CURATED = [
  { ticker: "AAPL", name: "Apple", category: "Actions", tier: 1, aliases: ["aple", "iphone", "mac", "apple inc"] },
  { ticker: "MSFT", name: "Microsoft", category: "Actions", tier: 1, aliases: ["windows", "xbox", "bill gates"] },
  { ticker: "NVDA", name: "Nvidia", category: "Actions", tier: 1, aliases: ["geforce", "gpu", "ia", "nvidia"] },
  { ticker: "AMZN", name: "Amazon", category: "Actions", tier: 1, aliases: ["prime", "aws", "bezos"] },
  { ticker: "GOOGL", name: "Alphabet (Google)", category: "Actions", tier: 1, aliases: ["google", "youtube"] },
  { ticker: "META", name: "Meta Platforms", category: "Actions", tier: 1, aliases: ["facebook", "instagram", "whatsapp"] },
  { ticker: "TSLA", name: "Tesla", category: "Actions", tier: 1, aliases: ["musk", "ev", "telsa"] },
  { ticker: "MC.PA", name: "LVMH", category: "Actions", tier: 1, aliases: ["lvmh", "vuitton", "luxe"] },
  { ticker: "TTE.PA", name: "TotalEnergies", category: "Actions", tier: 1, aliases: ["total", "petrole", "oil"] },
  { ticker: "^GSPC", name: "S&P 500", category: "Indices", tier: 1, aliases: ["sp500", "us500", "spx", "s&p"] },
  { ticker: "^IXIC", name: "Nasdaq Composite", category: "Indices", tier: 1, aliases: ["nasdaq", "tech"] },
  { ticker: "^NDX", name: "Nasdaq 100", category: "Indices", tier: 1, aliases: ["nasdaq 100", "ndx"] },
  { ticker: "^FCHI", name: "CAC 40", category: "Indices", tier: 1, aliases: ["cac", "france", "paris"] },
  { ticker: "BTC-USD", name: "Bitcoin", category: "Crypto", tier: 1, aliases: ["btc", "crypto", "satoshis"] },
  { ticker: "ETH-USD", name: "Ethereum", category: "Crypto", tier: 1, aliases: ["eth", "ether"] },
  { ticker: "GC=F", name: "Or (Gold)", category: "Matières 1ères", tier: 1, aliases: ["or", "gold", "metal"] },
  { ticker: "SI=F", name: "Argent (Silver)", category: "Matières 1ères", tier: 1, aliases: ["argent", "silver"] },
  { ticker: "CL=F", name: "Pétrole WTI", category: "Matières 1ères", tier: 1, aliases: ["petrole", "oil", "wti", "crude"] },
  { ticker: "CW8.PA", name: "Amundi MSCI World (CW8)", category: "ETF", tier: 1, aliases: ["msci world", "world", "amundi"] },
  { ticker: "SPY", name: "SPDR S&P 500", category: "ETF", tier: 1, aliases: ["spy", "etf sp500"] },
  { ticker: "QQQ", name: "Invesco QQQ (Nasdaq 100)", category: "ETF", tier: 1, aliases: ["qqq", "etf tech"] },

  { ticker: "OR.PA", name: "L'Oréal", category: "Actions", tier: 2, aliases: ["loreal", "beaute", "cosmetique"] },
  { ticker: "RMS.PA", name: "Hermès International", category: "Actions", tier: 2, aliases: ["hermes"] },
  { ticker: "AIR.PA", name: "Airbus", category: "Actions", tier: 2, aliases: ["aerien", "avion"] },
  { ticker: "BNP.PA", name: "BNP Paribas", category: "Actions", tier: 2, aliases: ["banque", "bnp"] },
  { ticker: "AI.PA", name: "Air Liquide", category: "Actions", tier: 2, aliases: ["airliquide", "gaz"] },
  { ticker: "SAN.PA", name: "Sanofi", category: "Actions", tier: 2, aliases: ["sante", "pharma"] },
  { ticker: "ASML.AS", name: "ASML Holding", category: "Actions", tier: 2, aliases: ["semiconducteur", "puces"] },
  { ticker: "BRK-B", name: "Berkshire Hathaway", category: "Actions", tier: 2, aliases: ["buffett", "berkshire"] },
  { ticker: "JPM", name: "JPMorgan Chase", category: "Actions", tier: 2, aliases: ["jpmorgan", "banque us"] },
  { ticker: "V", name: "Visa", category: "Actions", tier: 2, aliases: ["paiement"] },
  { ticker: "WMT", name: "Walmart", category: "Actions", tier: 2, aliases: ["distribution"] },
  { ticker: "SOL-USD", name: "Solana", category: "Crypto", tier: 2, aliases: ["sol"] },
  { ticker: "VWCE.DE", name: "Vanguard FTSE All-World (VWCE)", category: "ETF", tier: 2, aliases: ["all world", "vanguard", "vwce"] },
  { ticker: "^STOXX50E", name: "Euro Stoxx 50", category: "Indices", tier: 2, aliases: ["stoxx", "europe", "sx5e"] },
  { ticker: "^GDAXI", name: "DAX 40", category: "Indices", tier: 2, aliases: ["dax", "allemagne"] },
  { ticker: "EURUSD=X", name: "EUR/USD", category: "Forex", tier: 2, aliases: ["euro dollar", "forex"] },

  { ticker: "KER.PA", name: "Kering", category: "Actions", tier: 3, aliases: ["gucci", "luxe"] },
  { ticker: "CAP.PA", name: "Capgemini", category: "Actions", tier: 3, aliases: ["it", "conseil"] },
  { ticker: "SAF.PA", name: "Safran", category: "Actions", tier: 3, aliases: ["aero", "defense"] },
  { ticker: "AMD", name: "AMD", category: "Actions", tier: 3, aliases: ["ryzen", "gpu", "advanced micro devices"] },
  { ticker: "INTC", name: "Intel", category: "Actions", tier: 3, aliases: ["processeur"] },
  { ticker: "NFLX", name: "Netflix", category: "Actions", tier: 3, aliases: ["streaming"] },
  { ticker: "DIS", name: "Walt Disney", category: "Actions", tier: 3, aliases: ["disney"] },
  { ticker: "HG=F", name: "Cuivre (Copper)", category: "Matières 1ères", tier: 3, aliases: ["cuivre", "copper"] },
  { ticker: "NG=F", name: "Gaz naturel", category: "Matières 1ères", tier: 3, aliases: ["gaz", "gas"] },
  { ticker: "XRP-USD", name: "Ripple (XRP)", category: "Crypto", tier: 3, aliases: ["xrp"] },
];

// Priorité par défaut des actifs générés (les catégories "rares" remontent avant les 1 600 actions)
const DEFAULT_TIER = { Indices: 3, ETF: 3, Crypto: 3, Forex: 4, 'Matières 1ères': 3, Actions: 5 };

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function buildDatabase() {
  const byTicker = new Map();
  for (const a of CURATED) byTicker.set(a.ticker.toUpperCase(), { ...a, country: '' });
  for (const [ticker, name, category, country, aliases] of UNIVERSE) {
    const key = ticker.toUpperCase();
    const existing = byTicker.get(key);
    if (existing) {
      existing.country = existing.country || country;
      if (aliases) existing.aliases = [...new Set([...(existing.aliases || []), ...aliases])];
      continue;
    }
    byTicker.set(key, { ticker, name, category, country, tier: DEFAULT_TIER[category] ?? 5, aliases: aliases || [] });
  }
  // Index de recherche pré-calculé une seule fois (au lieu de re-normaliser à chaque frappe)
  return [...byTicker.values()].map(a => ({
    ...a,
    _t: a.ticker.toLowerCase(),
    _n: norm(a.name),
    _a: (a.aliases || []).map(norm),
  }));
}

export const ASSET_DATABASE = buildDatabase();
const BY_TICKER = new Map(ASSET_DATABASE.map(a => [a.ticker.toUpperCase(), a]));

export function getAsset(ticker) {
  return ticker ? BY_TICKER.get(String(ticker).toUpperCase()) : undefined;
}

export const DEFAULT_SUGGESTIONS = ASSET_DATABASE.filter(a => a.tier === 1).slice(0, 8);

// Mots qui désignent une catégorie entière (« action », « crypto »…) : la recherche liste alors les actifs de cette catégorie
const CATEGORY_WORDS = {
  Actions: ['action', 'actions', 'stock', 'stocks', 'equity', 'equities', 'titre', 'titres'],
  Indices: ['indice', 'indices', 'index', 'indexes'],
  ETF: ['etf', 'etfs', 'tracker', 'trackers'],
  Crypto: ['crypto', 'cryptos', 'cryptomonnaie', 'cryptomonnaies', 'crypto-monnaie', 'crypto-monnaies', 'cryptocurrency', 'cryptocurrencies'],
  Forex: ['forex', 'fx', 'devise', 'devises', 'paire', 'paires', 'currency', 'currencies'],
  'Matières 1ères': ['matiere', 'matieres', 'matiere premiere', 'matieres premieres', 'matieres 1eres', 'matiere 1ere', 'commodity', 'commodities'],
};
const WORD_TO_CATEGORY = new Map(Object.entries(CATEGORY_WORDS).flatMap(([cat, words]) => words.map(w => [w, cat])));

/**
 * Catégorie désignée par le texte tapé (« Actions », « crypto », « ETF »…), sinon null.
 * prefix : accepte aussi un début de mot d'au moins 3 lettres (« indic » -> Indices), s'il ne désigne qu'une catégorie.
 */
export function categoryOf(query, { prefix = false } = {}) {
  const q = norm(query).trim().replace(/\s+/g, ' ');
  const exact = WORD_TO_CATEGORY.get(q);
  if (exact || !prefix || q.length < 3) return exact || null;
  const cats = new Set([...WORD_TO_CATEGORY].filter(([w]) => w.startsWith(q)).map(([, c]) => c));
  return cats.size === 1 ? [...cats][0] : null;
}

/** Actifs d'une catégorie, les plus connus d'abord. */
export function assetsInCategory(category, limit = 40) {
  return ASSET_DATABASE.filter(a => a.category === category)
    .sort((x, y) => x.tier - y.tier || x.name.localeCompare(y.name))
    .slice(0, limit);
}

/** Recherche classée par pertinence : ticker exact > début de ticker > début de nom > mot du nom > alias > contient. */
/** maxScore : 3 = seulement les correspondances fortes (symbole, début du nom ou d'un mot du nom, alias exact). */
export function searchAssets(query, limit = 8, maxScore = 5) {
  const q = norm(query).trim();
  if (!q) return [];
  const scored = [];
  for (const a of ASSET_DATABASE) {
    let score;
    if (a._t === q) score = 0;
    else if (a._t.startsWith(q)) score = 1;
    else if (a._n.startsWith(q)) score = 2;
    else if (a._n.includes(' ' + q)) score = 3;
    else if (a._a.some(al => al === q)) score = 2;
    else if (a._a.some(al => al.startsWith(q))) score = 4;
    else if (a._n.includes(q) || a._t.includes(q)) score = 5;
    else continue;
    if (score > maxScore) continue;
    scored.push([score, a]);
  }
  scored.sort((x, y) => x[0] - y[0] || x[1].tier - y[1].tier || x[1].name.length - y[1].name.length);
  return scored.slice(0, limit).map(s => s[1]);
}
