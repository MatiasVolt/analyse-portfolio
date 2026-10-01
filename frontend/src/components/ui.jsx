import { useRef, useState, memo } from 'react';
import { Info, BookOpen } from 'lucide-react';
import { fmt } from '../format';

/**
 * Deux boutons d'aide (interprétation / définition) + bulle compacte.
 * La bulle s'ouvre au survol ou au clic (utile sur écran tactile) et se cale à droite si elle déborde.
 */
export function HelpButtons({ interpretation, definition, size = 15 }) {
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
        <button type="button" className={`icon-btn ${open === 'analysis' ? 'active' : ''}`} title="Interprétation"
          aria-label="Interprétation" onMouseEnter={() => show('analysis')} onClick={() => show(open === 'analysis' ? null : 'analysis')}
          style={{ color: open === 'analysis' ? '#60a5fa' : undefined }}>
          <Info size={size} />
        </button>
      )}
      {definition && (
        <button type="button" className={`icon-btn ${open === 'definition' ? 'active' : ''}`} title="Définition"
          aria-label="Définition" onMouseEnter={() => show('definition')} onClick={() => show(open === 'definition' ? null : 'definition')}
          style={{ color: open === 'definition' ? 'var(--violet)' : undefined }}>
          <BookOpen size={size} />
        </button>
      )}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', [alignRight ? 'right' : 'left']: 0, zIndex: 200,
          width: 300, maxWidth: '85vw', background: '#1e222d', border: '1px solid #2f3545',
          borderLeft: `3px solid ${open === 'analysis' ? '#3b82f6' : 'var(--violet)'}`,
          padding: '9px 11px', borderRadius: 6, fontSize: 12, lineHeight: 1.5,
          color: open === 'analysis' ? '#bfdbfe' : '#cbd5e1', boxShadow: '0 8px 24px rgba(0,0,0,.6)',
          pointerEvents: 'none', textTransform: 'none', letterSpacing: 0, fontWeight: 400, whiteSpace: 'normal',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3, color: open === 'analysis' ? '#60a5fa' : 'var(--violet)' }}>
            {open === 'analysis' ? 'Interprétation' : 'Définition'}
          </div>
          {open === 'analysis' ? interpretation : definition}
        </div>
      )}
    </span>
  );
}

const TONE_COLORS = { pos: 'var(--green)', neg: 'var(--red)', warn: 'var(--amber)', red: 'var(--red)', amber: 'var(--amber)' };

/** Une case « indicateur » : libellé, valeur, unité, boutons d'aide. */
export const StatCell = memo(function StatCell({ label, value, unit, nd = 2, signed = false, tone, interpretation, definition }) {
  const color = TONE_COLORS[tone] || 'var(--text-2)';
  const display = typeof value === 'number' ? fmt(value, nd, signed) : (value ?? '—');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, minHeight: 26 }}>
        <span style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={label}>
          {label}
        </span>
        <HelpButtons interpretation={interpretation} definition={definition} />
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 19, fontWeight: 700, color: display === '—' ? 'var(--muted)' : color, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
          {display}
        </span>
        {unit && display !== '—' && <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{unit}</span>}
      </div>
    </div>
  );
});

export function Segmented({ options, value, onChange, accent }) {
  return (
    <div className="segmented">
      {options.map(o => (
        <button key={o.value} type="button" className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}
          style={value === o.value && (o.accent || accent) ? { background: o.accent || accent } : undefined}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, style }) {
  return (
    <div style={style}>
      {label && <span className="label">{label}</span>}
      {children}
    </div>
  );
}

export function EmptyState({ children }) {
  return (
    <div className="panel" style={{ padding: '56px 20px', textAlign: 'center', color: '#64748b' }}>{children}</div>
  );
}
