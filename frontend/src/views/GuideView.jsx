import { memo, useEffect, useState } from 'react';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ScatterChart, Scatter, LabelList, ReferenceLine, Cell } from 'recharts';
import { Compass, Clock, Scale, ShieldAlert, TrendingDown, Target, ListChecks, ArrowRight, Info } from 'lucide-react';
import { EmptyState, HelpButtons } from '../components/ui';
import { DEFINITIONS } from '../definitions';
import { API, fmt, fmtDate } from '../format';
import { useLang } from '../i18n';
import { useChartColors } from '../theme';

const PROFILE_COLORS = { ACWI: '#1e7145', AGG: '#2e75b6', BIL: '#9aa29d' };
const PROFILE_NAMES = { ACWI: 'Actions monde', AGG: 'Obligations', BIL: 'Monétaire' };

// Position des étiquettes du nuage de points, pour que les familles proches ne se chevauchent pas
const LABEL_POS = { SPY: [8, -8, 'start'], ACWI: [8, 12, 'start'], QQQ: [8, 4, 'start'], EEM: [-8, 14, 'end'], GLD: [-8, 4, 'end'],
  TLT: [0, 18, 'middle'], AGG: [0, -10, 'middle'], BIL: [8, -8, 'start'] };

function PointLabel({ x, y, value, index, data, fill }) {
  const tk = data[index]?.ticker;
  const [dx, dy, anchor] = LABEL_POS[tk] || [8, 4, 'start'];
  return <text x={x + dx} y={y + dy} textAnchor={anchor} fill={fill} fontSize={11}>{String(value).replace(/ \(.*\)$/, '')}</text>;
}

const months = (t, m) => (m == null ? null : m < 24 ? t('{n} mois', { n: m }) : t('{n} ans', { n: fmt(m / 12, m % 12 ? 1 : 0) }));

function Section({ icon: Icon, title, lead, children }) {
  return (
    <section className="guide-section">
      <h2 className="guide-h2"><Icon size={17} aria-hidden="true" /> {title}</h2>
      {lead && <p className="guide-lead">{lead}</p>}
      {children}
    </section>
  );
}

/** Onglet « Bien démarrer » : la réponse honnête à « je veux gagner de l'argent, je fais quoi ? », chiffres réels à l'appui. */
function GuideView({ active, onGoTo, onSimulate }) {
  const { t, lang } = useLang();
  const c = useChartColors();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!active || data?._lang === lang) return;
    let alive = true;
    setError(null);
    axios.get(`${API}/api/guide`, { timeout: 180000 })
      .then(r => { if (alive) setData({ ...r.data, _lang: lang }); })
      .catch(e => { if (alive) setError(e.response?.data?.detail || t('Le service de données ne répond pas pour le moment. Réessayez dans un instant.')); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, lang]);

  const h = (days) => data?.horizons.find(x => x.days === days);
  const day = h(1), y20 = h(5040);
  const prof = (id) => data?.profiles.find(p => p.id === id);
  const bd = data?.best_days;
  const missed10 = bd?.missed.find(x => x.days === 10);
  const btc = data?.classes.find(x => x.ticker === 'BTC-USD');
  const scatter = data?.classes.filter(x => x.ticker !== 'BTC-USD') || [];

  return (
    <div className="guide">
      <div className="result-head">
        <div className="result-title"><h1>{t('Bien démarrer')}</h1></div>
        <div className="result-meta">{t('« Je veux faire fructifier mon argent : je fais quoi ? » La réponse honnête, chiffres réels à l’appui.')}</div>
      </div>

      <div className="guide-note" role="note">
        <Info size={15} aria-hidden="true" />
        <span>{t('Contenu pédagogique, pas un conseil personnalisé. Personne ne peut prédire le marché : les chiffres ci-dessous décrivent le passé, qui ne garantit pas l’avenir.')}</span>
      </div>

      {error && <div className="error-box" role="alert">{error}</div>}
      {!data && !error && <EmptyState icon={Compass} busy title="Calcul des repères historiques…">{t('Près de 100 ans de cours sont analysés, cela peut prendre quelques secondes la première fois.')}</EmptyState>}

      {data && (<>
        {/* 1. La réponse courte */}
        <div className="guide-answers">
          <div className="guide-answer">
            <span className="guide-big">{fmt(day.positive_pct, 0)} %</span>
            <strong>{t('Demain ? Presque pile ou face.')}</strong>
            <p>{t('Depuis {y}, le S&P 500 a monté {p} % des jours. À très court terme, personne ne sait : ni vous, ni les experts, ni ce site.', { y: data.spx_start.slice(0, 4), p: fmt(day.positive_pct, 1) })}</p>
          </div>
          <div className="guide-answer">
            <span className="guide-big">{fmt(y20.positive_pct, 0)} %</span>
            <strong>{t('Sur 20 ans, le temps joue pour vous.')}</strong>
            <p>{t('{p} % des périodes de 20 ans ont fini en gain, dividendes non compris. On ne s’enrichit pas en un jour, mais en restant investi longtemps.', { p: fmt(y20.positive_pct, 1) })}</p>
          </div>
          <div className="guide-answer">
            <span className="guide-big">×{fmt(Math.abs(prof('dynamic').mdd_pct / prof('prudent').mdd_pct), 1)}</span>
            <strong>{t('Gagner plus, c’est accepter de perdre plus.')}</strong>
            <p>{t('Depuis 2008, le profil dynamique a rapporté {a} % par an contre {b} % pour le prudent, mais sa pire chute a été {x} fois plus profonde ({c} % contre {d} %).', {
              a: fmt(prof('dynamic').cagr_pct, 1), b: fmt(prof('prudent').cagr_pct, 1), x: fmt(Math.abs(prof('dynamic').mdd_pct / prof('prudent').mdd_pct), 1),
              c: fmt(prof('dynamic').mdd_pct, 0), d: fmt(prof('prudent').mdd_pct, 0),
            })}</p>
          </div>
        </div>

        {/* 2. Le temps */}
        <Section icon={Clock} title={t('Le temps est votre meilleur allié')}
          lead={t('Chance d’être gagnant selon la durée pendant laquelle on garde le S&P 500, mesurée sur toutes les périodes possibles depuis {y}.', { y: data.spx_start.slice(0, 4) })}>
          <div className="guide-grid">
            <div className="guide-chart" role="img" aria-label={t('Part des périodes gagnantes selon la durée de placement')}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.horizons} margin={{ top: 22, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={c.grid} />
                  <XAxis dataKey="label" stroke={c.text} fontSize={12} tickLine={false} />
                  <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} stroke={c.text} fontSize={11} tickFormatter={(v) => `${v} %`} axisLine={false} tickLine={false} />
                  <ReferenceLine y={50} stroke={c.faint} strokeDasharray="4 4" />
                  <Tooltip cursor={{ fill: c.grid, opacity: 0.5 }} contentStyle={{ backgroundColor: 'var(--panel)', borderColor: 'var(--border-2)', color: 'var(--text)', fontSize: 12 }}
                    formatter={(v) => [`${fmt(v, 1)} %`, t('Périodes gagnantes')]} />
                  <Bar dataKey="positive_pct" fill={c.accent} radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}>
                    <LabelList dataKey="positive_pct" position="top" formatter={(v) => `${fmt(v, 0)} %`} fill={c.strong} fontSize={12} fontWeight={600} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="table guide-table">
              <thead><tr><th>{t('Durée')}</th><th className="num">{t('Gagnant')}</th><th className="num">{t('Médiane / an')}</th><th className="num">{t('Pire cas / an')}</th></tr></thead>
              <tbody>
                {data.horizons.map(x => (
                  <tr key={x.days}>
                    <td>{x.label}</td>
                    <td className="num">{fmt(x.positive_pct, 0)} %</td>
                    <td className="num">{x.median_annual_pct != null ? `${fmt(x.median_annual_pct, 1, true)} %` : `${fmt(x.median_pct, 2, true)} %`}</td>
                    <td className="num" style={{ color: 'var(--red)' }}>{x.worst_annual_pct != null ? `${fmt(x.worst_annual_pct, 1, true)} %` : `${fmt(x.worst_pct, 1, true)} %`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="guide-p">{t('Ce qu’il faut retenir : l’argent dont vous aurez besoin dans moins de 2 ou 3 ans n’a rien à faire en bourse. Plus votre horizon est long, plus les mauvaises années ont le temps d’être compensées. Avec les dividendes réinvestis (environ 2 % par an en plus), les chiffres seraient encore meilleurs.')}</p>
        </Section>

        {/* 3. Rendement / risque */}
        <Section icon={Scale} title={t('Gagner plus, c’est accepter de perdre plus')}
          lead={t('Chaque point représente une grande famille de placements depuis {y} : à droite, ça bouge beaucoup ; en haut, ça a beaucoup rapporté.', { y: data.classes_start.slice(0, 4) })}>
          <div className="guide-grid">
            <div className="guide-chart" role="img" aria-label={t('Rendement annuel et volatilité des grandes familles de placements')}>
              <ResponsiveContainer width="100%" height={300}>
                <ScatterChart margin={{ top: 16, right: 24, left: -8, bottom: 16 }}>
                  <CartesianGrid stroke={c.grid} />
                  <XAxis type="number" dataKey="vol_pct" name={t('Volatilité')} stroke={c.text} fontSize={11} tickFormatter={(v) => `${v} %`}
                    label={{ value: t('Risque : volatilité par an'), position: 'insideBottom', offset: -10, fill: c.text, fontSize: 11 }} domain={[0, 30]} ticks={[0, 5, 10, 15, 20, 25, 30]} />
                  <YAxis type="number" dataKey="cagr_pct" name={t('Rendement')} stroke={c.text} fontSize={11} tickFormatter={(v) => `${v} %`} />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ payload }) => {
                    const p = payload?.[0]?.payload;
                    if (!p) return null;
                    return (
                      <div className="chart-tip">
                        <strong>{p.name}</strong>
                        <span>{t('Rendement : {v} % par an', { v: fmt(p.cagr_pct, 1) })}</span>
                        <span>{t('Volatilité : {v} %', { v: fmt(p.vol_pct, 1) })}</span>
                        <span>{t('Pire baisse : {v} %', { v: fmt(p.mdd_pct, 0) })}</span>
                      </div>
                    );
                  }} />
                  <Scatter data={scatter} fill={c.accent} isAnimationActive={false}>
                    {scatter.map(x => <Cell key={x.ticker} fill={c.accent} />)}
                    <LabelList dataKey="name" content={(props) => <PointLabel {...props} data={scatter} fill={c.strong} />} />
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <table className="table guide-table">
              <thead><tr><th>{t('Placement')}</th><th className="num">{t('Par an')}</th><th className="num">{t('Pire baisse')}</th><th className="num">{t('Sharpe')} <HelpButtons definition={DEFINITIONS.sharpe} size={11} /></th></tr></thead>
              <tbody>
                {[...data.classes].sort((a, b) => a.vol_pct - b.vol_pct).map(x => (
                  <tr key={x.ticker}>
                    <td>{x.name}</td>
                    <td className="num" style={{ color: x.cagr_pct >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(x.cagr_pct, 1, true)} %</td>
                    <td className="num" style={{ color: 'var(--red)' }}>{fmt(x.mdd_pct, 0)} %</td>
                    <td className="num">{fmt(x.sharpe, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {btc && <p className="hint" style={{ marginTop: 8 }}>{t('Le Bitcoin est hors du graphique tant il est extrême : {r} % par an depuis {y}, mais {v} % de volatilité et une chute de {d} %.', { r: fmt(btc.cagr_pct, 0, true), y: btc.start.slice(0, 4), v: fmt(btc.vol_pct, 0), d: fmt(btc.mdd_pct, 0) })}</p>}
          <p className="guide-p">{t('C’est la règle de base de la finance : le rendement est la récompense du risque accepté. Un livret ou un fonds monétaire ne baisse presque jamais, mais rapporte peu ({c} % par an ici). Les actions ont rapporté bien plus, au prix de chutes de 50 % et plus.', { c: fmt(data.cash_cagr_pct, 1) })}</p>
          <p className="guide-p">{t('Attention, l’inverse n’est pas vrai : prendre plus de risque ne garantit pas de gagner plus. Les actions émergentes ont été très risquées et ont peu rapporté. C’est pour cela qu’on regarde le ratio de Sharpe : le rendement obtenu pour chaque unité de risque. Le but n’est pas de gagner le plus possible, mais d’être bien payé pour le risque pris, et de diversifier pour que les mauvaises surprises d’un placement soient amorties par les autres.')}</p>
        </Section>

        {/* 4. Profils */}
        <Section icon={Target} title={t('Choisissez le risque que vous pouvez supporter')}
          lead={t('Trois mélanges simples d’actions monde et d’obligations, rééquilibrés chaque mois, testés depuis {y}. La bonne question n’est pas « lequel rapporte le plus ? » mais « quelle chute pourrais-je traverser sans tout vendre ? ».', { y: data.classes_start.slice(0, 4) })}>
          <div className="guide-profiles">
            {data.profiles.map(p => (
              <div key={p.id} className="guide-profile">
                <div className="guide-profile-head">
                  <strong>{p.name}</strong>
                  <span className="hint">{Object.entries(p.weights).map(([k, w]) => `${w} % ${t(PROFILE_NAMES[k])}`).join(' · ')}</span>
                </div>
                <div className="alloc-stack" aria-hidden="true">
                  {Object.entries(p.weights).map(([k, w]) => <span key={k} style={{ width: `${w}%`, background: PROFILE_COLORS[k] }} />)}
                </div>
                <dl className="guide-dl">
                  <div><dt>{t('10 000 investis en {y} sont devenus', { y: data.classes_start.slice(0, 4) })}</dt><dd>{fmt(p.final_10000, 0)}</dd></div>
                  <div><dt>{t('Rendement moyen')}</dt><dd style={{ color: 'var(--green)' }}>{fmt(p.cagr_pct, 1, true)} % / {t('an')}</dd></div>
                  <div><dt>{t('Pire chute')}</dt><dd style={{ color: 'var(--red)' }}>{fmt(p.mdd_pct, 0)} %</dd></div>
                  <div><dt>{t('Pire année civile')}</dt><dd style={{ color: 'var(--red)' }}>{fmt(p.worst_year_pct, 0)} %</dd></div>
                  <div><dt>{t('Temps pour s’en remettre')}</dt><dd>{months(t, p.recovery_months) || '—'}</dd></div>
                </dl>
                <button type="button" className="btn" onClick={() => onSimulate(p)}>{t('Simuler ce portefeuille')} <ArrowRight size={13} /></button>
              </div>
            ))}
          </div>
          <p className="guide-p">{t('Montants en dollars, avant frais et impôts. Les ETF utilisés (ACWI, AGG, BIL) ne servent qu’à représenter chaque famille : des équivalents existent en euros.')}</p>
        </Section>

        {/* 5. Krachs */}
        <Section icon={ShieldAlert} title={t('Les krachs arrivent… et passent')}
          lead={t('Les plus fortes baisses du S&P 500 depuis 1928. Elles semblent toujours être « la fin du monde » sur le moment ; avec le recul, ce sont des étapes.')}>
          <div className="table-scroll">
            <table className="table guide-crashes">
              <thead><tr><th>{t('Événement')}</th><th>{t('Sommet')}</th><th>{t('Chute')}</th><th className="num">{t('Durée de la chute')}</th><th className="num">{t('Retour au sommet')}</th></tr></thead>
              <tbody>
                {data.crashes.map(x => (
                  <tr key={x.peak}>
                    <td><strong>{x.name}</strong></td>
                    <td>{fmtDate(x.peak)}</td>
                    <td>
                      <div className="crash-bar"><span style={{ width: `${Math.min(100, Math.abs(x.depth_pct))}%` }} /><b>{fmt(x.depth_pct, 0)} %</b></div>
                    </td>
                    <td className="num">{months(t, x.fall_months)}</td>
                    <td className="num">{x.recovery ? t('{d} plus tard', { d: months(t, x.recovery_months) }) : t('pas encore')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="guide-p">{t('Cours sans dividendes : en les réinvestissant, la récupération a été nettement plus rapide (après 1929, environ 7 ans au lieu de 25). Leçon : ne placez en actions que l’argent que vous pouvez laisser plusieurs années, et attendez-vous à voir un jour votre portefeuille perdre un tiers ou la moitié de sa valeur.')}</p>
        </Section>

        {/* 6. Market timing */}
        <Section icon={TrendingDown} title={t('Le piège : entrer et sortir au « bon » moment')}
          lead={t('100 investis dans le S&P 500 en {y} et jamais touchés sont devenus {v}. Voici ce qu’il serait resté en ratant seulement ses meilleures journées :', { y: bd.start.slice(0, 4), v: fmt(bd.final_100_full, 0) })}>
          <div className="guide-bars">
            <div className="guide-bar-row">
              <span>{t('Resté investi tout le temps')}</span>
              <div className="guide-bar"><span style={{ width: '100%', background: c.accent }} /></div>
              <b>{fmt(bd.final_100_full, 0)}</b><em>{fmt(bd.full_cagr_pct, 1, true)} % / {t('an')}</em>
            </div>
            {bd.missed.map(x => (
              <div key={x.days} className="guide-bar-row">
                <span>{t('Raté les {n} meilleurs jours', { n: x.days })}</span>
                <div className="guide-bar"><span style={{ width: `${(x.final_100 / bd.final_100_full) * 100}%`, background: c.faint }} /></div>
                <b>{fmt(x.final_100, 0)}</b><em>{fmt(x.cagr_pct, 1, true)} % / {t('an')}</em>
              </div>
            ))}
          </div>
          <p className="guide-p">{t('Rater les 10 meilleures séances sur près de 20 ans divise le résultat par plus de deux ({a} au lieu de {b}). Et {p} % de ces meilleures séances ont eu lieu en pleine crise, juste à côté des pires : celui qui vend par peur rate souvent le rebond. Rester investi bat presque toujours le fait de deviner le bon moment.', { a: fmt(missed10.final_100, 0), b: fmt(bd.final_100_full, 0), p: fmt(bd.best10_in_bear_pct, 0) })}</p>
        </Section>

        {/* 7. Les chiffres à regarder + plan */}
        <Section icon={ListChecks} title={t('Votre plan, et les 5 chiffres à regarder sur ce site')}>
          <ol className="guide-steps">
            <li><strong>{t('Gardez une épargne de précaution.')}</strong> {t('3 à 6 mois de dépenses sur un livret, disponibles tout de suite. On n’investit que ce qui reste.')}</li>
            <li><strong>{t('Fixez votre horizon.')}</strong> {t('Besoin de l’argent dans moins de 3 ans : pas d’actions. Plus de 8 à 10 ans : les actions deviennent intéressantes.')}</li>
            <li><strong>{t('Choisissez la pire chute que vous pouvez supporter.')}</strong> {t('C’est elle qui décide de votre profil (voir plus haut), pas le rendement espéré.')}</li>
            <li><strong>{t('Diversifiez.')}</strong> {t('Un fonds indiciel (ETF) monde contient des milliers d’entreprises : bien moins risqué que 2 ou 3 actions choisies au hasard.')} <button type="button" className="link-btn" onClick={() => onGoTo('portfolio')}>{t('Composer un portefeuille')}</button></li>
            <li><strong>{t('Investissez régulièrement et surveillez les frais.')}</strong> {t('Un montant fixe chaque mois lisse les points d’entrée. 1 % de frais par an en moins, c’est environ 20 % de capital en plus sur 20 ans. En France, les enveloppes PEA et assurance-vie réduisent les impôts.')}</li>
            <li><strong>{t('Ne paniquez pas pendant les krachs.')}</strong> {t('Ils font partie du voyage. Vendre au plus bas transforme une perte temporaire en perte définitive.')}</li>
          </ol>

          <div className="guide-metrics">
            {[
              ['Rendement annuel (CAGR)', 'cagr', 'Combien ça a rapporté par an, en moyenne. Comparez toujours sur la même durée.', 'Repère : les actions mondiales font environ 7 à 8 % par an sur le long terme.'],
              ['Volatilité', 'vol', 'L’ampleur des secousses. Plus elle est haute, plus le prix fait le yoyo.', 'Repère : ~15-20 % pour un grand indice, 60 % et plus pour une crypto.'],
              ['Max Drawdown', 'mdd', 'La pire chute, du sommet au creux. C’est le chiffre qui teste vos nerfs.', 'Demandez-vous : aurais-je tenu sans vendre ?'],
              ['Ratio de Sharpe', 'sharpe', 'Le rendement obtenu pour chaque unité de risque. Il départage deux placements.', 'Repère : au-dessus de 0,5 c’est correct, au-dessus de 1 très bon.'],
              ['Corrélation', 'correlation', 'À quel point deux placements bougent ensemble. Utile pour diversifier.', 'Mélangez des actifs peu corrélés (en dessous de 0,5) pour amortir les chutes.'],
            ].map(([label, key, what, rule]) => (
              <div key={key} className="guide-metric">
                <strong>{t(label)} <HelpButtons definition={DEFINITIONS[key]} size={12} /></strong>
                <p>{t(what)}</p>
                <p className="hint">{t(rule)}</p>
              </div>
            ))}
          </div>
          <div className="guide-cta">
            <button type="button" className="btn btn-primary" onClick={() => onGoTo('asset')}>{t('Analyser un placement')} <ArrowRight size={14} /></button>
            <button type="button" className="btn" onClick={() => onGoTo('screener')}>{t('Comparer des milliers d’actifs dans le screener')}</button>
          </div>
        </Section>
      </>)}
    </div>
  );
}

export default memo(GuideView);
