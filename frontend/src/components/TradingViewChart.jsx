import { useEffect, useRef, useState, memo, Component } from 'react';
import * as LightweightCharts from 'lightweight-charts';
import { fmt } from '../format';

export class ChartErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error('Erreur graphique :', error, info);
  }
  render() {
    if (this.state.hasError) {
      return <div style={{ padding: 20, textAlign: 'center', color: 'var(--red)' }}>Données insuffisantes ou incompatibles pour générer le graphique.</div>;
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
function TradingViewChart({ data, type = 'line', lineColor = '#2962ff', isMoney = false, currency = '€', compareKey, compareLabel, mainLabel, height = 360 }) {
  const containerRef = useRef(null);
  const [legend, setLegend] = useState(null);

  useEffect(() => {
    if (!containerRef.current || !Array.isArray(data) || data.length === 0) return;

    const chart = LightweightCharts.createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: LightweightCharts.ColorType?.Solid ?? 'solid', color: '#131722' },
        textColor: '#787b86',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      },
      grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
      timeScale: { borderColor: '#2a2e39' },
      rightPriceScale: { borderColor: '#2a2e39', scaleMargins: { top: 0.1, bottom: 0.08 } },
      crosshair: { vertLine: { color: '#787b86', width: 1, style: 2 }, horzLine: { color: '#787b86', width: 1, style: 2 } },
      localization: { locale: 'fr-FR', priceFormatter: (p) => (isMoney && type === 'line' ? fmt(p, 0) : fmt(p, Math.abs(p) < 10 ? 4 : 2)) },
    });

    // Les dates arrivent déjà triées et uniques depuis l'API
    const rows = data.filter(d => d && d.date);
    let main, compare = null;

    if (type === 'candle' && rows[0]?.open !== undefined) {
      main = addSeries(chart, 'candle', { upColor: '#089981', downColor: '#f23645', borderVisible: false, wickUpColor: '#089981', wickDownColor: '#f23645' });
      main.setData(rows.map(d => ({ time: d.date, open: d.open, high: d.high, low: d.low, close: d.close })));
    } else if (type === 'drawdown') {
      main = addSeries(chart, 'area', { topColor: 'rgba(242,54,69,0.05)', bottomColor: 'rgba(242,54,69,0.4)', lineColor: '#f23645', lineWidth: 2,
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

    return () => { chart.remove(); setLegend(null); };
  }, [data, type, lineColor, isMoney, currency, compareKey]);

  const dec = (v) => fmt(v, Math.abs(v) < 10 ? 4 : 2);
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: height }}>
      <div style={{
        position: 'absolute', top: 8, left: 12, zIndex: 10, display: 'flex', gap: 12, fontSize: 11, flexWrap: 'wrap',
        background: 'rgba(19,23,34,.85)', padding: '4px 8px', borderRadius: 4, border: '1px solid #2a2e39', pointerEvents: 'none',
        visibility: legend ? 'visible' : 'hidden',
      }}>
        {legend && <>
          <span style={{ color: '#787b86' }}>{legend.time}</span>
          {legend.open !== undefined ? (<>
            <span style={{ color: '#787b86' }}>O <b style={{ color: '#d1d4dc' }}>{dec(legend.open)}</b></span>
            <span style={{ color: '#787b86' }}>H <b style={{ color: '#089981' }}>{dec(legend.high)}</b></span>
            <span style={{ color: '#787b86' }}>B <b style={{ color: '#f23645' }}>{dec(legend.low)}</b></span>
            <span style={{ color: '#787b86' }}>C <b style={{ color: '#d1d4dc' }}>{dec(legend.close)}</b></span>
          </>) : (<>
            <span style={{ color: '#787b86' }}>{type === 'drawdown' ? 'Drawdown' : (mainLabel || 'Valeur')} <b style={{ color: type === 'drawdown' ? '#f23645' : lineColor }}>
              {type === 'drawdown' ? `${fmt(legend.value, 2)} %` : isMoney ? `${fmt(legend.value, 0)} ${currency}` : dec(legend.value)}</b></span>
            {legend.compareValue !== undefined && (
              <span style={{ color: '#787b86' }}>{compareLabel || 'Benchmark'} <b style={{ color: '#9ca3af' }}>{isMoney ? `${fmt(legend.compareValue, 0)} ${currency}` : dec(legend.compareValue)}</b></span>
            )}
          </>)}
        </>}
      </div>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, borderRadius: 4, overflow: 'hidden' }} />
    </div>
  );
}

export default memo(TradingViewChart);
