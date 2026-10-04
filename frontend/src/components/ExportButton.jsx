import { useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { useLang } from '../i18n';

/** Bouton « Télécharger le tableur » : lance un export .xlsx et affiche l'état pendant la génération. */
export default function ExportButton({ onExport, label = 'Télécharger le tableur', labelVars, disabled = false, small = false }) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async () => {
    setBusy(true); setError(null);
    try { await onExport(); } catch (e) { console.error(e); setError(e?.message && e.message !== 'Network Error' ? e.message : t("L'export a échoué. Réessayez.")); }
    finally { setBusy(false); }
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button type="button" className={`btn btn-export${small ? ' btn-sm' : ''}`} onClick={run} disabled={busy || disabled} title={t('Fichier .xlsx avec toutes les données de cette section')}>
        {busy ? <Loader2 size={14} className="spin" /> : <FileSpreadsheet size={14} />} {t(label, labelVars)}
      </button>
      {error && <span className="hint" style={{ color: 'var(--red)' }}>{error}</span>}
    </span>
  );
}
