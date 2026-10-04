import { useState, memo } from 'react';
import { StatCell } from './ui';
import { DEFINITIONS, METRICS, METRIC_TABS, ASSET_CLASS_LABELS } from '../definitions';
import { parseNum, fmtMillions } from '../format';
import { useLang, getRfMode, setRfMode } from '../i18n';

function toneFor(meta, v) {
  if (v === null || v === undefined) return undefined;
  if (meta.color === 'sign') return v >= 0 ? 'pos' : 'neg';
  return meta.color;
}

function MetricGrid({ keys, metrics, interpretations, confLabel }) {
  const { t } = useLang();
  return (
    <div className="stat-grid">
      {keys.map(k => {
        const meta = METRICS[k];
        const v = metrics[meta.field];
        return (
          <StatCell key={k}
            label={meta.varLabel ? `${t(meta.label)} (${confLabel} %)` : meta.label}
            value={v} unit={meta.unit} nd={meta.nd ?? 2} signed={meta.signed}
            tone={toneFor(meta, v)}
            interpretation={meta.interp ? interpretations?.[meta.interp] : undefined}
            definition={DEFINITIONS[meta.def]} />
        );
      })}
    </div>
  );
}

/**
 * Tableau de bord des indicateurs, par onglets.
 * classMetrics : liste {id,label,value,unit,definition,interpretation,tone} propre au type d'actif.
 */
function StatsDashboard({ metrics, interpretations, classMetrics, assetClass, varInput, onVarChange, onVarSubmit, confUsed, footer }) {
  const { t, lang } = useLang();
  const [tab, setTab] = useState('overview');
  const tabs = [
    ...METRIC_TABS,
    ...(classMetrics?.length ? [{ id: 'specific', label: `${t('Spécifique')} ${t(ASSET_CLASS_LABELS[assetClass] || '')}`.trim() }] : []),
    { id: 'all', label: 'Tout' },
  ];
  const active = tabs.find(x => x.id === tab) ? tab : 'overview';
  // Libellé = niveau ayant servi au calcul (et non la saisie en cours, ni une valeur hors bornes ignorée par l'API)
  const conf = confUsed !== undefined ? Math.round(confUsed * 1000) / 10 : parseNum(varInput);
  const confLabel = Number.isFinite(conf) ? (lang === 'fr' ? String(conf).replace('.', ',') : String(conf)) : '95';

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="dash-head">
        <div className="underline-tabs" role="tablist">
          {tabs.map(x => (
            <button key={x.id} type="button" role="tab" aria-selected={active === x.id} className={active === x.id ? 'on' : ''} onClick={() => setTab(x.id)}>{t(x.label)}</button>
          ))}
        </div>
        <div className="dash-var">
          <button type="button" className="btn btn-sm" onClick={() => { setRfMode(getRfMode() === 'fixed' ? 'market' : 'fixed'); onVarSubmit(); }}
            title={t("Taux utilisé pour le Sharpe, le Sortino et l'alpha. Cliquez pour basculer entre le taux du marché et l'ancien taux fixe de 2 %.")}>
            {t('Taux sans risque :')} {getRfMode() === 'fixed' ? t('2 % fixe') : t('marché {v} %', { v: String(metrics.risk_free_pct ?? '…').replace('.', lang === 'fr' ? ',' : '.') })}
          </button>
          <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>{t('Confiance VaR')}</span>
          <input type="text" inputMode="decimal" value={varInput} onChange={(e) => onVarChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onVarSubmit()}
            title={t('Entre 50 et 99,9 — appuyez sur Entrée pour recalculer')}
            style={{ width: 54, padding: '3px 6px', textAlign: 'center', fontWeight: 700, fontSize: 12 }} />
          <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>%</span>
        </div>
      </div>

      {active === 'specific' ? (
        <div className="stat-grid">
          {classMetrics.map(m => (
            <StatCell key={m.id} label={m.label} tone={m.tone}
              value={m.unit === 'M' && m.value != null ? fmtMillions(m.value) : m.value} unit={m.unit === 'M' ? '' : m.unit}
              nd={m.unit === 'pips' ? 0 : m.unit === 'M' ? 1 : 2}
              signed={m.unit === '%' && /perf|ytd|ma200|dist/.test(m.id)}
              interpretation={m.interpretation} definition={m.definition} />
          ))}
        </div>
      ) : active === 'all' ? (
        <MetricGrid keys={Object.keys(METRICS)} metrics={metrics} interpretations={interpretations} confLabel={confLabel} />
      ) : (
        <MetricGrid keys={tabs.find(x => x.id === active).keys} metrics={metrics} interpretations={interpretations} confLabel={confLabel} />
      )}
      {footer && <div className="hint" style={{ marginTop: 16, paddingTop: 10, borderTop: '1px solid var(--border)' }}>{footer}</div>}
    </div>
  );
}

export default memo(StatsDashboard);
