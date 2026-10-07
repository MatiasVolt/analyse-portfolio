import { useCallback, useEffect, useState } from 'react';

/**
 * Navigation verticale pour lightweight-charts (par défaut, seul l'axe du temps se déplace) :
 * glisser dans le graphique déplace aussi les prix, Maj + molette zoome verticalement autour du curseur.
 * `manual` passe à true dès que l'échelle des prix n'est plus automatique ; `reset()` la remet en automatique.
 * api : { chart, series } ; hostRef : conteneur du graphique.
 */
export function usePriceNavigation(hostRef, api) {
  const [manual, setManual] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !api) return;
    const scale = api.series.priceScale();
    const sync = () => setManual(!scale.options().autoScale);
    const inPane = (e) => {
      const r = host.getBoundingClientRect(), ps = api.chart.paneSize();
      return e.clientX - r.left < ps.width && e.clientY - r.top < ps.height;
    };
    let drag = null;

    const onDown = (e) => {
      // Souris seulement : au doigt, le glissement vertical sert à faire défiler la page
      if (e.pointerType === 'touch' || e.button !== 0 || !inPane(e)) return;
      const range = scale.getVisibleRange();
      if (range) drag = { y: e.clientY, range, moved: false };
    };
    const onMove = (e) => {
      if (!drag) return;
      if (!(e.buttons & 1)) { drag = null; return; }
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dy) < 6) return; // un glissement horizontal ne doit pas figer l'échelle des prix
      drag.moved = true;
      const k = (drag.range.to - drag.range.from) / api.chart.paneSize().height;
      scale.setVisibleRange({ from: drag.range.from + dy * k, to: drag.range.to + dy * k });
      setManual(true);
    };
    const onUp = () => { drag = null; requestAnimationFrame(sync); };
    const onWheel = (e) => {
      if (!e.shiftKey || !inPane(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const range = scale.getVisibleRange();
      const anchor = api.series.coordinateToPrice(e.clientY - host.getBoundingClientRect().top);
      if (!range || anchor === null) return;
      const f = (e.deltaY || e.deltaX) > 0 ? 1.12 : 1 / 1.12; // Maj + molette : certains navigateurs envoient deltaX
      scale.setVisibleRange({ from: anchor - (anchor - range.from) * f, to: anchor + (range.to - anchor) * f });
      setManual(true);
    };
    // Double-clic sur l'axe des prix (comportement natif) : l'échelle redevient automatique
    const onDblClick = () => requestAnimationFrame(sync);

    host.addEventListener('pointerdown', onDown, true);
    host.addEventListener('wheel', onWheel, { capture: true, passive: false });
    host.addEventListener('dblclick', onDblClick);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      host.removeEventListener('pointerdown', onDown, true);
      host.removeEventListener('wheel', onWheel, { capture: true });
      host.removeEventListener('dblclick', onDblClick);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setManual(false);
    };
  }, [hostRef, api]);

  const reset = useCallback(() => {
    api?.series.priceScale().setAutoScale(true);
    setManual(false);
  }, [api]);

  return { manual, reset };
}
