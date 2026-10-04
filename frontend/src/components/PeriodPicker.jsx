import { PERIODS } from '../format';
import { useLang } from '../i18n';

/** Sélecteur de période : boutons rapides ou dates précises. */
export default function PeriodPicker({ mode, onModeChange, period, onPeriodChange, start, end, onStartChange, onEndChange, today }) {
  const { t } = useLang();
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 5 }}>
        <span className="label" style={{ margin: 0 }}>{t('Période')}</span>
        <button type="button" onClick={() => onModeChange(mode === 'preset' ? 'custom' : 'preset')}
          style={{ background: 'none', border: 'none', color: 'var(--accent-text)', fontSize: 11, padding: 0 }}>
          {mode === 'preset' ? t('Dates précises') : t('Boutons rapides')}
        </button>
      </div>
      {mode === 'preset' ? (
        <div className="segmented">
          {PERIODS.map(p => (
            <button key={p.value} type="button" className={period === p.value ? 'on' : ''} onClick={() => onPeriodChange(p.value)}>{t(p.label)}</button>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="date" max={end || today} value={start} onChange={(e) => onStartChange(e.target.value)} style={{ padding: '4px 6px', fontSize: 12 }} />
          <span style={{ color: 'var(--muted)' }}>→</span>
          <input type="date" min={start} max={today} value={end} onChange={(e) => onEndChange(e.target.value)} style={{ padding: '4px 6px', fontSize: 12 }} />
        </div>
      )}
    </div>
  );
}
