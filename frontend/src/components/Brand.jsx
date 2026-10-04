import { useLang } from '../i18n';

/** Logo : une courbe de rendement qui monte sur ses axes, avec un point doré à l'arrivée. */
export function BrandMark({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="brand-logo">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="rgba(255,255,255,.13)" stroke="rgba(255,255,255,.35)" strokeWidth="1" />
      <path d="M6 23 L6 25.5 L26 25.5" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".45" strokeLinecap="round" />
      <path d="M7.5 21.5 C 11 21, 13 18.8, 15 16 S 19.5 10.6, 23.5 10.2" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="23.5" cy="10.2" r="2.8" fill="var(--brand-gold)" />
    </svg>
  );
}

/** Nom du site en logotype : « The Yield Is Yours », avec « Yield » mis en valeur. */
export default function Brand({ section, onHome }) {
  const { t } = useLang();
  return (
    <a className="brand" href="/" title={t('Retour à l’accueil')} onClick={(e) => { e.preventDefault(); onHome?.(); }}>
      <BrandMark />
      <span className="brand-name">The <em>Yield</em> Is Yours</span>
      {section && <span className="brand-file">{section}</span>}
    </a>
  );
}
