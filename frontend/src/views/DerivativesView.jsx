import { memo, useMemo, useState } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, ReferenceArea, Legend } from 'recharts';
import { Sigma, AlertTriangle, Plus, Trash2, Download, Table2 } from 'lucide-react';
import AssetSearchInput from '../components/AssetSearchInput';
import { Field, StatCell, EmptyState } from '../components/ui';
import { blackScholes, impliedVol, legPayoff, legValueNow, STRATEGIES } from '../finance/optionsMath';
import { getAsset } from '../tickerDatabase';
import { API, fmt, fmtInt, parseNum } from '../format';
import { useLang, trName, getLocale } from '../i18n';
import { GREEKS } from '../definitions';

const AXIS = { stroke: '#88888f', fontSize: 11 };
const TOOLTIP = { contentStyle: { backgroundColor: '#1b1b1e', borderColor: '#323237', color: '#fff', fontSize: 12 } };
let legSeq = 0;
const newLeg = (l) => ({ id: `leg${Date.now().toString(36)}${legSeq++}`, qty: 1, ...l });



const roundStrike = (k, chainStrikes) => {
  if (chainStrikes?.length) return chainStrikes.reduce((best, s) => (Math.abs(s - k) < Math.abs(best - k) ? s : best), chainStrikes[0]);
  const step = k > 500 ? 10 : k > 100 ? 5 : k > 20 ? 1 : k > 5 ? 0.5 : 0.1;
  return Math.round(k / step) * step;
};

function DerivativesView({ onAnalyze }) {
  const { t } = useLang();
  const [ticker, setTicker] = useState('');
  const [mkt, setMkt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [S, setS] = useState('');
  const [vol, setVol] = useState('');
  const [rate, setRate] = useState('');
  const [div, setDiv] = useState('');
  const [days, setDays] = useState('');
  const [strike, setStrike] = useState('');
  const [legs, setLegs] = useState([]);
  const [showChain, setShowChain] = useState(true);

  const load = async (t = ticker, expiry) => {
    const tk = (t || '').trim().toUpperCase();
    if (!tk) { setError(t('Choisissez un sous-jacent.')); return; }
    setLoading(true); setError(null);
    try {
      const { data } = await axios.get(`${API}/api/options/${encodeURIComponent(tk)}`, { params: expiry ? { expiry } : {} });
      setMkt(data);
      setS(String(data.spot));
      if (!expiry) setVol(String(data.hv_30 ?? data.hv_1y ?? ''));
      setRate(String(data.risk_free_pct ?? ''));
      if (data.expiry) {
        const d = Math.max(1, Math.round((new Date(`${data.expiry}T21:00:00Z`) - Date.now()) / 86400000));
        setDays(String(d));
      }
      if (!strike || !expiry) setStrike(String(roundStrike(data.spot, data.calls.map(c => c.strike))));
    } catch (err) {
      setError(err.response?.data?.detail || t("Impossible de charger le sous-jacent (le serveur Python est-il lancé ?)."));
    } finally { setLoading(false); }
  };

  const p = { S: parseNum(S), sigma: parseNum(vol) / 100, r: (parseNum(rate) || 0) / 100, q: (parseNum(div) || 0) / 100, T: parseNum(days) / 365 };
  const baseOk = p.S > 0 && p.sigma > 0 && p.T > 0;
  const K = parseNum(strike);
  const call = baseOk && K > 0 ? blackScholes({ type: 'call', ...p, K }) : null;
  const put = baseOk && K > 0 ? blackScholes({ type: 'put', ...p, K }) : null;

  const chainStrikes = useMemo(() => mkt?.calls?.map(c => c.strike) || [], [mkt]);
  const chainMid = (kind, k) => (kind === 'call' ? mkt?.calls : mkt?.puts)?.find(c => c.strike === k)?.mid;
  const theo = (kind, k) => blackScholes({ type: kind, ...p, K: k }).price;
  const premiumFor = (kind, k) => (kind === 'stock' ? p.S : (chainMid(kind, k) || theo(kind, k)));

  const applyStrategy = (id) => {
    const st = STRATEGIES.find(x => x.id === id);
    if (!st || !baseOk) return;
    setLegs(st.legs(p.S).map(l => {
      const k = l.kind === 'stock' ? null : roundStrike(l.strike, chainStrikes);
      return newLeg({ ...l, strike: k, premium: Math.round(premiumFor(l.kind, k) * 100) / 100 });
    }));
  };
  const addFromChain = (kind, row, side = 1) => setLegs(ls => [...ls, newLeg({ kind, side, strike: row.strike, premium: row.mid })]);
  const updateLeg = (id, field, value) => setLegs(ls => ls.map(l => (l.id === id ? { ...l, [field]: value } : l)));

  // Diagramme de gains : à l'échéance et aujourd'hui (Black-Scholes)
  const payoff = (() => {
    const clean = legs.map(l => ({ ...l, qty: parseNum(l.qty) || 0, strike: parseNum(l.strike), premium: parseNum(l.premium) || 0 }))
      .filter(l => l.qty && (l.kind === 'stock' || l.strike > 0));
    if (!clean.length || !baseOk) return null;
    const lo = p.S * 0.5, hi = p.S * 1.5, n = 160;
    const pts = Array.from({ length: n + 1 }, (_, i) => {
      const x = lo + ((hi - lo) * i) / n;
      return {
        price: Math.round(x * 100) / 100,
        expiry: clean.reduce((s, l) => s + legPayoff(l, x), 0),
        today: clean.reduce((s, l) => s + legValueNow(l, x, p.T, p.r, p.sigma, p.q), 0),
      };
    });
    const ys = pts.map(x => x.expiry);
    const breakevens = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if ((a.expiry < 0) !== (b.expiry < 0)) breakevens.push(a.price + (b.price - a.price) * (-a.expiry) / (b.expiry - a.expiry));
    }
    // Le cours ne descend pas sous 0 : seul le côté haut peut être illimité. On évalue aussi le cas « cours = 0 ».
    const slopeHi = ys[n] - ys[n - 1];
    const atZero = clean.reduce((s, l) => s + legPayoff(l, 0), 0);
    const cost = clean.reduce((s, l) => s + l.side * l.qty * l.premium, 0);
    return {
      pts, breakevens, cost,
      maxGain: slopeHi > 1e-9 ? Infinity : Math.max(...ys, atZero),
      maxLoss: slopeHi < -1e-9 ? -Infinity : Math.min(...ys, atZero),
      sd: p.S * p.sigma * Math.sqrt(p.T),
    };
  })();

  const atmIv = useMemo(() => {
    if (!mkt?.calls?.length) return null;
    const row = mkt.calls.reduce((b, c) => (Math.abs(c.strike - mkt.spot) < Math.abs(b.strike - mkt.spot) ? c : b));
    return row.iv;
  }, [mkt]);

  return (
    <div>
      <div className="result-head" style={{ marginTop: 0 }}>
        <div className="result-title"><h1>{t('Dérivés · options')}</h1></div>
        <div className="result-meta">{t("Modèle de Black-Scholes · chaînes d'options Yahoo (actions et ETF américains)")}</div>
      </div>

      <div className="warn-box">
        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>{t("Outil pédagogique : les prix calculés sont théoriques. Les options sont des produits à effet de levier ; la majorité des particuliers qui les échangent perdent de l'argent, surtout en vendant des options sans couverture (pertes potentiellement illimitées).")}</div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="form-row">
          <Field label="Sous-jacent" style={{ width: 280 }}>
            <AssetSearchInput value={ticker} onChange={setTicker} onSelect={(t) => { setTicker(t); load(t); }} onEnter={() => load()} />
          </Field>
          <button type="button" className="btn btn-primary" onClick={() => load()} disabled={loading}><Download size={14} /> {loading ? t('Chargement…') : t('Charger le marché')}</button>
          {mkt && (
            <div className="hint" style={{ alignSelf: 'center' }}>
              {trName(getAsset(mkt.ticker)?.name) || mkt.ticker} · {t('cours {s} · vol. historique 30 j {a} % / 1 an {b} %', { s: fmt(mkt.spot, 2), a: fmt(mkt.hv_30, 1), b: fmt(mkt.hv_1y, 1) })}
              {atmIv && <> · {t('vol. implicite à la monnaie {v} %', { v: fmt(atmIv, 1) })}</>}
              <button type="button" className="link-btn" onClick={() => onAnalyze(mkt.ticker)}>{t("analyser l'actif")}</button>
            </div>
          )}
        </div>
        {error && <div className="error-box" style={{ marginTop: 12, marginBottom: 0 }}>{error}</div>}

        <div className="bond-form" style={{ marginTop: 16 }}>
          <Field label="Cours du sous-jacent"><input type="text" inputMode="decimal" value={S} onChange={(e) => setS(e.target.value)} /></Field>
          <Field label="Volatilité (% / an)"><input type="text" inputMode="decimal" value={vol} onChange={(e) => setVol(e.target.value)} /></Field>
          <Field label="Taux sans risque (%)"><input type="text" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
          <Field label="Dividende (% / an)"><input type="text" inputMode="decimal" value={div} onChange={(e) => setDiv(e.target.value)} /></Field>
          <Field label="Jours jusqu'à l'échéance"><input type="text" inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
          {mkt?.expiries?.length > 0 && (
            <Field label="Échéance cotée">
              <select value={mkt.expiry || ''} onChange={(e) => load(mkt.ticker, e.target.value)} style={{ width: '100%' }}>
                {mkt.expiries.map(x => <option key={x} value={x}>{new Date(`${x}T12:00:00`).toLocaleDateString(getLocale(), { day: 'numeric', month: 'short', year: 'numeric' })}</option>)}
              </select>
            </Field>
          )}
        </div>
        {mkt && (
          <div className="hint" style={{ marginTop: 8 }}>
            {t('Volatilité :')} <button type="button" className="link-btn" onClick={() => setVol(String(mkt.hv_30))}>{t('historique 30 j')}</button>
            <button type="button" className="link-btn" onClick={() => setVol(String(mkt.hv_1y))}>{t('historique 1 an')}</button>
            {atmIv && <button type="button" className="link-btn" onClick={() => setVol(String(atmIv))}>{t('implicite du marché')}</button>}
            · {t('taux sans risque = bon du Trésor US à 3 mois (onglet Obligations).')}
            {!mkt.expiries?.length && ` ${t('Aucune option cotée sur Yahoo pour ce sous-jacent : le calcul reste possible avec vos paramètres.')}`}
          </div>
        )}
      </div>

      {/* PRICER */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <h3 className="section-title"><Sigma size={15} /> {t('Prix théorique et grecques')}</h3>
          <Field label="" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="hint">Strike</span>
            <input type="text" inputMode="decimal" value={strike} onChange={(e) => setStrike(e.target.value)} style={{ width: 110 }} />
          </Field>
        </div>
        {!call ? (
          <div className="hint">{t('Chargez un sous-jacent ou renseignez cours, volatilité, échéance et strike.')}</div>
        ) : (
          <div className="grid-2">
            {[['Call (droit d\'acheter)', call, 'call'], ['Put (droit de vendre)', put, 'put']].map(([label, g, kind]) => {
              const mid = chainMid(kind, K);
              const iv = mid ? impliedVol({ type: kind, ...p, K, price: mid }) : null;
              return (
                <div key={kind} className="greek-card">
                  <div className="greek-head">
                    <span className="label" style={{ margin: 0 }}>{t(label)}</span>
                    <span className="kpi-value">{fmt(g.price, 2)}</span>
                    {mid ? <span className="hint">{t('marché')} {fmt(mid, 2)}{iv ? ` · ${t('vol. implicite')} ${fmt(iv * 100, 1)} %` : ''}</span> : null}
                  </div>
                  <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
                    <StatCell label="Delta" value={g.delta} nd={3} definition={GREEKS.delta} />
                    <StatCell label="Gamma" value={g.gamma} nd={4} definition={GREEKS.gamma} />
                    <StatCell label="Vega" value={g.vega} nd={3} definition={GREEKS.vega} />
                    <StatCell label="Theta / jour" value={g.theta} nd={3} definition={GREEKS.theta} tone={g.theta < 0 ? 'neg' : 'pos'} />
                    <StatCell label="Rho" value={g.rho} nd={3} definition={GREEKS.rho} />
                    <StatCell label="Proba. d'exercice" value={g.probItm * 100} unit="%" nd={1} definition={GREEKS.prob} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* STRATÉGIES */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <h3 className="section-title">{t('Construire une stratégie')}</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <select value="" onChange={(e) => applyStrategy(e.target.value)} disabled={!baseOk} style={{ fontSize: 12 }}>
              <option value="">{t('Stratégies classiques…')}</option>
              {STRATEGIES.map(s => <option key={s.id} value={s.id}>{t(s.label)}</option>)}
            </select>
            <button type="button" className="btn btn-sm" disabled={!baseOk} onClick={() => setLegs(ls => [...ls, newLeg({ kind: 'call', side: 1, strike: roundStrike(p.S, chainStrikes), premium: Math.round(premiumFor('call', roundStrike(p.S, chainStrikes)) * 100) / 100 })])}>
              <Plus size={13} /> {t('Ajouter une jambe')}
            </button>
          </div>
        </div>
        {legs.length === 0 ? (
          <div className="hint">{t(baseOk ? "Choisissez une stratégie classique, ajoutez une jambe, ou cliquez sur une ligne de la chaîne d'options." : "Chargez d'abord un sous-jacent (ou renseignez les paramètres).")}</div>
        ) : (<>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>{t('Sens')}</th><th>Instrument</th><th className="num">Strike</th><th className="num">{t('Quantité')}</th><th className="num">{t('Prime / prix')}</th><th className="num">{t('Théorique')}</th><th /></tr></thead>
              <tbody>
                {legs.map(l => (
                  <tr key={l.id}>
                    <td><select value={l.side} onChange={(e) => updateLeg(l.id, 'side', Number(e.target.value))}><option value={1}>{t('Achat')}</option><option value={-1}>{t('Vente')}</option></select></td>
                    <td><select value={l.kind} onChange={(e) => updateLeg(l.id, 'kind', e.target.value)}><option value="call">Call</option><option value="put">Put</option><option value="stock">{t('Action')}</option></select></td>
                    <td className="num">{l.kind === 'stock' ? '—' : <input type="text" inputMode="decimal" value={l.strike ?? ''} onChange={(e) => updateLeg(l.id, 'strike', e.target.value)} style={{ width: 80, textAlign: 'right' }} />}</td>
                    <td className="num"><input type="text" inputMode="decimal" value={l.qty} onChange={(e) => updateLeg(l.id, 'qty', e.target.value)} style={{ width: 60, textAlign: 'right' }} /></td>
                    <td className="num"><input type="text" inputMode="decimal" value={l.premium ?? ''} onChange={(e) => updateLeg(l.id, 'premium', e.target.value)} style={{ width: 80, textAlign: 'right' }} /></td>
                    <td className="num hint">{l.kind === 'stock' ? fmt(p.S, 2) : fmt(theo(l.kind, parseNum(l.strike)), 2)}</td>
                    <td><button type="button" className="icon-btn" onClick={() => setLegs(ls => ls.filter(x => x.id !== l.id))}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>{t('Quantités par unité de sous-jacent (un contrat américain = 100 actions). Prime = prix du marché si la chaîne est chargée, sinon prix théorique.')}</div>

          {payoff && (<>
            <div className="kpi-strip panel" style={{ marginTop: 14, marginBottom: 12, background: 'var(--panel-2)' }}>
              <div><span className="label">{t(payoff.cost >= 0 ? 'Coût net' : 'Crédit net reçu')}</span><span className="kpi-value">{fmt(Math.abs(payoff.cost), 2)}</span></div>
              <div><span className="label">{t('Gain maximal')}</span><span className="kpi-value" style={{ color: 'var(--green)' }}>{payoff.maxGain === Infinity ? t('Illimité') : fmt(payoff.maxGain, 2)}</span></div>
              <div><span className="label">{t('Perte maximale')}</span><span className="kpi-value" style={{ color: 'var(--red)' }}>{payoff.maxLoss === -Infinity ? t('Illimitée') : fmt(payoff.maxLoss, 2)}</span></div>
              <div><span className="label">{t('Point(s) mort(s)')}</span><span className="kpi-value" style={{ fontSize: 16 }}>{payoff.breakevens.length ? payoff.breakevens.map(b => fmt(b, 2)).join(' · ') : '—'}</span></div>
            </div>
            <div style={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%" minWidth={10} minHeight={10}>
                <LineChart data={payoff.pts} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#222226" />
                  <XAxis dataKey="price" type="number" domain={['dataMin', 'dataMax']} {...AXIS} tickFormatter={(v) => fmt(v, 0)} />
                  <YAxis {...AXIS} width={56} tickFormatter={(v) => fmt(v, 0)} />
                  <Tooltip {...TOOLTIP} labelFormatter={(v) => `${t('Cours')} ${fmt(v, 2)}`} formatter={(v, n) => [fmt(v, 2), n]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceArea x1={p.S - payoff.sd} x2={p.S + payoff.sd} fill="rgba(224,164,58,.07)" />
                  <ReferenceLine y={0} stroke="#55555c" />
                  <ReferenceLine x={p.S} stroke="#88888f" strokeDasharray="4 4" label={{ value: t('cours actuel'), fill: '#88888f', fontSize: 10, position: 'top' }} />
                  <Line dataKey="today" name={t("Valeur aujourd'hui (théorique)")} stroke="#7f9cc4" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                  <Line dataKey="expiry" name={t("Gain / perte à l'échéance")} stroke="#e0a43a" strokeWidth={2.2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="hint" style={{ marginTop: 4 }}>{t("Zone ambrée : fourchette de cours à l'échéance dans environ 2 cas sur 3 selon la volatilité saisie (± 1 écart-type).")}</div>
          </>)}
        </>)}
      </div>

      {/* CHAÎNE D'OPTIONS */}
      {mkt?.calls?.length > 0 && (
        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-head">
            <h3 className="section-title"><Table2 size={15} /> {t("Chaîne d'options · échéance")} {new Date(`${mkt.expiry}T12:00:00`).toLocaleDateString(getLocale(), { day: 'numeric', month: 'long', year: 'numeric' })}</h3>
            <button type="button" className="btn btn-sm" onClick={() => setShowChain(s => !s)}>{showChain ? t('Masquer') : t('Afficher')}</button>
          </div>
          {showChain && (
            <div style={{ overflow: 'auto', maxHeight: 460 }}>
              <table className="table chain-table">
                <thead>
                  <tr><th className="num">{t('Vol. impl.')}</th><th className="num">{t('Intérêt ouvert')}</th><th className="num">{t('Achat')}</th><th className="num">{t('Vente')}</th><th className="num" style={{ color: 'var(--text)' }}>CALLS</th>
                    <th className="num strike-col">Strike</th>
                    <th style={{ color: 'var(--text)' }}>PUTS</th><th className="num">{t('Achat')}</th><th className="num">{t('Vente')}</th><th className="num">{t('Intérêt ouvert')}</th><th className="num">{t('Vol. impl.')}</th></tr>
                </thead>
                <tbody>
                  {mkt.calls.map(c => {
                    const pt = mkt.puts.find(x => x.strike === c.strike);
                    const atm = Math.abs(c.strike - mkt.spot) === Math.min(...chainStrikes.map(s => Math.abs(s - mkt.spot)));
                    return (
                      <tr key={c.strike} className={atm ? 'atm' : ''}>
                        <td className={`num ${c.itm ? 'itm' : ''}`}>{c.iv ? `${fmt(c.iv, 1)} %` : '—'}</td>
                        <td className={`num ${c.itm ? 'itm' : ''}`}>{fmtInt(c.open_interest)}</td>
                        <td className={`num ${c.itm ? 'itm' : ''}`}>{fmt(c.bid, 2)}</td>
                        <td className={`num ${c.itm ? 'itm' : ''}`}>{fmt(c.ask, 2)}</td>
                        <td className={`num ${c.itm ? 'itm' : ''}`}><button type="button" className="row-action" onClick={() => addFromChain('call', c)}>+ call</button></td>
                        <td className="num strike-col" onClick={() => setStrike(String(c.strike))} title={t('Utiliser ce strike dans le calculateur')}>{fmt(c.strike, 2)}</td>
                        <td className={pt?.itm ? 'itm' : ''}>{pt && <button type="button" className="row-action" onClick={() => addFromChain('put', pt)}>+ put</button>}</td>
                        <td className={`num ${pt?.itm ? 'itm' : ''}`}>{pt ? fmt(pt.bid, 2) : '—'}</td>
                        <td className={`num ${pt?.itm ? 'itm' : ''}`}>{pt ? fmt(pt.ask, 2) : '—'}</td>
                        <td className={`num ${pt?.itm ? 'itm' : ''}`}>{pt ? fmtInt(pt.open_interest) : '—'}</td>
                        <td className={`num ${pt?.itm ? 'itm' : ''}`}>{pt?.iv ? `${fmt(pt.iv, 1)} %` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="hint" style={{ marginTop: 8 }}>{t('Fond teinté : option dans la monnaie. Ligne encadrée : strike le plus proche du cours. « + call / + put » ajoute une jambe achetée au prix milieu (changez le sens dans le tableau pour la vendre).')}</div>
        </div>
      )}
      {!mkt && !loading && <EmptyState icon={Sigma} title="Choisissez un sous-jacent">Les actions et ETF américains (Apple, SPY, QQQ…) ont une chaîne d'options cotée. Pour les autres, le calculateur fonctionne avec vos propres paramètres.</EmptyState>}
    </div>
  );
}

export default memo(DerivativesView);
