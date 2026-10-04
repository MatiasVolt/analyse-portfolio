// Contenu des classeurs exportés depuis chaque section du site.
import { downloadWorkbook, signArgb } from './workbook';
import { METRICS, DEFINITIONS, SCREENER_GROUPS } from '../definitions';
import { getAsset } from '../tickerDatabase';
import { tr, trName } from '../i18n';

const nameOf = (tk) => trName(getAsset(tk)?.name) || tk;
const unitType = (unit) => (unit === '%' ? 'pct' : 'num');
const today = () => new Date().toLocaleString();

/** Lignes « indicateur » communes à l'actif et au portefeuille. */
function metricRows(metrics, interpretations) {
  return Object.values(METRICS).map(m => ({
    label: tr(m.label), value: metrics[m.field], unit: m.unit === '%' ? '' : tr(m.unit || ''), _t: unitType(m.unit),
    interp: m.interp ? interpretations?.[m.interp] || '' : '', def: tr(DEFINITIONS[m.def] || ''),
  }));
}

function indicatorsSheet(metrics, interpretations) {
  const rows = metricRows(metrics, interpretations);
  // Une colonne par type pour garder de vrais formats de nombre
  return {
    name: tr('Indicateurs'),
    columns: [
      { header: tr('Indicateur'), key: 'label', width: 30 },
      { header: tr('Valeur (%)'), key: 'pct', type: 'pct', width: 13, color: signArgb },
      { header: tr('Valeur'), key: 'num', type: 'num', width: 12 },
      { header: tr('Unité'), key: 'unit', width: 10 },
      { header: tr('Interprétation'), key: 'interp', width: 70, wrap: true },
      { header: tr('Définition'), key: 'def', width: 70, wrap: true },
    ],
    rows: rows.map(r => ({ ...r, pct: r._t === 'pct' ? r.value : null, num: r._t === 'num' ? r.value : null })),
  };
}

function historySheet(chartData, withOhlc, extra = []) {
  return {
    name: tr('Historique'),
    columns: [
      { header: 'Date', key: 'date', type: 'date', width: 12 },
      ...(withOhlc ? [
        { header: tr('Ouverture'), key: 'open', type: 'num4', width: 12 }, { header: tr('Plus haut'), key: 'high', type: 'num4', width: 12 },
        { header: tr('Plus bas'), key: 'low', type: 'num4', width: 12 }, { header: tr('Clôture'), key: 'close', type: 'num4', width: 12 },
      ] : []),
      { header: tr('Base 100'), key: 'value', type: 'num', width: 11 },
      ...extra,
      { header: tr('Drawdown (%)'), key: 'dd', type: 'pct', width: 13, color: signArgb },
    ],
    rows: chartData.map(d => ({ ...d, dd: d.drawdown })),
  };
}

function monteCarloSheet(mc) {
  return {
    name: 'Monte-Carlo',
    columns: [
      { header: tr('Jour'), key: 'day', width: 9 },
      { header: tr('Pessimiste (5e centile)'), key: 'pessimiste', type: 'num', width: 22 },
      { header: tr('Médian'), key: 'median', type: 'num', width: 12 },
      { header: tr('Optimiste (95e centile)'), key: 'optimiste', type: 'num', width: 22 },
    ],
    rows: mc?.chart_data || [],
  };
}

// --------------------------------------------------------------------------- Portefeuille
export function exportPortfolio(data, currency) {
  const m = data.metrics;
  const corr = data.breakdown.correlation;
  return downloadWorkbook(tr('Portefeuille'), [
    {
      name: tr('Synthèse'), title: tr('Simulation de portefeuille'), subtitle: `${tr('Exporté le')} ${today()}`,
      pairs: [
        [tr('Période'), `${data.period_start} → ${data.period_end}`],
        [tr('Benchmark'), data.benchmark_label],
        [tr('Rééquilibrage'), data.rebalance],
        [tr('Taux sans risque'), m.risk_free_pct, 'pct'],
        ...(data.money_summary ? [
          [`${tr('Capital initial')} (${currency})`, data.money_summary.initial_capital, 'money'],
          [`${tr('Valeur finale')} (${currency})`, data.money_summary.final_value, 'money'],
          [`${tr('Gain / perte')} (${currency})`, data.money_summary.profit_loss, 'money'],
        ] : []),
        [tr('Variation totale'), m.total_change_pct, 'pct'],
        [tr('CAGR (rend. annuel)'), m.cagr_pct, 'pct'],
        [tr('Ratio de Sharpe'), m.sharpe_ratio, 'num'],
        [tr('Corrélation moyenne :').replace(' :', '').replace(':', ''), data.breakdown.average_correlation, 'num'],
        [tr('Ratio de diversification :').replace(' :', '').replace(':', ''), data.breakdown.diversification_ratio, 'num'],
      ],
    },
    {
      name: tr('Composition'),
      columns: [
        { header: 'Ticker', key: 'ticker', width: 14 }, { header: tr('Actif'), key: 'name', width: 34 },
        { header: tr('Poids'), key: 'w', type: 'pct', width: 10 },
        { header: tr('Perf. totale'), key: 'total_return_pct', type: 'pct', width: 13, color: signArgb },
        { header: 'CAGR', key: 'cagr_pct', type: 'pct', width: 10, color: signArgb },
        { header: tr('Volatilité'), key: 'volatility_pct', type: 'pct', width: 11 },
        { header: 'Max DD', key: 'max_drawdown_pct', type: 'pct', width: 10 },
        { header: 'Sharpe', key: 'sharpe_ratio', type: 'num', width: 9 },
        { header: tr('Contrib. perf.'), key: 'return_contribution_pct', type: 'pct', width: 13, color: signArgb },
        { header: tr('Part du risque'), key: 'risk_contribution_pct', type: 'pct', width: 13 },
      ],
      rows: data.breakdown.assets.map(a => ({ ...a, name: nameOf(a.ticker), w: a.weight_pct })),
    },
    indicatorsSheet(m, data.interpretations),
    {
      name: tr('Corrélations'),
      columns: [{ header: '', key: 't', width: 14 }, ...corr.tickers.map(tk => ({ header: tk, key: tk, type: 'num', width: 11 }))],
      rows: corr.matrix.map((row, i) => ({ t: corr.tickers[i], ...Object.fromEntries(row.map((v, j) => [corr.tickers[j], v])) })),
    },
    historySheet(data.chart_data, false, [
      { header: `${tr('Benchmark')} (${tr('Base 100')})`, key: 'benchmark', type: 'num', width: 18 },
      ...(data.money_summary ? [{ header: `${tr('Valeur du capital')} (${currency})`, key: 'money_value', type: 'money', width: 18 }] : []),
    ]),
    monteCarloSheet(data.monte_carlo),
  ]);
}

// --------------------------------------------------------------------------- Rapport de comparaison (généré par le serveur, avec graphiques)
export async function exportComparisonReport(portfolios, compareParams) {
  const { default: axios } = await import('axios');
  const { API } = await import('../format');
  const res = await axios.post(`${API}/api/export/comparison`, {
    portfolios: portfolios.map(p => ({ name: p.name, items: p.items, rebalance: p.rebalance || 'none' })),
    benchmark: compareParams.benchmark, period: compareParams.period, start_date: compareParams.start_date, end_date: compareParams.end_date,
  }, { responseType: 'blob' }).catch(async (err) => {
    // L'erreur arrive sous forme de blob : on la relit pour afficher le vrai message
    const text = err.response?.data ? await err.response.data.text() : '';
    let detail = '';
    try { detail = JSON.parse(text).detail; } catch { /* pas du JSON */ }
    throw new Error(detail || err.message);
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(res.data);
  a.download = `${tr('Comparaison de portefeuilles')} ${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// --------------------------------------------------------------------------- Screener
export function exportScreener(rows, marketLabel) {
  const metricCols = SCREENER_GROUPS.flatMap(g => g.metrics).map(m => ({
    header: `${tr(m.label)}${m.unit === '%' ? ' (%)' : ''}`, key: m.key,
    type: m.unit === '%' ? 'pct' : m.key === 'avg_dollar_volume_m' ? 'num' : 'num', width: 14,
    color: m.signed ? signArgb : undefined,
  }));
  return downloadWorkbook('Screener', [{
    name: 'Screener',
    columns: [
      { header: 'Ticker', key: 'ticker', width: 12 }, { header: tr('Actif'), key: 'name', width: 32 },
      { header: tr('Marché'), key: 'mkt', width: 16 }, { header: tr('Pays'), key: 'country', width: 16 }, { header: tr('Secteur'), key: 'sector', width: 22 },
      ...metricCols,
    ],
    rows: rows.map(r => ({ ...r, mkt: marketLabel(r.market), country: trName(r.country) })),
  }]);
}

