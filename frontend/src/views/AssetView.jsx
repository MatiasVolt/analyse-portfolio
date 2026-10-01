import { memo, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Search, Activity, BarChart2, ShieldAlert, Maximize2 } from 'lucide-react';
import AssetSearchInput from '../components/AssetSearchInput';
import PeriodPicker from '../components/PeriodPicker';
import StatsDashboard from '../components/StatsDashboard';
import MonteCarloCard from '../components/MonteCarloCard';
import TradingViewChart, { ChartErrorBoundary } from '../components/TradingViewChart';
import { Field, Segmented, EmptyState } from '../components/ui';
import { getAsset } from '../tickerDatabase';
import { API, BENCHMARKS, fmt, parseNum, signColor } from '../format';
import { ASSET_CLASS_LABELS } from '../definitions';

const QUICK = [
  { label: 'S&P 500', ticker: '^GSPC' }, { label: 'CAC 40', ticker: '^FCHI' }, { label: 'MSCI World', ticker: 'CW8.PA' },
  { label: 'Apple', ticker: 'AAPL' }, { label: 'Nvidia', ticker: 'NVDA' }, { label: 'LVMH', ticker: 'MC.PA' },
  { label: 'Bitcoin', ticker: 'BTC-USD' }, { label: 'Or', ticker: 'GC=F' }, { label: 'EUR/USD', ticker: 'EURUSD=X' },
];

const CHART_TYPES = [
  { value: 'line', label: 'Courbe', icon: <Activity size={13} /> },
  { value: 'candle', label: 'Chandeliers', icon: <BarChart2 size={13} /> },
  { value: 'drawdown', label: 'Drawdown', icon: <ShieldAlert size={13} />, accent: '#f23645' },
];

function AssetView({ shared, externalRequest, onFullscreen }) {
  const { today, varInput, setVarInput, confLevel, forecastDays, setForecastDays, currency, setCurrency } = shared;

  const [ticker, setTicker] = useState('');
  const [benchmark, setBenchmark] = useState('');
  const [timeMode, setTimeMode] = useState('preset');
  const [period, setPeriod] = useState('1y');
  const [start, setStart] = useState('2020-01-01');
  const [end, setEnd] = useState(today);
  const [capital, setCapital] = useState('');
  const [chartType, setChartType] = useState('line');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const run = async (o = {}) => {
    const p = { ticker, benchmark, timeMode, period, start, end, capital, forecastDays, conf: confLevel(), ...o };
    const t = (p.ticker || '').trim().toUpperCase();
    if (!t) { setError('Choisissez un actif dans la liste ou tapez un symbole.'); return; }
    if (p.timeMode === 'custom' && p.start >= p.end) { setError('La date de début doit précéder la date de fin.'); return; }

    abortRef.current?.abort(); // annule la requête précédente si on clique vite
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setLoading(true);
    try {
      const params = { var_confidence: p.conf, forecast_days: p.forecastDays };
      if (p.benchmark) params.benchmark = p.benchmark;
      if (p.timeMode === 'preset') params.period = p.period;
      else { params.start_date = p.start; params.end_date = p.end; }
      const cap = parseNum(p.capital);
      if (cap > 0) params.initial_capital = cap;
      const res = await axios.get(`${API}/api/asset/${encodeURIComponent(t)}`, { params, signal: ctrl.signal });
      setData(res.data);
    } catch (err) {
      if (axios.isCancel(err)) return;
      setError(err.response?.data?.detail || "Impossible de joindre l'API (le serveur Python est-il lancé ?).");
    } finally {
      if (abortRef.current === ctrl) setLoading(false);
    }
  };

  // Demande venant d'un autre onglet (bouton « Analyser » du screener)
  useEffect(() => {
    if (externalRequest?.ticker) {
      setTicker(externalRequest.ticker);
      run({ ticker: externalRequest.ticker });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalRequest]);

  const pick = (t) => { setTicker(t); run({ ticker: t }); };
  const cap = parseNum(capital);
  const hasCap = cap > 0;
  const m = data?.metrics;
  const isMoneyChart = Boolean(data?.money_summary);

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
          <Field label="Actif" style={{ width: 280 }}>
            <AssetSearchInput value={ticker} onChange={setTicker} onSelect={pick} onEnter={() => run()} placeholder="Apple, MSCI World, Bitcoin, AAPL…" />
          </Field>
          <Field label="Benchmark">
            <select value={benchmark} onChange={(e) => { setBenchmark(e.target.value); if (data) run({ benchmark: e.target.value }); }}>
              <option value="">Automatique</option>
              {BENCHMARKS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </Field>
          <PeriodPicker mode={timeMode} onModeChange={setTimeMode} period={period}
            onPeriodChange={(p) => { setPeriod(p); if (ticker) run({ period: p, timeMode: 'preset' }); }}
            start={start} end={end} onStartChange={setStart} onEndChange={setEnd} today={today} />
          <button type="button" className="btn btn-primary" onClick={() => run()} disabled={loading} style={{ padding: '8px 18px' }}>
            <Search size={14} /> {loading ? 'Calcul…' : 'Analyser'}
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14, alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700, marginRight: 4 }}>Accès rapide</span>
          {QUICK.map(q => (
            <button key={q.ticker} type="button" className="btn" onClick={() => pick(q.ticker)}
              style={{ padding: '4px 10px', fontSize: 12, ...(ticker === q.ticker ? { background: '#1e3a8a', borderColor: 'var(--accent)', color: '#fff' } : {}) }}>
              {q.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      {!data && !loading && <EmptyState>Recherchez un actif ou cliquez sur un raccourci pour lancer l'analyse.</EmptyState>}
      {!data && loading && <EmptyState>Téléchargement et calcul en cours…</EmptyState>}

      {data && (
        <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>{getAsset(data.ticker)?.name || data.ticker}</h1>
              <span style={{ color: '#38bdf8', fontWeight: 600 }}>{data.ticker}</span>
              <span style={{ color: 'var(--muted)', fontSize: 12, padding: '2px 8px', border: '1px solid var(--border-2)', borderRadius: 10 }}>{ASSET_CLASS_LABELS[data.asset_class] || data.asset_class}</span>
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>
              Du {data.period_start} au {data.period_end} · Référence : <strong style={{ color: 'var(--text-2)' }}>{data.benchmark_label}</strong>
            </div>
          </div>

          {/* Simulation d'un investissement */}
          <div className="panel" style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 16, alignItems: 'center', padding: '12px 20px' }}>
            <Field label="Capital investi (optionnel)">
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="text" inputMode="decimal" value={capital} onChange={(e) => setCapital(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && run()} onBlur={() => { if (data && (parseNum(capital) > 0) !== isMoneyChart) run(); }}
                  style={{ width: 110 }} />
                <select value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="€">€</option><option value="$">$</option></select>
              </div>
            </Field>
            <div><span className="label">Valeur finale</span><strong style={{ fontSize: 19 }}>{hasCap ? `${fmt(cap * (1 + m.total_change_pct / 100), 0)} ${currency}` : '—'}</strong></div>
            <div><span className="label">Gain / perte</span><strong style={{ fontSize: 19, color: hasCap ? signColor(m.total_change_pct) : undefined }}>{hasCap ? `${fmt(cap * m.total_change_pct / 100, 0, true)} ${currency}` : '—'}</strong></div>
            <div><span className="label">Rendement</span><strong style={{ fontSize: 19, color: signColor(m.total_change_pct) }}>{fmt(m.total_change_pct, 2, true)} %</strong>
              <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 6 }}>soit {fmt(m.cagr_pct, 2, true)} %/an</span></div>
          </div>

          <StatsDashboard metrics={m} interpretations={data.interpretations} classMetrics={data.class_specific_metrics} assetClass={data.asset_class}
            varInput={varInput} onVarChange={setVarInput} onVarSubmit={() => run()}
            footer={`Calculé sur ${m.observations} séances · taux sans risque 2 % · annualisation ${m.periods_per_year} séances/an`} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: 16, marginBottom: 24 }}>
            <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
                <Segmented options={CHART_TYPES} value={chartType} onChange={setChartType} />
                <button type="button" className="icon-btn" title="Plein écran"
                  onClick={() => onFullscreen({ kind: 'chart', title: getAsset(data.ticker)?.name || data.ticker, props: { data: data.chart_data, type: chartType, isMoney: isMoneyChart, currency } })}>
                  <Maximize2 size={15} />
                </button>
              </div>
              <div style={{ flex: 1, minHeight: 360 }}>
                <ChartErrorBoundary>
                  <TradingViewChart data={data.chart_data} type={chartType} isMoney={isMoneyChart} currency={currency} mainLabel="Cours" />
                </ChartErrorBoundary>
              </div>
            </div>
            <MonteCarloCard mc={data.monte_carlo} forecastDays={forecastDays} currency={currency}
              onHorizonChange={(d) => { setForecastDays(d); run({ forecastDays: d }); }}
              onFullscreen={() => onFullscreen({ kind: 'mc', forecastDays, props: { data: data.monte_carlo.chart_data } })} />
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(AssetView);
