import { useEffect, useRef, useState, memo, Component } from 'react';
import * as LightweightCharts from 'lightweight-charts';
import { fmt } from '../format';
import DrawingLayer from './DrawingLayer';
import { tr, useLang, getLocale } from '../i18n';

export class ChartErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, resetKey: props.resetKey };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  // Nouvelles données -> on retente l'affichage (sinon une seule série invalide bloquait le graphique jusqu'au rechargement)
  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.resetKey ? { hasError: false, resetKey: props.resetKey } : null;
  }
  componentDidCatch(error, info) {
    console.error('Erreur graphique :', error, info);
  }
  render() {
    if (this.state.hasError) {
      return <div style={{ padding: 20, textAlign: 'center', color: 'var(--red)' }}>{tr('Données insuffisantes ou incompatibles pour générer le graphique.')}</div>;
    }
    return this.props.children;
  }
}

const addSeries = (chart, kind, opts) => {
  const legacy = { line: 'addLineSeries', area: 'addAreaSeries', candle: 'addCandlestickSeries' }[kind];
  if (chart[legacy]) return chart[legacy](opts);
  const ctor = { line: LightweightCharts.LineSeries, area: LightweightCharts.AreaSeries, candle: LightweightCharts.CandlestickSeries }[kind];
  return chart.addSeries(ctor, opts);
};

/**
 * Graphique TradingView (lightweight-charts).
 * type : 'line' | 'candle' | 'drawdown'.  compareKey : 2e courbe optionnelle (ex. benchmark en base 100).
 * Mémorisé : n'est reconstruit que si les données ou le type changent (plus à chaque survol d'une infobulle).
 */
function TradingViewChart({ data, type = 'line', lineColor = '#e0a43a', isMoney = false, currency = '€', compareKey, compareLabel, mainLabel, height = 360, drawable = false, drawKey }) {
  const containerRef = useRef(null);
  const { t } = useLang();
  const [legend, setLegend] = useState(null);
  const [api, setApi] = useState(null); // { chart, series } pour le calque de dessin

  useEffect(() => {
    if (!containerRef.current || !Array.isArray(data) || data.length === 0) return;

    const chart = LightweightCharts.createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: LightweightCharts.ColorType?.Solid ?? 'solid', color: '#161618' },
        textColor: '#88888f',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      },
      grid: { vertLines: { color: '#222226' }, horzLines: { color: '#222226' } },
      timeScale: { borderColor: '#323237' },
      rightPriceScale: { borderColor: '#323237', scaleMargins: { top: 0.1, bottom: 0.08 } },
      crosshair: { vertLine: { color: '#88888f', width: 1, style: 2 }, horzLine: { color: '#88888f', width: 1, style: 2 } },
      localization: { locale: getLocale(), priceFormatter: (p) => (isMoney && type === 'line' ? fmt(p, 0) : fmt(p, Math.abs(p) < 10 ? 4 : Math.abs(p) >= 10000 ? 0 : 2)) },
    });

    // Les dates arrivent déjà triées et uniques depuis l'API
    const rows = data.filter(d => d && d.date);
    let main, compare = null;

    if (type === 'candle' && rows[0]?.open !== undefined) {
      main = addSeries(chart, 'candle', { upColor: '#22a06b', downColor: '#e5484d', borderVisible: false, wickUpColor: '#22a06b', wickDownColor: '#e5484d' });
      main.setData(rows.map(d => ({ time: d.date, open: d.open, high: d.high, low: d.low, close: d.close })));
    } else if (type === 'drawdown') {
      main = addSeries(chart, 'area', { topColor: 'rgba(229,72,77,0.05)', bottomColor: 'rgba(229,72,77,0.4)', lineColor: '#e5484d', lineWidth: 2,
        priceFormat: { type: 'custom', formatter: (p) => `${fmt(p, 1)} %` } });
      main.setData(rows.map(d => ({ time: d.date, value: d.drawdown ?? 0 })));
    } else {
      const valueOf = (d) => isMoney ? (d.money_value ?? d.value) : (d.close ?? d.value);
      main = addSeries(chart, 'line', { color: lineColor, lineWidth: 2,
        priceFormat: isMoney ? { type: 'custom', formatter: (p) => `${fmt(p, 0)} ${currency}` } : undefined });
      main.setData(rows.map(d => ({ time: d.date, value: valueOf(d) ?? 0 })));

      if (compareKey && rows[0]?.[compareKey] !== undefined) {
        // En mode monétaire, le benchmark (base 100) est remis à l'échelle du capital pour être comparable
        const scale = isMoney && rows[0].money_value ? rows[0].money_value / 100 : 1;
        compare = addSeries(chart, 'line', { color: '#9ca3af', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: true });
        compare.setData(rows.map(d => ({ time: d.date, value: (d[compareKey] ?? 0) * scale })));
      }
    }

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData) { setLegend(null); return; }
      const bar = param.seriesData.get(main);
      const cmp = compare ? param.seriesData.get(compare) : null;
      if (bar) setLegend({ time: param.time, ...bar, compareValue: cmp?.value });
    });
    chart.timeScale().fitContent();
    if (drawable) setApi({ chart, series: main });

    return () => { setApi(null); chart.remove(); setLegend(null); };
  }, [data, type, lineColor, isMoney, currency, compareKey, drawable]);

  const dec = (v) => fmt(v, Math.abs(v) < 10 ? 4 : 2);
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: height }}>
      <div style={{
        position: 'absolute', top: 8, left: 12, zIndex: 10, display: 'flex', gap: 12, fontSize: 11, flexWrap: 'wrap',
        background: 'rgba(22,22,24,.9)', padding: '4px 8px', borderRadius: 4, border: '1px solid #323237', pointerEvents: 'none',
        visibility: legend ? 'visible' : 'hidden',
      }}>
        {legend && <>
          <span style={{ color: '#88888f' }}>{legend.time}</span>
          {legend.open !== undefined ? (<>
            <span style={{ color: '#88888f' }}>O <b style={{ color: '#d2d2d6' }}>{dec(legend.open)}</b></span>
            <span style={{ color: '#88888f' }}>H <b style={{ color: '#22a06b' }}>{dec(legend.high)}</b></span>
            <span style={{ color: '#88888f' }}>{t('B')} <b style={{ color: '#e5484d' }}>{dec(legend.low)}</b></span>
            <span style={{ color: '#88888f' }}>C <b style={{ color: '#d2d2d6' }}>{dec(legend.close)}</b></span>
          </>) : (<>
            <span style={{ color: '#88888f' }}>{type === 'drawdown' ? 'Drawdown' : t(mainLabel || 'Valeur')} <b style={{ color: type === 'drawdown' ? '#e5484d' : lineColor }}>
              {type === 'drawdown' ? `${fmt(legend.value, 2)} %` : isMoney ? `${fmt(legend.value, 0)} ${currency}` : dec(legend.value)}</b></span>
            {legend.compareValue !== undefined && (
              <span style={{ color: '#88888f' }}>{compareLabel || 'Benchmark'} <b style={{ color: '#9ca3af' }}>{isMoney ? `${fmt(legend.compareValue, 0)} ${currency}` : dec(legend.compareValue)}</b></span>
            )}
          </>)}
        </>}
      </div>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, borderRadius: 4, overflow: 'hidden' }} />
      {drawable && api && <DrawingLayer key={`${drawKey}|${type}`} api={api} storageKey={`${drawKey}|${type}`} />}
    </div>
  );
}

export default memo(TradingViewChart);
