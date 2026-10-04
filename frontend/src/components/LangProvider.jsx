import { useCallback, useMemo, useState } from 'react';
import { LangContext, setCurrentLang, initialLang, tr } from '../i18n';

/** Fournit la langue courante ; changer de langue re-rend tous les composants qui utilisent useLang(). */
export default function LangProvider({ children }) {
  const [lang, setLangState] = useState(initialLang);
  const setLang = useCallback((l) => {
    setCurrentLang(l);
    setLangState(l);
  }, []);
  // `t` change d'identité avec la langue : les composants mémorisés qui l'utilisent se mettent à jour
  const value = useMemo(() => ({ lang, setLang, t: (fr, vars) => tr(fr, vars) }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}
