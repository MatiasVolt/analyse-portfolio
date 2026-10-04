import { memo, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, ReferenceDot, Legend } from 'recharts';
import { Landmark, Calculator, TrendingUp, ArrowRight } from 'lucide-react';
import { StatCell, HelpButtons, EmptyState, Field, Segmented } from '../components/ui';
import { analyzeBond, priceYieldCurve, cashflows, yieldFromPrice } from '../finance/bondMath';
import { API, fmt, parseNum } from '../format';
import { useLang, tr } from '../i18n';
import { BOND_DEFS as DEF } from '../definitions';

const AXIS = { stroke: '#88888f', fontSize: 11 };
const TOOLTIP = { contentStyle: { backgroundColor: '#1b1b1e', borderColor: '#323237', color: '#fff', fontSize: 12 } };



/** Taux de la courbe US interpolé à une maturité donnée (en années). */
function curveYield(curve, years) {
  const pts = (curve || []).filter(p => p.yield !== null);
  if (!pts.length) return null;
  if (years <= pts[0].years) return pts[0].yield;
  for (let i = 1; i < pts.length; i++) {
    if (years <= pts[i].years) {
      const a = pts[i - 1], b = pts[i];
      return a.yield + (b.yield - a.yield) * (years - a.years) / (b.years - a.years);
    }
  }
  return pts[pts.length - 1].yield;
}

function BondCalculator({ market }) {
  const { t } = useLang();
  const [nominal, setNominal] = useState('');
  const [coupon, setCoupon] = useState('');
  const [freq, setFreq] = useState('1');
  const [years, setYears] = useState('');
  const [mode, setMode] = useState('yield');
  const [yieldIn, setYieldIn] = useState('');
  const [priceIn, setPriceIn] = useState('');

  const usCurve = market?.us_curve?.now;
  const fr10 = market?.europe?.find(e => e.code === 'FR')?.yield;
  const ig = market?.credit?.find(c => c.name.startsWith('Investment'))?.value;

  const presets = [
    usCurve && { label: 'Trésor US 10 ans', v: { n: '1000', c: '4.25', f: '2', y: '10', yld: curveYield(usCurve, 10) } },
    fr10 && { label: 'OAT France 10 ans', v: { n: '1000', c: '3', f: '1', y: '10', yld: fr10 } },
    usCurve && ig && { label: 'Entreprise US 5 ans (IG)', v: { n: '1000', c: '5', f: '2', y: '5', yld: curveYield(usCurve, 5) + ig } },
  ].filter(Boolean);

  const apply = (v) => {
    setNominal(v.n); setCoupon(v.c); setFreq(v.f); setYears(v.y); setMode('yield'); setYieldIn(String(Math.round(v.yld * 100) / 100));
  };

  const inputs = { nominal: parseNum(nominal), couponPct: parseNum(coupon), freq: parseInt(freq, 10), years: parseNum(years) };
  const valid = inputs.nominal > 0 && inputs.couponPct >= 0 && inputs.years > 0 && inputs.years <= 100;
  let yieldPct = null;
  if (valid) {
    if (mode === 'yield') yieldPct = parseNum(yieldIn);
    else {
      const p = parseNum(priceIn);
      if (p > 0) yieldPct = yieldFromPrice(cashflows(inputs), (p / 100) * inputs.nominal, inputs.freq);
    }
  }
  const ready = valid && Number.isFinite(yieldPct);
  const res = useMemo(() => (ready ? analyzeBond({ ...inputs, yieldPct }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, nominal, coupon, freq, years, yieldPct]);
  const curve = useMemo(() => (ready ? priceYieldCurve(inputs, yieldPct) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, nominal, coupon, freq, years, yieldPct]);
  const marketYield = valid && usCurve ? curveYield(usCurve, inputs.years) : null;

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head">
        <h3 className="section-title"><Calculator size={15} /> {t("Calculateur d'obligation")}</h3>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="hint">{t('Pré-remplir avec le marché actuel :')}</span>
          {presets.map(p => <button key={p.label} type="button" className="btn btn-sm" onClick={() => apply(p.v)}>{t(p.label)}</button>)}
        </div>
      </div>

      <div className="bond-form">
        <Field label="Nominal"><input type="text" inputMode="decimal" value={nominal} onChange={(e) => setNominal(e.target.value)} /></Field>
        <Field label="Coupon (% / an)"><input type="text" inputMode="decimal" value={coupon} onChange={(e) => setCoupon(e.target.value)} /></Field>
        <Field label="Versement">
          <select value={freq} onChange={(e) => setFreq(e.target.value)} style={{ width: '100%' }}>
            <option value="1">{t('Annuel')}</option><option value="2">{t('Semestriel')}</option><option value="4">{t('Trimestriel')}</option><option value="12">{t('Mensuel')}</option>
          </select>
        </Field>
        <Field label="Échéance (années)"><input type="text" inputMode="decimal" value={years} onChange={(e) => setYears(e.target.value)} /></Field>
        <Field label="Je connais">
          <Segmented value={mode} onChange={setMode} options={[{ value: 'yield', label: 'le rendement' }, { value: 'price', label: 'le prix' }]} />
        </Field>
        {mode === 'yield'
          ? <Field label="Rendement (% / an)"><input type="text" inputMode="decimal" value={yieldIn} onChange={(e) => setYieldIn(e.target.value)} /></Field>
          : <Field label="Prix (% du nominal)"><input type="text" inputMode="decimal" value={priceIn} onChange={(e) => setPriceIn(e.target.value)} /></Field>}
      </div>
      {valid && marketYield !== null && (
        <div className="hint" style={{ marginTop: 8 }}>
          {t("Taux d'État américain à {n} ans aujourd'hui :", { n: fmt(inputs.years, inputs.years % 1 ? 1 : 0) })} <strong style={{ color: 'var(--text-2)' }}>{fmt(marketYield, 2)} %</strong>
          {mode === 'yield' && <button type="button" className="link-btn" onClick={() => setYieldIn(String(Math.round(marketYield * 100) / 100))}>{t('utiliser ce taux')}</button>}
        </div>
      )}

      {!res ? (
        <div className="hint" style={{ marginTop: 16 }}>{t("Renseignez le nominal, le coupon, l'échéance et le rendement (ou le prix) — ou utilisez un des boutons de pré-remplissage.")}</div>
      ) : (<>
        <div className="stat-grid" style={{ marginTop: 18 }}>
          <StatCell label="Prix" value={res.pricePct} unit="%" definition={DEF.price}
            interpretation={`${t("L'obligation vaut {p} pour un nominal de {n}.", { p: fmt(res.price, 2), n: fmt(inputs.nominal, 0) })} ${t(res.pricePct > 100.01 ? 'Elle cote au-dessus du pair : son coupon est plus généreux que le marché.' : res.pricePct < 99.99 ? "Elle cote sous le pair : son coupon est inférieur au marché, la différence est rattrapée à l'échéance." : 'Elle cote au pair : coupon et rendement sont égaux.')}`} />
          <StatCell label="Rendement actuariel" value={yieldPct} unit="%" definition={DEF.ytm} />
          <StatCell label="Rendement courant" value={res.currentYield} unit="%" definition={DEF.current} />
          <StatCell label="Duration de Macaulay" value={res.macaulay} unit="ans" definition={DEF.macaulay} />
          <StatCell label="Duration modifiée" value={res.modified} definition={DEF.modified}
            interpretation={t("Si les taux montent de 1 %, le prix baisse d'environ {v} %. Plus l'échéance est longue et le coupon faible, plus la duration est élevée.", { v: fmt(res.modified, 2) })} />
          <StatCell label="Convexité" value={res.convexity} definition={DEF.convexity} />
          <StatCell label="DV01" value={res.dv01} definition={DEF.dv01} nd={3} />
          <StatCell label="Taux +1 %" value={(res.up1.exact / res.price) * 100} unit="%" signed tone="neg"
            interpretation={t('Si les taux montent de 1 point : {a} sur le prix (approximation duration + convexité : {b}).', { a: fmt(res.up1.exact, 2, true), b: fmt(res.up1.approx, 2, true) })} />
          <StatCell label="Taux −1 %" value={(res.down1.exact / res.price) * 100} unit="%" signed tone="pos"
            interpretation={t("Si les taux baissent de 1 point : {a} sur le prix. Le gain est plus fort que la perte du cas inverse : c'est l'effet de convexité.", { a: fmt(res.down1.exact, 2, true) })} />
        </div>

        <div className="grid-2" style={{ marginTop: 18 }}>
          <div>
            <span className="label">{t('Relation prix / rendement')}</span>
            <div style={{ height: 230 }}>
              <ResponsiveContainer width="100%" height="100%" minWidth={10} minHeight={10}>
                <LineChart data={curve} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#222226" />
                  <XAxis dataKey="yield" {...AXIS} tickFormatter={(v) => `${fmt(v, 1)} %`} minTickGap={30} type="number" domain={['dataMin', 'dataMax']} />
                  <YAxis {...AXIS} width={52} tickFormatter={(v) => fmt(v, 0)} domain={['auto', 'auto']} />
                  <Tooltip {...TOOLTIP} formatter={(v) => [`${fmt(v, 2)} %`, tr('Prix')]} labelFormatter={(v) => `${tr('Rendement')} ${fmt(v, 2)} %`} />
                  <ReferenceLine y={100} stroke="#45454b" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="price" stroke="#e0a43a" dot={false} strokeWidth={2} isAnimationActive={false} />
                  <ReferenceDot x={Math.round(yieldPct * 100) / 100} y={res.pricePct} r={5} fill="#e0a43a" stroke="#161618" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <span className="label">{t('Flux reçus ({n} versements · total des coupons {c})', { n: res.rows.length, c: fmt(res.totalCoupons, 2) })}</span>
            <div style={{ height: 230 }}>
              <ResponsiveContainer width="100%" height="100%" minWidth={10} minHeight={10}>
                <BarChart data={res.rows.map(r => ({ t: fmt(r.t, 1), coupon: r.coupon, principal: r.principal, pv: r.pv }))} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#222226" />
                  <XAxis dataKey="t" {...AXIS} minTickGap={20} />
                  <YAxis {...AXIS} width={52} tickFormatter={(v) => fmt(v, 0)} scale="sqrt" />
                  <Tooltip {...TOOLTIP} formatter={(v, n) => [fmt(v, 2), tr(n === 'coupon' ? 'Coupon' : n === 'principal' ? 'Remboursement' : 'Valeur actuelle')]} labelFormatter={(v) => `${tr('Année')} ${v}`} />
                  <Bar dataKey="coupon" stackId="a" fill="#e0a43a" isAnimationActive={false} />
                  <Bar dataKey="principal" stackId="a" fill="#7f9cc4" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </>)}
    </div>
  );
}

function BondsView({ active, onAnalyze }) {
  const { t, lang } = useLang();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  // Rechargé au changement de langue (noms des ETF et des pays)
  useEffect(() => {
    if (!active || (data && data._lang === lang)) return;
    axios.get(`${API}/api/bonds`).then(r => setData({ ...r.data, _lang: lang }))
      .catch(err => setError(err.response?.data?.detail || tr("Impossible de charger les données obligataires (le serveur Python est-il lancé ?).")));
  }, [active, data, lang]);

  const curveData = useMemo(() => data?.us_curve?.now?.map((p, i) => ({
    tenor: t(p.tenor), now: p.yield, month: data.us_curve.month_ago?.[i]?.yield, year: data.us_curve.year_ago?.[i]?.yield,
  })) || [], [data, t]);

  const y = (tenor) => data?.us_curve?.now?.find(p => p.tenor === tenor)?.yield;
  const s = data?.spreads;
  const hy = data?.credit?.find(c => c.name.startsWith('High'));

  return (
    <div>
      <div className="result-head" style={{ marginTop: 0 }}>
        <div className="result-title"><h1>{t('Obligations')}</h1></div>
        <div className="result-meta">{t("Taux d'État et écarts de crédit · source FRED (Réserve fédérale de Saint-Louis)")}{data && ` · ${t('données du {d}', { d: data.updated })}`}{data?.stale && ` · ${t('copie locale')}`}</div>
      </div>
      {error && <div className="error-box">{error}</div>}
      {!data && !error && <EmptyState icon={Landmark} title="Chargement des taux…" />}

      {data && (<>
        <div className="panel kpi-strip">
          <div><span className="label">{t('Taux US 2 ans')}</span><span className="kpi-value">{fmt(y('2A'), 2)} %</span><span className="kpi-sub">{t('sensible aux décisions de la Fed')}</span></div>
          <div><span className="label">{t('Taux US 10 ans')}</span><span className="kpi-value">{fmt(y('10A'), 2)} %</span><span className="kpi-sub">{t('référence des crédits immobiliers US')}</span></div>
          <div>
            <span className="label" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>{t('Écart 10 ans − 2 ans')} <HelpButtons definition={DEF.s10_2} size={12} /></span>
            <span className="kpi-value" style={{ color: s.s10_2 < 0 ? 'var(--red)' : 'var(--green)' }}>{fmt(s.s10_2, 2, true)} {t('pt')}</span>
            <span className="kpi-sub">{s.s10_2 < 0 ? t('Courbe inversée : signal de récession historique') : `${t('Courbe normale')}${s.inverted_days_1y ? ` ${t('(inversée {n} j sur 12 mois)', { n: s.inverted_days_1y })}` : ''}`}</span>
          </div>
          <div>
            <span className="label" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>{t('Prime High Yield')} <HelpButtons definition={DEF.credit} size={12} /></span>
            <span className="kpi-value" style={{ color: hy.value > hy.median_5y * 1.2 ? 'var(--red)' : 'var(--text)' }}>{fmt(hy.value, 2)} %</span>
            <span className="kpi-sub">{t('médiane 5 ans : {v} %', { v: fmt(hy.median_5y, 2) })} · {t(hy.value > hy.median_5y * 1.2 ? 'stress sur le crédit' : hy.value < hy.median_5y * 0.85 ? 'marché très confiant' : 'niveau normal')}</span>
          </div>
        </div>

        <div className="grid-2" style={{ marginBottom: 16 }}>
          <div className="panel">
            <div className="panel-head"><h3 className="section-title"><TrendingUp size={15} /> {t('Courbe des taux américains')} <HelpButtons definition={DEF.curve} size={13} /></h3></div>
            <div style={{ height: 270 }}>
              <ResponsiveContainer width="100%" height="100%" minWidth={10} minHeight={10}>
                <LineChart data={curveData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#222226" />
                  <XAxis dataKey="tenor" {...AXIS} />
                  <YAxis {...AXIS} width={44} domain={['auto', 'auto']} tickFormatter={(v) => `${fmt(v, 1)}`} />
                  <Tooltip {...TOOLTIP} formatter={(v, n) => [`${fmt(v, 2)} %`, n]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line dataKey="year" name={t('Il y a 1 an')} stroke="#55555c" strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                  <Line dataKey="month" name={t('Il y a 1 mois')} stroke="#88888f" dot={false} isAnimationActive={false} />
                  <Line dataKey="now" name={t("Aujourd'hui")} stroke="#e0a43a" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head"><h3 className="section-title">{t('Écart 10 ans − 2 ans depuis 1976')} <HelpButtons definition={DEF.s10_2} size={13} /></h3></div>
            <div style={{ height: 270 }}>
              <ResponsiveContainer width="100%" height="100%" minWidth={10} minHeight={10}>
                <AreaChart data={s.s10_2_history} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#222226" />
                  <XAxis dataKey="date" {...AXIS} minTickGap={50} tickFormatter={(d) => d.slice(0, 4)} />
                  <YAxis {...AXIS} width={44} tickFormatter={(v) => fmt(v, 1)} />
                  <Tooltip {...TOOLTIP} formatter={(v) => [`${fmt(v, 2)} ${tr('pt')}`, tr('Écart')]} />
                  <ReferenceLine y={0} stroke="#e5484d" strokeDasharray="4 4" label={{ value: t('inversion'), fill: '#e5484d', fontSize: 10, position: 'insideBottomLeft' }} />
                  <Area dataKey="value" stroke="#e0a43a" fill="rgba(224,164,58,.15)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <BondCalculator market={data} />

        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="panel">
            <div className="panel-head"><h3 className="section-title">{t("Taux d'État à 10 ans")}</h3><span className="hint">{t("moyenne mensuelle · écart avec l'Allemagne (Bund)")}</span></div>
            <table className="table">
              <thead><tr><th>{t('Pays')}</th><th className="num">{t('Taux 10 ans')}</th><th className="num">{t('Sur 1 an')}</th><th className="num">{t('Écart vs Bund')}</th><th className="num">{t('Mois')}</th></tr></thead>
              <tbody>
                {data.europe.map(e => (
                  <tr key={e.code}>
                    <td><strong>{e.country}</strong></td>
                    <td className="num">{fmt(e.yield, 2)} %</td>
                    <td className="num" style={{ color: e.change_1y > 0 ? 'var(--red)' : 'var(--green)' }}>{fmt(e.change_1y, 2, true)} {t('pt')}</td>
                    <td className="num">{e.spread_vs_de_bp === null ? <span className="hint">{t('référence')}</span> : `${e.spread_vs_de_bp > 0 ? '+' : ''}${e.spread_vs_de_bp} ${t('pb')}`}</td>
                    <td className="num hint">{e.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="hint" style={{ marginTop: 8 }}>{t("L'écart avec l'Allemagne mesure la prime de risque demandée à chaque pays de la zone euro (1 pb = 0,01 %).")}</div>
          </div>

          <div className="panel">
            <div className="panel-head"><h3 className="section-title">{t('Investir en obligations via des ETF')}</h3><span className="hint">{t("plus la duration est longue, plus l'ETF est sensible aux taux")}</span></div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead><tr><th>ETF</th><th className="num">Duration</th><th className="num">{t('Perf. 1 an')}</th><th className="num">{t('Volatilité')}</th><th className="num">Max DD</th><th /></tr></thead>
                <tbody>
                  {data.etfs.map(e => (
                    <tr key={e.ticker}>
                      <td><strong>{e.name}</strong> <span style={{ color: 'var(--accent-text)', fontSize: 11 }}>{e.ticker}</span></td>
                      <td className="num">{fmt(e.duration, 1)} {t('ans')}</td>
                      <td className="num" style={{ color: e.perf_1y_pct >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(e.perf_1y_pct, 2, true)} %</td>
                      <td className="num">{fmt(e.volatility_pct, 1)} %</td>
                      <td className="num" style={{ color: '#f07075' }}>{fmt(e.max_drawdown_pct, 1)} %</td>
                      <td><button type="button" className="row-action" onClick={() => onAnalyze(e.ticker)}>{t('Analyser')} <ArrowRight size={11} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </>)}
    </div>
  );
}

export default memo(BondsView);
