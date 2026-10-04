import { useCallback, useEffect, useMemo, useState } from 'react';
import { Minimize2, Moon, Sun, Search, Layers, SlidersHorizontal, CalendarDays, Landmark, Sigma } from 'lucide-react';
import AssetView from './views/AssetView';
import PortfolioView from './views/PortfolioView';
import ScreenerView from './views/ScreenerView';
import CalendarView from './views/CalendarView';
import BondsView from './views/BondsView';
import DerivativesView from './views/DerivativesView';
import { fetchCalendar } from './calendar';
import TradingViewChart from './components/TradingViewChart';
import { MonteCarloChart } from './components/MonteCarloCard';
import { horizonLabel, parseNum } from './format';
import { useLang } from './i18n';
import { FlagFR, FlagUK } from './components/Flags';
import Brand from './components/Brand';
import { useTheme, setTheme } from './theme';

const TABS = [
  { id: 'asset', label: 'Actif / ETF', icon: Search,
    about: 'Analysez une action, un ETF, un indice ou une crypto : performance, risque et projection.' },
  { id: 'portfolio', label: 'Portefeuille', icon: Layers,
    about: "Composez un portefeuille et voyez comment il se serait comporté dans le passé." },
  { id: 'screener', label: 'Screener', icon: SlidersHorizontal,
    about: 'Parcourez et filtrez des milliers d’actifs selon leur performance et leur risque.' },
  { id: 'calendar', label: 'Calendrier', icon: CalendarDays,
    about: 'Les annonces économiques qui peuvent faire bouger les marchés, heure par heure.' },
  { id: 'bonds', label: 'Obligations', icon: Landmark,
    about: "Les taux d'intérêt du moment et un calculateur de prix d'obligation." },
  { id: 'derivatives', label: 'Dérivés', icon: Sigma,
    about: "Comprenez le prix d'une option et testez une stratégie, sans engager d'argent." },
];

// Raccourcis clavier : Alt + 1…6 change d'onglet (Ctrl + chiffre est réservé par le navigateur aux onglets du navigateur)
const ALT_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌥' : 'Alt';
const isTyping = (el) => el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);

function Fullscreen({ view, onClose }) {
  const { t } = useLang();
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={view.kind === 'mc' ? t('Simulation Monte-Carlo') : t(view.title)}
      style={{ position: 'fixed', inset: 0, background: 'var(--panel)', zIndex: 9999, padding: 24, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{view.kind === 'mc' ? `${t('Simulation Monte-Carlo')} (${horizonLabel(view.forecastDays)})` : t(view.title)}</h2>
        <button type="button" className="btn" onClick={onClose} autoFocus><Minimize2 size={14} /> {t('Quitter le plein écran (Échap)')}</button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {view.kind === 'mc' ? <MonteCarloChart data={view.props.data} big /> : <TradingViewChart {...view.props} height={300} drawable
          drawKey={`${view.title}|${view.props.data?.[0]?.date}|${view.props.data?.length}`} />}
      </div>
    </div>
  );
}

export default function App() {
  // Date locale (toISOString donne la date UTC : la veille entre minuit et 2 h en France)
  const { t, lang, setLang } = useLang();
  const theme = useTheme();
  const today = useMemo(() => new Date().toLocaleDateString('sv-SE'), []);
  const [activeTab, setActiveTab] = useState('asset');
  const [varInput, setVarInput] = useState('95');
  const [forecastDays, setForecastDays] = useState('252');
  const [currency, setCurrency] = useState('€');
  const [fullscreen, setFullscreen] = useState(null);
  const [assetRequest, setAssetRequest] = useState(null);
  const [highToday, setHighToday] = useState(0);

  // Badge de l'onglet Calendrier : annonces à fort impact restant aujourd'hui
  useEffect(() => {
    const count = () => fetchCalendar().then(d => {
      const now = Date.now() / 1000, today = new Date().toLocaleDateString('sv-SE');
      setHighToday(d.events.filter(e => e.impact === 'High' && e.timestamp >= now && new Date(e.datetime).toLocaleDateString('sv-SE') === today).length);
    }).catch(() => {});
    count();
    const id = setInterval(count, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const confLevel = useCallback(() => {
    const v = parseNum(varInput);
    return Number.isFinite(v) && v >= 50 && v < 100 ? v / 100 : 0.95;
  }, [varInput]);

  const shared = useMemo(() => ({ today, varInput, setVarInput, confLevel, forecastDays, setForecastDays, currency, setCurrency }),
    [today, varInput, confLevel, forecastDays, currency]);
  const closeFullscreen = useCallback(() => setFullscreen(null), []);

  const current = TABS.find(x => x.id === activeTab) || TABS[0];

  const goTo = useCallback((id) => { setActiveTab(id); window.scrollTo({ top: 0 }); }, []);
  const [tip, setTip] = useState(null); // infobulle de l'onglet survolé : { index, left, bottom }
  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-6]$/.test(e.code)) {
        e.preventDefault();
        goTo(TABS[Number(e.code.slice(5)) - 1].id);
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(document.activeElement)) {
        // « / » : place le curseur dans le champ de recherche de l'onglet affiché
        const input = document.querySelector('[data-view]:not([hidden]) input[role="combobox"], [data-view]:not([hidden]) input[type="text"]');
        if (input) { e.preventDefault(); input.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo]);
  const showTip = (index) => (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ index, left: Math.min(Math.max(r.left + r.width / 2, 110), window.innerWidth - 110), bottom: window.innerHeight - r.top + 8 });
  };

  const openCalendar = useCallback(() => { setActiveTab('calendar'); window.scrollTo({ top: 0 }); }, []);

  const analyzeFromScreener = useCallback((ticker) => {
    setAssetRequest({ ticker, at: Date.now() });
    setActiveTab('asset');
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <div className="app-shell">
      {fullscreen && <Fullscreen view={fullscreen} onClose={closeFullscreen} />}

      <header className="topbar">
        <div className="titlebar">
          <Brand section={t(current.label)} onHome={() => goTo('asset')} />
          <button type="button" className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={t(theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre')} aria-label={t(theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre')}>
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <div className="lang-switch" role="group" aria-label={t('Langue')}>
            <button type="button" className={lang === 'fr' ? 'on' : ''} onClick={() => setLang('fr')} title="Français" aria-pressed={lang === 'fr'}><FlagFR /></button>
            <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')} title="English" aria-pressed={lang === 'en'}><FlagUK /></button>
          </div>
        </div>
        {/* Une phrase qui dit à quoi sert l'onglet actif */}
        <div className="formula-bar">
          <p className="formula-about">{t(current.about)}</p>
        </div>
      </header>

      {/* Les onglets restent montés : on retrouve son analyse en revenant sur un onglet */}
      <div data-view="asset" hidden={activeTab !== 'asset'}><AssetView shared={shared} externalRequest={assetRequest} onFullscreen={setFullscreen} onOpenCalendar={openCalendar} /></div>
      <div data-view="portfolio" hidden={activeTab !== 'portfolio'}><PortfolioView shared={shared} onFullscreen={setFullscreen} onOpenCalendar={openCalendar} /></div>
      <div data-view="screener" hidden={activeTab !== 'screener'}><ScreenerView active={activeTab === 'screener'} onAnalyze={analyzeFromScreener} /></div>
      <div data-view="bonds" hidden={activeTab !== 'bonds'}><BondsView active={activeTab === 'bonds'} onAnalyze={analyzeFromScreener} /></div>
      <div data-view="derivatives" hidden={activeTab !== 'derivatives'}><DerivativesView onAnalyze={analyzeFromScreener} /></div>
      <div data-view="calendar" hidden={activeTab !== 'calendar'}><CalendarView active={activeTab === 'calendar'} onAnalyze={analyzeFromScreener} /></div>

      <nav className="sheet-tabs" aria-label={t('Sections')}>
        {TABS.map((tab, i) => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} type="button" className={activeTab === tab.id ? 'on' : ''} aria-current={activeTab === tab.id ? 'page' : undefined}
              aria-keyshortcuts={`Alt+${i + 1}`} onMouseEnter={showTip(i)} onMouseLeave={() => setTip(null)} onFocus={showTip(i)} onBlur={() => setTip(null)}
              onClick={() => { goTo(tab.id); setTip(null); }}>
              <Icon size={14} aria-hidden="true" /> <span className="sheet-tab-label">{t(tab.label)}</span>
              {tab.id === 'calendar' && highToday > 0 && <span className="nav-badge" title={t("Annonces à fort impact restant aujourd'hui")} aria-label={`${highToday} · ${t("Annonces à fort impact restant aujourd'hui")}`}>{highToday}</span>}
            </button>
          );
        })}
      </nav>
      {tip && (
        <div className="tab-tip" role="tooltip" style={{ left: tip.left, bottom: tip.bottom }}>
          <span>{t(TABS[tip.index].about)}</span>
          <span className="tab-tip-keys"><kbd>{ALT_KEY}</kbd> + <kbd>{tip.index + 1}</kbd>{TABS[tip.index].id !== 'bonds' && <> · {t('recherche')} <kbd>/</kbd></>}</span>
        </div>
      )}
    </div>
  );
}
