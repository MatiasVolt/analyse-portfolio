import { memo, useEffect, useState } from 'react';
import axios from 'axios';
import { Landmark, ExternalLink } from 'lucide-react';
import { HelpButtons } from './ui';
import { API, fmt, fmtDate } from '../format';
import { useLang } from '../i18n';

const DEFINITION = "Le taux directeur est le taux que fixe une banque centrale pour prêter aux banques ou rémunérer leurs dépôts. C'est son principal outil : en le montant, elle renchérit le crédit pour freiner l'inflation ; en le baissant, elle le rend moins cher pour soutenir l'économie. Il se répercute sur les crédits, l'épargne, les obligations et le cours des devises.";

/** Jours restants avant une date (arrondi au jour). */
const daysUntil = (iso) => Math.max(0, Math.round((new Date(iso) - Date.now()) / 86400000));

/**
 * Taux directeurs des grandes banques centrales : taux en vigueur, dernière décision, dernier changement, prochaine réunion.
 * Les décisions viennent du calendrier économique : ce sont les annonces d'importance maximale.
 */
function PolicyRates({ active, onOpenCalendar }) {
  const { t, lang } = useLang();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    axios.get(`${API}/api/policy-rates`)
      .then(r => { if (alive) { setData(r.data); setError(null); } })
      .catch(e => alive && setError(e.response?.data?.detail || t('Le service de données ne répond pas pour le moment. Réessayez dans un instant.')));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, lang]);

  if (error) return <div className="panel hint" style={{ marginBottom: 16 }}>{t('Taux directeurs')} : {error}</div>;
  if (!data) return null;

  const move = (v) => (v > 0 ? t('hausse de {x} pt', { x: fmt(v, 2) }) : v < 0 ? t('baisse de {x} pt', { x: fmt(-v, 2) }) : t('inchangé'));
  const since = data.history_start ? fmtDate(data.history_start) : null;

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head">
        <h3 className="section-title"><Landmark size={15} /> {t('Taux directeurs des banques centrales')} <HelpButtons definition={DEFINITION} /></h3>
        <span className="hint">
          {t('source')} {data.source} · {t('données du {d}', { d: data.updated })}{data.stale ? ` · ${t('copie locale')}` : ''}
          {onOpenCalendar && <> · <button type="button" className="link-btn" onClick={onOpenCalendar}>{t('Voir les réunions dans le calendrier')}</button></>}
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table policy-table">
          <thead>
            <tr>
              <th>{t('Banque centrale')}</th><th>{t('Devise')}</th><th className="num">{t('Taux actuel')}</th>
              <th>{t('Dernière décision')}</th><th>{t('Dernier changement')}</th><th>{t('Prochaine réunion')}</th>
            </tr>
          </thead>
          <tbody>
            {data.banks.map(b => {
              const d = b.last_decision, c = b.last_change, n = b.next_meeting;
              const tone = d.change > 0 ? 'var(--red)' : d.change < 0 ? 'var(--green)' : 'var(--muted-2)';
              return (
                <tr key={b.code}>
                  <td style={{ whiteSpace: 'normal' }}>
                    <strong>{b.name}</strong>
                    {b.publisher_url && <a href={b.publisher_url} target="_blank" rel="noreferrer" className="policy-link" aria-label={t('Site de {s}', { s: b.name })} title={t('Site de {s}', { s: b.name })}><ExternalLink size={11} /></a>}
                    <div className="hint">{b.note}</div>
                  </td>
                  <td><span className="ccy">{b.currency}</span></td>
                  <td className="num"><strong className="policy-rate">{fmt(b.rate, 2)} %</strong></td>
                  <td>
                    {fmtDate(d.date.slice(0, 10))}
                    <div className="hint" style={{ color: tone }}>{d.change === null ? '—' : move(d.change)}</div>
                  </td>
                  <td>
                    {c ? <>{fmtDate(c.date.slice(0, 10))}<div className="hint">{t('de {a} % à {b} %', { a: fmt(c.from, 2), b: fmt(c.to, 2) })}</div></>
                      : <span className="hint">{since ? t('aucun depuis le {d} au moins', { d: since }) : '—'}</span>}
                  </td>
                  <td>
                    {n ? <>{fmtDate(n.date.slice(0, 10))}
                      <div className="hint">{t('dans {n} j', { n: daysUntil(n.date) })}{n.forecast != null ? ` · ${t('prévision : {f} %', { f: fmt(n.forecast, 2) })}` : ''}</div></>
                      : <span className="hint">{t('pas encore annoncée par la source')}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ margin: '10px 0 0' }}>
        {t('En rouge : la banque a monté son taux (crédit plus cher) ; en vert : elle l’a baissé. Les décisions sont lues depuis le {d} : un « dernier changement » plus ancien n’apparaît pas. Pour la Fed, le taux affiché est le haut de sa fourchette cible (large de 0,25 point).', { d: since || '—' })}
      </p>
    </div>
  );
}

export default memo(PolicyRates);
