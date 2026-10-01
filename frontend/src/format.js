export const API = 'http://127.0.0.1:8000';

export const COLORS = ['#2962ff', '#089981', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#10b981', '#ef4444', '#eab308', '#6366f1'];

const formatters = new Map();
function nf(nd) {
  if (!formatters.has(nd)) {
    formatters.set(nd, new Intl.NumberFormat('fr-FR', { minimumFractionDigits: nd, maximumFractionDigits: nd }));
  }
  return formatters.get(nd);
}

/** Nombre au format français ; '—' si absent. */
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
  return v >= 1000 ? `${fmt(v / 1000, 1)} Md` : `${fmt(v, 1)} M`;
}

/** Accepte « 12,5 » comme « 12.5 ». */
export function parseNum(v) {
  if (v === null || v === undefined || v === '') return NaN;
  return parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
}

export const signColor = (v) => (v === null || v === undefined ? undefined : v >= 0 ? 'var(--green)' : 'var(--red)');

export const TAG_COLORS = {
  'Actions': '#38bdf8', 'Indices': '#a78bfa', 'ETF': '#34d399', 'Crypto': '#fbbf24',
  'Matières 1ères': '#f472b6', 'Forex': '#2dd4bf',
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

export const horizonLabel = (days) => HORIZONS.find(h => h.value === String(days))?.label || `${days} séances`;
