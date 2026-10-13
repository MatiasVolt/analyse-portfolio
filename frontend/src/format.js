import { getLocale, tr } from './i18n';

// Adresse de l'API : réglée par VITE_API_URL une fois en ligne (ex. https://api.mondomaine.com), le serveur local sinon
export const API = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

export const COLORS = ['#1e7145', '#2e75b6', '#c55a11', '#7f6000', '#7030a0', '#c00000', '#00a2c7', '#548235', '#bf9000', '#7f7f7f'];

// Formateurs mis en cache par langue + nombre de décimales
const formatters = new Map();
function nf(nd) {
  const key = `${getLocale()}|${nd}`;
  if (!formatters.has(key)) {
    formatters.set(key, new Intl.NumberFormat(getLocale(), { minimumFractionDigits: nd, maximumFractionDigits: nd }));
  }
  return formatters.get(key);
}

/** Nombre au format de la langue choisie (3,14 / 3.14) ; '—' si absent. */
export function fmt(v, nd = 2, signed = false) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  const s = nf(nd).format(n);
  return signed && n > 0 ? `+${s}` : s;
}

// Devises d'analyse proposées (cours convertis par l'API) et symboles d'affichage
export const CURRENCY_CODE = { '€': 'EUR', '$': 'USD' };
const CURRENCY_SYMBOL = { EUR: '€', USD: '$', GBP: '£', JPY: '¥' };
/** 'EUR' -> '€' ; une devise sans symbole courant garde son code ('CHF'). */
export const currencySymbol = (code) => (code ? CURRENCY_SYMBOL[code] || code : '');

/** Volumes en millions : 14 794 M -> « 14,8 Md » */
export function fmtMillions(v) {
  if (v === null || v === undefined) return '—';
  return v >= 1000 ? `${fmt(v / 1000, 1)} ${tr('Md')}` : `${fmt(v, 1)} M`;
}

/** Accepte « 12,5 » comme « 12.5 ». */
export function parseNum(v) {
  if (v === null || v === undefined || v === '') return NaN;
  return parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
}

/** « 2025-10-03 » -> « 3 oct. 2025 » (affichage uniquement ; renvoie la chaîne telle quelle si elle n'est pas une date ISO). */
export function fmtDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return iso ?? '—';
  return new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
}

/** Entier avec séparateur de milliers de la langue choisie. */
export const fmtInt = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString(getLocale()));

export const signColor = (v) => (v === null || v === undefined ? undefined : v >= 0 ? 'var(--green)' : 'var(--red)');

export const TAG_COLORS = {
  'Actions': '#2e75b6', 'Indices': '#595959', 'ETF': '#1e7145', 'Crypto': '#b85c00',
  'Matières 1ères': '#7f6000', 'Forex': '#00838f',
};

export const BENCHMARKS = [
  { value: '^GSPC', label: 'S&P 500 (US)' },
  { value: '^NDX', label: 'Nasdaq 100 (US)' },
  { value: 'URTH', label: 'MSCI World' },
  { value: '^STOXX50E', label: 'Euro Stoxx 50' },
  { value: '^FCHI', label: 'CAC 40 (FR)' },
  { value: '^GDAXI', label: 'DAX 40 (DE)' },
  { value: 'BTC-USD', label: 'Bitcoin (Crypto)' },
];

export const PERIODS = [
  { value: '1mo', label: '1M', title: '1 mois' }, { value: '6mo', label: '6M', title: '6 mois' }, { value: 'ytd', label: 'YTD', title: 'Depuis le 1er janvier' },
  { value: '1y', label: '1A', title: '1 an' }, { value: '2y', label: '2A', title: '2 ans' }, { value: '5y', label: '5A', title: '5 ans' },
  { value: '10y', label: '10A', title: '10 ans' }, { value: 'max', label: 'MAX', title: 'Tout l’historique disponible' },
];

export const HORIZONS = [
  { value: '21', label: '1 mois' }, { value: '63', label: '3 mois' }, { value: '252', label: '1 an' },
  { value: '756', label: '3 ans' }, { value: '1260', label: '5 ans' }, { value: '2520', label: '10 ans' },
];

export const horizonLabel = (days) => tr(HORIZONS.find(h => h.value === String(days))?.label || '{n} séances', { n: days });
