"""
Frontière efficiente (Markowitz) sans dépendance lourde : numpy uniquement.
Contraintes : pas de vente à découvert (poids >= 0), somme des poids = 100 %.

Pour une aversion au risque g, on maximise  rendement - g/2 × variance  sur le simplexe
(problème convexe, résolu par gradient projeté accéléré). En faisant varier g de presque 0
(tout sur l'actif le plus rentable) à très grand (portefeuille de variance minimale),
on parcourt toute la partie haute de la frontière.
"""
import numpy as np
import pandas as pd


def _project_simplex(v):
    """Projection euclidienne sur {w >= 0, somme = 1}."""
    u = np.sort(v)[::-1]
    css = np.cumsum(u)
    rho = np.nonzero(u * np.arange(1, len(v) + 1) > (css - 1))[0][-1]
    theta = (css[rho] - 1) / (rho + 1)
    return np.maximum(v - theta, 0)


def _solve(mu, cov, gamma, w0, iters=600):
    """max mu·w - gamma/2 · w'Σw  sur le simplexe (FISTA)."""
    L = gamma * float(np.linalg.eigvalsh(cov).max()) + 1e-12
    w = y = w0.copy()
    t = 1.0
    for _ in range(iters):
        grad = mu - gamma * cov @ y
        w_new = _project_simplex(y + grad / L)
        t_new = (1 + np.sqrt(1 + 4 * t * t)) / 2
        y = w_new + (t - 1) / t_new * (w_new - w)
        if np.abs(w_new - w).max() < 1e-9:
            w = w_new
            break
        w, t = w_new, t_new
    return w


def _min_variance(cov, w0, iters=2000):
    L = float(np.linalg.eigvalsh(cov).max()) + 1e-12
    w = y = w0.copy()
    t = 1.0
    for _ in range(iters):
        w_new = _project_simplex(y - cov @ y / L)
        t_new = (1 + np.sqrt(1 + 4 * t * t)) / 2
        y = w_new + (t - 1) / t_new * (w_new - w)
        if np.abs(w_new - w).max() < 1e-10:
            w = w_new
            break
        w, t = w_new, t_new
    return w


def compute(prices: pd.DataFrame, current: np.ndarray, ppy: int, rf: float) -> dict:
    """prices : cours alignés (une colonne par actif). current : poids actuels (somme 1)."""
    rets = prices.pct_change().dropna()
    tickers = list(prices.columns)
    mu = rets.mean().to_numpy() * ppy
    cov = rets.cov().to_numpy() * ppy
    n = len(tickers)

    def point(w):
        r = float(mu @ w)
        v = float(np.sqrt(max(w @ cov @ w, 0)))
        return {"ret_pct": round(r * 100, 2), "vol_pct": round(v * 100, 2),
                "sharpe": round((r - rf) / v, 2) if v > 0 else None,
                "weights": {t: round(float(x) * 100, 1) for t, x in zip(tickers, w) if x > 0.0005}}

    w_eq = np.full(n, 1 / n)
    w_min = _min_variance(cov, w_eq)
    # balayage de l'aversion au risque : de très faible (rendement max) à très forte (variance min)
    frontier_w = [w_min]
    w = w_min
    for g in np.geomspace(1000, 0.05, 70):
        w = _solve(mu, cov, g, w)
        frontier_w.append(w)
    frontier_w.append(np.eye(n)[int(np.argmax(mu))])
    pts = sorted((point(x) | {"_w": x} for x in frontier_w), key=lambda p: p["vol_pct"])
    # on ne garde que la partie efficiente (rendement croissant avec le risque) et sans doublons
    eff, best = [], -np.inf
    for p in pts:
        if p["ret_pct"] > best + 1e-6:
            eff.append(p)
            best = p["ret_pct"]

    cur = point(current)
    min_var = eff[0]
    max_sharpe = max(eff, key=lambda p: p["sharpe"] if p["sharpe"] is not None else -np.inf)
    same_ret = next((p for p in eff if p["ret_pct"] >= cur["ret_pct"] - 0.01), None)  # le moins risqué qui rapporte au moins autant
    same_risk = max((p for p in eff if p["vol_pct"] <= cur["vol_pct"] + 0.01), key=lambda p: p["ret_pct"], default=None)

    # nuage de portefeuilles tirés au hasard, pour visualiser l'espace des possibles
    rng = np.random.default_rng(7)
    cloud_w = rng.dirichlet(np.full(n, 0.6), size=1500)
    cr = cloud_w @ mu
    cv = np.sqrt(np.einsum("ij,jk,ik->i", cloud_w, cov, cloud_w))
    cloud = [{"ret_pct": round(float(a) * 100, 2), "vol_pct": round(float(b) * 100, 2)} for a, b in zip(cr, cv)]

    clean = lambda p: {k: v for k, v in p.items() if k != "_w"} if p else None
    return {
        "tickers": tickers,
        "assets": [{"ticker": t, "ret_pct": round(float(mu[i]) * 100, 2), "vol_pct": round(float(np.sqrt(cov[i, i])) * 100, 2)} for i, t in enumerate(tickers)],
        "current": cur,
        "frontier": [clean(p) for p in eff],
        "min_variance": clean(min_var),
        "max_sharpe": clean(max_sharpe),
        "same_return": clean(same_ret),
        "same_risk": clean(same_risk),
        "cloud": cloud,
        "risk_free_pct": round(rf * 100, 2),
        "observations": int(len(rets)),
        "start": prices.index[0].strftime("%Y-%m-%d"),
        "end": prices.index[-1].strftime("%Y-%m-%d"),
    }
