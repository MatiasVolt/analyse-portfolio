/** Drapeaux en SVG (les émojis drapeaux ne s'affichent pas sous Windows). */
export function FlagFR({ size = 18 }) {
  return (
    <svg width={size} height={size * 2 / 3} viewBox="0 0 3 2" aria-hidden="true" style={{ display: 'block', borderRadius: 2 }}>
      <rect width="1" height="2" fill="#002654" /><rect x="1" width="1" height="2" fill="#fff" /><rect x="2" width="1" height="2" fill="#ce1126" />
    </svg>
  );
}
export function FlagUK({ size = 18 }) {
  return (
    <svg width={size} height={size * 2 / 3} viewBox="0 0 60 40" aria-hidden="true" style={{ display: 'block', borderRadius: 2 }}>
      <clipPath id="uk-clip"><rect width="60" height="40" /></clipPath>
      <g clipPath="url(#uk-clip)">
        <rect width="60" height="40" fill="#012169" />
        <path d="M0,0 L60,40 M60,0 L0,40" stroke="#fff" strokeWidth="8" />
        <path d="M0,0 L60,40 M60,0 L0,40" stroke="#C8102E" strokeWidth="3" />
        <path d="M30,0 V40 M0,20 H60" stroke="#fff" strokeWidth="12" />
        <path d="M30,0 V40 M0,20 H60" stroke="#C8102E" strokeWidth="7" />
      </g>
    </svg>
  );
}
