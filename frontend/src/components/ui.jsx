import { useRef, useState, memo } from 'react';
import { Info, BookOpen } from 'lucide-react';
import { fmt } from '../format';
import { useLang } from '../i18n';

// Les composants de base traduisent eux-mêmes les textes reçus (clés françaises) : les écrans passent du français.
const txt = (t, v) => (typeof v === 'string' ? t(v) : v);

/**
 * Deux boutons d'aide (interprétation / définition) + bulle compacte.
 * La bulle s'ouvre au survol ou au clic (utile sur écran tactile) et se cale à droite si elle déborde.
 */
export function HelpButtons({ interpretation, definition, size = 15 }) {
  const { t } = useLang();
  const [open, setOpen] = useState(null); // 'analysis' | 'definition' | null
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef(null);

  const show = (kind) => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setAlignRight(rect.left + 310 > window.innerWidth);
    }
    setOpen(kind);
  };

  if (!interpretation && !definition) return null;

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', gap: 2 }} onMouseLeave={() => setOpen(null)}>
      {interpretation && (
        <button type="button" className={`icon-btn ${open === 'analysis' ? 'active' : ''}`}
          aria-label={t('Interprétation')} onMouseEnter={() => show('analysis')} onClick={() => show(open === 'analysis' ? null : 'analysis')}
          style={{ color: open === 'analysis' ? 'var(--accent-text)' : undefined }}>
          <Info size={size} />
        </button>
      )}
      {definition && (
        <button type="button" className={`icon-btn ${open === 'definition' ? 'active' : ''}`}
          aria-label={t('Définition')} onMouseEnter={() => show('definition')} onClick={() => show(open === 'definition' ? null : 'definition')}
          style={{ color: open === 'definition' ? '#fff' : undefined }}>
          <BookOpen size={size} />
        </button>
      )}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', [alignRight ? 'right' : 'left']: 0, zIndex: 200,
          width: 300, maxWidth: '85vw', background: 'var(--raised)', border: '1px solid var(--border-2)',
          borderLeft: `3px solid ${open === 'analysis' ? 'var(--accent)' : 'var(--muted)'}`,
          padding: '9px 11px', borderRadius: 6, fontSize: 12, lineHeight: 1.5,
          color: 'var(--text-2)', boxShadow: '0 8px 24px rgba(0,0,0,.6)',
          pointerEvents: 'none', textTransform: 'none', letterSpacing: 0, fontWeight: 400, whiteSpace: 'normal',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3, color: open === 'analysis' ? 'var(--accent-text)' : 'var(--muted-2)' }}>
            {open === 'analysis' ? t('Interprétation') : t('Définition')}
          </div>
          {txt(t, open === 'analysis' ? interpretation : definition)}
        </div>
      )}
    </span>
  );
}

const TONE_COLORS = { pos: 'var(--green)', neg: 'var(--red)', warn: 'var(--amber)', red: 'var(--red)', amber: 'var(--amber)' };

/** Une case « indicateur » : libellé, valeur, unité, boutons d'aide. */
export const StatCell = memo(function StatCell({ label, value, unit, nd = 2, signed = false, tone, interpretation, definition }) {
  const { t } = useLang();
  const color = TONE_COLORS[tone] || 'var(--text-2)';
  const display = typeof value === 'number' ? fmt(value, nd, signed) : (value ?? '—');
  return (
    <div className="stat-cell">
      <div className="stat-head">
        <span className="stat-label" title={txt(t, label)}>{txt(t, label)}</span>
        <HelpButtons interpretation={interpretation} definition={definition} size={13} />
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 19, fontWeight: 700, color: display === '—' ? 'var(--muted)' : color, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
          {display}
        </span>
        {unit && display !== '—' && <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{txt(t, unit)}</span>}
      </div>
    </div>
  );
});

export function Segmented({ options, value, onChange, accent }) {
  const { t } = useLang();
  return (
    <div className="segmented">
      {options.map(o => (
        <button key={o.value} type="button" className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}
          style={value === o.value && (o.accent || accent) ? { background: o.accent || accent } : undefined}>
          {o.icon}{txt(t, o.label)}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, style }) {
  const { t } = useLang();
  return (
    <div style={style}>
      {label && <span className="label">{txt(t, label)}</span>}
      {children}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }) {
  const { t } = useLang();
  return (
    <div className="panel empty-state">
      {Icon && <span className="empty-icon"><Icon size={20} /></span>}
      {title && <div className="empty-title">{txt(t, title)}</div>}
      {children && <div className="empty-text">{txt(t, children)}</div>}
    </div>
  );
}
