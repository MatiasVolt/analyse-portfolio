import { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, MousePointer2, TrendingUp, Minus, Square, PenLine, Eraser, Undo2, Trash2, X, MoveHorizontal } from 'lucide-react';
import { fmt } from '../format';
import { useLang } from '../i18n';

/**
 * Outils de dessin au-dessus d'un graphique lightweight-charts (la version gratuite n'en contient pas).
 * Chaque point est stocké en (index logique de la barre, prix) : les tracés suivent le zoom et le défilement.
 * Les dessins sont conservés dans le navigateur (localStorage) pour chaque graphique.
 */
const TOOLS = [
  { id: null, label: 'Curseur (déplacer / zoomer le graphique)', icon: MousePointer2 },
  { id: 'trend', label: 'Ligne de tendance (cliquer-glisser)', icon: TrendingUp },
  { id: 'ray', label: 'Demi-droite prolongée (cliquer-glisser)', icon: MoveHorizontal },
  { id: 'hline', label: 'Ligne horizontale (support / résistance, un clic)', icon: Minus },
  { id: 'rect', label: 'Rectangle / zone (cliquer-glisser)', icon: Square },
  { id: 'free', label: 'Crayon libre', icon: PenLine },
  { id: 'erase', label: 'Gomme (cliquer sur un tracé)', icon: Eraser },
];
const COLORS = ['#e8e8ea', '#e0a43a', '#22a06b', '#e5484d', '#7f9cc4'];

const load = (key) => {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
};

export default function DrawingLayer({ api, storageKey }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState(null);
  const [color, setColor] = useState(COLORS[0]);
  const key = `drawings:${storageKey}`;
  const [drawings, setDrawings] = useState(() => load(key));
  const [draft, setDraft] = useState(null);
  const [, setFrame] = useState(0); // force le recalcul des coordonnées quand le graphique bouge
  const svgRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(drawings)); } catch { /* stockage indisponible : dessins non conservés */ }
  }, [key, drawings]);

  // Redessine quand l'échelle de temps ou de prix change
  useEffect(() => {
    if (!api) return;
    const bump = () => setFrame(f => f + 1);
    const ts = api.chart.timeScale();
    ts.subscribeVisibleLogicalRangeChange(bump);
    api.chart.subscribeCrosshairMove(bump);
    // On suit la taille du conteneur du graphique (le calque, lui, prend la taille du panneau de prix)
    const ro = new ResizeObserver(bump);
    const host = svgRef.current?.parentElement;
    if (host) ro.observe(host);
    const raf = requestAnimationFrame(bump);
    return () => {
      cancelAnimationFrame(raf);
      ts.unsubscribeVisibleLogicalRangeChange(bump);
      api.chart.unsubscribeCrosshairMove(bump);
      ro.disconnect();
    };
  }, [api]);

  // Pendant un dessin, le graphique ne doit ni défiler ni zoomer
  useEffect(() => {
    if (!api) return;
    const drawingMode = Boolean(tool);
    api.chart.applyOptions({ handleScroll: !drawingMode, handleScale: !drawingMode });
  }, [api, tool]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && tool) { e.stopImmediatePropagation(); setTool(null); setDraft(null); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && open) setDrawings(d => d.slice(0, -1));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tool, open]);

  const toXY = useCallback((pt) => {
    if (!api) return null;
    const x = api.chart.timeScale().logicalToCoordinate(pt.l);
    const y = api.series.priceToCoordinate(pt.p);
    return x === null || y === null ? null : { x, y };
  }, [api]);

  const fromEvent = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const l = api.chart.timeScale().coordinateToLogical(x);
    const p = api.series.coordinateToPrice(y);
    return l === null || p === null ? null : { l, p };
  };

  const onDown = (e) => {
    if (!tool || tool === 'erase' || !api) return;
    const pt = fromEvent(e);
    if (!pt) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture indisponible : le tracé fonctionne quand même */ }
    if (tool === 'hline') { setDrawings(d => [...d, { type: 'hline', color, pts: [pt] }]); return; }
    setDraft({ type: tool, color, pts: tool === 'free' ? [pt] : [pt, pt] });
  };
  const onMove = (e) => {
    if (!draft) return;
    const pt = fromEvent(e);
    if (!pt) return;
    setDraft(d => (d.type === 'free' ? { ...d, pts: [...d.pts, pt] } : { ...d, pts: [d.pts[0], pt] }));
  };
  const onUp = () => {
    if (!draft) return;
    const [a, b] = [draft.pts[0], draft.pts[draft.pts.length - 1]];
    const moved = draft.type === 'free' ? draft.pts.length > 2 : Math.abs(a.l - b.l) > 0.3 || Math.abs(a.p - b.p) > 1e-9;
    if (moved) setDrawings(d => [...d, draft]);
    setDraft(null);
  };

  const pane = api?.chart.paneSize ? api.chart.paneSize() : null;
  const w = pane?.width ?? 0, h = pane?.height ?? 0;

  const render = (d, i, isDraft = false) => {
    const pts = d.pts.map(toXY);
    if (pts.some(p => !p)) return null;
    const common = {
      stroke: d.color, strokeWidth: 2, fill: 'none', vectorEffect: 'non-scaling-stroke',
      style: { pointerEvents: tool === 'erase' && !isDraft ? 'all' : 'none', cursor: tool === 'erase' ? 'pointer' : undefined },
      onClick: tool === 'erase' && !isDraft ? () => setDrawings(ds => ds.filter((_, j) => j !== i)) : undefined,
    };
    const k = isDraft ? 'draft' : i;
    if (d.type === 'hline') {
      return (
        <g key={k}>
          <line x1={0} x2={w} y1={pts[0].y} y2={pts[0].y} {...common} strokeDasharray="6 4" />
          <line x1={0} x2={w} y1={pts[0].y} y2={pts[0].y} stroke="transparent" strokeWidth={10} style={common.style} onClick={common.onClick} />
          <rect x={w - 64} y={pts[0].y - 9} width={62} height={18} rx={3} fill={d.color} />
          <text x={w - 33} y={pts[0].y + 4} textAnchor="middle" fontSize="11" fill="#111" fontWeight="700">{fmt(d.pts[0].p, d.pts[0].p < 10 ? 4 : 2)}</text>
        </g>
      );
    }
    if (d.type === 'trend' || d.type === 'ray') {
      let [a, b] = pts;
      if (d.type === 'ray' && (b.x !== a.x)) {
        const slope = (b.y - a.y) / (b.x - a.x), xEnd = b.x > a.x ? w : 0;
        b = { x: xEnd, y: a.y + slope * (xEnd - a.x) };
      }
      return (
        <g key={k}>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} />
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={10} style={common.style} onClick={common.onClick} />
          <circle cx={pts[0].x} cy={pts[0].y} r={3} fill={d.color} />
          <circle cx={pts[1].x} cy={pts[1].y} r={3} fill={d.color} />
        </g>
      );
    }
    if (d.type === 'rect') {
      const [a, b] = pts;
      return <rect key={k} x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(a.x - b.x)} height={Math.abs(a.y - b.y)}
        {...common} fill={`${d.color}22`} />;
    }
    if (d.type === 'free') {
      return <polyline key={k} points={pts.map(p => `${p.x},${p.y}`).join(' ')} {...common} strokeLinejoin="round" strokeLinecap="round" />;
    }
    return null;
  };

  return (
    <>
      <svg ref={svgRef} className="draw-layer" width={w} height={h}
        style={{ position: 'absolute', left: 0, top: 0, zIndex: 5, pointerEvents: tool && tool !== 'erase' ? 'all' : 'none', cursor: tool && tool !== 'erase' ? 'crosshair' : 'default', overflow: 'hidden' }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        {drawings.map((d, i) => render(d, i))}
        {draft && render(draft, -1, true)}
      </svg>

      <div className="draw-toolbar" style={{ right: 72 }}>
        {!open ? (
          <button type="button" className="draw-btn" title={t('Dessiner sur le graphique')} onClick={() => setOpen(true)}><Pencil size={15} /></button>
        ) : (<>
          {TOOLS.map(tl => {
            const Icon = tl.icon;
            return <button key={tl.label} type="button" className={`draw-btn ${tool === tl.id ? 'on' : ''}`} title={t(tl.label)} onClick={() => setTool(tl.id)}><Icon size={15} /></button>;
          })}
          <span className="draw-sep" />
          {COLORS.map(c => (
            <button key={c} type="button" className={`draw-swatch ${color === c ? 'on' : ''}`} style={{ background: c }} title={t('Couleur')} onClick={() => setColor(c)} />
          ))}
          <span className="draw-sep" />
          <button type="button" className="draw-btn" title={t('Annuler le dernier tracé (Ctrl+Z)')} onClick={() => setDrawings(d => d.slice(0, -1))} disabled={!drawings.length}><Undo2 size={15} /></button>
          <button type="button" className="draw-btn" title={t('Tout effacer')} onClick={() => setDrawings([])} disabled={!drawings.length}><Trash2 size={15} /></button>
          <button type="button" className="draw-btn" title={t('Fermer les outils')} onClick={() => { setOpen(false); setTool(null); }}><X size={15} /></button>
        </>)}
      </div>
      {tool && tool !== 'erase' && <div className="draw-hint">{t('Mode dessin · Échap pour revenir au curseur')}</div>}
    </>
  );
}
