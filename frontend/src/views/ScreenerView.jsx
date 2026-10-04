import { memo, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { RefreshCw, RotateCcw, ArrowUp, ArrowDown, ChevronDown, ChevronRight, ArrowRight, Search, SlidersHorizontal, Loader2 } from 'lucide-react';
import { HelpButtons, EmptyState } from '../components/ui';
import { SCREENER_GROUPS, SCREENER_METRICS, SCREENER_DEFAULT_COLUMNS } from '../definitions';
import { API, fmt, fmtInt, fmtMillions, parseNum, TAG_COLORS } from '../format';
import { useLang, tr, trName } from '../i18n';
import ExportButton from '../components/ExportButton';
import { exportScreener } from '../export/builders';

const PAGE = 100;
const MARKET_LABELS = { US: 'Actions US', Europe: 'Actions Europe', 'Amériques': 'Actions Amériques', Asie: 'Actions Asie' };
const MARKET_COLORS = { US: TAG_COLORS.Actions, Europe: '#8a6d1f', ...TAG_COLORS };

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
  if (/drawdown|var_|cvar|worst/.test(key)) return 'var(--red)';
  if (key === 'sharpe' || key === 'sortino') return v >= 1 ? 'var(--green)' : v < 0 ? 'var(--red)' : undefined;
  if (key === 'rsi_14') return v >= 70 || v <= 30 ? 'var(--amber)' : undefined;
  return undefined;
}

function FilterRow({ metric, range, value, onChange }) {
  const { t } = useLang();
  const [lo, hi] = range || [];
  const active = value && (value.min !== '' || value.max !== '');
  return (
    <div className={`filter-row${active ? ' is-active' : ''}`} data-filter={metric.key}>
      <span className="filter-row-label">
        <span className="ellipsis">{t(metric.label)}{metric.unit && metric.unit !== 'M' ? ` (${t(metric.unit)})` : ''}</span>
        <HelpButtons definition={metric.def} size={12} />
      </span>
      {/* Pas d'exemple fictif : le placeholder montre la plage réellement observée dans la base */}
      <label className={`bound-input${value?.min ? ' filled' : ''}`}>
        <span>min</span>
        <input type="text" inputMode="decimal" value={value?.min ?? ''} onChange={(e) => onChange({ ...value, min: e.target.value })}
          placeholder={lo !== undefined ? fmt(lo, 2) : ''} title={lo !== undefined ? t('Minimum observé : {v}', { v: fmt(lo, 2) }) : undefined}
          aria-label={`${t(metric.label)} minimum`} />
      </label>
      <label className={`bound-input${value?.max ? ' filled' : ''}`}>
        <span>max</span>
        <input type="text" inputMode="decimal" value={value?.max ?? ''} onChange={(e) => onChange({ ...value, max: e.target.value })}
          placeholder={hi !== undefined ? fmt(hi, 2) : ''} title={hi !== undefined ? t('Maximum observé : {v}', { v: fmt(hi, 2) }) : undefined}
          aria-label={`${t(metric.label)} maximum`} />
      </label>
    </div>
  );
}

/** Résumé court d'un filtre actif, ex. « Sharpe ≥ 1,5 ». */
function filterSummary(metric, f) {
  const lo = f?.min?.trim(), hi = f?.max?.trim();
  const l = tr(metric.label);
  if (lo && hi) return `${l} ${lo} → ${hi}`;
  return lo ? `${l} ≥ ${lo}` : `${l} ≤ ${hi}`;
}

/** Bandeau déroulant regroupant les filtres d'une famille de métriques. */
function FilterGroup({ group, open, onToggle, activeKeys, filters, ranges, onFilter, onClear }) {
  const { t } = useLang();
  const count = group.metrics.filter(m => activeKeys.has(m.key)).length;
  const bodyId = `fgroup-${group.id}`;
  return (
    <section className={`fgroup${open ? ' open' : ''}${count ? ' has-active' : ''}`}>
      <div className="fgroup-head">
        <button type="button" className="fgroup-toggle" aria-expanded={open} aria-controls={bodyId} data-group={group.id} onClick={onToggle}>
          <ChevronRight size={15} className="fgroup-chevron" />
          <span className="fgroup-title">{t(group.label)}</span>
          <span className="fgroup-meta">{t('{n} critères', { n: group.metrics.length })}</span>
          {count > 0 && <span className="count-badge" title={t(count > 1 ? '{n} filtres actifs' : '{n} filtre actif', { n: count })}>{count}</span>}
          {!open && count > 0 && (
            <span className="fgroup-chips">
              {group.metrics.filter(m => activeKeys.has(m.key)).map(m => <span key={m.key} className="chip">{filterSummary(m, filters[m.key])}</span>)}
            </span>
          )}
        </button>
        {count > 0 && <button type="button" className="link-btn" onClick={onClear}>{t('Effacer')}</button>}
      </div>
      <div className="fgroup-body" id={bodyId} inert={!open}>
        <div className="fgroup-clip">
          <div className="fgroup-grid">
            {group.metrics.map(mt => (
              <FilterRow key={mt.key} metric={mt} range={ranges[mt.key]} value={filters[mt.key]} onChange={(v) => onFilter(mt.key, v)} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ScreenerView({ active, onAnalyze }) {
  const { t, lang } = useLang();
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
  const [openGroups, setOpenGroups] = useState(() => new Set()); // bandeaux repliés par défaut
  const wasRunning = useRef(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`${API}/api/screener`);
      setPayload(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || tr("Impossible de charger le screener (le serveur Python est-il lancé ?)."));
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
      setRefreshMsg(err.response?.data?.detail || tr('Erreur lors du lancement.'));
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
      const na = va === null || va === undefined, nb = vb === null || vb === undefined;
      if (na || nb) return na === nb ? 0 : na ? 1 : -1; // valeurs manquantes toujours en bas (comparateur cohérent)
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
  const clearGroup = (g) => setFilters(f => { const n = { ...f }; for (const mt of g.metrics) delete n[mt.key]; return n; });
  const toggleGroup = (id) => setOpenGroups(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const activeKeys = useMemo(() => new Set(activeFilters.map(([k]) => k)), [activeFilters]);
  const resetAll = () => { setFilters({}); setMarkets([]); setCountry(''); setQuery(''); };
  const sortBy = (key) => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));

  const SortHeader = ({ k, label, num = true }) => (
    <th className={num ? 'num' : ''} style={{ userSelect: 'none', color: sort.key === k ? 'var(--text)' : undefined }}
      aria-sort={sort.key === k ? (sort.dir === 'desc' ? 'descending' : 'ascending') : undefined}>
      <button type="button" className="th-sort" onClick={() => sortBy(k)} title={t('Trier par cette colonne')}>
        {t(label)}{sort.key === k && (sort.dir === 'desc' ? <ArrowDown size={12} aria-hidden="true" /> : <ArrowUp size={12} aria-hidden="true" />)}
      </button>
    </th>
  );

  const running = status?.is_running;

  return (
    <div>
      {/* Bandeau statut */}
      <div style={{ marginBottom: 16 }}>
        <div className="result-head" style={{ alignItems: 'center' }}>
          <div className="result-title">
            <h2>Screener</h2>
            <span className="tag">{t('{n} actifs', { n: payload ? fmtInt(payload.total) : '…' })}</span>
            <span className="result-meta">
              {t('Mise à jour :')} <strong>{(status?.last_updated || payload?.updated || '…').replace(' à ', lang === 'en' ? ' ' : ' à ')}</strong> · {t('métriques calculées sur 1 an glissant')}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {(refreshMsg || (running && status.progress_text)) && <span role="status" style={{ fontSize: 12, color: 'var(--amber)' }}>{refreshMsg || status.progress_text}</span>}
            <button type="button" className="btn" onClick={refresh} disabled={running || status?.can_refresh === false}
              title={status?.can_refresh === false && !running ? t('Une actualisation a déjà eu lieu il y a moins de 4 h') : t('Re-télécharge tout l’univers (2 à 4 minutes)')}>
              <RefreshCw size={13} className={running ? 'spin' : ''} /> {running ? `${t('Actualisation…')} ${status.progress_pct} %` : status?.can_refresh === false ? t('À jour') : t('Actualiser les données')}
            </button>
          </div>
        </div>
        {running && (
          <div style={{ height: 4, background: 'var(--bg)', borderRadius: 2, overflow: 'hidden', marginTop: 10 }}>
            <div style={{ width: `${status.progress_pct}%`, height: '100%', background: 'var(--accent)', transition: 'width .4s' }} />
          </div>
        )}
      </div>

      {error && <div className="error-box" role="alert">{error}</div>}
      {!payload && loading && <EmptyState icon={Loader2} busy title="Chargement de la base du screener…" />}

      {payload && (<>
        {/* Univers */}
        <div className="panel" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="search-box">
              <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
              <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Nom ou symbole…')} aria-label={t('Rechercher un actif (nom ou symbole)')} style={{ width: '100%', paddingLeft: 28 }} />
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {payload.markets.map(mk => {
                const on = markets.includes(mk);
                const c = MARKET_COLORS[mk] || '#69716c';
                return (
                  <button key={mk} type="button" onClick={() => toggleMarket(mk)} className="btn" aria-pressed={on}
                    style={{ padding: '4px 10px', fontSize: 12, ...(on ? { background: `${c}26`, borderColor: c, color: 'var(--text)' } : {}) }}>
                    {t(MARKET_LABELS[mk] || mk)}
                  </button>
                );
              })}
            </div>
            {countries.length > 1 && (
              <select value={country} onChange={(e) => setCountry(e.target.value)} style={{ fontSize: 12 }} aria-label={t('Pays')}>
                <option value="">{t('Tous les pays')}</option>
                {countries.map(c => <option key={c} value={c}>{trName(c)}</option>)}
              </select>
            )}
            <div style={{ flex: 1 }} />
            <button type="button" className="btn" onClick={() => setShowFilters(s => !s)} aria-expanded={showFilters}>
              <SlidersHorizontal size={13} /> {t('Filtres')}{activeFilters.length > 0 && <span className="count-badge">{activeFilters.length}</span>}
              <ChevronDown size={13} style={{ transform: showFilters ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
            </button>
            <button type="button" className="btn" onClick={resetAll}><RotateCcw size={13} /> {t('Réinitialiser')}</button>
            <ExportButton onExport={() => exportScreener(filtered, (mk) => tr(MARKET_LABELS[mk] || mk))} label="Exporter les résultats" disabled={!filtered.length} />
          </div>

          {showFilters && (
            <div className="fgroups">
              {SCREENER_GROUPS.map(g => (
                <FilterGroup key={g.id} group={g} open={openGroups.has(g.id)} onToggle={() => toggleGroup(g.id)}
                  activeKeys={activeKeys} filters={filters} ranges={payload.ranges} onFilter={setFilter} onClear={() => clearGroup(g)} />
              ))}
            </div>
          )}
          {showFilters && <div className="hint" style={{ marginTop: 10 }}>{t('Les valeurs grisées indiquent la plage observée dans la base (minimum → maximum). Laissez vide pour ne pas filtrer. Les décimales acceptent la virgule.')}</div>}
        </div>

        {/* Résultats */}
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>
              <span style={{ color: 'var(--text)', fontWeight: 700 }}>{fmtInt(filtered.length)}</span> {t(filtered.length > 1 ? 'actifs correspondants' : 'actif correspondant')}
            </h3>
            <span className="hint">{t("Cliquez sur un en-tête pour trier · une métrique filtrée s'ajoute automatiquement en colonne")}</span>
          </div>
          {filtered.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted-2)' }}>
              {t('Aucun actif ne passe tous les filtres. Élargissez une borne ou réinitialisez.')}
              <div style={{ marginTop: 10 }}><button type="button" className="btn btn-sm" onClick={resetAll}><RotateCcw size={12} /> {t('Réinitialiser')}</button></div>
            </div>
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
                        <strong style={{ color: 'var(--text)' }}>{r.name || r.ticker}</strong> <span style={{ color: 'var(--accent-text)', fontSize: 11 }}>{r.ticker}</span>
                      </td>
                      <td style={{ color: 'var(--muted-2)' }}>{t(MARKET_LABELS[r.market] || r.market)}{r.country && r.market !== 'Crypto' && r.market !== 'Forex' ? ` · ${trName(r.country)}` : ''}</td>
                      <td className="num">{formatCell('last_price', r.last_price)}</td>
                      {columns.map(k => <td key={k} className="num" style={{ color: cellColor(k, r[k]) }}>{formatCell(k, r[k])}</td>)}
                      <td>
                        <button type="button" className="row-action" onClick={() => onAnalyze(r.ticker)}>{t('Analyser')} <ArrowRight size={12} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {shown < filtered.length && (
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => setShown(s => s + PAGE)}>{t('Afficher {a} de plus ({b} restants)', { a: Math.min(PAGE, filtered.length - shown), b: filtered.length - shown })}</button>
            </div>
          )}
        </div>
      </>)}
    </div>
  );
}

export default memo(ScreenerView);
