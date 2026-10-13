import { memo, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Search, Activity, BarChart2, ShieldAlert, Maximize2, ChartLine, Loader2 } from 'lucide-react';
import AssetSearchInput from '../components/AssetSearchInput';
import PeriodPicker from '../components/PeriodPicker';
import StatsDashboard from '../components/StatsDashboard';
import { annualNote, periodFooter } from '../periodText';
import MonteCarloCard from '../components/MonteCarloCard';
import { EventsPanel } from '../components/Calendar';
import TradingViewChart, { ChartErrorBoundary } from '../components/TradingViewChart';
import { Field, Segmented, EmptyState } from '../components/ui';
import { getAsset } from '../tickerDatabase';
import { API, BENCHMARKS, currencySymbol, fmt, fmtDate, parseNum, signColor } from '../format';
import { ASSET_CLASS_LABELS } from '../definitions';
import { useLang, trName } from '../i18n';

const QUICK = [
  { label: 'S&P 500', ticker: '^GSPC' }, { label: 'CAC 40', ticker: '^FCHI' }, { label: 'MSCI World', ticker: 'CW8.PA' },
  { label: 'Apple', ticker: 'AAPL' }, { label: 'Nvidia', ticker: 'NVDA' }, { label: 'LVMH', ticker: 'MC.PA' },
  { label: 'Bitcoin', ticker: 'BTC-USD' }, { label: 'Or', ticker: 'GC=F' }, { label: 'EUR/USD', ticker: 'EURUSD=X' },
];

const CHART_TYPES = [
  { value: 'line', label: 'Courbe', icon: <Activity size={13} /> },
  { value: 'candle', label: 'Chandeliers', icon: <BarChart2 size={13} /> },
  { value: 'drawdown', label: 'Drawdown', icon: <ShieldAlert size={13} />, accent: 'var(--red)' },
];

function AssetView({ shared, externalRequest, onFullscreen, onOpenCalendar }) {
  const { today, varInput, setVarInput, confLevel, rfInput, setRfInput, rfOverride, forecastDays, setForecastDays } = shared;
  const { t, lang } = useLang();

  const [ticker, setTicker] = useState('');
  const [benchmark, setBenchmark] = useState('');
  const [timeMode, setTimeMode] = useState('preset');
  const [period, setPeriod] = useState('1y');
  const [start, setStart] = useState('2020-01-01');
  const [end, setEnd] = useState(today);
  const [capital, setCapital] = useState('');
  const [ccy, setCcy] = useState(''); // devise d'analyse : '' = devise de cotation, sinon 'EUR' ou 'USD' (cours convertis)
  const [chartType, setChartType] = useState('line');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pendingDays, setPendingDays] = useState(null);
  const abortRef = useRef(null);

  const run = async (o = {}) => {
    const p = { ticker, benchmark, timeMode, period, start, end, capital, forecastDays, conf: confLevel(), rf: rfOverride(), ccy, ...o };
    const tk = (p.ticker || '').trim().toUpperCase();
    if (!tk) { setError(t('Choisissez un actif dans la liste ou tapez un symbole.')); return; }
    if (p.timeMode === 'custom' && p.start >= p.end) { setError(t('La date de début doit précéder la date de fin.')); return; }

    abortRef.current?.abort(); // annule la requête précédente si on clique vite
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null);
    setLoading(true);
    setPendingDays(String(p.forecastDays));
    try {
      const params = { var_confidence: p.conf, forecast_days: p.forecastDays };
      if (p.benchmark) params.benchmark = p.benchmark;
      if (p.rf !== null) params.risk_free_pct = p.rf;
      if (p.ccy) params.currency = p.ccy;
      if (p.timeMode === 'preset') params.period = p.period;
      else { params.start_date = p.start; params.end_date = p.end; }
      const cap = parseNum(p.capital);
      if (cap > 0) params.initial_capital = cap;
      const res = await axios.get(`${API}/api/asset/${encodeURIComponent(tk)}`, { params, signal: ctrl.signal });
      setData({ ...res.data, _days: String(p.forecastDays), _conf: p.conf });
    } catch (err) {
      if (axios.isCancel(err)) return;
      setError(err.response?.data?.detail || t("Le service de données ne répond pas pour le moment. Réessayez dans un instant."));
    } finally {
      if (abortRef.current === ctrl) { setLoading(false); setPendingDays(null); }
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

  // Changement de langue : on relance l'analyse pour récupérer interprétations et libellés traduits
  useEffect(() => {
    if (data) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const pick = (tk) => { setTicker(tk); run({ ticker: tk }); };
  const cap = parseNum(capital);
  const hasCap = cap > 0;
  const m = data?.metrics;
  const isMoneyChart = Boolean(data?.money_summary);
  // Unité de l'axe : capital dans la devise choisie, sinon devise de cotation (points pour un indice)
  const currency = currencySymbol(m?.currency); // symbole de la devise dans laquelle les chiffres sont exprimés
  const isForex = data?.asset_class === 'FOREX';
  const chartUnit = isMoneyChart ? currency : data?.asset_class === 'INDEX' && !m?.converted ? t('Points') : m?.currency;

  return (
    <div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="form-row">
          <Field label="Actif" style={{ flex: '0 1 300px' }}>
            <AssetSearchInput value={ticker} onChange={setTicker} onSelect={pick} onEnter={() => run()} />
          </Field>
          <Field label="Comparer à">
            <select aria-label={t('Comparer à')} title={t("Indice de référence (benchmark) utilisé pour le bêta, l'alpha et la comparaison")} value={benchmark} onChange={(e) => { setBenchmark(e.target.value); if (data) run({ benchmark: e.target.value }); }}>
              <option value="">{t('Automatique (indice du pays)')}</option>
              {BENCHMARKS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </Field>
          <PeriodPicker mode={timeMode} onModeChange={setTimeMode} period={period}
            onPeriodChange={(p) => { setPeriod(p); if (ticker) run({ period: p, timeMode: 'preset' }); }}
            start={start} end={end} onStartChange={setStart} onEndChange={setEnd} today={today} />
          <button type="button" className="btn btn-primary" onClick={() => run()} disabled={loading} style={{ padding: '8px 18px' }}>
            <Search size={14} /> {loading ? t('Calcul…') : t('Analyser')}
          </button>
        </div>

        <div className="quick-row">
          <span className="label" style={{ margin: '0 6px 0 0' }}>{t('Accès rapide')}</span>
          {QUICK.map(q => (
            <button key={q.ticker} type="button" onClick={() => pick(q.ticker)}
              className={`btn btn-sm${ticker === q.ticker ? ' is-on' : ''}`} aria-pressed={ticker === q.ticker}>
              {t(q.label)}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error-box" role="alert">{error}</div>}

      {!data && !loading && (
        <EmptyState icon={ChartLine} title="Par où commencer ?">
          {"Tapez le nom d'une action, d'un ETF, d'un indice ou d'une crypto dans le champ « Actif », ou cliquez simplement sur un accès rapide (Apple, S&P 500…). Vous verrez ici sa performance, son niveau de risque et une projection de son évolution possible."}
        </EmptyState>
      )}
      {!data && loading && <EmptyState icon={Loader2} busy title="Analyse en cours…">{'Téléchargement des cours et calcul des indicateurs.'}</EmptyState>}

      {data && (
        <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .15s' }}>
          <div className="result-head">
            <div className="result-title">
              <h1>{trName(getAsset(data.ticker)?.name) || data.ticker}</h1>
              <span className="ticker">{data.ticker}</span>
              <span className="tag">{t(ASSET_CLASS_LABELS[data.asset_class] || data.asset_class)}</span>
            </div>
            <div className="result-meta" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span>{t('Du {a} au {b}', { a: fmtDate(data.period_start), b: fmtDate(data.period_end) })} {!isForex && <> · {t('Référence :')} <strong>{data.benchmark_label}</strong></>}</span>
            </div>
          </div>

          {/* Simulation d'un investissement */}
          <div className="panel kpi-strip">
            <Field label="Capital investi (optionnel)">
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="text" inputMode="decimal" value={capital} onChange={(e) => setCapital(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && run()} onBlur={() => { if (data && (parseNum(capital) > 0) !== isMoneyChart) run(); }}
                  style={{ width: 0, flex: 1, maxWidth: 120, textAlign: 'right' }} aria-label={t('Capital investi')} />
                <select value={isForex ? '' : ccy} disabled={isForex} onChange={(e) => { setCcy(e.target.value); run({ ccy: e.target.value }); }}
                  aria-label={t('Devise d’analyse')} title={t('Devise dans laquelle l’actif est analysé. En choisissant € ou $, les cours sont convertis au taux de change de chaque jour : la performance inclut alors l’effet de change.')}>
                  <option value="">{t('Devise de cotation')}{m?.listing_currency ? ` (${m.listing_currency})` : ''}</option>
                  <option value="EUR">€ (EUR)</option><option value="USD">$ (USD)</option>
                </select>
              </div>
            </Field>
            <div><span className="label">{t('Valeur finale')}</span>
              {hasCap ? <strong className="kpi-value">{fmt(cap * (1 + m.total_change_pct / 100), 0)} {currency}</strong>
                : <><strong className="kpi-value dim">—</strong><span className="kpi-sub">{t('Saisissez un capital')}</span></>}</div>
            <div><span className="label">{t('Gain / perte')}</span>
              {hasCap ? <strong className="kpi-value" style={{ color: signColor(m.total_change_pct) }}>{fmt(cap * m.total_change_pct / 100, 0, true)} {currency}</strong>
                : <><strong className="kpi-value dim">—</strong><span className="kpi-sub">{t('Saisissez un capital')}</span></>}</div>
            <div><span className="label">{t('Rendement')}</span><strong className="kpi-value" style={{ color: signColor(m.total_change_pct) }}>{fmt(m.total_change_pct, 2, true)} %</strong>
              <span className="kpi-sub">{annualNote(t, m)}</span></div>
          </div>

          {m.converted && (
            <p className="hint" style={{ margin: '-8px 0 12px' }}>
              {t('Cours convertis de {a} en {b} au taux de change de clôture de chaque jour : tous les chiffres (performance, risque, graphique) incluent l’effet de change. L’indice de comparaison est converti de la même façon.', { a: m.listing_currency, b: m.currency })}
            </p>
          )}
          <StatsDashboard metrics={m} interpretations={data.interpretations} classMetrics={data.class_specific_metrics} assetClass={data.asset_class}
            varInput={varInput} onVarChange={setVarInput} onVarSubmit={() => run()} confUsed={data._conf}
            rfInput={rfInput} onRfChange={setRfInput} onRfSubmit={(v) => run({ rf: v })}
            footer={periodFooter(t, m)} />

          <div className="grid-2" style={{ marginBottom: 24 }}>
            <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
                <Segmented options={CHART_TYPES} value={chartType} onChange={setChartType} label="Type de graphique" />
                <button type="button" className="icon-btn" title={t('Plein écran')} aria-label={t('Plein écran')}
                  onClick={() => onFullscreen({ kind: 'chart', title: trName(getAsset(data.ticker)?.name) || data.ticker, props: { data: data.chart_data, type: chartType, isMoney: isMoneyChart, currency, unit: chartUnit } })}>
                  <Maximize2 size={15} />
                </button>
              </div>
              <div style={{ flex: 1, minHeight: 360 }}>
                <ChartErrorBoundary resetKey={data}>
                  <TradingViewChart data={data.chart_data} type={chartType} isMoney={isMoneyChart} currency={currency} mainLabel="Cours" unit={chartUnit} />
                </ChartErrorBoundary>
              </div>
              {['ACTION', 'ETF'].includes(data.asset_class) && chartType !== 'drawdown' && (
                <div className="hint" style={{ marginTop: 6 }}>{t('Cours ajustés des dividendes et des divisions d’actions : les cours anciens affichés sont donc plus bas que ceux réellement cotés à l’époque. Source : Yahoo Finance.')}</div>
              )}
            </div>
            <MonteCarloCard mc={data.monte_carlo} forecastDays={pendingDays ?? data._days} computedDays={data._days} currency={currency}
              onHorizonChange={(d) => { setForecastDays(d); run({ forecastDays: d }); }}
              onFullscreen={() => onFullscreen({ kind: 'mc', forecastDays: data._days, props: { data: data.monte_carlo.chart_data, unit: data.monte_carlo.is_money ? currency : '' } })} />
          </div>

          <EventsPanel tickers={[data.ticker]} title="Annonces économiques qui peuvent faire bouger cet actif" onOpenCalendar={onOpenCalendar} />
        </div>
      )}
    </div>
  );
}

export default memo(AssetView);
