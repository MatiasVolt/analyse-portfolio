import React, { useEffect, useRef, useState } from 'react';
import * as LightweightCharts from 'lightweight-charts';

export default function TradingViewChart({ 
  data, 
  type = 'line', 
  colors = {}, 
  isMoney = false, 
  currency = '$' 
}) {
  const chartContainerRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const [legendData, setLegendData] = useState(null);

  useEffect(() => {
    if (!chartContainerRef.current || !Array.isArray(data) || data.length === 0) return;

    if (chartInstanceRef.current) {
      try {
        chartInstanceRef.current.remove();
      } catch (e) {}
      chartInstanceRef.current = null;
    }

    const {
      backgroundColor = '#131722',
      lineColor = '#2962ff',
      textColor = '#787b86',
      upColor = '#089981',
      downColor = '#f23645',
    } = colors;

    const ColorType = LightweightCharts.ColorType || { Solid: 'solid' };
    const chart = LightweightCharts.createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: backgroundColor },
        textColor: textColor,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, sans-serif'
      },
      grid: {
        vertLines: { color: '#1e222d' },
        horzLines: { color: '#1e222d' },
      },
      width: chartContainerRef.current.clientWidth || 500,
      height: chartContainerRef.current.clientHeight || 340,
      timeScale: {
        borderColor: '#2a2e39',
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: '#2a2e39',
        scaleMargins: { top: 0.1, bottom: 0.1 },
        autoScale: true,
      },
      crosshair: {
        vertLine: { color: '#787b86', width: 1, style: 2 },
        horzLine: { color: '#787b86', width: 1, style: 2 },
      },
      handleScroll: true,
      handleScale: true,
    });
    chartInstanceRef.current = chart;

    // Déduplication et tri chronologique strict
    const cleanMap = new Map();
    data.forEach(item => {
      if (!item || !item.date) return;
      cleanMap.set(String(item.date).split('T')[0], item);
    });

    const sortedData = Array.from(cleanMap.values()).sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );

    let activeSeries = null;

    if (type === 'candle') {
      activeSeries = chart.addCandlestickSeries 
        ? chart.addCandlestickSeries({
            upColor,
            downColor,
            borderVisible: false,
            wickUpColor: upColor,
            wickDownColor: downColor,
          })
        : chart.addSeries(LightweightCharts.CandlestickSeries, {
            upColor,
            downColor,
            borderVisible: false,
            wickUpColor: upColor,
            wickDownColor: downColor,
          });

      const formattedCandles = sortedData.map(d => {
        const rawClose = Number(d.close ?? d.price ?? d.value ?? 0);
        const o = Number(d.open ?? rawClose);
        const h = Number(d.high ?? Math.max(o, rawClose));
        const l = Number(d.low ?? Math.min(o, rawClose));
        const c = rawClose;
        return {
          time: String(d.date).split('T')[0],
          open: isNaN(o) ? 0 : o,
          high: isNaN(h) ? 0 : h,
          low: isNaN(l) ? 0 : l,
          close: isNaN(c) ? 0 : c,
        };
      });

      activeSeries.setData(formattedCandles);

    } else if (type === 'drawdown') {
      activeSeries = chart.addAreaSeries 
        ? chart.addAreaSeries({
            topColor: 'rgba(242, 54, 69, 0.05)',
            bottomColor: 'rgba(242, 54, 69, 0.40)',
            lineColor: '#f23645',
            lineWidth: 2,
            priceFormat: { type: 'custom', formatter: (p) => `${p.toFixed(2)} %` }
          })
        : chart.addSeries(LightweightCharts.AreaSeries, {
            topColor: 'rgba(242, 54, 69, 0.05)',
            bottomColor: 'rgba(242, 54, 69, 0.40)',
            lineColor: '#f23645',
            lineWidth: 2,
          });

      activeSeries.setData(sortedData.map(d => ({
        time: String(d.date).split('T')[0],
        value: isNaN(Number(d.drawdown)) ? 0 : Number(d.drawdown),
      })));

    } else {
      activeSeries = chart.addLineSeries 
        ? chart.addLineSeries({
            color: lineColor,
            lineWidth: 2,
            priceFormat: isMoney 
              ? { type: 'custom', formatter: (p) => `${p.toLocaleString()} ${currency}` } 
              : undefined
          })
        : chart.addSeries(LightweightCharts.LineSeries, { color: lineColor, lineWidth: 2 });

      // Lecture en priorité du cours réel (Close) sauf si le mode monétaire est actif
      activeSeries.setData(sortedData.map(d => {
        const primaryValue = isMoney 
          ? Number(d.money_value ?? d.value ?? 0)
          : Number(d.close ?? d.price ?? d.value ?? 0);

        return {
          time: String(d.date).split('T')[0],
          value: isNaN(primaryValue) ? 0 : primaryValue,
        };
      }));
    }

    // Suivi précis du Crosshair pour afficher les chandeliers et mèches
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData || !activeSeries) {
        setLegendData(null);
        return;
      }
      const bar = param.seriesData.get(activeSeries);
      if (bar) {
        setLegendData({
          time: param.time,
          ...bar
        });
      }
    });

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current && chartInstanceRef.current) {
        chartInstanceRef.current.applyOptions({ 
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight || 340
        });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartInstanceRef.current) {
        try { chartInstanceRef.current.remove(); } catch (e) {}
        chartInstanceRef.current = null;
      }
    };
  }, [data, type, colors, isMoney, currency]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Infobulle supérieure pour les mèches / valeurs OHLC */}
      {legendData && (
        <div style={{
          position: 'absolute',
          top: 8,
          left: 12,
          zIndex: 10,
          display: 'flex',
          gap: '12px',
          fontSize: '11px',
          backgroundColor: 'rgba(19, 23, 34, 0.85)',
          padding: '4px 8px',
          borderRadius: '4px',
          border: '1px solid #2a2e39',
          pointerEvents: 'none'
        }}>
          <span style={{ color: '#787b86' }}>Date : <strong style={{ color: '#d1d4dc' }}>{legendData.time}</strong></span>
          {legendData.open !== undefined ? (
            <>
              <span style={{ color: '#787b86' }}>O : <strong style={{ color: '#d1d4dc' }}>{legendData.open.toFixed(2)}</strong></span>
              <span style={{ color: '#787b86' }}>H : <strong style={{ color: '#089981' }}>{legendData.high.toFixed(2)}</strong></span>
              <span style={{ color: '#787b86' }}>L : <strong style={{ color: '#f23645' }}>{legendData.low.toFixed(2)}</strong></span>
              <span style={{ color: '#787b86' }}>C : <strong style={{ color: '#d1d4dc' }}>{legendData.close.toFixed(2)}</strong></span>
            </>
          ) : (
            <span style={{ color: '#787b86' }}>Valeur : <strong style={{ color: '#2962ff' }}>{legendData.value?.toFixed(2)}</strong></span>
          )}
        </div>
      )}
      <div 
        ref={chartContainerRef} 
        style={{ width: '100%', height: '100%', minHeight: '340px', borderRadius: '4px', overflow: 'hidden' }} 
      />
    </div>
  );
}