// Formules de la calculatrice financière (fonctions pures, taux en décimal : 5 % = 0.05).

/** Cherche x tel que fn(x) = target sur [lo, hi] (fn monotone). null si la cible n'est pas encadrée. */
export function solve(fn, target, lo, hi, iter = 200) {
  let flo = fn(lo) - target, fhi = fn(hi) - target;
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let k = 0; k < iter; k++) {
    const mid = (lo + hi) / 2, fm = fn(mid) - target;
    if (Math.abs(fm) < 1e-10 || hi - lo < 1e-12) return mid;
    if (flo * fm <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

// ───────────── Épargne / intérêts composés ─────────────
// pv : capital de départ, pmt : versement par période, rate : taux annuel, years : durée, m : périodes par an,
// begin : versements en début de période (sinon en fin).

/** Valeur finale d'une épargne : PV·(1+i)^n + PMT·((1+i)^n − 1)/i (× (1+i) si versement en début de période). */
export function futureValue({ pv, pmt, rate, years, m, begin }) {
  const i = rate / m, n = years * m;
  const g = (1 + i) ** n;
  const annuity = i === 0 ? n : (g - 1) / i;
  return pv * g + pmt * annuity * (begin ? 1 + i : 1);
}

/** Calcule l'inconnue `target` ('fv' | 'pmt' | 'pv' | 'years' | 'rate') à partir des autres valeurs. */
export function solveSavings(target, p) {
  if (target === 'fv') return futureValue(p);
  if (target === 'pv') {
    const g = (1 + p.rate / p.m) ** (p.years * p.m);
    return (p.fv - futureValue({ ...p, pv: 0 })) / g;
  }
  if (target === 'pmt') {
    const unit = futureValue({ ...p, pv: 0, pmt: 1 });
    return unit ? (p.fv - futureValue({ ...p, pmt: 0 })) / unit : null;
  }
  if (target === 'years') return solve((y) => futureValue({ ...p, years: y }), p.fv, 0, 300);
  if (target === 'rate') return solve((r) => futureValue({ ...p, rate: r }), p.fv, -0.99, 2);
  return null;
}

/** Évolution année par année : capital versé cumulé et intérêts cumulés. */
export function savingsPath(p) {
  const rows = [];
  const years = Math.min(Math.ceil(p.years), 100);
  for (let y = 0; y <= years; y++) {
    const yy = Math.min(y, p.years);
    const value = futureValue({ ...p, years: yy });
    const paid = p.pv + p.pmt * yy * p.m;
    rows.push({ year: y, paid, interest: value - paid, value });
  }
  return rows;
}

// ───────────── Crédit ─────────────

/** Mensualité d'un prêt amortissable : P·i / (1 − (1+i)^−n). */
export function loanPayment(principal, rate, years, m = 12) {
  const i = rate / m, n = Math.round(years * m);
  if (n <= 0) return null;
  return i === 0 ? principal / n : (principal * i) / (1 - (1 + i) ** -n);
}

/** Capital empruntable pour une mensualité donnée : M·(1 − (1+i)^−n) / i. */
export function loanPrincipal(payment, rate, years, m = 12) {
  const i = rate / m, n = Math.round(years * m);
  if (n <= 0) return null;
  return i === 0 ? payment * n : (payment * (1 - (1 + i) ** -n)) / i;
}

/** Tableau d'amortissement résumé par année. */
export function amortization(principal, rate, years, m = 12) {
  const pay = loanPayment(principal, rate, years, m);
  const i = rate / m, n = Math.round(years * m);
  let balance = principal;
  const rows = [];
  for (let k = 1; k <= n; k++) {
    const interest = balance * i;
    const capital = pay - interest;
    balance = Math.max(0, balance - capital);
    const y = Math.ceil(k / m);
    if (!rows[y - 1]) rows[y - 1] = { year: y, interest: 0, capital: 0, balance: 0 };
    rows[y - 1].interest += interest;
    rows[y - 1].capital += capital;
    rows[y - 1].balance = balance;
  }
  return rows;
}

// ───────────── Rendements ─────────────

/** Rendement annualisé (CAGR) : (fin / début)^(1/années) − 1. */
export const cagr = (start, end, years) => (start > 0 && end >= 0 && years > 0 ? (end / start) ** (1 / years) - 1 : null);

/** Hausse nécessaire pour effacer une perte : 1 / (1 − perte) − 1. */
export const recoveryGain = (loss) => (loss < 1 ? 1 / (1 - loss) - 1 : null);

// ───────────── Taux ─────────────

/** Taux effectif annuel d'un taux nominal capitalisé m fois par an : (1 + r/m)^m − 1. */
export const effectiveRate = (nominal, m) => (1 + nominal / m) ** m - 1;

/** Taux équivalent sur une autre période : (1 + r)^(fraction) − 1 (ex. mensuel -> annuel : fraction 12). */
export const equivalentRate = (rate, fraction) => (1 + rate) ** fraction - 1;

/** Rendement réel (relation de Fisher) : (1 + nominal) / (1 + inflation) − 1. */
export const realRate = (nominal, inflation) => (1 + nominal) / (1 + inflation) - 1;

/** Temps de doublement exact : ln 2 / ln(1 + r). */
export const doublingYears = (rate) => (rate > 0 ? Math.log(2) / Math.log(1 + rate) : null);

// ───────────── VAN / TRI ─────────────

/** Valeur actuelle nette : Σ CFt / (1 + r)^t, le flux de l'année 0 n'est pas actualisé. */
export const npv = (rate, flows) => flows.reduce((s, cf, t) => s + cf / (1 + rate) ** t, 0);

/** Taux de rendement interne : le taux qui annule la VAN (null s'il n'existe pas sur −99 % … +1 000 %). */
export function irr(flows) {
  if (!flows.some(f => f < 0) || !flows.some(f => f > 0)) return null;
  // On cherche le premier changement de signe de la VAN, puis on affine par dichotomie
  let prev = -0.99, fprev = npv(prev, flows);
  for (let r = -0.98; r <= 10; r += 0.01) {
    const f = npv(r, flows);
    if (fprev * f <= 0) return solve((x) => npv(x, flows), 0, prev, r);
    prev = r; fprev = f;
  }
  return null;
}

/** Délai de récupération (années, interpolé) : quand la somme des flux redevient positive. */
export function payback(flows) {
  let cum = 0;
  for (let t = 0; t < flows.length; t++) {
    const before = cum;
    cum += flows[t];
    if (t > 0 && before < 0 && cum >= 0) return t - 1 + -before / flows[t];
  }
  return null;
}
