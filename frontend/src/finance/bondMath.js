// Mathématiques obligataires (obligation à taux fixe, remboursement in fine au pair).
// Conventions : coupon et rendement en % annuel, fréquence = nombre de coupons par an, maturité en années.

/** Échéancier des flux : [{ t (années), period, coupon, principal, total }] */
export function cashflows({ nominal, couponPct, freq, years }) {
  const n = Math.max(1, Math.round(years * freq));
  const c = (nominal * couponPct) / 100 / freq;
  const firstT = years - (n - 1) / freq; // première échéance (gère les maturités non entières)
  return Array.from({ length: n }, (_, i) => {
    const t = firstT + i / freq;
    const principal = i === n - 1 ? nominal : 0;
    return { period: i + 1, t, coupon: c, principal, total: c + principal };
  });
}

/** Prix (même unité que le nominal) pour un rendement actuariel donné. */
export function priceFromYield(flows, yieldPct, freq) {
  const y = yieldPct / 100 / freq;
  return flows.reduce((s, f) => s + f.total / Math.pow(1 + y, f.t * freq), 0);
}

/** Rendement actuariel (YTM) pour un prix donné : bissection robuste. */
export function yieldFromPrice(flows, price, freq) {
  let lo = -0.99 * 100, hi = 100; // en %
  const f = (y) => priceFromYield(flows, y, freq) - price;
  if (f(lo) * f(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid;
    if (hi - lo < 1e-9) break;
  }
  return (lo + hi) / 2;
}

/** Analyse complète d'une obligation. */
export function analyzeBond({ nominal, couponPct, freq, years, yieldPct }) {
  const flows = cashflows({ nominal, couponPct, freq, years });
  const y = yieldPct / 100 / freq;
  let price = 0, macTerm = 0, convTerm = 0;
  const rows = flows.map(fl => {
    const k = fl.t * freq; // nombre de périodes
    const df = 1 / Math.pow(1 + y, k);
    const pv = fl.total * df;
    price += pv;
    macTerm += fl.t * pv;
    convTerm += pv * k * (k + 1) / Math.pow(1 + y, 2) / (freq * freq);
    return { ...fl, discount: df, pv };
  });
  const macaulay = macTerm / price;
  const modified = macaulay / (1 + y);
  const convexity = convTerm / price;
  const dv01 = price * modified * 0.0001;
  const shock = (dy) => ({
    approx: price * (-modified * dy + 0.5 * convexity * dy * dy),
    exact: priceFromYield(flows, yieldPct + dy * 100, freq) - price,
  });
  return {
    rows, price, pricePct: (price / nominal) * 100,
    currentYield: (couponPct * nominal) / price,
    macaulay, modified, convexity, dv01,
    up1: shock(0.01), down1: shock(-0.01),
    totalCoupons: flows.reduce((s, f) => s + f.coupon, 0),
  };
}

/** Courbe prix / rendement autour du rendement courant (pour le graphique). */
export function priceYieldCurve({ nominal, couponPct, freq, years }, centerYield) {
  const flows = cashflows({ nominal, couponPct, freq, years });
  const lo = Math.max(-1, centerYield - 4), hi = centerYield + 4;
  return Array.from({ length: 41 }, (_, i) => {
    const yv = lo + ((hi - lo) * i) / 40;
    return { yield: Math.round(yv * 100) / 100, price: (priceFromYield(flows, yv, freq) / nominal) * 100 };
  });
}
