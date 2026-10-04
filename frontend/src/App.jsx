import { useCallback, useEffect, useMemo, useState } from 'react';
import { Minimize2, ChartLine, Search, Layers, SlidersHorizontal, CalendarDays, Landmark, Sigma } from 'lucide-react';
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

const TABS = [
  { id: 'asset', label: 'Actif / ETF', icon: Search },
  { id: 'portfolio', label: 'Portefeuille', icon: Layers },
  { id: 'screener', label: 'Screener', icon: SlidersHorizontal },
  { id: 'calendar', label: 'Calendrier', icon: CalendarDays },
  { id: 'bonds', label: 'Obligations', icon: Landmark },
  { id: 'derivatives', label: 'Dérivés', icon: Sigma },
];

function Fullscreen({ view, onClose }) {
  const { t } = useLang();
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 9999, padding: 24, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{view.kind === 'mc' ? `${t('Simulation Monte-Carlo')} (${horizonLabel(view.forecastDays)})` : t(view.title)}</h2>
        <button type="button" className="btn" onClick={onClose}><Minimize2 size={14} /> {t('Quitter le plein écran (Échap)')}</button>
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
        <div className="brand">
          <span className="brand-mark"><ChartLine size={16} /></span>
          <span className="brand-name">{t('Analyse de portefeuille')}</span>
        </div>
        <nav className="nav-tabs" aria-label="Sections">
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} type="button" className={activeTab === tab.id ? 'on' : ''} aria-current={activeTab === tab.id ? 'page' : undefined}
                onClick={() => setActiveTab(tab.id)}>
                <Icon size={14} /> {t(tab.label)}
                {tab.id === 'calendar' && highToday > 0 && <span className="nav-badge" title={t('Annonces à fort impact restant aujourd\'hui')}>{highToday}</span>}
              </button>
            );
          })}
        </nav>
        <div className="lang-switch" role="group" aria-label={t('Langue')}>
          <button type="button" className={lang === 'fr' ? 'on' : ''} onClick={() => setLang('fr')} title="Français" aria-pressed={lang === 'fr'}><FlagFR /></button>
          <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')} title="English" aria-pressed={lang === 'en'}><FlagUK /></button>
        </div>
      </header>

      {/* Les onglets restent montés : on retrouve son analyse en revenant sur un onglet */}
      <div hidden={activeTab !== 'asset'}><AssetView shared={shared} externalRequest={assetRequest} onFullscreen={setFullscreen} onOpenCalendar={openCalendar} /></div>
      <div hidden={activeTab !== 'portfolio'}><PortfolioView shared={shared} onFullscreen={setFullscreen} onOpenCalendar={openCalendar} /></div>
      <div hidden={activeTab !== 'screener'}><ScreenerView active={activeTab === 'screener'} onAnalyze={analyzeFromScreener} /></div>
      <div hidden={activeTab !== 'bonds'}><BondsView active={activeTab === 'bonds'} onAnalyze={analyzeFromScreener} /></div>
      <div hidden={activeTab !== 'derivatives'}><DerivativesView onAnalyze={analyzeFromScreener} /></div>
      <div hidden={activeTab !== 'calendar'}><CalendarView active={activeTab === 'calendar'} onAnalyze={analyzeFromScreener} /></div>
    </div>
  );
}
