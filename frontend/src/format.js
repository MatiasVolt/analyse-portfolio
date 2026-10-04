import { getLocale, tr } from './i18n';

export const API = 'http://127.0.0.1:8000';

export const COLORS = ['#e0a43a', '#2bb3a3', '#e8735a', '#7f9cc4', '#a3b84a', '#c98fb0', '#d9c27a', '#5fa37a', '#b0805a', '#9a9aa2'];

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

export function fmtMoney(v, currency = '€', nd = 0) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  return `${fmt(v, nd)} ${currency}`;
}

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
  'Actions': '#9fb4cc', 'Indices': '#d2d2d6', 'ETF': '#5fbf8f', 'Crypto': '#e0a43a',
  'Matières 1ères': '#c98f5a', 'Forex': '#2bb3a3',
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
  { value: '1mo', label: '1M' }, { value: '6mo', label: '6M' }, { value: 'ytd', label: 'YTD' },
  { value: '1y', label: '1A' }, { value: '2y', label: '2A' }, { value: '5y', label: '5A' },
  { value: '10y', label: '10A' }, { value: 'max', label: 'MAX' },
];

export const HORIZONS = [
  { value: '21', label: '1 mois' }, { value: '63', label: '3 mois' }, { value: '252', label: '1 an' },
  { value: '756', label: '3 ans' }, { value: '1260', label: '5 ans' }, { value: '2520', label: '10 ans' },
];

export const horizonLabel = (days) => tr(HORIZONS.find(h => h.value === String(days))?.label || '{n} séances', { n: days });
