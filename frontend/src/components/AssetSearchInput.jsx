import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { getAsset, searchAssets, DEFAULT_SUGGESTIONS, ASSET_DATABASE } from '../tickerDatabase';
import { TAG_COLORS } from '../format';

/**
 * Champ de recherche d'actif. `value` = ticker ; affiche le nom si l'actif est connu.
 * onChange(ticker) à chaque frappe, onSelect(ticker) au choix d'une suggestion, onEnter() sur Entrée sans suggestion active.
 */
export default function AssetSearchInput({ value, onChange, onSelect, onEnter, placeholder = 'Nom ou symbole…', autoFocus = false }) {
  const [text, setText] = useState(() => getAsset(value)?.name ?? value ?? '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapperRef = useRef(null);
  const listRef = useRef(null);

  // Synchronise l'affichage si le ticker change de l'extérieur (raccourci, screener, modèle…)
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    const asset = getAsset(value);
    if (asset) setText(asset.name);
    else if (text.trim().toUpperCase() !== (value || '').toUpperCase()) setText(value || '');
  }

  useEffect(() => {
    const close = (e) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    if (active >= 0 && listRef.current) listRef.current.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const refresh = (val) => {
    setResults(val.trim() ? searchAssets(val, 8) : DEFAULT_SUGGESTIONS);
    setActive(-1);
    setOpen(true);
  };

  const handleChange = (e) => {
    const val = e.target.value;
    setText(val);
    const exact = searchAssets(val, 1)[0];
    const isExact = exact && (exact.name.toLowerCase() === val.trim().toLowerCase() || exact.ticker.toLowerCase() === val.trim().toLowerCase());
    onChange?.(isExact ? exact.ticker : val.trim().toUpperCase());
    refresh(val);
  };

  const choose = (item) => {
    setText(item.name);
    setOpen(false);
    onChange?.(item.ticker);
    onSelect?.(item.ticker);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) refresh(text); setActive(a => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, -1)); }
    else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Enter') {
      // Entrée sans sélection : on prend la meilleure suggestion (ex. « CW8 » -> CW8.PA) ; sinon le symbole tapé tel quel
      const pickIdx = active >= 0 ? active : 0;
      if (open && text.trim() && results[pickIdx]) { e.preventDefault(); choose(results[pickIdx]); }
      else { setOpen(false); onEnter?.(); }
    }
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      <input type="text" value={text} placeholder={placeholder} autoFocus={autoFocus}
        onChange={handleChange} onFocus={(e) => { e.target.select(); refresh(text); }} onKeyDown={handleKeyDown}
        style={{ width: '100%' }} spellCheck={false} autoComplete="off" />

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, width: 'max(100%, 320px)', maxWidth: '90vw',
          background: '#0e1626', border: '1px solid #334155', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,.7)', zIndex: 1000,
        }}>
          <div ref={listRef} style={{ maxHeight: 300, overflowY: 'auto' }}>
            {results.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--muted-2)' }}>
                Aucun résultat dans la bibliothèque. Appuyez sur Entrée pour utiliser « {text.trim().toUpperCase()} » tel quel.
              </div>
            )}
            {results.map((item, i) => {
              const c = TAG_COLORS[item.category] || '#94a3b8';
              return (
                <div key={item.ticker} onMouseDown={(e) => { e.preventDefault(); choose(item); }} onMouseEnter={() => setActive(i)}
                  style={{ padding: '7px 12px', cursor: 'pointer', borderBottom: '1px solid #1e222d', background: i === active ? '#1e2a44' : 'transparent' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
                    <strong style={{ color: '#fff', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</strong>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: `${c}22`, color: c, border: `1px solid ${c}44`, flexShrink: 0 }}>{item.category}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 1 }}>
                    <span style={{ color: '#38bdf8', fontWeight: 600 }}>{item.ticker}</span>
                    {item.country && <span> · {item.country}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ padding: '6px 12px', background: '#090d16', borderTop: '1px solid #1e222d', fontSize: 11, color: '#64748b', display: 'flex', justifyContent: 'space-between', borderRadius: '0 0 6px 6px' }}>
            <span>{ASSET_DATABASE.length.toLocaleString('fr-FR')} actifs · ↑↓ Entrée</span>
            <a href="https://finance.yahoo.com/lookup" target="_blank" rel="noreferrer" style={{ color: '#38bdf8', textDecoration: 'none' }}>
              Autre symbole sur Yahoo <ExternalLink size={10} style={{ display: 'inline' }} />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
