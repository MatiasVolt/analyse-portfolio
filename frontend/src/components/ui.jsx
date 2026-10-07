import { cloneElement, isValidElement, useEffect, useId, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import { Info, BookOpen } from 'lucide-react';
import { fmt } from '../format';
import { useLang } from '../i18n';

// Les composants de base traduisent eux-mêmes les textes reçus (clés françaises) : les écrans passent du français.
const txt = (t, v) => (typeof v === 'string' ? t(v) : v);

const BUBBLE_W = 300;

/**
 * Deux boutons d'aide (interprétation / définition) + bulle compacte.
 * La bulle s'ouvre au survol ou au clic (utile sur écran tactile). Elle est affichée au niveau de la page (portail),
 * en position fixe : un tableau à défilement ou un panneau étroit ne peut plus la couper. Elle reste dans l'écran
 * et passe au-dessus du bouton s'il n'y a pas la place en dessous.
 */
export function HelpButtons({ interpretation, definition, size = 15 }) {
  const { t } = useLang();
  const [open, setOpen] = useState(null); // 'analysis' | 'definition' | null
  const [pos, setPos] = useState(null); // { left, top | bottom } en coordonnées de la fenêtre
  const ref = useRef(null);
  const bubbleId = useId();

  const show = (kind) => {
    if (kind && ref.current) {
      const r = ref.current.getBoundingClientRect();
      const w = Math.min(BUBBLE_W, window.innerWidth * 0.9);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      // Sous le bouton s'il reste au moins ~220 px, sinon au-dessus
      setPos(window.innerHeight - r.bottom > 220 || r.top < 220
        ? { left, top: r.bottom + 4 } : { left, bottom: window.innerHeight - r.top + 4 });
    }
    setOpen(kind);
  };

  // La bulle est en position fixe : on la ferme si la page (ou un tableau) défile, sinon elle resterait décalée
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [open]);

  if (!interpretation && !definition) return null;

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', gap: 2 }} onMouseLeave={() => setOpen(null)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(null); }}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(null); } }}>
      {interpretation && (
        <button type="button" className={`icon-btn ${open === 'analysis' ? 'active' : ''}`}
          aria-label={t('Interprétation')} aria-expanded={open === 'analysis'} aria-describedby={open === 'analysis' ? bubbleId : undefined} onMouseEnter={() => show('analysis')} onClick={() => show(open === 'analysis' ? null : 'analysis')}
          style={{ color: open === 'analysis' ? 'var(--accent-text)' : undefined }}>
          <Info size={size} />
        </button>
      )}
      {definition && (
        <button type="button" className={`icon-btn ${open === 'definition' ? 'active' : ''}`}
          aria-label={t('Définition')} aria-expanded={open === 'definition'} aria-describedby={open === 'definition' ? bubbleId : undefined} onMouseEnter={() => show('definition')} onClick={() => show(open === 'definition' ? null : 'definition')}
          style={{ color: open === 'definition' ? 'var(--text)' : undefined }}>
          <BookOpen size={size} />
        </button>
      )}
      {open && pos && createPortal(
        <div id={bubbleId} role="tooltip" style={{
          position: 'fixed', ...pos, zIndex: 10000,
          width: BUBBLE_W, maxWidth: '90vw', maxHeight: '70vh', overflowY: 'auto', background: 'var(--raised)', border: '1px solid var(--border-2)',
          borderLeft: `3px solid ${open === 'analysis' ? 'var(--accent)' : 'var(--muted)'}`,
          padding: '10px 12px', borderRadius: 6, fontSize: 12.5, lineHeight: 1.55,
          color: 'var(--text-2)', boxShadow: '0 6px 20px rgba(0,0,0,.14)',
          pointerEvents: 'none', textTransform: 'none', letterSpacing: 0, fontWeight: 400, whiteSpace: 'normal',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3, color: open === 'analysis' ? 'var(--accent-text)' : 'var(--muted-2)' }}>
            {open === 'analysis' ? t('Interprétation') : t('Définition')}
          </div>
          {txt(t, open === 'analysis' ? interpretation : definition)}
        </div>,
        document.body,
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

export function Segmented({ options, value, onChange, accent, label }) {
  const { t } = useLang();
  return (
    <div className="segmented" role="group" aria-label={label ? txt(t, label) : undefined}>
      {options.map(o => (
        <button key={o.value} type="button" className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)} aria-pressed={value === o.value}
          style={value === o.value && (o.accent || accent) ? { background: o.accent || accent } : undefined}>
          {o.icon}{txt(t, o.label)}
        </button>
      ))}
    </div>
  );
}

/**
 * Champ avec libellé. Un <input>/<select> seul est relié à son libellé (clic sur le libellé = focus, lecteurs d'écran) ;
 * un contenu composé est annoncé comme un groupe portant ce libellé.
 */
export function Field({ label, children, style }) {
  const { t } = useLang();
  const id = useId();
  const single = isValidElement(children) && (children.type === 'input' || children.type === 'select');
  if (!label) return <div style={style}>{children}</div>;
  if (single) {
    const inputId = children.props.id || `${id}-in`;
    return (
      <div style={style}>
        <label className="label" htmlFor={inputId}>{txt(t, label)}</label>
        {cloneElement(children, { id: inputId })}
      </div>
    );
  }
  return (
    <div style={style} role="group" aria-labelledby={`${id}-lb`}>
      <span className="label" id={`${id}-lb`}>{txt(t, label)}</span>
      {children}
    </div>
  );
}

/** État vide : icône, titre, explication et, si fourni, des actions en un clic (exemples, modèles…). */
export function EmptyState({ icon: Icon, title, children, actions, busy = false }) {
  const { t } = useLang();
  return (
    <div className="panel empty-state" role={busy ? 'status' : undefined} aria-live={busy ? 'polite' : undefined}>
      {Icon && <span className="empty-icon" aria-hidden="true"><Icon size={20} className={busy ? 'spin' : undefined} /></span>}
      {title && <div className="empty-title">{txt(t, title)}</div>}
      {children && <div className="empty-text">{txt(t, children)}</div>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  );
}
