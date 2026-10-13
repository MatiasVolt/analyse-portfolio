import axios from 'axios';
import { API } from './format';
import { getLang, getLocale, tr } from './i18n';

// Importance d'une annonce sur 5 niveaux (échelle du site : type d'indicateur × poids de la zone économique), 0 = jour férié.
// Couleurs : du rouge (majeure) au gris (mineure), dans l'esprit de Forex Factory.
export const LEVELS = {
  5: { label: 'Majeure', color: '#c42b1c' },
  4: { label: 'Forte', color: '#d86b00' },
  3: { label: 'Moyenne', color: '#b89a00' },
  2: { label: 'Faible', color: '#6f8f5f' },
  1: { label: 'Mineure', color: '#8a8f8b' },
  0: { label: 'Férié', color: '#8a8f8b' },
};
/** Niveau d'une annonce (les copies locales anciennes n'ont que le classement de la source). */
export const levelOf = (e) => e.level ?? ({ High: 4, Medium: 3, Low: 1, Holiday: 0 }[e.impact] ?? 1);
// Le libellé est traduit à l'affichage (clé française)
export const impactOf = (level) => {
  const m = LEVELS[level] || LEVELS[1];
  return { ...m, rank: level, label: tr(m.label) };
};
/** Classement d'origine de la source, affiché à côté du nôtre. */
export const SOURCE_IMPACT = { High: 'fort', Medium: 'moyen', Low: 'faible' };

// Petit cache mémoire : plusieurs onglets lisent les mêmes données sans refaire d'appel
const cache = new Map();
const TTL = 5 * 60 * 1000;

export function fetchCalendar(params = {}) {
  const key = JSON.stringify({ ...params, lang: getLang() });
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.promise;
  const promise = axios.get(`${API}/api/calendar`, { params }).then(r => r.data);
  promise.catch(() => cache.delete(key));
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

export const eventTime = (e) => new Date(e.datetime).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
export const eventDayKey = (e) => new Date(e.datetime).toLocaleDateString('sv-SE');
export const dayLabel = (iso) => {
  const s = new Date(`${iso}T12:00:00`).toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** « dans 2 h 14 », « dans 3 j » */
export function countdown(ts) {
  const s = Math.round(ts - Date.now() / 1000);
  if (s <= 0) return tr('maintenant');
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return tr('dans {d} j {h} h', { d, h });
  if (h > 0) return tr('dans {h} h {m}', { h, m: String(m).padStart(2, '0') });
  return tr('dans {m} min', { m });
}
