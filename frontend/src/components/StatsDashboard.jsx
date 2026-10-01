import { useState, memo } from 'react';
import { StatCell } from './ui';
import { DEFINITIONS, METRICS, METRIC_TABS, ASSET_CLASS_LABELS } from '../definitions';
import { parseNum, fmtMillions } from '../format';

function toneFor(meta, v) {
  if (v === null || v === undefined) return undefined;
  if (meta.color === 'sign') return v >= 0 ? 'pos' : 'neg';
  return meta.color;
}

function MetricGrid({ keys, metrics, interpretations, confLabel }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: '16px 24px' }}>
      {keys.map(k => {
        const meta = METRICS[k];
        const v = metrics[meta.field];
        return (
          <StatCell key={k}
            label={meta.varLabel ? `${meta.label} (${confLabel} %)` : meta.label}
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
function StatsDashboard({ metrics, interpretations, classMetrics, assetClass, varInput, onVarChange, onVarSubmit, footer }) {
  const [tab, setTab] = useState('overview');
  const tabs = [
    ...METRIC_TABS,
    ...(classMetrics?.length ? [{ id: 'specific', label: `Spécifique ${ASSET_CLASS_LABELS[assetClass] || ''}`.trim() }] : []),
    { id: 'all', label: 'Tout' },
  ];
  const active = tabs.find(t => t.id === tab) ? tab : 'overview';
  const conf = parseNum(varInput);
  const confLabel = Number.isFinite(conf) ? String(conf).replace('.', ',') : '95';

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          {tabs.map(t => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} style={{
              background: 'none', border: 'none', fontSize: 13, padding: '0 0 9px', marginBottom: -1,
              fontWeight: active === t.id ? 600 : 400, color: active === t.id ? '#5b8cff' : 'var(--muted)',
              borderBottom: `2px solid ${active === t.id ? 'var(--accent)' : 'transparent'}`,
            }}>{t.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>Confiance VaR</span>
          <input type="text" inputMode="decimal" value={varInput} onChange={(e) => onVarChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onVarSubmit()}
            title="Entre 50 et 99,9 — appuyez sur Entrée pour recalculer"
            style={{ width: 54, padding: '3px 6px', textAlign: 'center', fontWeight: 700, fontSize: 12 }} />
          <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>%</span>
        </div>
      </div>

      {active === 'specific' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px 24px' }}>
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
        <MetricGrid keys={tabs.find(t => t.id === active).keys} metrics={metrics} interpretations={interpretations} confLabel={confLabel} />
      )}
      {footer && <div style={{ marginTop: 14, fontSize: 11, color: 'var(--muted)' }}>{footer}</div>}
    </div>
  );
}

export default memo(StatsDashboard);
