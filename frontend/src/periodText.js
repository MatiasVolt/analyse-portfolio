import { fmt } from './format';

/** Sous le rendement : « soit X % par an » seulement si la période dépasse un an (sinon le chiffre annuel n'apporte rien ou extrapole). */
export function annualNote(t, m) {
  const y = m.period_years ?? 0;
  if (y >= 1.1) return t('soit {v} % par an en moyenne', { v: fmt(m.cagr_pct, 2, true) });
  if (y >= 0.9) return t('sur un an');
  return t('sur {n} mois', { n: Math.max(1, Math.round(y * 12)) });
}

/** Pied du tableau : nombre de séances réellement observées et facteur d'annualisation (norme de marché). */
export function periodFooter(t, m) {
  const crypto = m.periods_per_year >= 365;
  return t(crypto ? 'Calculé sur {n} jours de cotation · annualisation : 365 jours par an (la crypto cote tous les jours)'
    : 'Calculé sur {n} séances de cotation (jours fériés exclus) · annualisation : 252 séances par an, la convention des marchés', { n: m.observations });
}
