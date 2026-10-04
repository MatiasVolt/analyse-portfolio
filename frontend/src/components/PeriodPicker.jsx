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
          className="link-btn" style={{ padding: '0 2px' }}>
          {mode === 'preset' ? t('Dates précises') : t('Boutons rapides')}
        </button>
      </div>
      {mode === 'preset' ? (
        <div className="segmented" role="group" aria-label={t('Période')}>
          {PERIODS.map(p => (
            <button key={p.value} type="button" className={period === p.value ? 'on' : ''} aria-pressed={period === p.value} title={t(p.title)} aria-label={t(p.title)} onClick={() => onPeriodChange(p.value)}>{t(p.label)}</button>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="date" max={end || today} value={start} onChange={(e) => onStartChange(e.target.value)} aria-label={t('Date de début')} style={{ padding: '4px 6px', fontSize: 12 }} />
          <span style={{ color: 'var(--muted)' }} aria-hidden="true">→</span>
          <input type="date" min={start} max={today} value={end} onChange={(e) => onEndChange(e.target.value)} aria-label={t('Date de fin')} style={{ padding: '4px 6px', fontSize: 12 }} />
        </div>
      )}
    </div>
  );
}
