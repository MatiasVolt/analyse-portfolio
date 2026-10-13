import { memo, useId, useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { PiggyBank, House, TrendingUp, Crosshair, Percent, Coins, Plus, Minus } from 'lucide-react';
import { Segmented } from '../components/ui';
import { fmt, parseNum } from '../format';
import { useLang } from '../i18n';
import { useChartColors } from '../theme';
import {
  futureValue, solveSavings, savingsPath, loanPayment, loanPrincipal, amortization,
  cagr, recoveryGain, effectiveRate, equivalentRate, realRate, doublingYears, npv, irr, payback,
} from '../finance/calcMath';

const MODES = [
  { id: 'savings', label: 'Épargne & intérêts composés', icon: PiggyBank },
  { id: 'loan', label: 'Crédit', icon: House },
  { id: 'returns', label: 'Rendements', icon: TrendingUp },
  { id: 'position', label: 'Taille de position', icon: Crosshair },
  { id: 'rates', label: 'Taux', icon: Percent },
  { id: 'npv', label: 'VAN / TRI', icon: Coins },
];

// Champ vide = non renseigné (null), « 5,5 » accepté comme 5.5
const num = (s) => (String(s ?? '').trim() === '' ? null : (Number.isFinite(parseNum(s)) ? parseNum(s) : null));
const pct = (v, nd = 2, signed = false) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${fmt(v * 100, nd, signed)} %`);
const ready = (...vals) => vals.every(v => v !== null && Number.isFinite(v));

// ───────────── Briques d'interface ─────────────

function Num({ label, value, onChange, unit, hint }) {
  const { t } = useLang();
  const id = useId();
  return (
    <div className="calc-field">
      <label className="label" htmlFor={id}>{t(label)}</label>
      <div className="calc-input">
        <input id={id} type="text" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" />
        {unit && <span aria-hidden="true">{t(unit)}</span>}
      </div>
      {hint && <div className="hint">{t(hint)}</div>}
    </div>
  );
}

function Result({ label, value, sub, tone, big }) {
  const { t } = useLang();
  return (
    <div className={`calc-result${big ? ' big' : ''}`}>
      <span className="label">{t(label)}</span>
      <strong style={{ color: value === '—' ? 'var(--muted)' : tone }}>{value}</strong>
      {sub && <span className="hint">{sub}</span>}
    </div>
  );
}

/** La formule utilisée, et ce que représente chaque lettre. */
function Formula({ formula, legend, children }) {
  const { t } = useLang();
  // Les lettres d'une formule changent avec la langue (VF en français, FV en anglais). Clé « §lettre » dans le
  // dictionnaire pour ne pas entrer en conflit avec un autre texte d'une seule lettre ; sans traduction, la lettre reste telle quelle.
  const symbol = (k) => { const v = t(`§${k}`); return v.startsWith('§') ? k : v; };
  return (
    <div className="calc-formula">
      <span className="label">{t('Formule')}</span>
      <div className="calc-formula-eq">{t(formula)}</div>
      {legend && <ul>{legend.map(([k, v]) => <li key={k}><b>{symbol(k)}</b> : {t(v)}</li>)}</ul>}
      {children && <p className="hint">{children}</p>}
    </div>
  );
}

const Empty = () => {
  const { t } = useLang();
  return <p className="hint calc-empty">{t('Remplissez les champs : le résultat se calcule au fur et à mesure.')}</p>;
};

// ───────────── Épargne & intérêts composés ─────────────

const SAVINGS_TARGETS = [
  { value: 'fv', label: 'Capital final' }, { value: 'pmt', label: 'Versement' }, { value: 'pv', label: 'Capital de départ' },
  { value: 'years', label: 'Durée' }, { value: 'rate', label: 'Taux' },
];

function Savings({ cur }) {
  const { t } = useLang();
  const c = useChartColors();
  const [target, setTarget] = useState('fv');
  const [f, setF] = useState({ pv: '', pmt: '', rate: '', years: '', fv: '', m: '12', begin: false });
  const set = (k) => (v) => setF(s => ({ ...s, [k]: v }));
  const m = Number(f.m);
  const per = m === 12 ? 'par mois' : 'par an';

  const p = { pv: num(f.pv) ?? 0, pmt: num(f.pmt) ?? 0, rate: num(f.rate) === null ? null : num(f.rate) / 100, years: num(f.years), fv: num(f.fv), m, begin: f.begin };
  const needed = { fv: [p.rate, p.years], pmt: [p.rate, p.years, p.fv], pv: [p.rate, p.years, p.fv], years: [p.rate, p.fv], rate: [p.years, p.fv] }[target];
  const ok = ready(...needed) && (target === 'fv' || target === 'pmt' || target === 'pv' || p.pv > 0 || p.pmt > 0);
  const value = ok ? solveSavings(target, p) : null;
  // Versement ou capital de départ négatif = déjà atteint : pas de détail ni de courbe
  const full = value === null || !Number.isFinite(value) || ((target === 'pmt' || target === 'pv') && value < 0) ? null : { ...p, [target]: value };
  const final = full ? futureValue(full) : null;
  const paid = full ? full.pv + full.pmt * full.years * m : null;
  const path = useMemo(() => (full && full.years > 0 && full.years <= 100 ? savingsPath(full) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [full?.pv, full?.pmt, full?.rate, full?.years, m, f.begin]);

  const shown = value === null ? '—'
    : target === 'rate' ? pct(value)
      : target === 'years' ? `${fmt(value, 1)} ${t('ans')}`
        : `${fmt(value, 2)} ${cur}`;
  let note = null;
  if (ok && value === null) note = t('Impossible d’atteindre ce montant avec ces paramètres.');
  else if (target === 'pmt' && value < 0) note = t('Le capital de départ suffit déjà : aucun versement n’est nécessaire.');
  else if (target === 'pv' && value < 0) note = t('Les versements suffisent déjà : aucun capital de départ n’est nécessaire.');

  const field = (k, label, unit, hint) => target !== k && <Num label={label} value={f[k]} onChange={set(k)} unit={unit} hint={hint} />;
  return (
    <div className="grid-2">
      <div className="panel">
        <div className="calc-target">
          <span className="label">{t('Je cherche :')}</span>
          <Segmented options={SAVINGS_TARGETS} value={target} onChange={setTarget} label="Valeur à calculer" />
        </div>
        <div className="calc-fields">
          {field('pv', 'Capital de départ (optionnel)', cur)}
          {field('pmt', `Versement ${per} (optionnel)`, cur)}
          {field('rate', 'Rendement annuel', '%')}
          {field('years', 'Durée', 'ans')}
          {field('fv', 'Capital visé', cur)}
          <div className="calc-field">
            <span className="label">{t('Versements')}</span>
            <select value={f.m} onChange={(e) => set('m')(e.target.value)} aria-label={t('Fréquence des versements')}>
              <option value="12">{t('Mensuels')}</option><option value="1">{t('Annuels')}</option>
            </select>
            <label className="calc-check"><input type="checkbox" checked={f.begin} onChange={(e) => set('begin')(e.target.checked)} /> {t('en début de période')}</label>
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="calc-results">
          <Result big label={SAVINGS_TARGETS.find(x => x.value === target).label} value={note && value !== null && value < 0 ? '0' : shown} />
          {full && paid !== null && <>
            <Result label="Total versé" value={`${fmt(paid, 2)} ${cur}`} />
            <Result label="Intérêts gagnés" value={`${fmt(final - paid, 2, true)} ${cur}`} tone={final - paid >= 0 ? 'var(--green)' : 'var(--red)'}
              sub={final > 0 ? t('{p} du capital final', { p: pct((final - paid) / final, 1) }) : null} />
          </>}
        </div>
        {note && <p className="hint calc-note">{note}</p>}
        {!ok && <Empty />}
        {path && (
          <div style={{ height: 210, marginTop: 12 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={path} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
                <XAxis dataKey="year" stroke={c.text} fontSize={11} tickFormatter={(y) => `${y} ${t('ans')}`} minTickGap={20} />
                <YAxis stroke={c.text} fontSize={11} width={70} tickFormatter={(v) => fmt(v, 0)} />
                <Tooltip contentStyle={{ background: c.bg, borderColor: c.border, fontSize: 12 }} labelFormatter={(y) => `${y} ${t('ans')}`}
                  formatter={(v, n) => [`${fmt(v, 0)} ${cur}`, n]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="paid" stackId="1" name={t('Versé')} stroke={c.blue} fill={c.blue} fillOpacity={0.35} isAnimationActive={false} />
                <Area type="monotone" dataKey="interest" stackId="1" name={t('Intérêts')} stroke={c.accent} fill={c.accent} fillOpacity={0.35} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        <Formula formula="VF = VA × (1 + i)ⁿ + V × [(1 + i)ⁿ − 1] ÷ i"
          legend={[['VF', 'capital final'], ['VA', 'capital de départ'], ['V', 'versement par période'],
            ['i', m === 12 ? 'taux par mois = rendement annuel ÷ 12' : 'rendement annuel'], ['n', m === 12 ? 'nombre de mois' : 'nombre d’années']]}>
          {t('Chaque période, les intérêts s’ajoutent au capital et rapportent à leur tour : c’est l’effet « boule de neige ». Pour trouver une durée ou un taux, la calculatrice essaie des valeurs jusqu’à retomber sur le capital visé.')}
        </Formula>
      </div>
    </div>
  );
}

// ───────────── Crédit ─────────────

function Loan({ cur }) {
  const { t } = useLang();
  const [known, setKnown] = useState('amount');
  const [f, setF] = useState({ amount: '', payment: '', rate: '', years: '' });
  const set = (k) => (v) => setF(s => ({ ...s, [k]: v }));
  const rate = num(f.rate) === null ? null : num(f.rate) / 100, years = num(f.years);
  const principal = known === 'amount' ? num(f.amount) : (ready(num(f.payment), rate, years) ? loanPrincipal(num(f.payment), rate, years) : null);
  const ok = ready(principal, rate, years) && principal > 0 && years > 0;
  const pay = ok ? loanPayment(principal, rate, years) : null;
  const total = ok ? pay * Math.round(years * 12) : null;
  const rows = ok && years <= 50 ? amortization(principal, rate, years) : null;

  return (
    <div className="grid-2">
      <div className="panel">
        <div className="calc-target">
          <span className="label">{t('Je connais :')}</span>
          <Segmented options={[{ value: 'amount', label: 'Le montant à emprunter' }, { value: 'payment', label: 'La mensualité possible' }]} value={known} onChange={setKnown} label="Donnée connue" />
        </div>
        <div className="calc-fields">
          {known === 'amount' ? <Num label="Montant emprunté" value={f.amount} onChange={set('amount')} unit={cur} />
            : <Num label="Mensualité maximale" value={f.payment} onChange={set('payment')} unit={cur} />}
          <Num label="Taux annuel" value={f.rate} onChange={set('rate')} unit="%" hint="Hors assurance" />
          <Num label="Durée" value={f.years} onChange={set('years')} unit="ans" />
        </div>
        <Formula formula="M = C × i ÷ [1 − (1 + i)⁻ⁿ]"
          legend={[['M', 'mensualité'], ['C', 'capital emprunté'], ['i', 'taux mensuel = taux annuel ÷ 12'], ['n', 'nombre de mensualités']]}>
          {t('La mensualité reste la même, mais sa composition change : au début elle paie surtout des intérêts, à la fin surtout du capital (voir le tableau).')}
        </Formula>
      </div>
      <div className="panel">
        <div className="calc-results">
          {known === 'amount' ? <Result big label="Mensualité" value={ok ? `${fmt(pay, 2)} ${cur}` : '—'} />
            : <Result big label="Capacité d’emprunt" value={ok ? `${fmt(principal, 0)} ${cur}` : '—'} />}
          <Result label="Coût des intérêts" value={ok ? `${fmt(total - principal, 0)} ${cur}` : '—'} tone="var(--red)"
            sub={ok ? t('{p} du montant emprunté', { p: pct((total - principal) / principal, 1) }) : null} />
          <Result label="Total remboursé" value={ok ? `${fmt(total, 0)} ${cur}` : '—'} />
        </div>
        {!ok && <Empty />}
        {rows && (
          <div className="calc-table-wrap">
            <table className="calc-table">
              <thead><tr><th>{t('Année')}</th><th>{t('Intérêts payés')}</th><th>{t('Capital remboursé')}</th><th>{t('Reste dû')}</th></tr></thead>
              <tbody>{rows.map(r => (
                <tr key={r.year}><td>{r.year}</td><td>{fmt(r.interest, 0)}</td><td>{fmt(r.capital, 0)}</td><td>{fmt(r.balance, 0)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────── Rendements ─────────────

function Returns({ cur }) {
  const { t } = useLang();
  const [f, setF] = useState({ start: '', end: '', years: '', loss: '' });
  const set = (k) => (v) => setF(s => ({ ...s, [k]: v }));
  const start = num(f.start), end = num(f.end), years = num(f.years), loss = num(f.loss);
  const total = ready(start, end) && start > 0 ? end / start - 1 : null;
  const annual = ready(start, end, years) ? cagr(start, end, years) : null;
  const need = loss !== null && loss > 0 && loss < 100 ? recoveryGain(loss / 100) : null;

  return (
    <div className="grid-2">
      <div className="panel">
        <h3 className="section-title">{t('Rendement annualisé (CAGR)')}</h3>
        <div className="calc-fields">
          <Num label="Valeur de départ" value={f.start} onChange={set('start')} unit={cur} />
          <Num label="Valeur finale" value={f.end} onChange={set('end')} unit={cur} />
          <Num label="Durée" value={f.years} onChange={set('years')} unit="ans" />
        </div>
        <div className="calc-results">
          <Result label="Rendement total" value={pct(total, 2, true)} tone={total === null ? undefined : total >= 0 ? 'var(--green)' : 'var(--red)'} />
          <Result big label="Rendement annualisé" value={pct(annual, 2, true)} tone={annual === null ? undefined : annual >= 0 ? 'var(--green)' : 'var(--red)'} />
        </div>
        <Formula formula="CAGR = (fin ÷ début)^(1 ÷ années) − 1">
          {t('C’est le rendement constant, chaque année, qui aurait mené du départ à l’arrivée. Il permet de comparer des placements sur des durées différentes : +100 % en 10 ans, c’est 7,18 % par an.')}
        </Formula>
      </div>
      <div className="panel">
        <h3 className="section-title">{t('Perte à rattraper')}</h3>
        <div className="calc-fields">
          <Num label="Baisse subie" value={f.loss} onChange={set('loss')} unit="%" />
        </div>
        <div className="calc-results">
          <Result big label="Hausse nécessaire pour revenir au départ" value={pct(need, 2, true)} tone="var(--amber)" />
        </div>
        <table className="calc-table compact">
          <thead><tr><th>{t('Baisse')}</th>{[10, 20, 30, 50, 75, 90].map(l => <th key={l}>−{l} %</th>)}</tr></thead>
          <tbody><tr><td>{t('Hausse nécessaire')}</td>{[10, 20, 30, 50, 75, 90].map(l => <td key={l}>+{fmt(recoveryGain(l / 100) * 100, 0)} %</td>)}</tr></tbody>
        </table>
        <Formula formula="Hausse = 1 ÷ (1 − baisse) − 1">
          {t('Après une baisse, on repart d’une base plus petite : il faut donc une hausse plus forte que la baisse pour revenir au point de départ. −50 % demande +100 %.')}
        </Formula>
      </div>
    </div>
  );
}

// ───────────── Taille de position ─────────────

function Position({ cur }) {
  const { t } = useLang();
  const [f, setF] = useState({ capital: '', risk: '', entry: '', stop: '', target: '' });
  const set = (k) => (v) => setF(s => ({ ...s, [k]: v }));
  const capital = num(f.capital), risk = num(f.risk), entry = num(f.entry), stop = num(f.stop), target = num(f.target);
  const ok = ready(capital, risk, entry, stop) && capital > 0 && risk > 0 && entry > 0 && stop > 0 && entry !== stop;
  const riskAmount = ok ? capital * risk / 100 : null;
  const perUnit = ok ? Math.abs(entry - stop) : null;
  const qty = ok ? riskAmount / perUnit : null;
  const whole = ok ? Math.floor(qty) : null;
  const value = ok ? whole * entry : null;
  const long = ok ? stop < entry : null;
  const rr = ok && target !== null && (long ? target > entry : target < entry) ? Math.abs(target - entry) / perUnit : null;

  return (
    <div className="grid-2">
      <div className="panel">
        <div className="calc-fields">
          <Num label="Capital du compte" value={f.capital} onChange={set('capital')} unit={cur} />
          <Num label="Risque accepté sur cette position" value={f.risk} onChange={set('risk')} unit="%" hint="Part du capital que vous acceptez de perdre si le stop est touché" />
          <Num label="Prix d’entrée" value={f.entry} onChange={set('entry')} unit={cur} />
          <Num label="Stop-loss" value={f.stop} onChange={set('stop')} unit={cur} hint="Astuce : l’ATR de l’onglet Actif donne la variation habituelle d’une séance" />
          <Num label="Objectif (optionnel)" value={f.target} onChange={set('target')} unit={cur} />
        </div>
        <Formula formula="Quantité = (capital × risque %) ÷ |entrée − stop|">
          {t('On part de la perte maximale acceptée, pas du montant à investir : si le stop est proche, on peut acheter plus de titres pour le même risque ; s’il est loin, moins.')}
        </Formula>
      </div>
      <div className="panel">
        <div className="calc-results">
          <Result big label="Quantité à acheter" value={ok ? fmt(whole, 0) : '—'} sub={ok ? t('{q} exactement · position {d}', { q: fmt(qty, 2), d: t(long ? 'acheteuse' : 'vendeuse (à découvert)') }) : null} />
          <Result label="Montant risqué" value={ok ? `${fmt(riskAmount, 2)} ${cur}` : '—'} tone="var(--red)" />
          <Result label="Valeur de la position" value={ok ? `${fmt(value, 2)} ${cur}` : '—'} sub={ok ? t('{p} du capital', { p: pct(value / capital, 1) }) : null} />
          <Result label="Ratio gain / risque" value={rr === null ? '—' : `${fmt(rr, 2)} : 1`} tone={rr === null ? undefined : rr >= 2 ? 'var(--green)' : rr >= 1 ? 'var(--amber)' : 'var(--red)'} />
        </div>
        {!ok && <Empty />}
        {ok && value > capital && <p className="hint calc-note">{t('La position dépasse votre capital : il faudrait un effet de levier. Éloignez le stop ou réduisez le risque.')}</p>}
        {ok && target !== null && rr === null && <p className="hint calc-note">{t('L’objectif doit être du côté du gain (au-dessus de l’entrée pour un achat, en dessous pour une vente).')}</p>}
      </div>
    </div>
  );
}

// ───────────── Taux ─────────────

function Rates() {
  const { t } = useLang();
  const [f, setF] = useState({ nominal: '', comp: '12', eq: '', eqDir: 'm2y', nom: '', infl: '', dbl: '' });
  const set = (k) => (v) => setF(s => ({ ...s, [k]: v }));
  const nominal = num(f.nominal), eq = num(f.eq), nom = num(f.nom), infl = num(f.infl), dbl = num(f.dbl);
  const eff = nominal !== null ? effectiveRate(nominal / 100, Number(f.comp)) : null;
  const eqv = eq !== null ? equivalentRate(eq / 100, f.eqDir === 'm2y' ? 12 : 1 / 12) : null;
  const real = ready(nom, infl) ? realRate(nom / 100, infl / 100) : null;
  const years = dbl !== null ? doublingYears(dbl / 100) : null;

  return (
    <div className="calc-cards">
      <div className="panel">
        <h3 className="section-title">{t('Taux nominal → taux effectif')}</h3>
        <div className="calc-fields">
          <Num label="Taux nominal annuel" value={f.nominal} onChange={set('nominal')} unit="%" />
          <div className="calc-field"><span className="label">{t('Intérêts ajoutés')}</span>
            <select value={f.comp} onChange={(e) => set('comp')(e.target.value)} aria-label={t('Fréquence de capitalisation')}>
              <option value="12">{t('chaque mois')}</option><option value="4">{t('chaque trimestre')}</option><option value="365">{t('chaque jour')}</option>
            </select></div>
        </div>
        <Result big label="Taux effectif annuel" value={pct(eff, 3)} />
        <Formula formula="effectif = (1 + r ÷ m)^m − 1">{t('Quand les intérêts sont versés plusieurs fois par an, ils produisent eux-mêmes des intérêts : le taux réellement obtenu sur l’année est un peu plus élevé que le taux affiché.')}</Formula>
      </div>
      <div className="panel">
        <h3 className="section-title">{t('Taux équivalent')}</h3>
        <div className="calc-fields">
          <Num label={f.eqDir === 'm2y' ? 'Taux mensuel' : 'Taux annuel'} value={f.eq} onChange={set('eq')} unit="%" />
          <div className="calc-field"><span className="label">{t('Conversion')}</span>
            <select value={f.eqDir} onChange={(e) => set('eqDir')(e.target.value)} aria-label={t('Sens de la conversion')}>
              <option value="m2y">{t('mensuel → annuel')}</option><option value="y2m">{t('annuel → mensuel')}</option>
            </select></div>
        </div>
        <Result big label={f.eqDir === 'm2y' ? 'Taux annuel équivalent' : 'Taux mensuel équivalent'} value={pct(eqv, 3)} />
        <Formula formula={f.eqDir === 'm2y' ? 'annuel = (1 + mensuel)¹² − 1' : 'mensuel = (1 + annuel)^(1/12) − 1'}>{t('Multiplier un taux mensuel par 12 sous-estime le rendement annuel : les gains de chaque mois s’ajoutent au capital du mois suivant.')}</Formula>
      </div>
      <div className="panel">
        <h3 className="section-title">{t('Rendement réel (après inflation)')}</h3>
        <div className="calc-fields">
          <Num label="Rendement nominal" value={f.nom} onChange={set('nom')} unit="%" />
          <Num label="Inflation" value={f.infl} onChange={set('infl')} unit="%" />
        </div>
        <Result big label="Rendement réel" value={pct(real, 2, true)} tone={real === null ? undefined : real >= 0 ? 'var(--green)' : 'var(--red)'}
          sub={ready(nom, infl) ? t('approximation rapide : {v}', { v: `${fmt(nom - infl, 2, true)} %` }) : null} />
        <Formula formula="réel = (1 + nominal) ÷ (1 + inflation) − 1">{t('Ce que gagne vraiment votre pouvoir d’achat. Un livret à 3 % avec 2 % d’inflation ne vous enrichit que d’environ 1 % par an.')}</Formula>
      </div>
      <div className="panel">
        <h3 className="section-title">{t('Temps de doublement')}</h3>
        <div className="calc-fields">
          <Num label="Rendement annuel" value={f.dbl} onChange={set('dbl')} unit="%" />
        </div>
        <Result big label="Années pour doubler" value={years === null ? '—' : `${fmt(years, 1)} ${t('ans')}`}
          sub={years !== null ? t('règle de 72 : {v} ans', { v: fmt(72 / dbl, 1) }) : null} />
        <Formula formula="années = ln 2 ÷ ln(1 + r)">{t('La « règle de 72 » donne une estimation de tête : 72 ÷ taux en %. À 6 %, un capital double en 12 ans environ.')}</Formula>
      </div>
    </div>
  );
}

// ───────────── VAN / TRI ─────────────

function Npv({ cur }) {
  const { t } = useLang();
  const [rate, setRate] = useState('');
  const [flows, setFlows] = useState(['', '', '', '']);
  const values = flows.map(num);
  const filled = values.map(v => v ?? 0);
  const r = num(rate);
  const anyFlow = values.some(v => v !== null);
  const van = r !== null && anyFlow ? npv(r / 100, filled) : null;
  const tri = anyFlow ? irr(filled) : null;
  const pb = anyFlow ? payback(filled) : null;

  return (
    <div className="grid-2">
      <div className="panel">
        <div className="calc-fields">
          <Num label="Taux d’actualisation (rendement exigé)" value={rate} onChange={setRate} unit="%" />
        </div>
        <span className="label" style={{ marginTop: 12, display: 'block' }}>{t('Flux de trésorerie (négatif = dépense, positif = rentrée)')}</span>
        <div className="calc-flows">
          {flows.map((v, i) => (
            <div key={i} className="calc-flow">
              <span>{i === 0 ? t('Aujourd’hui') : t('Année {n}', { n: i })}</span>
              <div className="calc-input">
                <input type="text" inputMode="decimal" value={v} aria-label={i === 0 ? t('Aujourd’hui') : t('Année {n}', { n: i })}
                  onChange={(e) => setFlows(fs => fs.map((x, j) => (j === i ? e.target.value : x)))} />
                <span aria-hidden="true">{cur}</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" className="btn btn-sm" onClick={() => setFlows(fs => [...fs, ''])} disabled={flows.length >= 40}><Plus size={13} /> {t('Ajouter une année')}</button>
          <button type="button" className="btn btn-sm" onClick={() => setFlows(fs => fs.slice(0, -1))} disabled={flows.length <= 2}><Minus size={13} /> {t('Retirer')}</button>
        </div>
      </div>
      <div className="panel">
        <div className="calc-results">
          <Result big label="VAN (valeur actuelle nette)" value={van === null ? '—' : `${fmt(van, 2, true)} ${cur}`} tone={van === null ? undefined : van >= 0 ? 'var(--green)' : 'var(--red)'} />
          <Result label="TRI (taux de rendement interne)" value={pct(tri, 2)} />
          <Result label="Délai de récupération" value={pb === null ? '—' : `${fmt(pb, 1)} ${t('ans')}`} />
        </div>
        {van !== null && (
          <p className="hint calc-note">{t(van >= 0
            ? 'VAN positive : le projet rapporte plus que le rendement exigé. Il crée de la valeur.'
            : 'VAN négative : le projet rapporte moins que le rendement exigé. Mieux vaut placer l’argent au taux d’actualisation.')}</p>
        )}
        {!anyFlow && <Empty />}
        {anyFlow && tri === null && <p className="hint calc-note">{t('Pas de TRI : il faut au moins un flux négatif et un flux positif.')}</p>}
        <Formula formula="VAN = Σ Fₜ ÷ (1 + r)ᵗ"
          legend={[['Fₜ', 'flux de l’année t (l’année 0 n’est pas actualisée)'], ['r', 'taux d’actualisation'], ['TRI', 'le taux r pour lequel la VAN vaut exactement 0']]}>
          {t('Un euro reçu dans 5 ans vaut moins qu’un euro aujourd’hui, car on aurait pu le placer entre-temps. La VAN ramène tous les flux en euros d’aujourd’hui pour les additionner.')}
        </Formula>
      </div>
    </div>
  );
}

// ───────────── Vue ─────────────

const COMPONENTS = { savings: Savings, loan: Loan, returns: Returns, position: Position, rates: Rates, npv: Npv };

function CalculatorView({ shared }) {
  const { t } = useLang();
  const [mode, setMode] = useState('savings');
  const [opened, setOpened] = useState(['savings']); // calculs déjà ouverts : ils restent montés et gardent leurs valeurs
  const open = (id) => { setMode(id); setOpened(o => (o.includes(id) ? o : [...o, id])); };
  return (
    <div>
      <div className="calc-modes" role="tablist" aria-label={t('Calculs disponibles')}>
        {MODES.map(m => {
          const Icon = m.icon;
          return (
            <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} className={mode === m.id ? 'on' : ''} onClick={() => open(m.id)}>
              <Icon size={15} aria-hidden="true" /> {t(m.label)}
            </button>
          );
        })}
      </div>
      {opened.map(id => {
        const C = COMPONENTS[id];
        return <div key={id} hidden={id !== mode}><C cur={shared.currency} /></div>;
      })}
    </div>
  );
}

export default memo(CalculatorView);
