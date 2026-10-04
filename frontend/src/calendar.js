import axios from 'axios';
import { API } from './format';
import { getLang, getLocale, tr } from './i18n';

// Code couleur inspiré de Forex Factory : rouge = fort, orange = moyen, jaune = faible, gris = férié
export const IMPACT = {
  High: { label: 'Fort', color: '#c42b1c', rank: 3 },
  Medium: { label: 'Moyen', color: '#d86b00', rank: 2 },
  Low: { label: 'Faible', color: '#b89a00', rank: 1 },
  Holiday: { label: 'Férié', color: '#8a8f8b', rank: 0 },
};
// Le libellé est traduit à l'affichage (clé française)
export const impactOf = (i) => {
  const m = IMPACT[i] || { label: i, color: '#69716c', rank: 0 };
  return { ...m, label: tr(m.label) };
};

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
