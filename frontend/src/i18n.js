import { createContext, useContext } from 'react';
import axios from 'axios';
import EN_RAW from './i18n/en';

// Espaces insécables (typographie française autour de « » : ; ?) ignorés pour la recherche des clés
const normKey = (k) => k.replace(/[\u00a0\u202f]/g, ' ');
const EN = Object.fromEntries(Object.entries(EN_RAW).map(([k, v]) => [normKey(k), v]));
// Le détecteur d'oublis ne signale que les textes visiblement français (pas ceux déjà traduits par le serveur)
const looksFrench = (s) => /[àâçéèêëîïôûùüœ«»]|\b(le|la|les|des|du|un|une|et|est|sur|pour|avec)\b/i.test(s);

/**
 * Traduction FR -> EN. Le texte français sert de clé : t('Analyser') -> 'Analyze' en anglais.
 * Variables : t('Du {a} au {b}', { a, b }). Une clé absente du dictionnaire reste en français
 * (et est signalée en développement dans window.__missingI18n pour qu'on la traduise).
 */
const STORAGE_KEY = 'lang';
const initial = (() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'fr' || saved === 'en') return saved;
  } catch { /* stockage indisponible */ }
  return navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
})();

let current = initial;

// Taux sans risque : 'market' (bon du Trésor US 3 mois, par défaut) ou 'fixed' (ancien taux fixe de 2 %)
let rfMode = (() => { try { return localStorage.getItem('rfMode') === 'fixed' ? 'fixed' : 'market'; } catch { return 'market'; } })();
export const getRfMode = () => rfMode;
export function setRfMode(m) {
  rfMode = m;
  try { localStorage.setItem('rfMode', m); } catch { /* stockage indisponible */ }
}
export const getLang = () => current;
export const getLocale = () => (current === 'en' ? 'en-US' : 'fr-FR');

// Chaque requête vers l'API précise la langue : interprétations et explications reviennent traduites
axios.interceptors.request.use((cfg) => {
  cfg.params = { ...(cfg.params || {}), lang: current, rf: rfMode };
  return cfg;
});

const missing = new Set();
export function tr(fr, vars) {
  if (fr === null || fr === undefined) return fr;
  let s = fr;
  if (current === 'en') {
    const en = EN[normKey(fr)];
    if (en === undefined) {
      if (import.meta.env.DEV && !missing.has(fr) && looksFrench(fr)) {
        missing.add(fr);
        window.__missingI18n = [...missing];
      }
    } else s = en;
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  return s;
}

/** Traduction sans signalement des absences : noms d'actifs, pays… (la plupart sont déjà internationaux). */
export function trName(v) {
  if (current !== 'en' || !v) return v;
  const en = EN[normKey(v)];
  return en !== undefined ? en : v;
}

export const LangContext = createContext({ lang: initial, setLang: () => {}, t: tr });

/** Appelé par LangProvider : change la langue utilisée par tr(), les formats et les requêtes. */
export function setCurrentLang(l) {
  current = l;
  try { localStorage.setItem(STORAGE_KEY, l); } catch { /* stockage indisponible */ }
  document.documentElement.lang = l;
}
export const initialLang = initial;

export const useLang = () => useContext(LangContext);
