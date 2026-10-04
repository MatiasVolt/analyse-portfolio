import { memo, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Layers, Plus, Trash2, Activity, ShieldAlert, Maximize2, Equal, Scale, Play, PieChart, Settings2, Lock, LockOpen } from 'lucide-react';
import PortfolioLibrary from '../components/PortfolioLibrary';
import AssetSearchInput from '../components/AssetSearchInput';
import PeriodPicker from '../components/PeriodPicker';
import StatsDashboard from '../components/StatsDashboard';
import MonteCarloCard from '../components/MonteCarloCard';
import { EventsPanel } from '../components/Calendar';
import TradingViewChart, { ChartErrorBoundary } from '../components/TradingViewChart';
import { Field, Segmented, HelpButtons, EmptyState } from '../components/ui';
import { getAsset } from '../tickerDatabase';
import { API, BENCHMARKS, COLORS, fmt, fmtDate, parseNum, signColor } from '../format';
import { DEFINITIONS } from '../definitions';
import { useLang, trName } from '../i18n';

// Identifiant unique de ligne. Pas de simple compteur de module : il repart à 1 à chaque rechargement à chaud (HMR)
// alors que les lignes déjà affichées sont conservées -> deux lignes avec le même id (saisie dupliquée, lignes en double).
let seq = 0;
const uid = () => `${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const newRow = (ticker = '', weight = '', amount = '') => ({ id: uid(), ticker, weight, amount });

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
const nameOf = (tk) => trName(getAsset(tk)?.name) || tk;

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
  const { t } = useLang();
  const over = sum > 100.5;
  const ok = Math.abs(sum - 100) <= 0.5;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: '#0b0f17', border: '1px solid var(--border-2)' }}>
        {rows.map((r, i) => weights[i] > 0 && (
          <div key={r.id} title={`${nameOf(r.ticker) || t('Actif')} : ${fmt(weights[i], 1)} %`}
            style={{ width: `${Math.min(weights[i], 100) / Math.max(sum, 100) * 100}%`, background: COLORS[i % COLORS.length] }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12 }}>
        <span style={{ color: ok ? 'var(--green)' : over ? 'var(--red)' : 'var(--amber)', fontWeight: 600 }}>
          {t('Total alloué : {v} %', { v: fmt(sum, 1) })}
        </span>
        <span style={{ color: 'var(--muted)' }}>
          {ok ? t('Prêt à simuler') : over ? t('Dépasse de {v} %', { v: fmt(sum - 100, 1) }) : t('Reste {v} % à répartir', { v: fmt(100 - sum, 1) })}
        </span>
      </div>
    </div>
  );
}

function CorrelationMatrix({ corr }) {
  const { t } = useLang();
  if (!corr || corr.tickers.length < 2) return null;
  const cell = (v) => {
    const a = Math.abs(v);
    const bg = v >= 0 ? `rgba(229,72,77,${0.12 + a * 0.6})` : `rgba(43,179,163,${0.12 + a * 0.6})`;
    return { background: bg, color: a > 0.5 ? '#fff' : 'var(--text-2)' };
  };
  // Paires extrêmes (lecture rapide de la matrice, simple affichage)
  const pairs = [];
  corr.matrix.forEach((row, i) => row.forEach((v, j) => { if (j > i && v !== null && v !== undefined) pairs.push({ a: corr.tickers[i], b: corr.tickers[j], v }); }));
  pairs.sort((x, y) => y.v - x.v);
  const hi = pairs[0], lo = pairs[pairs.length - 1];
  return (
    <div className="corr-layout">
      <div style={{ overflowX: 'auto', minWidth: 0 }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 3, fontSize: 12 }}>
          <thead>
            <tr><th />{corr.tickers.map(tk => <th key={tk} style={{ padding: '4px 6px', color: 'var(--muted)', fontWeight: 600 }}>{tk}</th>)}</tr>
          </thead>
          <tbody>
            {corr.matrix.map((row, i) => (
              <tr key={corr.tickers[i]}>
                <td style={{ padding: '4px 8px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{corr.tickers[i]}</td>
                {row.map((v, j) => (
                  <td key={j} style={{ padding: '7px 8px', textAlign: 'center', borderRadius: 4, minWidth: 56, fontVariantNumeric: 'tabular-nums', ...(i === j ? { color: 'var(--muted)', background: 'var(--panel-2)' } : cell(v)) }}>{fmt(v, 2)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="corr-side">
        <div className="corr-scale">
          <span>−1</span><div className="corr-gradient" /><span>+1</span>
        </div>
        <div className="hint" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}><span>{t('Sens inverse')}</span><span>{t('Ensemble')}</span></div>
        {hi && (
          <div className="corr-fact">
            <span className="label">{t('Paire la plus liée')}</span>
            <strong>{nameOf(hi.a)} / {nameOf(hi.b)}</strong> <span className="corr-val" style={cell(hi.v)}>{fmt(hi.v, 2)}</span>
          </div>
        )}
        {lo && lo !== hi && (
          <div className="corr-fact">
            <span className="label">{t('Meilleure diversification')}</span>
            <strong>{nameOf(lo.a)} / {nameOf(lo.b)}</strong> <span className="corr-val" style={cell(lo.v)}>{fmt(lo.v, 2)}</span>
          </div>
        )}
        <div className="hint">{t('Rouge : les actifs montent et baissent ensemble. Bleu : ils évoluent en sens inverse, ce qui amortit les baisses du portefeuille.')}</div>
      </div>
    </div>
  );
}

function PortfolioView({ shared, onFullscreen, onOpenCalendar }) {
  const { today, varInput, setVarInput, confLevel, forecastDays, setForecastDays, currency, setCurrency } = shared;
  const { t, lang } = useLang();

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
  const [pendingDays, setPendingDays] = useState(null);
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

  /**
   * Barre coulissante : fixe le poids de la ligne, puis répartit le reste (100 % − lignes verrouillées − cette ligne)
   * entre les autres lignes non verrouillées, proportionnellement à leurs poids actuels (à parts égales s'ils sont nuls).
   */
  const slideWeight = (id, raw) => setRows(rs => {
    const num = (r) => Math.max(parseNum(r.weight) || 0, 0);
    const lockedSum = rs.filter(r => r.locked && r.id !== id).reduce((a, r) => a + num(r), 0);
    const w = Math.max(0, Math.min(parseFloat(raw) || 0, 100 - lockedSum));
    const others = rs.filter(r => r.id !== id && !r.locked && r.ticker.trim());
    if (!others.length) return rs.map(r => (r.id === id ? { ...r, weight: String(round2(w)) } : r));
    const othersSum = others.reduce((a, r) => a + num(r), 0);
    const remaining = Math.max(0, 100 - lockedSum - w);
    const next = new Map(others.map(r => [r.id, round2(othersSum > 0 ? (remaining * num(r)) / othersSum : remaining / others.length)]));
    // Corrige l'arrondi sur la dernière ligne ajustée pour retomber exactement sur 100 %
    const drift = round2(remaining - [...next.values()].reduce((a, b) => a + b, 0));
    const lastId = others[others.length - 1].id;
    next.set(lastId, round2(Math.max(0, next.get(lastId) + drift)));
    return rs.map(r => (r.id === id ? { ...r, weight: String(round2(w)) } : next.has(r.id) ? { ...r, weight: String(next.get(r.id)) } : r));
  });
  const toggleLock = (id) => setRows(rs => rs.map(r => (r.id === id ? { ...r, locked: !r.locked } : r)));

  const loadSaved = (p) => {
    setInputMode('weight');
    setRows(p.items.map(([tk, w]) => newRow(tk, String(w))));
    setRebalance(p.rebalance || 'none');
  };

  const switchMode = (mode) => {
    if (mode === inputMode) return;
    if (mode === 'amount') {
      setRows(rs => rs.map((r, i) => ({ ...r, amount: amounts[i] ? String(Math.round(amounts[i])) : '' })));
    } else if (capital > 0) {
      setRows(rs => rs.map((r, i) => ({ ...r, weight: weights[i] ? String(round2(weights[i])) : '' })));
      setTotalCapital(String(Math.round(capital)));
    } // aucun montant saisi : on garde les % d'avant au lieu de tout effacer
    setInputMode(mode);
  };

  const equalWeights = () => {
    // Compteur local à l'updater : React (StrictMode) peut l'appeler deux fois
    setRows(rs => {
      const n = rs.filter(r => r.ticker.trim()).length;
      if (!n) return rs;
      const each = round2(100 / n);
      let given = 0;
      return rs.map(r => {
        if (!r.ticker.trim()) return { ...r, weight: '' };
        given += 1;
        return { ...r, weight: String(given === n ? round2(100 - each * (n - 1)) : each) };
      });
    });
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
    if (!valid.length) { setError(t('Ajoutez au moins un actif avec une pondération ou un montant.')); return; }
    const dup = valid.find((x, i) => valid.findIndex(y => y.t === x.t) !== i);
    if (dup) { setError(t('« {n} » apparaît deux fois : fusionnez les deux lignes.', { n: nameOf(dup.t) })); return; }
    const total = valid.reduce((a, x) => a + x.w, 0);
    if (Math.abs(total - 100) > 0.5) { setError(t('La somme des pondérations doit faire 100 % (actuellement {v} %). Utilisez « Ajuster à 100 % ».', { v: fmt(total, 1) })); return; }
    if (timeMode === 'custom' && start >= end) { setError(t('La date de début doit précéder la date de fin.')); return; }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setLoading(true);
    setPendingDays(String(fd));
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
      setData({ ...res.data, _days: String(fd), _conf: payload.var_confidence });
    } catch (err) {
      if (axios.isCancel(err)) return;
      setError(err.response?.data?.detail || t("Impossible de joindre l'API (le serveur Python est-il lancé ?)."));
    } finally {
      if (abortRef.current === ctrl) { setLoading(false); setPendingDays(null); }
    }
  };

  // Changement de langue : on relance la simulation pour récupérer les textes traduits
  useEffect(() => {
    if (data) simulate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const m = data?.metrics;
  const isMoney = Boolean(data?.money_summary);
  const filledCount = rows.filter(r => r.ticker.trim()).length;

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 16, alignItems: 'stretch' }}>
        {/* ---------------- COMPOSITION ---------------- */}
        <div className="panel" style={{ flex: '2 1 600px', minWidth: 0 }}>
          <div className="panel-head">
            <h3 className="section-title"><Layers size={16} /> {t('Composition du portefeuille')}</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('Je saisis')}</span>
              <Segmented value={inputMode} onChange={switchMode} options={[{ value: 'weight', label: 'des %' }, { value: 'amount', label: 'des montants' }]} />
              <select value="" onChange={(e) => applyPreset(e.target.value)} style={{ fontSize: 12, padding: '5px 8px' }}>
                <option value="">{t('Modèles…')}</option>
                {PRESETS.map(p => <option key={p.label} value={p.label}>{t(p.label)}</option>)}
              </select>
            </div>
          </div>

          {/* En-têtes de colonnes (une seule fois, plus de « % » répétés sur chaque ligne) */}
          <div className="alloc-row alloc-head">
            <span />
            <span className="label" style={{ margin: 0 }}>{t('Actif')}</span>
            <span className="label" style={{ margin: 0, textAlign: 'right' }}>{t('Poids')}</span>
            <span className="label" style={{ margin: 0, textAlign: 'right' }}>{t('Montant')} ({currency})</span>
            <span />
          </div>

          {rows.map((r, i) => (
            <div key={r.id} className="alloc-row">
              <span className="alloc-dot" style={{ background: COLORS[i % COLORS.length], opacity: r.ticker ? 1 : 0.25 }} />
              <AssetSearchInput value={r.ticker} onChange={(tk) => update(r.id, 'ticker', tk)}
                onEnter={() => simulate()} placeholder="Rechercher un actif…" />
              {inputMode === 'weight'
                ? <UnitInput value={r.weight} onChange={(v) => update(r.id, 'weight', v)} unit="%" onEnter={() => simulate()} />
                : <span className="alloc-derived">{weights[i] ? `${fmt(weights[i], 1)} %` : '—'}</span>}
              {inputMode === 'amount'
                ? <UnitInput value={r.amount} onChange={(v) => update(r.id, 'amount', v)} unit={currency} onEnter={() => simulate()} />
                : <span className="alloc-derived">{amounts[i] ? `${fmt(amounts[i], 0)} ${currency}` : '—'}</span>}
              <button type="button" className="icon-btn" title={t('Supprimer la ligne')} onClick={() => removeRow(r.id)} style={{ color: '#9ca3af' }}>
                <Trash2 size={15} />
              </button>
              {inputMode === 'weight' && (
                <div className="alloc-slider-row">
                  {/* Barre coulissante : les autres lignes non verrouillées s'ajustent pour rester à 100 % */}
                  <input type="range" className="alloc-slider" min="0" max="100" step="0.5" disabled={r.locked}
                    value={Math.min(100, Math.max(0, weights[i] || 0))}
                    onChange={(e) => slideWeight(r.id, e.target.value)}
                    style={{ '--fill': COLORS[i % COLORS.length], '--pct': `${Math.min(100, weights[i] || 0)}%` }}
                    aria-label={`${t('Poids')} ${nameOf(r.ticker) || ''}`} />
                  <button type="button" className={`icon-btn lock-btn${r.locked ? ' active' : ''}`} onClick={() => toggleLock(r.id)} aria-pressed={Boolean(r.locked)}
                    title={r.locked ? t('Déverrouiller : ce poids pourra de nouveau être ajusté automatiquement') : t('Verrouiller ce poids : il ne bougera plus quand vous déplacez les autres barres')}>
                    {r.locked ? <Lock size={13} /> : <LockOpen size={13} />}
                  </button>
                </div>
              )}
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="btn" onClick={() => setRows(rs => [...rs, newRow()])}><Plus size={14} /> {t('Ajouter un actif')}</button>
            {inputMode === 'weight' && <>
              <button type="button" className="btn" onClick={equalWeights} disabled={!filledCount} title={t('Même poids pour chaque actif renseigné')}><Equal size={14} /> {t('Répartir équitablement')}</button>
              <button type="button" className="btn" onClick={normalize} disabled={sum <= 0 || Math.abs(sum - 100) < 0.01} title={t('Garde les proportions mais ramène le total à 100 %')}><Scale size={14} /> {t('Ajuster à 100 %')}</button>
            </>}
            <div style={{ flex: 1 }} />
            {inputMode === 'weight' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('Capital total (optionnel)')}</span>
                <UnitInput value={totalCapital} onChange={setTotalCapital} unit={currency} onEnter={() => simulate()} width={130} />
              </div>
            ) : (
              <span style={{ fontSize: 13, color: 'var(--muted-2)' }}>{t('Capital total :')} <strong style={{ color: '#fff' }}>{fmt(capital, 0)} {currency}</strong></span>
            )}
          </div>

          {inputMode === 'weight' && <AllocationBar rows={rows} weights={weights} sum={sum} />}
          {inputMode === 'amount' && capital > 0 && <AllocationBar rows={rows} weights={weights} sum={100} />}
        </div>

        {/* ---------------- PARAMÈTRES ---------------- */}
        <div className="panel" style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h3 className="section-title"><Settings2 size={16} /> {t('Paramètres de simulation')}</h3>
          </div>
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
              {REBALANCE.map(r => <option key={r.value} value={r.value}>{t(r.label)}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5, lineHeight: 1.4 }}>
              {t(rebalance === 'none' ? 'Les poids dérivent avec les cours : ce qui monte pèse de plus en plus lourd.'
                : rebalance === 'monthly' ? 'Chaque début de mois, on revend ce qui a monté pour racheter ce qui a baissé.'
                  : 'Poids remis à la cible chaque jour (modèle théorique).')}
            </div>
          </Field>
          <button type="button" className="btn btn-primary" onClick={() => simulate()} disabled={loading} style={{ padding: '10px 14px', fontSize: 13, marginTop: 'auto' }}>
            <Play size={14} /> {loading ? t('Calcul…') : t('Simuler le portefeuille')}
          </button>
        </div>
      </div>

      <PortfolioLibrary
        currentItems={rows.map((r, i) => [r.ticker.trim().toUpperCase(), round2(weights[i])]).filter(([tk, w]) => tk && w > 0)}
        rebalance={rebalance} onLoad={loadSaved}
        compareParams={{
          benchmark, var_confidence: confLevel(),
          ...(timeMode === 'preset' ? { period } : { start_date: start, end_date: end }),
        }} />

      {error && <div className="error-box">{error}</div>}
      {!data && !loading && (
        <EmptyState icon={PieChart} title="Aucune simulation pour l'instant">
          Ajoutez des actifs avec leur poids (ou partez d'un « Modèle… »), puis cliquez sur « Simuler le portefeuille » pour obtenir l'historique, le risque et la projection.
        </EmptyState>
      )}

      {data && (
        <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
          <div className="result-head">
            <div className="result-title">
              <h1>{t('Résultats de la simulation')}</h1>
              <span className="tag">{t(data.tickers.length > 1 ? '{n} actifs' : '{n} actif', { n: data.tickers.length })}</span>
              <span className="tag">{t('Rééquilibrage :')} {t(REBALANCE.find(r => r.value === data.rebalance)?.label || '').split(' (')[0]}</span>
            </div>
            <div className="result-meta">
              {t('Du {a} au {b}', { a: fmtDate(data.period_start), b: fmtDate(data.period_end) })} {t('(historique commun à tous les actifs)')} · {t('Référence :')} <strong>{data.benchmark_label}</strong>
            </div>
          </div>

          <div className="panel kpi-strip">
            <div><span className="label">{t('Capital initial')}</span>{isMoney ? <strong className="kpi-value">{fmt(data.money_summary.initial_capital, 0)} {currency}</strong>
              : <><strong className="kpi-value dim">—</strong><span className="kpi-sub">{t('Renseignez un capital total')}</span></>}</div>
            <div><span className="label">{t('Valeur finale')}</span>{isMoney ? <strong className="kpi-value">{fmt(data.money_summary.final_value, 0)} {currency}</strong>
              : <strong className="kpi-value dim">—</strong>}</div>
            <div><span className="label">{t('Gain / perte')}</span>{isMoney ? <strong className="kpi-value" style={{ color: signColor(data.money_summary.profit_loss) }}>{fmt(data.money_summary.profit_loss, 0, true)} {currency}</strong>
              : <strong className="kpi-value dim">—</strong>}</div>
            <div><span className="label">{t('Rendement')}</span><strong className="kpi-value" style={{ color: signColor(m.total_change_pct) }}>{fmt(m.total_change_pct, 2, true)} %</strong>
              <span className="kpi-sub">{t('soit {v} % par an', { v: fmt(m.cagr_pct, 2, true) })}</span></div>
          </div>

          <StatsDashboard metrics={m} interpretations={data.interpretations} varInput={varInput} onVarChange={setVarInput} onVarSubmit={() => simulate()} confUsed={data._conf}
            footer={t('Calculé sur {n} séances communes · taux sans risque {r} %', { n: m.observations, r: fmt(m.risk_free_pct, 2) })} />

          <div className="grid-2" style={{ marginBottom: 16 }}>
            <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
                <Segmented value={chartType} onChange={setChartType} options={[
                  { value: 'line', label: 'Valeur vs benchmark', icon: <Activity size={13} /> },
                  { value: 'drawdown', label: 'Drawdown', icon: <ShieldAlert size={13} />, accent: '#e5484d' },
                ]} />
                <button type="button" className="icon-btn" title={t('Plein écran')}
                  onClick={() => onFullscreen({ kind: 'chart', title: 'Portefeuille', props: { data: data.chart_data, type: chartType, lineColor: '#e0a43a', isMoney, currency, compareKey: 'benchmark', compareLabel: data.benchmark_label, mainLabel: 'Portefeuille' } })}>
                  <Maximize2 size={15} />
                </button>
              </div>
              <div style={{ flex: 1, minHeight: 360 }}>
                <ChartErrorBoundary resetKey={data}>
                  <TradingViewChart data={data.chart_data} type={chartType} lineColor="#e0a43a" isMoney={isMoney} currency={currency}
                    compareKey="benchmark" compareLabel={data.benchmark_label} mainLabel="Portefeuille" />
                </ChartErrorBoundary>
              </div>
              {chartType === 'line' && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{t('Trait ambre : portefeuille · pointillés gris :')} {data.benchmark_label} {isMoney ? t('avec le même capital') : t('(base 100)')}</div>}
            </div>
            <MonteCarloCard mc={data.monte_carlo} forecastDays={pendingDays ?? data._days} computedDays={data._days} currency={currency}
              onHorizonChange={(d) => { setForecastDays(d); simulate({ forecastDays: d }); }}
              onFullscreen={() => onFullscreen({ kind: 'mc', forecastDays: data._days, props: { data: data.monte_carlo.chart_data } })} />
          </div>

          {/* Détail par ligne */}
          <div className="panel" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
              <h3 className="section-title">{t('Détail par actif')}</h3>
              <div style={{ display: 'flex', gap: 18, fontSize: 12, color: 'var(--muted-2)', flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{t('Corrélation moyenne :')} <strong style={{ color: '#fff' }}>{fmt(data.breakdown.average_correlation, 2)}</strong>
                  <HelpButtons definition={DEFINITIONS.average_correlation} size={13} /></span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{t('Ratio de diversification :')} <strong style={{ color: '#fff' }}>{fmt(data.breakdown.diversification_ratio, 2)}</strong>
                  <HelpButtons definition={DEFINITIONS.diversification_ratio} size={13} /></span>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('Actif')}</th><th className="num">{t('Poids')}</th><th className="num">{t('Perf. totale')}</th><th className="num">CAGR</th>
                    <th className="num">{t('Volatilité')}</th><th className="num">Max DD</th><th className="num">Sharpe</th>
                    <th className="num"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>{t('Contrib. perf.')}<HelpButtons definition={DEFINITIONS.return_contribution} size={12} /></span></th>
                    <th style={{ minWidth: 160 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>{t('Part du risque')}<HelpButtons definition={DEFINITIONS.risk_contribution} size={12} /></span></th>
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
                      <td className="num" style={{ color: signColor(a.return_contribution_pct) }}>{fmt(a.return_contribution_pct, 1, true)} {t('pts')}</td>
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
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>{t('Barre orange : la ligne pèse beaucoup plus dans le risque que dans le capital.')}</div>
          </div>

          {data.breakdown.correlation.tickers.length > 1 && (
            <div className="panel" style={{ marginBottom: 24 }}>
              <h3 className="section-title" style={{ marginBottom: 12 }}>{t('Matrice de corrélation')}</h3>
              <CorrelationMatrix corr={data.breakdown.correlation} />
            </div>
          )}

          <EventsPanel tickers={data.tickers} weights={data.tickers.map(tk => data.weights[tk])}
            title="Annonces économiques qui concernent ce portefeuille" onOpenCalendar={onOpenCalendar} />
        </div>
      )}
    </div>
  );
}

export default memo(PortfolioView);
