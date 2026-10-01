import { memo, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { RefreshCw, RotateCcw, ArrowUp, ArrowDown, ChevronDown, Search, SlidersHorizontal } from 'lucide-react';
import { HelpButtons, EmptyState } from '../components/ui';
import { SCREENER_GROUPS, SCREENER_METRICS, SCREENER_DEFAULT_COLUMNS } from '../definitions';
import { API, fmt, fmtMillions, parseNum, TAG_COLORS } from '../format';

const PAGE = 100;
const MARKET_LABELS = { US: 'Actions US', Europe: 'Actions Europe' };
const MARKET_COLORS = { US: TAG_COLORS.Actions, Europe: '#60a5fa', ...TAG_COLORS };

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function formatCell(key, v) {
  if (v === null || v === undefined) return '—';
  const meta = SCREENER_METRICS[key];
  if (key === 'avg_dollar_volume_m') return fmtMillions(v);
  if (key === 'last_price') return fmt(v, v < 10 ? 4 : 2);
  const nd = key === 'rsi_14' || key === 'recovery_days' ? 1 : 2;
  return `${fmt(v, nd, meta?.signed)}${meta?.unit === '%' ? ' %' : ''}`;
}

function cellColor(key, v) {
  if (v === null || v === undefined) return undefined;
  if (SCREENER_METRICS[key]?.signed) return v >= 0 ? 'var(--green)' : 'var(--red)';
  if (/drawdown|var_|cvar|worst/.test(key)) return '#f87171';
  if (key === 'sharpe' || key === 'sortino') return v >= 1 ? 'var(--green)' : v < 0 ? '#f87171' : undefined;
  if (key === 'rsi_14') return v >= 70 || v <= 30 ? 'var(--amber)' : undefined;
  return undefined;
}

function FilterRow({ metric, range, value, onChange }) {
  const [lo, hi] = range || [];
  const active = value && (value.min !== '' || value.max !== '');
  const box = { width: '100%', padding: '4px 6px', fontSize: 12, textAlign: 'right' };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 78px 78px', gap: 6, alignItems: 'center' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 12, color: active ? '#fff' : 'var(--muted-2)', fontWeight: active ? 600 : 400, minWidth: 0 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{metric.label}{metric.unit && metric.unit !== 'M' ? ` (${metric.unit})` : ''}</span>
        <HelpButtons definition={metric.def} size={12} />
      </span>
      {/* Pas d'exemple fictif : le placeholder montre la plage réellement observée dans la base */}
      <input type="text" inputMode="decimal" value={value?.min ?? ''} onChange={(e) => onChange({ ...value, min: e.target.value })}
        placeholder={lo !== undefined ? fmt(lo, 2) : 'min'} title={lo !== undefined ? `Minimum observé : ${fmt(lo, 2)}` : undefined}
        style={{ ...box, borderColor: value?.min ? 'var(--accent)' : undefined }} />
      <input type="text" inputMode="decimal" value={value?.max ?? ''} onChange={(e) => onChange({ ...value, max: e.target.value })}
        placeholder={hi !== undefined ? fmt(hi, 2) : 'max'} title={hi !== undefined ? `Maximum observé : ${fmt(hi, 2)}` : undefined}
        style={{ ...box, borderColor: value?.max ? 'var(--accent)' : undefined }} />
    </div>
  );
}

function ScreenerView({ active, onAnalyze }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [refreshMsg, setRefreshMsg] = useState(null);

  const [markets, setMarkets] = useState([]);   // vide = tous
  const [country, setCountry] = useState('');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState({ key: 'sharpe', dir: 'desc' });
  const [shown, setShown] = useState(PAGE);
  const [showFilters, setShowFilters] = useState(true);
  const wasRunning = useRef(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API}/api/screener`);
      setPayload(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || "Impossible de charger le screener (le serveur Python est-il lancé ?).");
    } finally {
      setLoading(false);
    }
  };

  const checkStatus = async () => {
    try {
      const res = await axios.get(`${API}/api/screener/status`);
      setStatus(res.data);
      if (wasRunning.current && !res.data.is_running) load(); // fin d'actualisation -> recharge
      wasRunning.current = res.data.is_running;
    } catch { /* l'erreur de connexion est déjà affichée par load() */ }
  };

  useEffect(() => {
    if (active && !payload && !loading) { load(); checkStatus(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!status?.is_running) return;
    const id = setInterval(checkStatus, 2000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.is_running]);

  const refresh = async () => {
    try {
      setRefreshMsg(null);
      await axios.post(`${API}/api/screener/refresh`);
      wasRunning.current = true;
      checkStatus();
    } catch (err) {
      setRefreshMsg(err.response?.data?.detail || 'Erreur lors du lancement.');
    }
  };

  const rows = useMemo(() => payload?.results || [], [payload]);
  const countries = useMemo(() => [...new Set(rows.filter(r => !markets.length || markets.includes(r.market)).map(r => r.country).filter(Boolean))].sort(), [rows, markets]);

  // Filtres numériques actifs, convertis une seule fois
  const activeFilters = useMemo(() => Object.entries(filters)
    .map(([k, f]) => [k, parseNum(f?.min), parseNum(f?.max)])
    .filter(([, lo, hi]) => Number.isFinite(lo) || Number.isFinite(hi)), [filters]);

  const filtered = useMemo(() => {
    const q = norm(query).trim();
    const out = rows.filter(r => {
      if (markets.length && !markets.includes(r.market)) return false;
      if (country && r.country !== country) return false;
      if (q && !norm(r.ticker).includes(q) && !norm(r.name).includes(q)) return false;
      for (const [k, lo, hi] of activeFilters) {
        const v = r[k];
        if (v === null || v === undefined) return false;
        if (Number.isFinite(lo) && v < lo) return false;
        if (Number.isFinite(hi) && v > hi) return false;
      }
      return true;
    });
    const { key, dir } = sort;
    const sgn = dir === 'asc' ? 1 : -1;
    out.sort((a, b) => {
      const va = a[key], vb = b[key];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      return typeof va === 'string' ? sgn * va.localeCompare(vb) : sgn * (va - vb);
    });
    return out;
  }, [rows, markets, country, query, activeFilters, sort]);

  useEffect(() => setShown(PAGE), [markets, country, query, activeFilters, sort]);

  // Colonnes : défaut + toute métrique filtrée ou triée
  const columns = useMemo(() => {
    const cols = [...SCREENER_DEFAULT_COLUMNS];
    for (const [k] of activeFilters) if (!cols.includes(k)) cols.push(k);
    if (SCREENER_METRICS[sort.key] && !cols.includes(sort.key)) cols.push(sort.key);
    return cols;
  }, [activeFilters, sort.key]);

  const toggleMarket = (m) => setMarkets(ms => (ms.includes(m) ? ms.filter(x => x !== m) : [...ms, m]));
  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const resetAll = () => { setFilters({}); setMarkets([]); setCountry(''); setQuery(''); };
  const sortBy = (key) => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));

  const SortHeader = ({ k, label, num = true }) => (
    <th className={num ? 'num' : ''} onClick={() => sortBy(k)} style={{ cursor: 'pointer', userSelect: 'none', color: sort.key === k ? '#fff' : undefined }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {label}{sort.key === k && (sort.dir === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
      </span>
    </th>
  );

  const running = status?.is_running;

  return (
    <div>
      {/* Bandeau statut */}
      <div className="panel" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Base : <strong style={{ color: '#fff' }}>{payload ? payload.total.toLocaleString('fr-FR') : '…'}</strong> actifs ·
            dernière mise à jour <strong style={{ color: '#5b8cff' }}>{status?.last_updated || payload?.updated || '…'}</strong> ·
            métriques calculées sur 1 an glissant
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {(refreshMsg || (running && status.progress_text)) && <span style={{ fontSize: 11, color: 'var(--amber)' }}>{refreshMsg || status.progress_text}</span>}
            <button type="button" className="btn" onClick={refresh} disabled={running || status?.can_refresh === false}
              title={status?.can_refresh === false && !running ? 'Une actualisation a déjà eu lieu il y a moins de 4 h' : 'Re-télécharge tout l’univers (2 à 4 minutes)'}>
              <RefreshCw size={13} className={running ? 'spin' : ''} /> {running ? `Actualisation… ${status.progress_pct} %` : status?.can_refresh === false ? 'À jour' : 'Actualiser les données'}
            </button>
          </div>
        </div>
        {running && (
          <div style={{ height: 4, background: 'var(--bg)', borderRadius: 2, overflow: 'hidden', marginTop: 10 }}>
            <div style={{ width: `${status.progress_pct}%`, height: '100%', background: 'var(--accent)', transition: 'width .4s' }} />
          </div>
        )}
      </div>

      {error && <div className="error-box">{error}</div>}
      {!payload && loading && <EmptyState>Chargement de la base du screener…</EmptyState>}

      {payload && (<>
        {/* Univers */}
        <div className="panel" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', width: 240 }}>
              <Search size={14} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
              <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom ou symbole…" style={{ width: '100%', paddingLeft: 28 }} />
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {payload.markets.map(mk => {
                const on = markets.includes(mk);
                const c = MARKET_COLORS[mk] || '#94a3b8';
                return (
                  <button key={mk} type="button" onClick={() => toggleMarket(mk)} className="btn"
                    style={{ padding: '4px 10px', fontSize: 12, ...(on ? { background: `${c}26`, borderColor: c, color: '#fff' } : {}) }}>
                    {MARKET_LABELS[mk] || mk}
                  </button>
                );
              })}
            </div>
            {countries.length > 1 && (
              <select value={country} onChange={(e) => setCountry(e.target.value)} style={{ fontSize: 12 }}>
                <option value="">Tous les pays</option>
                {countries.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <div style={{ flex: 1 }} />
            <button type="button" className="btn" onClick={() => setShowFilters(s => !s)}>
              <SlidersHorizontal size={13} /> Filtres{activeFilters.length ? ` (${activeFilters.length})` : ''}
              <ChevronDown size={13} style={{ transform: showFilters ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
            </button>
            <button type="button" className="btn" onClick={resetAll}><RotateCcw size={13} /> Réinitialiser</button>
          </div>

          {showFilters && (
            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '18px 28px' }}>
              {SCREENER_GROUPS.map(g => (
                <div key={g.id}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 78px 78px', gap: 6, marginBottom: 6 }}>
                    <span className="label" style={{ margin: 0, color: '#5b8cff' }}>{g.label}</span>
                    <span className="label" style={{ margin: 0, textAlign: 'right' }}>Min</span>
                    <span className="label" style={{ margin: 0, textAlign: 'right' }}>Max</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {g.metrics.map(mt => (
                      <FilterRow key={mt.key} metric={mt} range={payload.ranges[mt.key]} value={filters[mt.key]} onChange={(v) => setFilter(mt.key, v)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {showFilters && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12 }}>Les valeurs grisées indiquent la plage observée dans la base (minimum → maximum). Laissez vide pour ne pas filtrer. Les décimales acceptent la virgule.</div>}
        </div>

        {/* Résultats */}
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>
              <span style={{ color: '#fff', fontWeight: 700 }}>{filtered.length.toLocaleString('fr-FR')}</span> actif{filtered.length > 1 ? 's' : ''} correspondant{filtered.length > 1 ? 's' : ''}
            </h3>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Cliquez sur un en-tête pour trier · une métrique filtrée s'ajoute automatiquement en colonne</span>
          </div>
          {filtered.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>Aucun actif ne passe tous les filtres. Élargissez une borne ou réinitialisez.</div>
          ) : (
            <div style={{ overflow: 'auto', maxHeight: '70vh' }}>
              <table className="table">
                <thead>
                  <tr>
                    <SortHeader k="name" label="Actif" num={false} />
                    <SortHeader k="market" label="Marché" num={false} />
                    <SortHeader k="last_price" label="Cours" />
                    {columns.map(k => <SortHeader key={k} k={k} label={SCREENER_METRICS[k]?.label || k} />)}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, shown).map(r => (
                    <tr key={r.ticker}>
                      <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.name}>
                        <strong style={{ color: '#e6edf3' }}>{r.name || r.ticker}</strong> <span style={{ color: '#38bdf8', fontSize: 11 }}>{r.ticker}</span>
                      </td>
                      <td style={{ color: 'var(--muted-2)' }}>{MARKET_LABELS[r.market] || r.market}{r.country && r.market !== 'Crypto' && r.market !== 'Forex' ? ` · ${r.country}` : ''}</td>
                      <td className="num">{formatCell('last_price', r.last_price)}</td>
                      {columns.map(k => <td key={k} className="num" style={{ color: cellColor(k, r[k]) }}>{formatCell(k, r[k])}</td>)}
                      <td>
                        <button type="button" className="btn" onClick={() => onAnalyze(r.ticker)} style={{ padding: '3px 10px', fontSize: 11, color: '#5b8cff' }}>Analyser</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {shown < filtered.length && (
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => setShown(s => s + PAGE)}>Afficher {Math.min(PAGE, filtered.length - shown)} de plus ({filtered.length - shown} restants)</button>
            </div>
          )}
        </div>
      </>)}
    </div>
  );
}

export default memo(ScreenerView);
