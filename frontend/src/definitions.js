// Définitions des indicateurs (bouton « livre ») — les interprétations chiffrées (bouton « i ») viennent du backend.

export const DEFINITIONS = {
  total_change: "Variation du cours entre le premier et le dernier jour de la période. Pour les actions et les ETF, les cours sont ajustés : dividendes et divisions d'actions sont pris en compte. Exception : les indices (S&P 500, CAC 40…) sont des indices de prix, ils ne comptent pas les dividendes.",
  cagr: "Taux de croissance annuel composé (CAGR) : le rendement annuel constant qui aurait mené du point de départ au point d'arrivée. Utile pour comparer des périodes de durées différentes. Sur un an, il est presque égal à la variation totale ; sur moins d'un an, c'est une extrapolation.",
  sharpe: "Ce que l'actif a rapporté en plus d'un placement sans risque, pour chaque unité de risque prise. Calcul : (rendement moyen par séance − taux sans risque par séance) ÷ écart-type des rendements par séance, le tout ramené à l'année (× √252, ou × √365 pour la crypto). Le rendement utilisé est la moyenne arithmétique des séances, et non le CAGR affiché à côté : refaire le calcul avec le CAGR donne un chiffre un peu plus bas. Le taux sans risque est celui de la devise d'analyse (bon du Trésor US pour le dollar, taux de la BCE pour l'euro…), indiqué en haut du tableau. Repères : < 0 mauvais, 0,5 à 1 correct, > 1 très bon, > 2 exceptionnel.",
  sortino: 'Variante du Sharpe qui ne compte comme risque que les mauvaises séances : celles où le rendement passe sous le taux sans risque. Les fortes hausses ne sont pas pénalisées. Plus pertinent pour les actifs aux hausses brusques.',
  calmar: "CAGR ÷ |Max Drawdown|. Compare le gain annuel moyen à la pire chute subie. Au-dessus de 1, le gain d'une année moyenne dépasse en ampleur la pire chute. Attention : cela ne veut pas dire qu'une année suffit à l'effacer, car une chute se rattrape avec une hausse plus grande (après −50 %, il faut +100 %).",
  omega: "Additionnez toutes les hausses journalières d'un côté et toutes les baisses de l'autre : l'Omega est le rapport entre les deux. Au-dessus de 1, le bilan est gagnant. Contrairement au Sharpe, il tient compte de la taille réelle des bons et des mauvais jours. (Les traders l'appellent aussi « Profit Factor » : c'est le même calcul.)",
  win_rate: "Pourcentage de séances terminées en hausse (séances sans variation exclues). À lire avec le ratio Omega : on peut gagner souvent un peu et perdre rarement beaucoup.",
  mdd: "Max Drawdown : la plus grosse chute entre un sommet et le point le plus bas qui a suivi. Imaginez que vous achetez au pire moment (au sommet) et que vous vendez au pire moment (au creux) : c'est votre perte. Une chute se rattrape toujours avec une hausse plus grande : après −50 %, il faut +100 % pour revenir au départ.",
  mean_dd: "Un drawdown, c'est l'écart entre le cours du jour et le dernier record atteint (0 % les jours de record). Le drawdown moyen fait la moyenne de cet écart sur tous les jours où l'actif était sous un record : c'est le recul « habituel » ressenti en le détenant, moins extrême que le Max Drawdown.",
  current_dd: "Écart entre le dernier cours et le record historique de l'actif, quelle que soit la période choisie (pour un portefeuille : le plus haut de la période simulée). 0 % = l'actif est sur un record.",
  recovery: "Durée moyenne des périodes passées sous un ancien record : du record jusqu'au jour où l'actif en établit un nouveau. Ce ne sont pas des jours de baisse d'affilée : l'actif peut monter et descendre pendant ce temps, tant qu'il reste sous son record. Une période pas encore terminée est comptée jusqu'à aujourd'hui.",
  ulcer: "L'Ulcer Index mesure le stress de détenir un actif : il grimpe quand les baisses sont profondes et quand elles durent. Deux actifs peuvent avoir la même volatilité, mais celui qui reste longtemps loin de son record est bien plus pénible à garder (d'où le nom : « l'indice de l'ulcère »). Calcul : racine carrée de la moyenne des drawdowns au carré. Repères : < 5 serein, > 15 éprouvant.",
  vol: "La volatilité mesure l'ampleur habituelle des variations, à la hausse comme à la baisse (écart-type des rendements journaliers, ramené à l'année : × √252, ou × √365 pour la crypto qui cote tous les jours). Plus elle est élevée, plus le prix fait le yoyo.",
  downside_vol: "Volatilité calculée en ne retenant que les séances de baisse (les séances de hausse comptent pour zéro), ramenée à l'année. Elle ne mesure que le risque qui fait mal. Si elle vaut nettement plus que la volatilité totale ÷ 1,4, les baisses sont plus brutales que les hausses.",
  var_h: "Value at Risk historique sur 1 jour : seuil de perte qui n'a été dépassé que dans (100 − niveau de confiance) % des séances observées. Ce n'est pas la perte maximale : les pires jours vont au-delà (voir CVaR).",
  var_p: "Value at Risk paramétrique sur 1 jour : même seuil que la VaR historique, mais calculé en supposant que les variations suivent une courbe en cloche (loi normale). Calcul : moyenne − z × écart-type, où z est le nombre d'écarts-types qui correspond au niveau de confiance (1,645 à 95 %, 2,326 à 99 %). Elle sous-estime souvent le risque de krach, car les très mauvais jours sont plus fréquents que ne le prévoit la courbe en cloche.",
  cvar: "CVaR = Conditional Value at Risk (« VaR conditionnelle »), aussi appelée Expected Shortfall. C'est la perte moyenne des séances qui dépassent la VaR historique. Elle répond à la question : « quand ça va mal, on perd combien en moyenne ? »",
  beta: "Sensibilité aux mouvements de l'indice de référence (covariance ÷ variance de l'indice). 1 = suit le marché, > 1 = amplifie, < 1 = amortit, < 0 = évolue à l'inverse.",
  alpha: "L'alpha mesure ce que l'actif a gagné en plus (ou en moins) de ce que l'on pouvait attendre vu son lien avec l'indice de référence (son bêta). Exemple : avec un bêta de 1,2, si l'indice gagne 10 % de plus que le taux sans risque, on attend environ 12 % de plus que ce taux ; si l'actif a fait 3 points de mieux, son alpha est de +3 %. Positif = il a battu ce que le marché laissait prévoir. (Méthode : alpha de Jensen, issu du modèle MEDAF / CAPM.)",
  correlation: "Corrélation des rendements journaliers avec l'indice de référence, de −1 (mouvements opposés) à +1 (mouvements identiques). Plus elle est basse, plus l'actif diversifie un portefeuille investi dans cet indice.",
  r_squared: "Le R² indique quelle part des variations de l'actif va de pair avec celles de l'indice de référence (0 % = aucun lien, 100 % = l'actif bouge exactement comme l'indice). Il mesure un mouvement commun, pas une cause : deux actifs peuvent bouger ensemble parce qu'ils réagissent aux mêmes nouvelles (taux d'intérêt, appétit pour le risque).",
  tracking_error: "Chaque jour, l'actif fait un peu mieux ou un peu moins bien que l'indice de référence. La tracking error mesure l'ampleur de ces écarts sur une année. Faible (moins de 3 %) pour un ETF qui réplique l'indice, élevée pour un actif qui vit sa propre vie.",
  information_ratio: "Surperformance annualisée face à l'indice de référence ÷ tracking error. Mesure la régularité de la surperformance : > 0,5 bon, > 1 excellent.",
  capture: "Capture haussière / baissière : part de la hausse (ou de la baisse) moyenne de l'indice de référence que l'actif enregistre les mêmes jours. L'idéal : capture haussière élevée, capture baissière faible.",
  skew: "Asymétrie (skewness) des rendements journaliers. Négative : les grosses surprises sont plutôt des chutes. Positive : plutôt des envolées. 0 = symétrique.",
  kurt: "Excès de kurtosis : épaisseur des queues de distribution comparée à une loi normale (qui vaut 0). Une valeur élevée signale des journées extrêmes (krachs ou envolées) plus fréquentes que prévu.",
  tail_ratio: "Quantile 95 % ÷ |quantile 5 %| des rendements journaliers : compare l'ampleur des meilleures journées à celle des pires.",
  positive_months: "Part des mois civils terminés en hausse, avec le meilleur et le pire mois de la période.",
  best_day: "Plus forte hausse en une séance sur la période, avec sa date.",
  worst_day: "Plus forte baisse en une séance sur la période, avec sa date.",
  mean_daily: "Rendement moyen par séance (moyenne arithmétique).",
  median_daily: "Rendement médian par séance : une séance sur deux a fait mieux, une sur deux moins bien. S'il est nettement au-dessus du rendement moyen, quelques très mauvaises séances tirent la moyenne vers le bas ; nettement en dessous, quelques très bonnes séances la tirent vers le haut.",
  monte_carlo: "5 000 trajectoires futures sont simulées à partir de la tendance et de la volatilité historiques (mouvement brownien géométrique). Pessimiste = 5e centile (5 % des simulations finissent plus bas), médian = scénario central, optimiste = 95e centile. Hypothèse forte : le futur ressemble statistiquement au passé, et les krachs extrêmes sont sous-représentés. Ce n'est pas une prévision.",
  return_contribution: "Combien de points de la performance du portefeuille viennent de cette ligne. Calcul : poids au départ × performance de l'actif sur la période. Exemple : 20 % du portefeuille placés dans un actif qui a pris +50 % apportent +10 points. Additionnées, les contributions donnent la performance d'un portefeuille acheté au départ puis laissé tel quel (avec rééquilibrage, le total peut légèrement différer). Une contribution négative signale une ligne qui a fait perdre de l'argent au portefeuille.",
  risk_contribution: "Part du risque (variance) du portefeuille due à cette ligne. Tient compte de son poids, de sa volatilité et de sa corrélation avec les autres lignes. Une ligne peut peser 10 % du capital et 30 % du risque.",
  diversification_ratio: "Moyenne pondérée des volatilités individuelles ÷ volatilité du portefeuille. 1 = aucune diversification ; plus il est élevé, plus les lignes se compensent entre elles.",
  average_correlation: "Corrélation moyenne entre toutes les paires d'actifs du portefeuille. En dessous de 0,3 : bonne diversification ; au-dessus de 0,7 : les actifs bougent quasiment ensemble.",
};

/**
 * Catalogue des métriques affichées dans le tableau de bord.
 * field = clé dans `metrics`, def = clé de DEFINITIONS, interp = clé d'interprétation backend.
 */
export const METRICS = {
  total_change: { field: 'total_change_pct', label: 'Variation totale', unit: '%', def: 'total_change', interp: 'total_change', color: 'sign', signed: true },
  cagr: { field: 'cagr_pct', label: 'CAGR (rend. annuel)', unit: '%', def: 'cagr', interp: 'cagr', color: 'sign', signed: true },
  sharpe: { field: 'sharpe_ratio', label: 'Ratio de Sharpe', def: 'sharpe', interp: 'sharpe' },
  sortino: { field: 'sortino_ratio', label: 'Ratio de Sortino', def: 'sortino', interp: 'sortino' },
  calmar: { field: 'calmar_ratio', label: 'Ratio de Calmar', def: 'calmar', interp: 'calmar' },
  omega: { field: 'omega_ratio', label: 'Ratio Omega', def: 'omega', interp: 'omega' },
  win_rate: { field: 'win_rate_pct', label: 'Séances positives', unit: '%', def: 'win_rate', interp: 'win_rate', nd: 1 },
  positive_months: { field: 'positive_months_pct', label: 'Mois positifs', unit: '%', def: 'positive_months', interp: 'positive_months', nd: 0 },
  tail_ratio: { field: 'tail_ratio', label: 'Tail ratio', def: 'tail_ratio', interp: 'tail_ratio' },
  mdd: { field: 'max_drawdown_pct', label: 'Max Drawdown (période)', unit: '%', def: 'mdd', interp: 'mdd', color: 'red' },
  mean_dd: { field: 'mean_drawdown_pct', label: 'Drawdown moyen', unit: '%', def: 'mean_dd', interp: 'mean_dd', color: 'red' },
  current_dd: { field: 'current_drawdown_pct', label: 'Drawdown actuel (vs record)', unit: '%', def: 'current_dd', interp: 'current_dd', color: 'red' },
  recovery: { field: 'mean_time_to_recovery_days', label: 'Durée moyenne sous un record', unit: 'séances', def: 'recovery', interp: 'recovery', nd: 0 },
  ulcer: { field: 'ulcer_index', label: 'Ulcer Index', def: 'ulcer', interp: 'ulcer' },
  vol: { field: 'annualized_volatility_pct', label: 'Volatilité annualisée', unit: '%', def: 'vol', interp: 'vol' },
  downside_vol: { field: 'downside_volatility_pct', label: 'Volatilité baissière', unit: '%', def: 'downside_vol', interp: 'downside_vol' },
  var_h: { field: 'var_historical_pct', label: 'VaR historique 1 j', unit: '%', def: 'var_h', interp: 'var_h', color: 'amber', varLabel: true },
  var_p: { field: 'var_parametric_pct', label: 'VaR paramétrique 1 j', unit: '%', def: 'var_p', interp: 'var_p', color: 'amber', varLabel: true },
  cvar: { field: 'cvar_pct', label: 'CVaR 1 j', unit: '%', def: 'cvar', interp: 'cvar', color: 'amber', varLabel: true },
  beta: { field: 'beta', label: 'Bêta', def: 'beta', interp: 'beta' },
  alpha: { field: 'alpha_annual_pct', label: 'Alpha annualisé', unit: '%', def: 'alpha', interp: 'alpha', color: 'sign', signed: true },
  correlation: { field: 'correlation', label: 'Corrélation', def: 'correlation', interp: 'correlation' },
  r_squared: { field: 'r_squared', label: 'R²', unit: '%', def: 'r_squared', interp: 'r_squared', nd: 1 },
  tracking_error: { field: 'tracking_error_pct', label: 'Tracking error', unit: '%', def: 'tracking_error', interp: 'tracking_error' },
  information_ratio: { field: 'information_ratio', label: "Ratio d'information", def: 'information_ratio', interp: 'information_ratio' },
  up_capture: { field: 'up_capture_pct', label: 'Capture haussière', unit: '%', def: 'capture', interp: 'capture', nd: 0 },
  down_capture: { field: 'down_capture_pct', label: 'Capture baissière', unit: '%', def: 'capture', interp: 'capture', nd: 0 },
  skew: { field: 'skewness', label: 'Asymétrie (skewness)', def: 'skew', interp: 'skew' },
  kurt: { field: 'kurtosis', label: 'Excès de kurtosis', def: 'kurt', interp: 'kurt' },
  best_day: { field: 'max_daily_return_pct', label: 'Meilleure séance', unit: '%', def: 'best_day', interp: 'best_day', color: 'sign', signed: true },
  worst_day: { field: 'min_daily_return_pct', label: 'Pire séance', unit: '%', def: 'worst_day', interp: 'worst_day', color: 'sign', signed: true },
  mean_daily: { field: 'mean_daily_return_pct', label: 'Rendement moyen / séance', unit: '%', def: 'mean_daily', nd: 3, color: 'sign', signed: true },
  median_daily: { field: 'median_daily_return_pct', label: 'Rendement médian / séance', unit: '%', def: 'median_daily', nd: 3, color: 'sign', signed: true },
};

export const METRIC_TABS = [
  { id: 'overview', label: "Vue d'ensemble", keys: ['total_change', 'cagr', 'sharpe', 'sortino', 'vol', 'mdd', 'beta'] },
  { id: 'perf', label: 'Rendement / risque', keys: ['sharpe', 'sortino', 'calmar', 'omega', 'win_rate', 'positive_months', 'tail_ratio'] },
  { id: 'risk', label: 'Risque', keys: ['vol', 'downside_vol', 'mdd', 'mean_dd', 'current_dd', 'recovery', 'ulcer', 'var_h', 'var_p', 'cvar'] },
  { id: 'market', label: 'Vs indice de référence', keys: ['beta', 'alpha', 'correlation', 'r_squared', 'tracking_error', 'information_ratio', 'up_capture', 'down_capture'] },
  { id: 'distribution', label: 'Distribution', keys: ['skew', 'kurt', 'best_day', 'worst_day', 'mean_daily', 'median_daily', 'tail_ratio'] },
];

export const ASSET_CLASS_LABELS = {
  ACTION: 'Action', ETF: 'ETF', INDEX: 'Indice', CRYPTO: 'Crypto', FOREX: 'Forex', COMMODITY: 'Matière première',
};

// ---------------------------------------------------------------------------
// Screener : toutes les métriques filtrables
// ---------------------------------------------------------------------------
export const SCREENER_GROUPS = [
  {
    id: 'perf', label: 'Performance', metrics: [
      { key: 'perf_1m_pct', label: 'Perf. 1 mois', unit: '%', signed: true, def: 'Variation du cours sur 30 jours.' },
      { key: 'perf_3m_pct', label: 'Perf. 3 mois', unit: '%', signed: true, def: 'Variation du cours sur 3 mois.' },
      { key: 'perf_6m_pct', label: 'Perf. 6 mois', unit: '%', signed: true, def: 'Variation du cours sur 6 mois.' },
      { key: 'perf_ytd_pct', label: 'Perf. YTD', unit: '%', signed: true, def: 'Variation depuis le 1er janvier.' },
      { key: 'perf_1y_pct', label: 'Perf. 1 an', unit: '%', signed: true, def: 'Variation du cours sur 12 mois.' },
      { key: 'last_price', label: 'Dernier cours', unit: '', def: 'Dernier cours de clôture, dans la devise de cotation.' },
    ]
  },
  {
    id: 'ratios', label: 'Ratios rendement / risque', metrics: [
      { key: 'sharpe', label: 'Sharpe', def: DEFINITIONS.sharpe },
      { key: 'sortino', label: 'Sortino', def: DEFINITIONS.sortino },
      { key: 'calmar', label: 'Calmar', def: DEFINITIONS.calmar },
      { key: 'omega', label: 'Omega', def: DEFINITIONS.omega },
      { key: 'win_rate_pct', label: 'Séances positives', unit: '%', def: DEFINITIONS.win_rate },
    ]
  },
  {
    id: 'risk', label: 'Risque', metrics: [
      { key: 'annualized_volatility_pct', label: 'Volatilité', unit: '%', def: DEFINITIONS.vol },
      { key: 'downside_volatility_pct', label: 'Volatilité baissière', unit: '%', def: DEFINITIONS.downside_vol },
      { key: 'max_drawdown_pct', label: 'Max Drawdown', unit: '%', def: DEFINITIONS.mdd },
      { key: 'mean_drawdown_pct', label: 'Drawdown moyen', unit: '%', def: DEFINITIONS.mean_dd },
      { key: 'current_drawdown_pct', label: 'Distance au plus haut', unit: '%', def: DEFINITIONS.current_dd },
      { key: 'ulcer_index', label: 'Ulcer Index', def: DEFINITIONS.ulcer },
      { key: 'recovery_days', label: 'Durée moy. des baisses', unit: 'j', def: DEFINITIONS.recovery },
      { key: 'var_95_historical_pct', label: 'VaR 95 % hist.', unit: '%', def: DEFINITIONS.var_h },
      { key: 'var_95_parametric_pct', label: 'VaR 95 % param.', unit: '%', def: DEFINITIONS.var_p },
      { key: 'cvar_95_pct', label: 'CVaR 95 %', unit: '%', def: DEFINITIONS.cvar },
    ]
  },
  {
    id: 'market', label: 'Vs marché', metrics: [
      { key: 'beta', label: 'Bêta', def: DEFINITIONS.beta + ' Indice de référence : S&P 500 (US, ETF…), Stoxx 600 (Europe), Bitcoin (crypto).' },
      { key: 'alpha_annual_pct', label: 'Alpha', unit: '%', signed: true, def: DEFINITIONS.alpha },
      { key: 'correlation', label: 'Corrélation', def: DEFINITIONS.correlation },
    ]
  },
  {
    id: 'tech', label: 'Technique & liquidité', metrics: [
      { key: 'rsi_14', label: 'RSI 14', def: 'Relative Strength Index sur 14 séances (0 à 100). > 70 surachat, < 30 survente.' },
      { key: 'dist_ma50_pct', label: 'Écart MM50', unit: '%', signed: true, def: 'Écart entre le cours et sa moyenne mobile 50 séances (tendance de moyen terme).' },
      { key: 'dist_ma200_pct', label: 'Écart MM200', unit: '%', signed: true, def: 'Écart entre le cours et sa moyenne mobile 200 séances (tendance de fond).' },
      { key: 'atr_pct', label: 'ATR 14', unit: '%', def: "Amplitude moyenne d'une séance en % du cours (Average True Range)." },
      { key: 'avg_dollar_volume_m', label: 'Volume moyen / jour', unit: 'M', def: 'Montant moyen échangé par jour sur 3 mois, en millions de la devise de cotation.' },
    ]
  },
  {
    id: 'distribution', label: 'Distribution', metrics: [
      { key: 'skewness', label: 'Asymétrie', def: DEFINITIONS.skew },
      { key: 'kurtosis', label: 'Excès de kurtosis', def: DEFINITIONS.kurt },
      { key: 'best_day_pct', label: 'Meilleure séance', unit: '%', signed: true, def: DEFINITIONS.best_day },
      { key: 'worst_day_pct', label: 'Pire séance', unit: '%', signed: true, def: DEFINITIONS.worst_day },
    ]
  },
];

export const SCREENER_METRICS = Object.fromEntries(SCREENER_GROUPS.flatMap(g => g.metrics.map(m => [m.key, m])));

export const SCREENER_DEFAULT_COLUMNS = ['perf_1y_pct', 'annualized_volatility_pct', 'sharpe', 'sortino', 'max_drawdown_pct', 'beta', 'rsi_14'];

// Déplacé depuis views/BondsView.jsx (référencé par le dictionnaire anglais)
export const BOND_DEFS = {
  curve: "Courbe des taux : rendement des emprunts d'État américains selon leur durée. Normalement croissante (prêter longtemps est plus risqué). Inversée (taux courts > taux longs), elle a précédé la plupart des récessions américaines.",
  s10_2: "Écart entre le taux à 10 ans et le taux à 2 ans. Négatif = courbe inversée : le marché anticipe des baisses de taux, souvent à cause d'un ralentissement attendu.",
  credit: "Prime de risque (OAS) demandée aux entreprises par rapport aux emprunts d'État. Elle s'écarte quand les investisseurs craignent des faillites, et se resserre quand ils sont confiants.",
  price: "Prix de l'obligation, en % du nominal. Au-dessus de 100 : le coupon est supérieur aux taux du marché ; en dessous : il est inférieur.",
  ytm: "Rendement actuariel (YTM) : rendement annuel obtenu si l'on achète à ce prix, encaisse tous les coupons (réinvestis au même taux) et garde l'obligation jusqu'à l'échéance.",
  current: "Rendement courant : coupon annuel ÷ prix. Ignore le gain ou la perte à l'échéance (remboursement à 100).",
  macaulay: "Duration de Macaulay : durée de vie moyenne des flux, pondérée par leur valeur actuelle (en années).",
  modified: "Duration modifiée : variation approximative du prix (en %) pour une variation de 1 point des taux. 7 = le prix baisse d'environ 7 % si les taux montent de 1 %.",
  convexity: "Convexité : courbure de la relation prix/taux. Elle rend la baisse de prix (taux en hausse) un peu moins forte que la hausse de prix (taux en baisse).",
  dv01: "DV01 : variation du prix (pour le nominal saisi) quand les taux bougent de 0,01 % (1 point de base).",
};

// Déplacé depuis views/DerivativesView.jsx (référencé par le dictionnaire anglais)
export const GREEKS = {
  delta: "Delta : variation du prix de l'option quand le sous-jacent monte de 1. Un delta de 0,5 = l'option gagne 0,50 si l'action gagne 1. C'est aussi, grossièrement, la probabilité de finir dans la monnaie.",
  gamma: 'Gamma : vitesse à laquelle le delta change quand le sous-jacent bouge. Élevé près du strike et de l\'échéance.',
  vega: "Vega : variation du prix de l'option si la volatilité augmente de 1 point. Les options prennent de la valeur quand le marché s'agite.",
  theta: "Theta : perte de valeur par jour qui passe, toutes choses égales par ailleurs (« érosion du temps »). Un acheteur d'option la subit, un vendeur l'encaisse.",
  rho: "Rho : variation du prix de l'option si les taux d'intérêt augmentent de 1 point.",
  prob: "Probabilité, selon le modèle (monde « neutre au risque »), que l'option finisse dans la monnaie à l'échéance.",
};
