# The Yield Is Yours

Site d'analyse de marchés : actions, ETF, indices, crypto, devises, portefeuilles, obligations et options.
Chaque chiffre affiché est accompagné de sa définition et d'une phrase d'interprétation. Interface en français et en anglais.

## Ce que fait le site

| Onglet | Contenu |
|---|---|
| Bien démarrer | Repères historiques calculés sur les cours réels du S&P 500 depuis fin 1927 et de grandes familles de placements depuis 2008 |
| Actif / ETF | Performance, risque (volatilité, drawdown, VaR, CVaR), comparaison à un indice de référence, projection Monte-Carlo |
| Portefeuille | Simulation historique d'un portefeuille, contribution de chaque ligne au rendement et au risque, frontière efficiente |
| Screener | Filtrage d’environ 2 600 actifs sur 34 indicateurs |
| Calendrier | Annonces économiques, importance de 1 à 5, lecture de l'écart à la prévision, réaction mesurée des marchés |
| Obligations | Taux directeurs des banques centrales, courbes de taux et calculateur (prix, duration, convexité) |
| Dérivés | Black-Scholes, grecques, stratégies d'options |
| Calculatrice | Épargne, crédit, rendements, taille de position, taux, VAN / TRI |

## Méthode et limites

- **Cours** : Yahoo Finance, ajustés des dividendes et des divisions d'actions. Les indices sont des indices de prix (hors dividendes).
- **Devise** : chaque actif est analysé dans sa devise de cotation, ou converti en euros ou en dollars au taux de change de clôture de chaque jour. Un portefeuille est toujours calculé dans une seule devise.
- **Taux sans risque** : taux de marché de la devise d'analyse (source FRED : bon du Trésor US à 3 mois, taux de dépôt de la BCE…), modifiable à la main.
- **Annualisation** : 252 séances par an, 365 pour un actif qui cote tous les jours (crypto).
- **Ratio de Sharpe** : calculé sur la moyenne arithmétique des rendements par séance, pas sur le CAGR.
- **Monte-Carlo** : mouvement brownien géométrique calibré sur l'historique. Ce n'est pas une prévision.
- **Options** : modèle de Black-Scholes (options européennes).
- **Calendrier** : annonces fournies par TradingView (secours : Forex Factory). L'importance de 1 à 5 est une échelle propre au site (type d'indicateur × poids de la zone économique).
- Le site est un outil pédagogique, pas un conseil en investissement.

## Lancer le projet en local

Prérequis : Python 3.11 ou plus récent, Node.js 20 ou plus récent.

```bash
# API (port 8000)
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt      # Linux / macOS : .venv/bin/pip
.venv/Scripts/python -m uvicorn api:app --port 8000

# Site (port 5173), dans un second terminal
cd frontend
npm install
npm run dev
```

Le site appelle l'API sur `http://127.0.0.1:8000` ; une autre adresse se règle avec la variable `VITE_API_URL`.

## Organisation du code

| Fichier | Rôle |
|---|---|
| `api.py` | Routes de l'API (FastAPI), téléchargement des cours, conversion de devise |
| `backend.py` | Calcul des indicateurs, phrases d'interprétation, Monte-Carlo, portefeuille |
| `risk_free.py` | Taux sans risque par devise |
| `econ_calendar.py` | Calendrier économique : importance, explications |
| `policy_rates.py` | Taux directeurs des banques centrales |
| `fixed_income.py`, `frontier.py`, `guide.py`, `report.py` | Obligations et options, frontière efficiente, repères historiques, export Excel |
| `universe.py`, `update_screener.py` | Liste des actifs et mise à jour des données du screener |
| `frontend/src/views/` | Un fichier par onglet |
| `frontend/src/finance/` | Formules obligations, options et calculatrice |
| `deploy/` | Scripts d'installation et de mise à jour du serveur |
