import { memo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Clock, Maximize2 } from 'lucide-react';
import { HelpButtons } from './ui';
import { DEFINITIONS } from '../definitions';
import { fmt, HORIZONS, horizonLabel } from '../format';

export const MonteCarloChart = memo(function MonteCarloChart({ data, big = false }) {
  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={10} minHeight={10}>
      <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e222d" />
        <XAxis dataKey="day" stroke="#787b86" minTickGap={40} fontSize={big ? 12 : 11} />
        <YAxis stroke="#787b86" domain={['auto', 'auto']} fontSize={big ? 12 : 11} width={64} tickFormatter={(v) => fmt(v, 0)} />
        <Tooltip contentStyle={{ backgroundColor: '#161b22', borderColor: '#2a2e39', color: '#fff', fontSize: 12 }} formatter={(v, n) => [fmt(v, 2), n]} />
        <Line type="monotone" dataKey="optimiste" stroke="#089981" strokeDasharray="4 4" dot={false} strokeWidth={big ? 2 : 1.5} name="Optimiste (95e centile)" isAnimationActive={false} />
        <Line type="monotone" dataKey="median" stroke="#2962ff" dot={false} strokeWidth={big ? 2.5 : 2} name="Médian" isAnimationActive={false} />
        <Line type="monotone" dataKey="pessimiste" stroke="#f23645" strokeDasharray="4 4" dot={false} strokeWidth={big ? 2 : 1.5} name="Pessimiste (5e centile)" isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
});

function MonteCarloCard({ mc, forecastDays, onHorizonChange, onFullscreen, currency }) {
  if (!mc?.summary) return null;
  const s = mc.summary;
  const unit = mc.is_money ? ` ${currency}` : '';
  const box = (label, value, color, border) => (
    <div style={{ flex: 1, background: 'var(--bg)', padding: '6px 8px', borderRadius: 5, border: `1px solid ${border || 'var(--border-2)'}`, textAlign: 'center', minWidth: 0 }}>
      <span style={{ color, fontSize: 11, display: 'block' }}>{label}</span>
      <strong style={{ fontSize: 14 }}>{fmt(value, mc.is_money ? 0 : 1)}{unit}</strong>
    </div>
  );
  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={15} color="#2962ff" /> Monte-Carlo · {horizonLabel(forecastDays)}
            <HelpButtons definition={DEFINITIONS.monte_carlo}
              interpretation={`Sur ${horizonLabel(forecastDays)}, le scénario médian donne ${fmt(s.gain_espere_median_pct, 1, true)} %. Probabilité de finir en perte : ${fmt(s.probabilite_perte_pct, 1)} %. ${mc.is_money ? '' : 'Valeurs en base 100 (renseignez un capital pour les voir en argent).'}`} />
          </h3>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>5 000 scénarios · départ = {mc.is_money ? `${fmt(s.initial, 0)}${unit}` : '100'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <select value={forecastDays} onChange={(e) => onHorizonChange(e.target.value)} style={{ padding: '4px 6px', fontSize: 12 }}>
            {HORIZONS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
          </select>
          <button type="button" className="icon-btn" title="Plein écran" onClick={onFullscreen}><Maximize2 size={15} /></button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {box('Pessimiste (5 %)', s.scenario_pessimiste_5pct, '#f23645')}
        {box('Médian', s.scenario_median_50pct, '#5b8cff', '#2962ff55')}
        {box('Optimiste (95 %)', s.scenario_optimiste_95pct, '#089981')}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted-2)', marginBottom: 8 }}>
        Probabilité de finir en perte : <strong style={{ color: s.probabilite_perte_pct > 40 ? 'var(--red)' : 'var(--text-2)' }}>{fmt(s.probabilite_perte_pct, 1)} %</strong>
      </div>
      <div style={{ width: '100%', flex: 1, minHeight: 240 }}>
        <MonteCarloChart data={mc.chart_data} />
      </div>
    </div>
  );
}

export default memo(MonteCarloCard);
