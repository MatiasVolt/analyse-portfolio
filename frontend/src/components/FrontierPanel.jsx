import { memo, useEffect, useState } from 'react';
import axios from 'axios';
import { ComposedChart, Scatter, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, LabelList } from 'recharts';
import { Loader2, X, ArrowRight } from 'lucide-react';
import { HelpButtons } from './ui';
import { API, fmt, fmtDate } from '../format';
import { useLang, trName } from '../i18n';
import { getAsset } from '../tickerDatabase';
import { useChartColors } from '../theme';

const FRONTIER_DEF = "La frontière efficiente (Harry Markowitz, prix Nobel 1990) relie les dosages des mêmes actifs qui donnent le plus de rendement pour chaque niveau de risque. Tout portefeuille situé sous la courbe peut être amélioré : en changeant seulement les poids, on obtient soit le même rendement avec moins de volatilité, soit plus de rendement pour la même volatilité. Calcul : rendements moyens et corrélations historiques, poids positifs (pas de vente à découvert), total de 100 %. Limite importante : les rendements passés sont très instables, la frontière d'hier n'est pas celle de demain. Elle est surtout fiable pour réduire le risque grâce à la diversification.";

const nameOf = (tk) => trName(getAsset(tk)?.name) || tk;

function Suggestion({ title, hint, p, current, onApply, t }) {
  if (!p) return null;
  const dRet = p.ret_pct - current.ret_pct, dVol = p.vol_pct - current.vol_pct;
  return (
    <div className="frontier-card">
      <strong>{t(title)}</strong>
      <span className="hint">{t(hint)}</span>
      <dl className="guide-dl">
        <div><dt>{t('Rendement attendu')}</dt><dd>{fmt(p.ret_pct, 1)} % <em className={dRet >= 0 ? 'pos' : 'neg'}>({fmt(dRet, 1, true)})</em></dd></div>
        <div><dt>{t('Volatilité')}</dt><dd>{fmt(p.vol_pct, 1)} % <em className={dVol <= 0 ? 'pos' : 'neg'}>({fmt(dVol, 1, true)})</em></dd></div>
        <div><dt>{t('Sharpe')}</dt><dd>{fmt(p.sharpe, 2)}</dd></div>
      </dl>
      <ul className="frontier-weights">
        {Object.entries(p.weights).sort((a, b) => b[1] - a[1]).map(([tk, w]) => (
          <li key={tk}><span>{nameOf(tk)}</span><b>{fmt(w, 1)} %</b></li>
        ))}
      </ul>
      <button type="button" className="btn" onClick={() => onApply(p.weights)}>{t('Appliquer ces poids')} <ArrowRight size={13} /></button>
    </div>
  );
}

/** Panneau « Frontière efficiente » : mêmes actifs, meilleurs dosages possibles d'après l'historique. */
function FrontierPanel({ payload, onApply, onClose }) {
  const { t, lang } = useLang();
  const c = useChartColors();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    axios.post(`${API}/api/portfolio/frontier`, payload, { timeout: 120000 })
      .then(r => { if (alive) setData(r.data); })
      .catch(e => { if (alive) setError(e.response?.data?.detail || t('Le service de données ne répond pas pour le moment. Réessayez dans un instant.')); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, lang]);

  const special = data ? [
    { key: 'current', label: t('Votre portefeuille'), p: data.current, color: c.blue },
    { key: 'same_return', label: t('Même rendement, moins de risque'), p: data.same_return, color: c.accent },
    { key: 'same_risk', label: t('Même risque, plus de rendement'), p: data.same_risk, color: c.accent },
    { key: 'min_variance', label: t('Volatilité minimale'), p: data.min_variance, color: c.accent },
    { key: 'max_sharpe', label: t('Meilleur Sharpe'), p: data.max_sharpe, color: c.accent },
  ].filter(x => x.p) : [];
  const better = data && data.same_return && data.current.vol_pct - data.same_return.vol_pct > 0.1;

  return (
    <div className="panel frontier" style={{ marginBottom: 16 }}>
      <div className="panel-head">
        <h3 className="section-title">{t('Frontière efficiente')} <HelpButtons definition={FRONTIER_DEF} size={13} /></h3>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Fermer')} title={t('Fermer')}><X size={15} /></button>
      </div>
      {error && <div className="error-box" role="alert">{error}</div>}
      {!data && !error && <div className="hint" role="status"><Loader2 size={14} className="spin" /> {t('Recherche des meilleurs dosages…')}</div>}

      {data && (<>
        <p className="guide-p" style={{ marginTop: 0 }}>
          {better
            ? t('Avec les mêmes actifs, un autre dosage aurait donné le même rendement attendu ({r} % par an) avec une volatilité de {v2} % au lieu de {v1} %.', { r: fmt(data.current.ret_pct, 1), v1: fmt(data.current.vol_pct, 1), v2: fmt(data.same_return.vol_pct, 1) })
            : t('Votre portefeuille est déjà sur la frontière, ou tout près : à rendement égal, on ne peut presque pas réduire son risque avec ces actifs.')}
          {' '}{t('Calculé sur {n} séances, du {a} au {b}.', { n: data.observations, a: fmtDate(data.start), b: fmtDate(data.end) })}
        </p>

        <div className="guide-grid">
          <div className="guide-chart" role="img" aria-label={t('Frontière efficiente : rendement attendu selon la volatilité')}>
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart margin={{ top: 12, right: 24, left: -6, bottom: 18 }}>
                <CartesianGrid stroke={c.grid} />
                <XAxis type="number" dataKey="vol_pct" stroke={c.text} fontSize={11} domain={['auto', 'auto']} tickFormatter={(v) => `${fmt(v, 0)} %`}
                  label={{ value: t('Risque : volatilité par an'), position: 'insideBottom', offset: -12, fill: c.text, fontSize: 11 }} />
                <YAxis type="number" dataKey="ret_pct" stroke={c.text} fontSize={11} domain={['auto', 'auto']} tickFormatter={(v) => `${fmt(v, 0)} %`} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ payload: pl }) => {
                  const p = pl?.[0]?.payload;
                  if (!p) return null;
                  return (
                    <div className="chart-tip">
                      {p.label && <strong>{p.label}</strong>}
                      <span>{t('Rendement : {v} % par an', { v: fmt(p.ret_pct, 1) })}</span>
                      <span>{t('Volatilité : {v} %', { v: fmt(p.vol_pct, 1) })}</span>
                      {p.weights && <span className="hint">{Object.entries(p.weights).sort((a, b) => b[1] - a[1]).map(([k, w]) => `${k} ${fmt(w, 0)} %`).join(' · ')}</span>}
                    </div>
                  );
                }} />
                <Legend verticalAlign="top" height={28} iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <Scatter name={t('Dosages au hasard')} data={data.cloud} fill={c.faint} isAnimationActive={false} legendType="circle"
                  shape={(pr) => <circle cx={pr.cx} cy={pr.cy} r={1.8} fill={c.faint} fillOpacity={0.35} />} />
                <Line name={t('Frontière efficiente')} data={data.frontier} dataKey="ret_pct" stroke={c.accent} strokeWidth={2} dot={false} isAnimationActive={false} type="monotone" />
                <Scatter name={t('Actifs seuls')} data={data.assets.map(a => ({ ...a, label: nameOf(a.ticker) }))} fill={c.strong} isAnimationActive={false}>
                  <LabelList dataKey="ticker" position="right" fill={c.strong} fontSize={11} />
                </Scatter>
                <Scatter name={t('Votre portefeuille')} data={[{ ...data.current, label: t('Votre portefeuille') }]} fill={c.blue} isAnimationActive={false} shape="diamond" />
                <Scatter name={t('Propositions')} data={special.filter(x => x.key !== 'current').map(x => ({ ...x.p, label: x.label }))} fill={c.accent} stroke={c.bg} strokeWidth={2} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="frontier-cards">
            <Suggestion t={t} title="Même rendement, moins de risque" hint="Le dosage le plus calme qui rapporte au moins autant." p={data.same_return} current={data.current} onApply={onApply} />
            <Suggestion t={t} title="Même risque, plus de rendement" hint="Le dosage le plus rentable sans bouger plus que le vôtre." p={data.same_risk} current={data.current} onApply={onApply} />
            <Suggestion t={t} title="Meilleur Sharpe" hint="Le meilleur rendement pour chaque unité de risque." p={data.max_sharpe} current={data.current} onApply={onApply} />
            <Suggestion t={t} title="Volatilité minimale" hint="Le dosage qui a le moins bougé, quel que soit le rendement." p={data.min_variance} current={data.current} onApply={onApply} />
          </div>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>{t('Rendement attendu = moyenne historique des rendements, poids constants. Taux sans risque : {r} %. Les dosages « optimaux » s’appuient sur le passé : prenez-les comme une piste, et vérifiez-les en simulant le portefeuille.', { r: fmt(data.risk_free_pct, 2) })}</p>
      </>)}
    </div>
  );
}

export default memo(FrontierPanel);
