import { useMemo, useState } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { Bookmark, Save, FolderOpen, Trash2, GitCompare, Loader2 } from 'lucide-react';
import { API, COLORS, fmt, fmtDate } from '../format';
import { useLang, trName } from '../i18n';
import { getAsset } from '../tickerDatabase';
import ExportButton from './ExportButton';
import { exportComparisonReport } from '../export/builders';

const STORAGE_KEY = 'portfolios.v1';
const MAX_COMPARE = 5;

const loadSaved = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
};
const persist = (list) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* stockage indisponible : la liste reste en mémoire */ }
};

// Indicateurs comparés : better = sens « meilleur » (1 = plus haut, -1 = plus bas, 0 = neutre)
const ROWS = [
  { key: 'total_change_pct', label: 'Variation totale', unit: '%', better: 1, signed: true },
  { key: 'cagr_pct', label: 'CAGR (rend. annuel)', unit: '%', better: 1, signed: true },
  { key: 'annualized_volatility_pct', label: 'Volatilité annualisée', unit: '%', better: -1 },
  { key: 'max_drawdown_pct', label: 'Max Drawdown', unit: '%', better: 1 },
  { key: 'sharpe_ratio', label: 'Ratio de Sharpe', better: 1 },
  { key: 'sortino_ratio', label: 'Ratio de Sortino', better: 1 },
  { key: 'calmar_ratio', label: 'Ratio de Calmar', better: 1 },
  { key: 'var_historical_pct', label: 'VaR historique 1 j', unit: '%', better: 1 },
  { key: 'positive_months_pct', label: 'Mois positifs', unit: '%', better: 1, nd: 0 },
  { key: 'beta', label: 'Bêta', better: 0 },
];

const REBAL_LABEL = { none: 'Aucun (achat-conservation)', monthly: 'Mensuel', daily: 'Quotidien (poids constants)' };
const nameOf = (tk) => trName(getAsset(tk)?.name) || tk;

/**
 * Bibliothèque de portefeuilles : enregistrer la composition, la recharger, et comparer plusieurs idées
 * sur la même période et le même benchmark.
 */
export default function PortfolioLibrary({ currentItems, rebalance, onLoad, compareParams }) {
  const { t } = useLang();
  const [saved, setSaved] = useState(loadSaved);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [cmp, setCmp] = useState(null);       // { results: [...], errors: [...] }
  const [loading, setLoading] = useState(false);

  const total = currentItems.reduce((a, [, w]) => a + w, 0);
  const canSave = currentItems.length > 0 && Math.abs(total - 100) <= 0.5 && name.trim();

  const save = () => {
    if (!canSave) return;
    const item = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim(), savedAt: new Date().toISOString(), items: currentItems, rebalance };
    const next = [item, ...saved];
    setSaved(next); persist(next); setName('');
  };
  const remove = (id) => {
    const next = saved.filter(p => p.id !== id);
    setSaved(next); persist(next); setConfirmDelete(null);
    setSelected(s => s.filter(x => x !== id));
  };
  const toggle = (id) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : s.length >= MAX_COMPARE ? s : [...s, id]));

  const compare = async () => {
    const chosen = saved.filter(p => selected.includes(p.id));
    if (chosen.length < 2) return;
    setLoading(true);
    const settled = await Promise.allSettled(chosen.map(p => axios.post(`${API}/api/portfolio/analyze`, {
      ...compareParams, weights: Object.fromEntries(p.items), rebalance: p.rebalance || 'none', forecast_days: 21,
    })));
    const results = [], errors = [];
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') results.push({ p: chosen[i], d: r.value.data });
      else errors.push(`${chosen[i].name} : ${r.reason?.response?.data?.detail || t("Le service de données ne répond pas pour le moment. Réessayez dans un instant.")}`);
    });
    setCmp({ results, errors });
    setLoading(false);
  };

  // Courbes base 100 fusionnées par date (un point sur deux au-delà de 600 dates pour rester fluide)
  const chart = useMemo(() => {
    if (!cmp?.results.length) return [];
    const byDate = new Map();
    cmp.results.forEach(({ p, d }) => d.chart_data.forEach(row => {
      if (!byDate.has(row.date)) byDate.set(row.date, { date: row.date });
      byDate.get(row.date)[p.id] = row.value;
    }));
    const all = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    const step = all.length > 600 ? Math.ceil(all.length / 600) : 1;
    return all.filter((_, i) => i % step === 0 || i === all.length - 1);
  }, [cmp]);

  const best = (row) => {
    if (!row.better || !cmp) return null;
    const vals = cmp.results.map(({ d }) => d.metrics[row.key]).filter(v => v !== null && v !== undefined);
    if (vals.length < 2) return null;
    return row.better > 0 ? Math.max(...vals) : Math.min(...vals);
  };

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head">
        <h3 className="section-title"><Bookmark size={15} /> {t('Mes portefeuilles')}</h3>
        <div className="lib-save">
          {saved.length > 0 && (
            <ExportButton label={selected.length ? 'Rapport de comparaison ({n})' : 'Rapport de comparaison (tous)'} labelVars={{ n: selected.length }}
              onExport={() => exportComparisonReport(selected.length ? saved.filter(p => selected.includes(p.id)) : saved, compareParams)} />
          )}
          <input id="portfolio-name" type="text" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()}
            aria-label={t('Nom du portefeuille')} placeholder={t('Nom du portefeuille')} maxLength={60} />
          <button type="button" className="btn" onClick={save} disabled={!canSave}
            title={Math.abs(total - 100) > 0.5 ? t('La composition doit faire 100 % pour être enregistrée') : t('Enregistrer la composition actuelle')}>
            <Save size={14} /> {t('Enregistrer')}
          </button>
        </div>
      </div>

      {saved.length === 0 ? (
        <div className="hint">{t('Aucun portefeuille enregistré. Composez une idée, donnez-lui un nom et enregistrez-la : vous pourrez la comparer plus tard à d\'autres idées.')}</div>
      ) : (<>
        <div className="lib-list">
          {saved.map(p => (
            <div key={p.id} className={`lib-item${selected.includes(p.id) ? ' on' : ''}`}>
              <label className="lib-check">
                <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
                <span className="lib-name">{p.name}</span>
              </label>
              <div className="lib-chips">
                {p.items.map(([tk, w]) => <span key={tk} className="tag" title={nameOf(tk)}>{tk} {fmt(w, w % 1 ? 1 : 0)} %</span>)}
              </div>
              <span className="hint lib-meta">{t(REBAL_LABEL[p.rebalance] || REBAL_LABEL.none).split(' (')[0]} · {fmtDate(p.savedAt.slice(0, 10))}</span>
              <div className="lib-actions">
                <button type="button" className="btn btn-sm" onClick={() => onLoad(p)}><FolderOpen size={13} /> {t('Charger')}</button>
                {confirmDelete === p.id
                  ? <button type="button" className="btn btn-sm lib-danger" onClick={() => remove(p.id)} onBlur={() => setConfirmDelete(null)}>{t('Confirmer')}</button>
                  : <button type="button" className="icon-btn" title={t('Supprimer')} onClick={() => setConfirmDelete(p.id)}><Trash2 size={14} /></button>}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" disabled={selected.length < 2 || loading} onClick={compare}>
            {loading ? <Loader2 size={14} className="spin" /> : <GitCompare size={14} />} {t('Comparer ({n})', { n: selected.length })}
          </button>
          <span className="hint">{t('Cochez 2 à {m} portefeuilles. Ils sont comparés sur la période et le benchmark choisis dans les paramètres de simulation.', { m: MAX_COMPARE })}</span>
        </div>
      </>)}

      {cmp && (
        <div style={{ marginTop: 18 }}>
          {cmp.errors.map(e => <div key={e} className="error-box">{e}</div>)}
          {cmp.results.length >= 1 && (<>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('Indicateur')}</th>
                    {cmp.results.map(({ p }, i) => (
                      <th key={p.id} className="num"><span className="lib-dot" style={{ background: COLORS[i % COLORS.length] }} />{p.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map(row => {
                    const b = best(row);
                    return (
                      <tr key={row.key}>
                        <td>{t(row.label)}</td>
                        {cmp.results.map(({ p, d }) => {
                          const v = d.metrics[row.key];
                          const isBest = b !== null && v === b;
                          return <td key={p.id} className={`num${isBest ? ' lib-best' : ''}`}>{fmt(v, row.nd ?? 2, row.signed)}{row.unit && v !== null && v !== undefined ? ` ${row.unit}` : ''}</td>;
                        })}
                      </tr>
                    );
                  })}
                  <tr>
                    <td>{t('Période analysée')}</td>
                    {cmp.results.map(({ p, d }) => <td key={p.id} className="num hint">{fmtDate(d.period_start)} → {fmtDate(d.period_end)}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="hint" style={{ margin: '6px 0 12px' }}>{t('En surbrillance : le meilleur portefeuille sur chaque ligne (le bêta n\'a pas de « meilleur »).')}</div>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%" minWidth={10} minHeight={10}>
                <LineChart data={chart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e6e8e6" />
                  <XAxis dataKey="date" stroke="#69716c" fontSize={11} minTickGap={60} tickFormatter={(d) => fmtDate(d)} />
                  <YAxis stroke="#69716c" fontSize={11} width={48} domain={['auto', 'auto']} tickFormatter={(v) => fmt(v, 0)} />
                  <Tooltip contentStyle={{ backgroundColor: '#ffffff', borderColor: '#c6c9c6', color: 'var(--text)', fontSize: 12 }}
                    labelFormatter={(d) => fmtDate(d)} formatter={(v, n) => [fmt(v, 1), n]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {cmp.results.map(({ p }, i) => (
                    <Line key={p.id} dataKey={p.id} name={p.name} stroke={COLORS[i % COLORS.length]} dot={false} strokeWidth={2} connectNulls isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="hint" style={{ marginTop: 4 }}>{t('Valeur de chaque portefeuille en base 100. Si les actifs n\'ont pas le même historique, les courbes peuvent commencer à des dates différentes.')}</div>
          </>)}
        </div>
      )}
    </div>
  );
}
