import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { getAsset, searchAssets, DEFAULT_SUGGESTIONS, ASSET_DATABASE } from '../tickerDatabase';
import { TAG_COLORS, fmtInt } from '../format';
import { useLang, trName } from '../i18n';

/** Ticker correspondant exactement au texte tapé (symbole ou nom complet), sinon le texte tel quel en majuscules. */
function resolveTicker(val) {
  const q = val.trim();
  if (!q) return '';
  const byTicker = getAsset(q);
  if (byTicker) return byTicker.ticker;
  const byName = searchAssets(q, 8).find(a => a.name.toLowerCase() === q.toLowerCase());
  return byName ? byName.ticker : q.toUpperCase();
}

/**
 * Champ de recherche d'actif. `value` = ticker ; affiche le nom si l'actif est connu.
 * onChange(ticker) à chaque frappe (le texte tapé n'est JAMAIS remplacé pendant la saisie),
 * onSelect(ticker) au choix explicite d'une suggestion (clic ou flèches + Entrée),
 * onEnter() sur Entrée sans suggestion surlignée : le symbole tapé est conservé tel quel.
 * Champ vide + focus : suggestions populaires sous un titre explicite. Champ rempli + focus : liste fermée.
 */
export default function AssetSearchInput({ value, onChange, onSelect, onEnter, placeholder = 'Nom ou symbole…', autoFocus = false }) {
  const { t } = useLang();
  const [text, setText] = useState(() => getAsset(value)?.name ?? value ?? '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapperRef = useRef(null);
  const listRef = useRef(null);

  // Dernier ticker connu de ce champ (émis par la frappe/sélection, ou reçu du parent).
  // Si le parent envoie un ticker différent (raccourci, screener, modèle…), on met l'affichage à jour ;
  // s'il renvoie simplement ce que l'on vient d'émettre, on ne touche pas au texte en cours de saisie.
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setText(getAsset(value)?.name ?? value ?? '');
  }

  useEffect(() => {
    const close = (e) => { if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    if (active >= 0 && listRef.current) listRef.current.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // explicit=true (flèche bas) : on montre aussi les suggestions par défaut quand le champ est vide
  const refresh = (val, explicit = false) => {
    const next = val.trim() ? searchAssets(val, 8) : DEFAULT_SUGGESTIONS;
    setResults(next);
    setActive(-1);
    setOpen(explicit || Boolean(val.trim()));
    return next;
  };

  const emit = (ticker) => {
    setSyncedValue(ticker);
    onChange?.(ticker);
  };

  const handleChange = (e) => {
    const val = e.target.value;
    setText(val);
    emit(resolveTicker(val));
    refresh(val);
  };

  const choose = (item) => {
    setText(item.name);
    setOpen(false);
    setActive(-1);
    setSyncedValue(item.ticker);
    if (onSelect) onSelect(item.ticker);
    else onChange?.(item.ticker);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const list = open ? results : refresh(text, true);
      setActive(a => Math.min((open ? a : -1) + 1, list.length - 1));
    }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, -1)); }
    else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Tab') setOpen(false);
    else if (e.key === 'Enter') {
      // Seule une suggestion explicitement surlignée (flèches) est choisie ; sinon on garde exactement ce qui est tapé
      if (open && active >= 0 && results[active]) { e.preventDefault(); choose(results[active]); }
      else { setOpen(false); onEnter?.(); }
    }
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      <input type="text" value={text} placeholder={t(placeholder)} autoFocus={autoFocus}
        onChange={handleChange} onFocus={(e) => { e.target.select(); if (!text.trim()) refresh('', true); }} onBlur={() => setOpen(false)} onKeyDown={handleKeyDown}
        style={{ width: '100%' }} spellCheck={false} autoComplete="off" />

      {open && (
        // mousedown neutralisé : cliquer dans la liste (suggestion, barre de défilement, lien) ne fait pas perdre le focus
        <div onMouseDown={(e) => e.preventDefault()} style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, width: 'max(100%, 320px)', maxWidth: '90vw',
          background: 'var(--panel-2)', border: '1px solid var(--border-2)', borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,.7)', zIndex: 1000,
        }}>
          {!text.trim() && <div style={{ padding: '7px 12px 5px', fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>{t('Suggestions populaires')}</div>}
          <div ref={listRef} style={{ maxHeight: 300, overflowY: 'auto' }}>
            {results.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--muted-2)' }}>
                {t('Aucun résultat dans la bibliothèque. Le symbole « {s} » sera utilisé tel quel.', { s: text.trim().toUpperCase() })}
              </div>
            )}
            {results.map((item, i) => {
              const c = TAG_COLORS[item.category] || '#94a3b8';
              return (
                <div key={item.ticker} onMouseDown={(e) => { e.preventDefault(); choose(item); }} onMouseEnter={() => setActive(i)}
                  style={{ padding: '7px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: i === active ? 'var(--raised)' : 'transparent' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
                    <strong style={{ color: '#fff', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trName(item.name)}</strong>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: `${c}22`, color: c, border: `1px solid ${c}44`, flexShrink: 0 }}>{t(item.category)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 1 }}>
                    <span style={{ color: 'var(--accent-text)', fontWeight: 600 }}>{item.ticker}</span>
                    {item.country && <span> · {t(item.country)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ padding: '6px 12px', background: 'var(--input)', borderTop: '1px solid var(--border)', fontSize: 11, color: '#64748b', display: 'flex', justifyContent: 'space-between', borderRadius: '0 0 6px 6px' }}>
            <span>{t('{n} actifs · ↑↓ Entrée', { n: fmtInt(ASSET_DATABASE.length) })}</span>
            <a href="https://finance.yahoo.com/lookup" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-text)', textDecoration: 'none' }}>
              {t('Autre symbole sur Yahoo')} <ExternalLink size={10} style={{ display: 'inline' }} />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
