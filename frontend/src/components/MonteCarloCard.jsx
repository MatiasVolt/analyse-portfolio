import { memo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Clock, Maximize2 } from 'lucide-react';
import { HelpButtons } from './ui';
import { DEFINITIONS } from '../definitions';
import { fmt, HORIZONS, horizonLabel } from '../format';
import { useLang, tr, getLang } from '../i18n';

export const MonteCarloChart = memo(function MonteCarloChart({ data, big = false }) {
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={10} minHeight={10}>
      <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#222226" />
        <XAxis dataKey="day" stroke="#88888f" minTickGap={40} fontSize={big ? 12 : 11} tickFormatter={(d) => (getLang() === "en" ? String(d).replace("J+", "D+") : d)} />
        <YAxis stroke="#88888f" domain={['auto', 'auto']} fontSize={big ? 12 : 11} width={64} tickFormatter={(v) => fmt(v, 0)} />
        <Tooltip contentStyle={{ backgroundColor: '#1b1b1e', borderColor: '#323237', color: '#fff', fontSize: 12 }} formatter={(v, n) => [fmt(v, 2), n]} />
        <Line type="monotone" dataKey="optimiste" stroke="#22a06b" strokeDasharray="4 4" dot={false} strokeWidth={big ? 2 : 1.5} name={tr('Optimiste (95e centile)')} isAnimationActive={false} />
        <Line type="monotone" dataKey="median" stroke="#e0a43a" dot={false} strokeWidth={big ? 2.5 : 2} name={tr('Médian')} isAnimationActive={false} />
        <Line type="monotone" dataKey="pessimiste" stroke="#e5484d" strokeDasharray="4 4" dot={false} strokeWidth={big ? 2 : 1.5} name={tr('Pessimiste (5e centile)')} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
});

/** forecastDays : horizon sélectionné (éventuellement en cours de calcul) ; computedDays : horizon des résultats affichés. */
function MonteCarloCard({ mc, forecastDays, computedDays = forecastDays, onHorizonChange, onFullscreen, currency }) {
  const { t } = useLang();
  if (!mc?.summary) return null;
  const s = mc.summary;
  const unit = mc.is_money ? ` ${currency}` : '';
  const box = (label, value, color) => (
    <div className="scenario" style={{ '--tone': color }}>
      <span className="scenario-label">{t(label)}</span>
      <strong className="scenario-value">{fmt(value, mc.is_money ? 0 : 1)}{unit}</strong>
    </div>
  );
  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h3 className="section-title">
            <Clock size={15} /> Monte-Carlo · {horizonLabel(computedDays)}
            <HelpButtons definition={DEFINITIONS.monte_carlo}
              interpretation={`${t('Sur {h}, le scénario médian donne {g} %. Probabilité de finir en perte : {p} %.', { h: horizonLabel(computedDays), g: fmt(s.gain_espere_median_pct, 1, true), p: fmt(s.probabilite_perte_pct, 1) })} ${mc.is_money ? '' : t('Valeurs en base 100 (renseignez un capital pour les voir en argent).')}`} />
          </h3>
          <span className="hint">{t('5 000 scénarios · départ = {v}', { v: mc.is_money ? `${fmt(s.initial, 0)}${unit}` : '100' })}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <select value={forecastDays} onChange={(e) => onHorizonChange(e.target.value)} style={{ padding: '4px 6px', fontSize: 12 }}>
            {HORIZONS.map(h => <option key={h.value} value={h.value}>{t(h.label)}</option>)}
          </select>
          <button type="button" className="icon-btn" title={t('Plein écran')} onClick={onFullscreen}><Maximize2 size={15} /></button>
        </div>
      </div>
      <div className="scenario-row">
        {box('Pessimiste (5 %)', s.scenario_pessimiste_5pct, '#e5484d')}
        {box('Médian', s.scenario_median_50pct, 'var(--accent-text)')}
        {box('Optimiste (95 %)', s.scenario_optimiste_95pct, '#22a06b')}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted-2)', marginBottom: 8 }}>
        {t('Probabilité de finir en perte :')} <strong style={{ color: s.probabilite_perte_pct > 40 ? 'var(--red)' : 'var(--text-2)' }}>{fmt(s.probabilite_perte_pct, 1)} %</strong>
      </div>
      <div style={{ width: '100%', flex: 1, minHeight: 240 }}>
        <MonteCarloChart data={mc.chart_data} />
      </div>
    </div>
  );
}

export default memo(MonteCarloCard);
