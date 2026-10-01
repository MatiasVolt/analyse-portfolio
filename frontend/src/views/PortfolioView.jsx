import { memo, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Layers, Plus, Trash2, Activity, ShieldAlert, Maximize2, Equal, Scale, Play } from 'lucide-react';
import AssetSearchInput from '../components/AssetSearchInput';
import PeriodPicker from '../components/PeriodPicker';
import StatsDashboard from '../components/StatsDashboard';
import MonteCarloCard from '../components/MonteCarloCard';
import TradingViewChart, { ChartErrorBoundary } from '../components/TradingViewChart';
import { Field, Segmented, HelpButtons, EmptyState } from '../components/ui';
import { getAsset } from '../tickerDatabase';
import { API, BENCHMARKS, COLORS, fmt, parseNum, signColor } from '../format';
import { DEFINITIONS } from '../definitions';

let nextId = 1;
const newRow = (ticker = '', weight = '', amount = '') => ({ id: nextId++, ticker, weight, amount });

const PRESETS = [
  { label: '60/40 classique', items: [['SPY', 60], ['AGG', 40]] },
  { label: 'All Weather (Dalio)', items: [['VTI', 30], ['TLT', 40], ['IEF', 15], ['GLD', 7.5], ['DBC', 7.5]] },
  { label: 'Permanent (Browne)', items: [['VTI', 25], ['TLT', 25], ['GLD', 25], ['BIL', 25]] },
  { label: 'Monde + Émergents', items: [['CW8.PA', 85], ['PAEEM.PA', 15]] },
  { label: 'Big Tech US', items: [['AAPL', 20], ['MSFT', 20], ['NVDA', 20], ['AMZN', 20], ['GOOGL', 20]] },
  { label: 'Leaders CAC 40', items: [['MC.PA', 25], ['TTE.PA', 25], ['AIR.PA', 25], ['SAN.PA', 25]] },
  { label: 'Crypto', items: [['BTC-USD', 70], ['ETH-USD', 30]] },
];

const REBALANCE = [
  { value: 'none', label: 'Aucun (achat-conservation)' },
  { value: 'monthly', label: 'Mensuel' },
  { value: 'daily', label: 'Quotidien (poids constants)' },
];

const round2 = (x) => Math.round(x * 100) / 100;
const nameOf = (t) => getAsset(t)?.name || t;

/** Champ numérique avec unité intégrée à droite. */
function UnitInput({ value, onChange, unit, onEnter, width = '100%' }) {
  return (
    <div style={{ position: 'relative', width }}>
      <input type="text" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
        style={{ width: '100%', paddingRight: 26, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} />
      <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 12, pointerEvents: 'none' }}>{unit}</span>
    </div>
  );
}

function AllocationBar({ rows, weights, sum }) {
  const over = sum > 100.5;
  const ok = Math.abs(sum - 100) <= 0.5;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: '#0b0f17', border: '1px solid var(--border-2)' }}>
        {rows.map((r, i) => weights[i] > 0 && (
          <div key={r.id} title={`${nameOf(r.ticker) || 'Actif'} : ${fmt(weights[i], 1)} %`}
            style={{ width: `${Math.min(weights[i], 100) / Math.max(sum, 100) * 100}%`, background: COLORS[i % COLORS.length] }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12 }}>
        <span style={{ color: ok ? 'var(--green)' : over ? 'var(--red)' : 'var(--amber)', fontWeight: 600 }}>
          Total alloué : {fmt(sum, 1)} %
        </span>
        <span style={{ color: 'var(--muted)' }}>
          {ok ? 'Prêt à simuler' : over ? `Dépasse de ${fmt(sum - 100, 1)} %` : `Reste ${fmt(100 - sum, 1)} % à répartir`}
        </span>
      </div>
    </div>
  );
}

function CorrelationMatrix({ corr }) {
  if (!corr || corr.tickers.length < 2) return null;
  const cell = (v) => {
    const a = Math.abs(v);
    const bg = v >= 0 ? `rgba(242,54,69,${0.12 + a * 0.6})` : `rgba(41,98,255,${0.12 + a * 0.6})`;
    return { background: bg, color: a > 0.5 ? '#fff' : 'var(--text-2)' };
  };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 3, fontSize: 12 }}>
        <thead>
          <tr><th />{corr.tickers.map(t => <th key={t} style={{ padding: '4px 6px', color: 'var(--muted)', fontWeight: 600 }}>{t}</th>)}</tr>
        </thead>
        <tbody>
          {corr.matrix.map((row, i) => (
            <tr key={corr.tickers[i]}>
              <td style={{ padding: '4px 8px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{corr.tickers[i]}</td>
              {row.map((v, j) => (
                <td key={j} style={{ padding: '6px 8px', textAlign: 'center', borderRadius: 4, minWidth: 52, ...(i === j ? { color: 'var(--muted)' } : cell(v)) }}>{fmt(v, 2)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Rouge = les actifs montent et baissent ensemble · Bleu = ils évoluent en sens inverse (diversification).</div>
    </div>
  );
}

function PortfolioView({ shared, onFullscreen }) {
  const { today, varInput, setVarInput, confLevel, forecastDays, setForecastDays, currency, setCurrency } = shared;

  const [rows, setRows] = useState(() => [newRow(), newRow()]);
  const [inputMode, setInputMode] = useState('weight'); // 'weight' : on saisit des %, 'amount' : on saisit des montants
  const [totalCapital, setTotalCapital] = useState('');
  const [benchmark, setBenchmark] = useState('^GSPC');
  const [rebalance, setRebalance] = useState('none');
  const [timeMode, setTimeMode] = useState('preset');
  const [period, setPeriod] = useState('5y');
  const [start, setStart] = useState('2020-01-01');
  const [end, setEnd] = useState(today);
  const [chartType, setChartType] = useState('line');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  // --- Valeurs dérivées : en mode %, les montants se calculent ; en mode montants, les % se calculent
  const { weights, amounts, sum, capital } = useMemo(() => {
    if (inputMode === 'amount') {
      const am = rows.map(r => Math.max(parseNum(r.amount) || 0, 0));
      const total = am.reduce((a, b) => a + b, 0);
      return { amounts: am, weights: am.map(a => (total > 0 ? (a / total) * 100 : 0)), sum: total > 0 ? 100 : 0, capital: total };
    }
    const w = rows.map(r => Math.max(parseNum(r.weight) || 0, 0));
    const cap = parseNum(totalCapital) || 0;
    return { weights: w, amounts: w.map(x => (cap > 0 ? (x * cap) / 100 : null)), sum: w.reduce((a, b) => a + b, 0), capital: cap };
  }, [rows, inputMode, totalCapital]);

  const update = (id, field, value) => setRows(rs => rs.map(r => (r.id === id ? { ...r, [field]: value } : r)));
  const removeRow = (id) => setRows(rs => (rs.length > 1 ? rs.filter(r => r.id !== id) : [newRow()]));

  const switchMode = (mode) => {
    if (mode === inputMode) return;
    if (mode === 'amount') {
      setRows(rs => rs.map((r, i) => ({ ...r, amount: amounts[i] ? String(Math.round(amounts[i])) : '' })));
    } else {
      setRows(rs => rs.map((r, i) => ({ ...r, weight: weights[i] ? String(round2(weights[i])) : '' })));
      if (capital > 0) setTotalCapital(String(Math.round(capital)));
    }
    setInputMode(mode);
  };

  const equalWeights = () => {
    const filled = rows.filter(r => r.ticker.trim());
    if (!filled.length) return;
    const each = round2(100 / filled.length);
    let given = 0;
    setRows(rs => rs.map(r => {
      if (!r.ticker.trim()) return { ...r, weight: '' };
      given += 1;
      return { ...r, weight: String(given === filled.length ? round2(100 - each * (filled.length - 1)) : each) };
    }));
  };

  const normalize = () => {
    if (sum <= 0) return;
    const scaled = weights.map(w => round2((w / sum) * 100));
    const diff = round2(100 - scaled.reduce((a, b) => a + b, 0));
    const last = scaled.map((w, i) => (w > 0 ? i : -1)).filter(i => i >= 0).pop();
    if (last !== undefined) scaled[last] = round2(scaled[last] + diff);
    setRows(rs => rs.map((r, i) => ({ ...r, weight: scaled[i] ? String(scaled[i]) : '' })));
  };

  const applyPreset = (label) => {
    const p = PRESETS.find(x => x.label === label);
    if (!p) return;
    setInputMode('weight');
    setRows(p.items.map(([t, w]) => newRow(t, String(w))));
  };

  const simulate = async (o = {}) => {
    const fd = o.forecastDays ?? forecastDays;
    const valid = rows.map((r, i) => ({ t: r.ticker.trim().toUpperCase(), w: weights[i] })).filter(x => x.t && x.w > 0);
    if (!valid.length) { setError('Ajoutez au moins un actif avec une pondération ou un montant.'); return; }
    const dup = valid.find((x, i) => valid.findIndex(y => y.t === x.t) !== i);
    if (dup) { setError(`« ${nameOf(dup.t)} » apparaît deux fois : fusionnez les deux lignes.`); return; }
    const total = valid.reduce((a, x) => a + x.w, 0);
    if (Math.abs(total - 100) > 0.5) { setError(`La somme des pondérations doit faire 100 % (actuellement ${fmt(total, 1)} %). Utilisez « Ajuster à 100 % ».`); return; }
    if (timeMode === 'custom' && start >= end) { setError('La date de début doit précéder la date de fin.'); return; }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setLoading(true);
    try {
      const payload = {
        weights: Object.fromEntries(valid.map(x => [x.t, x.w])),
        benchmark, rebalance: o.rebalance ?? rebalance,
        var_confidence: confLevel(),
        forecast_days: parseInt(fd, 10) || 252,
        ...(timeMode === 'preset' ? { period: o.period ?? period } : { start_date: start, end_date: end }),
        ...(capital > 0 ? { initial_capital: capital } : {}),
      };
      const res = await axios.post(`${API}/api/portfolio/analyze`, payload, { signal: ctrl.signal });
      setData(res.data);
    } catch (err) {
      if (axios.isCancel(err)) return;
      setError(err.response?.data?.detail || "Impossible de joindre l'API (le serveur Python est-il lancé ?).");
    } finally {
      if (abortRef.current === ctrl) setLoading(false);
    }
  };

  const m = data?.metrics;
  const isMoney = Boolean(data?.money_summary);
  const filledCount = rows.filter(r => r.ticker.trim()).length;

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 16, alignItems: 'stretch' }}>
        {/* ---------------- COMPOSITION ---------------- */}
        <div className="panel" style={{ flex: '2 1 600px', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Layers size={16} /> Composition du portefeuille
            </h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Je saisis</span>
              <Segmented value={inputMode} onChange={switchMode} options={[{ value: 'weight', label: 'des %' }, { value: 'amount', label: 'des montants' }]} />
              <select value="" onChange={(e) => applyPreset(e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }}>
                <option value="">Modèles…</option>
                {PRESETS.map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
              </select>
            </div>
          </div>

          {/* En-têtes de colonnes (une seule fois, plus de « % » répétés sur chaque ligne) */}
          <div style={{ display: 'grid', gridTemplateColumns: '10px minmax(0,1fr) 110px 130px 30px', gap: 8, padding: '0 0 6px', borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
            <span />
            <span className="label" style={{ margin: 0 }}>Actif</span>
            <span className="label" style={{ margin: 0, textAlign: 'right' }}>Poids</span>
            <span className="label" style={{ margin: 0, textAlign: 'right' }}>Montant ({currency})</span>
            <span />
          </div>

          {rows.map((r, i) => (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '10px minmax(0,1fr) 110px 130px 30px', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: COLORS[i % COLORS.length], opacity: r.ticker ? 1 : 0.25 }} />
              <AssetSearchInput value={r.ticker} onChange={(t) => update(r.id, 'ticker', t)} onSelect={(t) => update(r.id, 'ticker', t)}
                onEnter={() => simulate()} placeholder="Rechercher un actif…" />
              {inputMode === 'weight'
                ? <UnitInput value={r.weight} onChange={(v) => update(r.id, 'weight', v)} unit="%" onEnter={() => simulate()} />
                : <span style={{ textAlign: 'right', color: 'var(--muted-2)', fontVariantNumeric: 'tabular-nums', paddingRight: 8 }}>{weights[i] ? `${fmt(weights[i], 1)} %` : '—'}</span>}
              {inputMode === 'amount'
                ? <UnitInput value={r.amount} onChange={(v) => update(r.id, 'amount', v)} unit={currency} onEnter={() => simulate()} />
                : <span style={{ textAlign: 'right', color: 'var(--muted-2)', fontVariantNumeric: 'tabular-nums', paddingRight: 8 }}>{amounts[i] ? fmt(amounts[i], 0) : '—'}</span>}
              <button type="button" className="icon-btn" title="Supprimer la ligne" onClick={() => removeRow(r.id)} style={{ color: '#9ca3af' }}>
                <Trash2 size={15} />
              </button>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="btn" onClick={() => setRows(rs => [...rs, newRow()])}><Plus size={14} /> Ajouter un actif</button>
            {inputMode === 'weight' && <>
              <button type="button" className="btn" onClick={equalWeights} disabled={!filledCount} title="Même poids pour chaque actif renseigné"><Equal size={14} /> Répartir équitablement</button>
              <button type="button" className="btn" onClick={normalize} disabled={sum <= 0 || Math.abs(sum - 100) < 0.01} title="Garde les proportions mais ramène le total à 100 %"><Scale size={14} /> Ajuster à 100 %</button>
            </>}
            <div style={{ flex: 1 }} />
            {inputMode === 'weight' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Capital total (optionnel)</span>
                <UnitInput value={totalCapital} onChange={setTotalCapital} unit={currency} onEnter={() => simulate()} width={130} />
              </div>
            ) : (
              <span style={{ fontSize: 13, color: 'var(--muted-2)' }}>Capital total : <strong style={{ color: '#fff' }}>{fmt(capital, 0)} {currency}</strong></span>
            )}
          </div>

          {inputMode === 'weight' && <AllocationBar rows={rows} weights={weights} sum={sum} />}
          {inputMode === 'amount' && capital > 0 && <AllocationBar rows={rows} weights={weights} sum={100} />}
        </div>

        {/* ---------------- PARAMÈTRES ---------------- */}
        <div className="panel" style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Paramètres de simulation</h3>
          <PeriodPicker mode={timeMode} onModeChange={setTimeMode} period={period} onPeriodChange={(p) => { setPeriod(p); if (data) simulate({ period: p }); }}
            start={start} end={end} onStartChange={setStart} onEndChange={setEnd} today={today} />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Field label="Benchmark" style={{ flex: 1, minWidth: 150 }}>
              <select value={benchmark} onChange={(e) => setBenchmark(e.target.value)} style={{ width: '100%' }}>
                {BENCHMARKS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
            </Field>
            <Field label="Devise" style={{ width: 80 }}>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ width: '100%' }}><option value="€">€</option><option value="$">$</option></select>
            </Field>
          </div>
          <Field label="Rééquilibrage">
            <select value={rebalance} onChange={(e) => { setRebalance(e.target.value); if (data) simulate({ rebalance: e.target.value }); }} style={{ width: '100%' }}>
              {REBALANCE.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, lineHeight: 1.4 }}>
              {rebalance === 'none' ? 'Les poids dérivent avec les cours : ce qui monte pèse de plus en plus lourd.'
                : rebalance === 'monthly' ? 'Chaque début de mois, on revend ce qui a monté pour racheter ce qui a baissé.'
                  : 'Poids remis à la cible chaque jour (modèle théorique).'}
            </div>
          </Field>
          <button type="button" className="btn btn-primary" onClick={() => simulate()} disabled={loading} style={{ padding: '10px 14px', fontSize: 13, marginTop: 'auto' }}>
            <Play size={14} /> {loading ? 'Calcul…' : 'Simuler le portefeuille'}
          </button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}
      {!data && !loading && <EmptyState>Composez votre portefeuille (ou choisissez un modèle) puis lancez la simulation.</EmptyState>}

      {data && (
        <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
          <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 10 }}>
            Simulation du {data.period_start} au {data.period_end} · {REBALANCE.find(r => r.value === data.rebalance)?.label} · référence <strong style={{ color: 'var(--text-2)' }}>{data.benchmark_label}</strong>
            {' '}· historique commun à tous les actifs uniquement
          </div>

          <div className="panel" style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, padding: '12px 20px' }}>
            <div><span className="label">Capital initial</span><strong style={{ fontSize: 19 }}>{isMoney ? `${fmt(data.money_summary.initial_capital, 0)} ${currency}` : '—'}</strong></div>
            <div><span className="label">Valeur finale</span><strong style={{ fontSize: 19 }}>{isMoney ? `${fmt(data.money_summary.final_value, 0)} ${currency}` : '—'}</strong></div>
            <div><span className="label">Gain / perte</span><strong style={{ fontSize: 19, color: isMoney ? signColor(data.money_summary.profit_loss) : undefined }}>{isMoney ? `${fmt(data.money_summary.profit_loss, 0, true)} ${currency}` : '—'}</strong></div>
            <div><span className="label">Rendement</span><strong style={{ fontSize: 19, color: signColor(m.total_change_pct) }}>{fmt(m.total_change_pct, 2, true)} %</strong>
              <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 6 }}>soit {fmt(m.cagr_pct, 2, true)} %/an</span></div>
          </div>

          <StatsDashboard metrics={m} interpretations={data.interpretations} varInput={varInput} onVarChange={setVarInput} onVarSubmit={() => simulate()}
            footer={`Calculé sur ${m.observations} séances communes · taux sans risque 2 %`} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: 16, marginBottom: 16 }}>
            <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
                <Segmented value={chartType} onChange={setChartType} options={[
                  { value: 'line', label: 'Valeur vs benchmark', icon: <Activity size={13} /> },
                  { value: 'drawdown', label: 'Drawdown', icon: <ShieldAlert size={13} />, accent: '#f23645' },
                ]} />
                <button type="button" className="icon-btn" title="Plein écran"
                  onClick={() => onFullscreen({ kind: 'chart', title: 'Portefeuille', props: { data: data.chart_data, type: chartType, lineColor: '#089981', isMoney, currency, compareKey: 'benchmark', compareLabel: data.benchmark_label, mainLabel: 'Portefeuille' } })}>
                  <Maximize2 size={15} />
                </button>
              </div>
              <div style={{ flex: 1, minHeight: 360 }}>
                <ChartErrorBoundary>
                  <TradingViewChart data={data.chart_data} type={chartType} lineColor="#089981" isMoney={isMoney} currency={currency}
                    compareKey="benchmark" compareLabel={data.benchmark_label} mainLabel="Portefeuille" />
                </ChartErrorBoundary>
              </div>
              {chartType === 'line' && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Trait vert : portefeuille · pointillés gris : {data.benchmark_label} {isMoney ? 'avec le même capital' : '(base 100)'}</div>}
            </div>
            <MonteCarloCard mc={data.monte_carlo} forecastDays={forecastDays} currency={currency}
              onHorizonChange={(d) => { setForecastDays(d); simulate({ forecastDays: d }); }}
              onFullscreen={() => onFullscreen({ kind: 'mc', forecastDays, props: { data: data.monte_carlo.chart_data } })} />
          </div>

          {/* Détail par ligne */}
          <div className="panel" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Détail par actif</h3>
              <div style={{ display: 'flex', gap: 18, fontSize: 12, color: 'var(--muted-2)', flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Corrélation moyenne : <strong style={{ color: '#fff' }}>{fmt(data.breakdown.average_correlation, 2)}</strong>
                  <HelpButtons definition={DEFINITIONS.average_correlation} size={13} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Ratio de diversification : <strong style={{ color: '#fff' }}>{fmt(data.breakdown.diversification_ratio, 2)}</strong>
                  <HelpButtons definition={DEFINITIONS.diversification_ratio} size={13} /></span>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Actif</th><th className="num">Poids</th><th className="num">Perf. totale</th><th className="num">CAGR</th>
                    <th className="num">Volatilité</th><th className="num">Max DD</th><th className="num">Sharpe</th>
                    <th className="num"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>Contrib. perf.<HelpButtons definition={DEFINITIONS.return_contribution} size={12} /></span></th>
                    <th style={{ minWidth: 160 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>Part du risque<HelpButtons definition={DEFINITIONS.risk_contribution} size={12} /></span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.breakdown.assets.map((a, i) => (
                    <tr key={a.ticker}>
                      <td><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: COLORS[data.tickers.indexOf(a.ticker) % COLORS.length], marginRight: 8 }} />
                        <strong>{nameOf(a.ticker)}</strong> <span style={{ color: 'var(--muted)' }}>{a.ticker}</span></td>
                      <td className="num">{fmt(a.weight_pct, 1)} %</td>
                      <td className="num" style={{ color: signColor(a.total_return_pct) }}>{fmt(a.total_return_pct, 1, true)} %</td>
                      <td className="num" style={{ color: signColor(a.cagr_pct) }}>{fmt(a.cagr_pct, 1, true)} %</td>
                      <td className="num">{fmt(a.volatility_pct, 1)} %</td>
                      <td className="num" style={{ color: 'var(--red)' }}>{fmt(a.max_drawdown_pct, 1)} %</td>
                      <td className="num">{fmt(a.sharpe_ratio, 2)}</td>
                      <td className="num" style={{ color: signColor(a.return_contribution_pct) }}>{fmt(a.return_contribution_pct, 1, true)} pts</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 6, background: '#0b0f17', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.max(0, Math.min(100, a.risk_contribution_pct))}%`, height: '100%', background: a.risk_contribution_pct > a.weight_pct * 1.5 ? 'var(--amber)' : COLORS[i % COLORS.length] }} />
                          </div>
                          <span style={{ fontVariantNumeric: 'tabular-nums', width: 46, textAlign: 'right' }}>{fmt(a.risk_contribution_pct, 1)} %</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>Barre orange : la ligne pèse beaucoup plus dans le risque que dans le capital.</div>
          </div>

          {data.breakdown.correlation.tickers.length > 1 && (
            <div className="panel" style={{ marginBottom: 24 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Matrice de corrélation</h3>
              <CorrelationMatrix corr={data.breakdown.correlation} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(PortfolioView);
