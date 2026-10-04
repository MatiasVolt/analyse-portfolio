// Modèle de Black-Scholes-Merton (options européennes) et stratégies.
// S = cours, K = strike, T = années, r = taux sans risque (décimal), q = rendement du dividende, sigma = volatilité (décimal).

// Fonction de répartition de la loi normale (approximation d'Abramowitz-Stegun, erreur < 1e-7)
export function normCdf(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * z);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}
export const normPdf = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/** Prix et grecques. type = 'call' | 'put'. Theta par jour calendaire, vega et rho pour 1 point de %. */
export function blackScholes({ type, S, K, T, r, q = 0, sigma }) {
  if (T <= 0 || sigma <= 0) {
    const intrinsic = type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
    return { price: intrinsic, delta: type === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, vega: 0, theta: 0, rho: 0, d1: null, d2: null, probItm: S > K === (type === 'call') ? 1 : 0 };
  }
  const sq = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sq);
  const d2 = d1 - sigma * sq;
  const dfq = Math.exp(-q * T), dfr = Math.exp(-r * T);
  let price, delta, theta, rho, probItm;
  if (type === 'call') {
    price = S * dfq * normCdf(d1) - K * dfr * normCdf(d2);
    delta = dfq * normCdf(d1);
    theta = -S * dfq * normPdf(d1) * sigma / (2 * sq) - r * K * dfr * normCdf(d2) + q * S * dfq * normCdf(d1);
    rho = K * T * dfr * normCdf(d2);
    probItm = normCdf(d2);
  } else {
    price = K * dfr * normCdf(-d2) - S * dfq * normCdf(-d1);
    delta = -dfq * normCdf(-d1);
    theta = -S * dfq * normPdf(d1) * sigma / (2 * sq) + r * K * dfr * normCdf(-d2) - q * S * dfq * normCdf(-d1);
    rho = -K * T * dfr * normCdf(-d2);
    probItm = normCdf(-d2);
  }
  return {
    price, delta, d1, d2, probItm,
    gamma: dfq * normPdf(d1) / (S * sigma * sq),
    vega: S * dfq * normPdf(d1) * sq / 100,
    theta: theta / 365,
    rho: rho / 100,
  };
}

/** Volatilité implicite à partir d'un prix de marché (bissection). */
export function impliedVol({ type, S, K, T, r, q = 0, price }) {
  let lo = 0.001, hi = 5;
  const f = (s) => blackScholes({ type, S, K, T, r, q, sigma: s }).price - price;
  if (f(lo) > 0 || f(hi) < 0) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Jambe de stratégie : { kind: 'call'|'put'|'stock', side: 1 (achat) | -1 (vente), qty, strike, premium }
 * Gain à l'échéance pour un cours final ST (par unité de sous-jacent, × qty).
 */
export function legPayoff(leg, ST) {
  const q = leg.qty * leg.side;
  if (leg.kind === 'stock') return q * (ST - leg.premium); // premium = prix d'achat de l'action
  const intrinsic = leg.kind === 'call' ? Math.max(ST - leg.strike, 0) : Math.max(leg.strike - ST, 0);
  return q * (intrinsic - leg.premium);
}

/** Valeur théorique aujourd'hui (Black-Scholes) d'une jambe, moins la prime payée. */
export function legValueNow(leg, S, T, r, sigma, q = 0) {
  const k = leg.qty * leg.side;
  if (leg.kind === 'stock') return k * (S - leg.premium);
  return k * (blackScholes({ type: leg.kind, S, K: leg.strike, T, r, q, sigma }).price - leg.premium);
}

export const STRATEGIES = [
  { id: 'long_call', label: 'Achat de call', hint: 'Pari sur une hausse, perte limitée à la prime.', legs: (S) => [{ kind: 'call', side: 1, strike: S }] },
  { id: 'long_put', label: 'Achat de put', hint: 'Pari sur une baisse ou assurance, perte limitée à la prime.', legs: (S) => [{ kind: 'put', side: 1, strike: S }] },
  { id: 'covered_call', label: 'Covered call', hint: 'Détenir l\'action et vendre un call : revenu régulier, hausse plafonnée.', legs: (S) => [{ kind: 'stock', side: 1 }, { kind: 'call', side: -1, strike: S * 1.05 }] },
  { id: 'protective_put', label: 'Put de protection', hint: 'Détenir l\'action et acheter un put : assurance contre une chute.', legs: (S) => [{ kind: 'stock', side: 1 }, { kind: 'put', side: 1, strike: S * 0.95 }] },
  { id: 'bull_call', label: 'Bull call spread', hint: 'Hausse modérée, coût réduit, gain plafonné.', legs: (S) => [{ kind: 'call', side: 1, strike: S }, { kind: 'call', side: -1, strike: S * 1.1 }] },
  { id: 'bear_put', label: 'Bear put spread', hint: 'Baisse modérée, coût réduit, gain plafonné.', legs: (S) => [{ kind: 'put', side: 1, strike: S }, { kind: 'put', side: -1, strike: S * 0.9 }] },
  { id: 'straddle', label: 'Straddle', hint: 'Pari sur un gros mouvement, peu importe le sens (ex. avant une annonce).', legs: (S) => [{ kind: 'call', side: 1, strike: S }, { kind: 'put', side: 1, strike: S }] },
  { id: 'strangle', label: 'Strangle', hint: 'Comme le straddle mais moins cher : il faut un mouvement plus fort.', legs: (S) => [{ kind: 'call', side: 1, strike: S * 1.05 }, { kind: 'put', side: 1, strike: S * 0.95 }] },
  { id: 'iron_condor', label: 'Iron condor', hint: 'Pari sur un marché calme : gain limité si le cours reste dans un couloir.', legs: (S) => [
    { kind: 'put', side: 1, strike: S * 0.85 }, { kind: 'put', side: -1, strike: S * 0.92 },
    { kind: 'call', side: -1, strike: S * 1.08 }, { kind: 'call', side: 1, strike: S * 1.15 }] },
];
