import { useEffect, useRef, useState } from 'react';
import * as LightweightCharts from 'lightweight-charts';
import DrawingLayer from './DrawingLayer';
import { usePriceNavigation } from './chartNav';
import { fmt } from '../format';
import { useLang, getLocale } from '../i18n';
import { useTheme, chartColors } from '../theme';

const DAY = 86400;
// L'axe du temps de lightweight-charts attend des dates : le jour J+n devient un horodatage fictif, réaffiché « J+n »
const toTime = (n) => (n + 1) * DAY;
const dayOf = (time) => Math.round(time / DAY) - 1;

const lineSeries = (chart, opts) => (chart.addLineSeries ? chart.addLineSeries(opts) : chart.addSeries(LightweightCharts.LineSeries, opts));

/**
 * Projection Monte-Carlo en plein écran, avec les outils de dessin
 * (tracer un objectif ou un seuil de perte et le comparer aux trois scénarios).
 */
export default function MonteCarloDrawChart({ data, unit, drawKey }) {
  const { t, lang } = useLang();
  const theme = useTheme();
  const c = chartColors(theme);
  const hostRef = useRef(null);
  const [api, setApi] = useState(null);
  const [legend, setLegend] = useState(null);
  const nav = usePriceNavigation(hostRef, api);
  // La projection est échantillonnée (1 point tous les `step` jours au-delà d'un an)
  const step = data?.length > 1 ? Number(String(data[1].day).replace(/\D/g, '')) - Number(String(data[0].day).replace(/\D/g, '')) || 1 : 1;

  useEffect(() => {
    if (!hostRef.current || !data?.length) return;
    const dayLabel = (time) => `${lang === 'en' ? 'D' : 'J'}+${dayOf(time)}`;
    const chart = LightweightCharts.createChart(hostRef.current, {
      autoSize: true,
      layout: { background: { type: LightweightCharts.ColorType.Solid, color: c.bg }, textColor: c.text,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal }, // la croix suit librement la souris
      rightPriceScale: { borderColor: c.border, scaleMargins: { top: 0.1, bottom: 0.08 } },
      timeScale: { borderColor: c.border, tickMarkFormatter: dayLabel },
      localization: { locale: getLocale(), timeFormatter: dayLabel, priceFormatter: (p) => fmt(p, Math.abs(p) >= 1000 ? 0 : 2) },
    });
    const rows = data.map(d => ({ n: Number(String(d.day).replace(/\D/g, '')), ...d }));
    const add = (key, color, width, style) => {
      const s = lineSeries(chart, { color, lineWidth: width, lineStyle: style, priceLineVisible: false });
      s.setData(rows.map(r => ({ time: toTime(r.n), value: r[key] })));
      return s;
    };
    const pess = add('pessimiste', c.red, 2, 2);
    const median = add('median', c.strong, 3, 0);
    const opt = add('optimiste', c.green, 2, 2);
    chart.timeScale().fitContent();
    chart.subscribeCrosshairMove((param) => {
      if (!param.time) { setLegend(null); return; }
      setLegend({ day: dayLabel(param.time), p: param.seriesData.get(pess)?.value, m: param.seriesData.get(median)?.value, o: param.seriesData.get(opt)?.value });
    });
    setApi({ chart, series: median });
    return () => { setApi(null); setLegend(null); chart.remove(); };
  }, [data, c, lang]);

  const v = (x) => (x === undefined ? '—' : `${fmt(x, Math.abs(x) >= 1000 ? 0 : 2)}${unit ? ` ${unit}` : ''}`);
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 300 }} role="img"
      aria-label={t('Projection Monte-Carlo : trois courbes (scénario pessimiste, médian et optimiste) du départ à l’horizon choisi.')}>
      <div style={{ position: 'absolute', top: 8, left: 12, zIndex: 10, display: 'flex', gap: 12, fontSize: 11, flexWrap: 'wrap', pointerEvents: 'none',
        background: c.legendBg, color: c.text, padding: '4px 8px', borderRadius: 4, border: `1px solid ${c.border}` }}>
        <span>{legend?.day ?? t('Survolez la courbe')}</span>
        <span>{t('Pessimiste (5e centile)')} <b style={{ color: c.red }}>{v(legend?.p)}</b></span>
        <span>{t('Médian')} <b style={{ color: c.strong }}>{v(legend?.m)}</b></span>
        <span>{t('Optimiste (95e centile)')} <b style={{ color: c.green }}>{v(legend?.o)}</b></span>
      </div>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0, borderRadius: 4, overflow: 'hidden' }} />
      <span className="chart-unit">{unit || t('Base 100')}</span>
      {nav.manual && (
        <button type="button" className="chart-autoscale" onClick={nav.reset} title={t('Revenir à l’échelle automatique des prix')}>↕ {t('Échelle auto')}</button>
      )}
      {api && <DrawingLayer key={drawKey} api={api} storageKey={drawKey} barsPerPoint={step} />}
    </div>
  );
}
