import { useCallback, useEffect, useMemo, useState } from 'react';
import { Minimize2 } from 'lucide-react';
import AssetView from './views/AssetView';
import PortfolioView from './views/PortfolioView';
import ScreenerView from './views/ScreenerView';
import TradingViewChart from './components/TradingViewChart';
import { MonteCarloChart } from './components/MonteCarloCard';
import { horizonLabel, parseNum } from './format';

const TABS = [
  { id: 'asset', label: 'Actif / ETF' },
  { id: 'portfolio', label: 'Portefeuille' },
  { id: 'screener', label: 'Screener' },
];

function Fullscreen({ view, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 9999, padding: 24, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{view.kind === 'mc' ? `Simulation Monte-Carlo (${horizonLabel(view.forecastDays)})` : view.title}</h2>
        <button type="button" className="btn" onClick={onClose}><Minimize2 size={14} /> Quitter le plein écran (Échap)</button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {view.kind === 'mc' ? <MonteCarloChart data={view.props.data} big /> : <TradingViewChart {...view.props} height={300} />}
      </div>
    </div>
  );
}

export default function App() {
  const today = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [activeTab, setActiveTab] = useState('asset');
  const [varInput, setVarInput] = useState('95');
  const [forecastDays, setForecastDays] = useState('252');
  const [currency, setCurrency] = useState('€');
  const [fullscreen, setFullscreen] = useState(null);
  const [assetRequest, setAssetRequest] = useState(null);

  const confLevel = useCallback(() => {
    const v = parseNum(varInput);
    return Number.isFinite(v) && v >= 50 && v < 100 ? v / 100 : 0.95;
  }, [varInput]);

  const shared = useMemo(() => ({ today, varInput, setVarInput, confLevel, forecastDays, setForecastDays, currency, setCurrency }),
    [today, varInput, confLevel, forecastDays, currency]);
  const closeFullscreen = useCallback(() => setFullscreen(null), []);

  const analyzeFromScreener = useCallback((ticker) => {
    setAssetRequest({ ticker, at: Date.now() });
    setActiveTab('asset');
    window.scrollTo({ top: 0 });
  }, []);

  return (
    <div style={{ padding: '0 24px 24px', minHeight: '100vh' }}>
      {fullscreen && <Fullscreen view={fullscreen} onClose={closeFullscreen} />}

      <div style={{
        position: 'sticky', top: 0, zIndex: 100, background: '#0d1117f2', backdropFilter: 'blur(8px)',
        borderBottom: '1px solid #21262d', padding: '14px 0 12px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {TABS.map(t => (
            <button key={t.id} type="button" onClick={() => setActiveTab(t.id)} style={{
              padding: '7px 16px', borderRadius: 6, border: 'none', fontWeight: 600, fontSize: 13,
              background: activeTab === t.id ? 'var(--accent)' : 'var(--panel-2)', color: activeTab === t.id ? '#fff' : 'var(--muted)',
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* Les onglets restent montés : on retrouve son analyse en revenant sur un onglet */}
      <div hidden={activeTab !== 'asset'}><AssetView shared={shared} externalRequest={assetRequest} onFullscreen={setFullscreen} /></div>
      <div hidden={activeTab !== 'portfolio'}><PortfolioView shared={shared} onFullscreen={setFullscreen} /></div>
      <div hidden={activeTab !== 'screener'}><ScreenerView active={activeTab === 'screener'} onAnalyze={analyzeFromScreener} /></div>
    </div>
  );
}
