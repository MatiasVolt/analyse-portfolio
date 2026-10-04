import { useSyncExternalStore } from 'react';

// Thème clair / sombre : suit le réglage du système tant que l'utilisateur n'a rien choisi, puis mémorise son choix
const STORAGE_KEY = 'theme';
const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches;

let current = (() => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* stockage indisponible */ }
  return systemDark() ? 'dark' : 'light';
})();

const listeners = new Set();
const apply = () => { document.documentElement.dataset.theme = current; };
apply();

export const getTheme = () => current;
export function setTheme(t) {
  current = t;
  try { localStorage.setItem(STORAGE_KEY, t); } catch { /* stockage indisponible */ }
  apply();
  listeners.forEach((l) => l());
}
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
export const useTheme = () => useSyncExternalStore(subscribe, getTheme);

// Couleurs des graphiques (les attributs SVG et le canvas des graphiques ne lisent pas les variables CSS)
const CHART = {
  light: {
    bg: '#ffffff', text: '#69716c', grid: '#e6e8e6', border: '#c6c9c6', strong: '#1f2421', faint: '#9aa29d',
    compare: '#7a837d', accent: '#1e7145', green: '#107c41', red: '#c42b1c', blue: '#2e75b6',
    legendBg: 'rgba(255,255,255,.94)', accentFill: 'rgba(30,113,69,.12)', accentBand: 'rgba(30,113,69,.07)',
  },
  dark: {
    bg: '#161a18', text: '#9aa39e', grid: '#262c29', border: '#3a423e', strong: '#e6ebe8', faint: '#6c756f',
    compare: '#8d968f', accent: '#3fb57a', green: '#3fb57a', red: '#ef5a4c', blue: '#5b9ee0',
    legendBg: 'rgba(22,26,24,.92)', accentFill: 'rgba(63,181,122,.16)', accentBand: 'rgba(63,181,122,.09)',
  },
};
export const chartColors = (t = current) => CHART[t];
export const useChartColors = () => CHART[useTheme()];

// Couleurs de série passées en dur par les vues (vert de l'identité, palette d'actifs…) : version lisible sur fond sombre
const DARK_SWAP = {
  '#1e7145': '#3fb57a', '#107c41': '#3fb57a', '#c42b1c': '#ef5a4c', '#2e75b6': '#5b9ee0', '#1f2421': '#e6ebe8',
  '#69716c': '#9aa39e', '#7a837d': '#8d968f', '#595959': '#a3a3a3', '#7f6000': '#c9a43a', '#7f7f7f': '#a6a6a6',
  '#7030a0': '#a678d6', '#c00000': '#ef5a4c', '#548235': '#86b866', '#c55a11': '#e88a4a', '#8a6d1f': '#c9a43a',
};
export const themed = (color, t = current) => (t === 'dark' && color ? DARK_SWAP[color.toLowerCase()] || color : color);
