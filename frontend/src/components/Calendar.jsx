import { useEffect, useState } from 'react';
import { CalendarDays, ArrowRight, ChevronRight } from 'lucide-react';
import { impactOf, eventTime, dayLabel, eventDayKey, fetchCalendar, countdown } from '../calendar';
import { fmt, fmtDate } from '../format';
import { useLang, tr } from '../i18n';

export function ImpactBadge({ impact, compact = false }) {
  const m = impactOf(impact);
  return (
    <span className="impact" style={{ '--impact': m.color }} title={tr('Impact {x}', { x: m.label.toLowerCase() })}>
      <span className="impact-bars">
        {[1, 2, 3].map(i => <i key={i} className={i <= m.rank ? 'on' : ''} />)}
      </span>
      {!compact && m.label}
    </span>
  );
}

/** Variation d'un actif le jour d'une annonce, comparée à sa variation un jour normal. */
export function ReactionChip({ r, onAnalyze }) {
  const unusual = r.vs_normal !== null && r.vs_normal >= 1.5;
  const name = tr(r.name);
  const day = tr('Le {date}, jour de l’annonce, {name} a varié de {chg} %.', { date: fmtDate(r.date), name, chg: fmt(r.change_pct, 2, true) });
  const normal = r.vs_normal === null ? ''
    : r.normal_pct != null
      ? ` ${tr(r.vs_normal >= 1
        ? 'Un jour normal, il bouge d’environ {n} % (variation médiane des 60 dernières séances) : ce mouvement est donc {x} fois plus fort que d’habitude.'
        : 'Un jour normal, il bouge d’environ {n} % (variation médiane des 60 dernières séances) : ce jour-là, il a donc moins bougé que d’habitude ({x} fois la normale).', { n: fmt(r.normal_pct, 2), x: fmt(r.vs_normal, 1) })}`
      : ` ${tr('Ce mouvement vaut {x} fois la variation d’un jour normal.', { x: fmt(r.vs_normal, 1) })}`;
  return (
    <button type="button" className={`reaction ${unusual ? 'unusual' : ''}`} onClick={onAnalyze ? () => onAnalyze(r.ticker) : undefined}
      title={day + normal + (onAnalyze ? ` ${tr('Cliquer pour analyser {name}.', { name })}` : '')}>
      <span className="reaction-name">{name}</span>
      <span style={{ color: r.change_pct >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(r.change_pct, 2, true)} %</span>
      {r.vs_normal !== null && <span className="reaction-x">{tr('{x}× la normale', { x: fmt(r.vs_normal, 1) })}</span>}
    </button>
  );
}

/**
 * Panneau compact affiché sous une analyse d'actif ou de portefeuille :
 * annonces fortes/moyennes de la semaine dans les devises qui pilotent ces actifs.
 */
export function EventsPanel({ tickers, weights, title, onOpenCalendar }) {
  const [data, setData] = useState(null);
  const { t, lang } = useLang();
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [reload, setReload] = useState(0);
  const [openId, setOpenId] = useState(null); // annonce dépliée (détail : pourquoi c'est important, réaction)

  // Rechargement toutes les 30 min : de nouvelles annonces entrent dans la fenêtre, les chiffres publiés arrivent
  useEffect(() => {
    const id = setInterval(() => { setReload(r => r + 1); setNow(Date.now() / 1000); }, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, []);
  const key = (tickers || []).join(',');
  const wkey = (weights || []).join(',');

  useEffect(() => {
    if (!key) return;
    let alive = true;
    fetchCalendar({ tickers: key, ...(wkey ? { weights: wkey } : {}) })
      .then(d => alive && setData(d))
      .catch(err => alive && setError(err.response?.data?.detail || tr('Calendrier indisponible.')));
    return () => { alive = false; };
  }, [key, wkey, lang, reload]);

  if (error) return null; // le calendrier est un complément : on ne bloque pas l'analyse
  if (!data) return null;

  const relevant = data.events.filter(e => e.impact === 'High' || e.impact === 'Medium');
  const upcoming = relevant.filter(e => e.timestamp >= now);
  const past = relevant.filter(e => e.timestamp < now && e.reaction?.length)
    .sort((a, b) => Math.max(...b.reaction.map(r => r.vs_normal || 0)) - Math.max(...a.reaction.map(r => r.vs_normal || 0)));
  // À venir (la plus proche en haut), puis passées les plus marquantes (la plus récente en haut)
  const list = [...upcoming.slice(0, 5), ...past.slice(0, Math.max(0, 6 - Math.min(upcoming.length, 5)))]
    .sort((a, b) => (a.timestamp >= now) !== (b.timestamp >= now) ? (a.timestamp >= now ? -1 : 1)
      : a.timestamp >= now ? a.timestamp - b.timestamp : b.timestamp - a.timestamp);
  const strongest = (e) => [...e.reaction].sort((a, b) => (b.vs_normal || 0) - (a.vs_normal || 0))[0];

  // Devises suivies, en clair : « USD 100 % » ne disait pas ce que cela signifiait
  const exp = data.exposure || [];
  const portfolio = Boolean(wkey);
  const exposureText = !exp.length ? null
    : !portfolio ? t(exp.length > 1 ? 'Annonces en {c} : les deux devises de cette paire.' : 'Annonces en {c} : la devise qui fait bouger cet actif.', { c: exp.map(x => x.currency).join(' / ') })
      : exp.length === 1 ? t('Annonces en {c} : toutes les lignes de ce portefeuille dépendent de cette devise.', { c: exp[0].currency })
        : t('Annonces des devises qui pilotent ce portefeuille, selon le poids de chaque ligne : {m}.', { m: exp.map(x => `${x.currency} ${fmt(x.pct, 0)} %`).join(', ') });

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head">
        <h3 className="section-title"><CalendarDays size={15} /> {t(title)}</h3>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="link-btn" onClick={onOpenCalendar}>{t('Calendrier complet')} <ArrowRight size={11} style={{ verticalAlign: -1 }} /></button>
        </div>
      </div>
      {exposureText && <div className="hint" style={{ margin: '-4px 0 10px' }}>{exposureText}</div>}
      {list.length === 0 ? (
        <div className="hint">{t('Aucune annonce forte ou moyenne pour {c} sur la période couverte.', { c: data.exposure?.map(x => x.currency).join(', ') })}</div>
      ) : (
        <div className="mini-events">
          {list.map(e => {
            const isPast = e.timestamp < now;
            const open = openId === e.id;
            return (
              <div key={e.id} className={`mini-event-wrap ${open ? 'open' : ''}`}>
              {/* div cliquable (et non <button>) : la ligne contient déjà un bouton, la réaction du marché */}
              <div role="button" tabIndex={0} className={`mini-event ${isPast ? 'past' : ''}`} style={{ '--impact': impactOf(e.impact).color }}
                aria-expanded={open} title={t('Voir le détail de l’annonce')} onClick={() => setOpenId(open ? null : e.id)}
                onKeyDown={(ev) => { if (ev.target === ev.currentTarget && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); setOpenId(open ? null : e.id); } }}>
                <div className="mini-event-when">
                  <span>{dayLabel(eventDayKey(e)).split(' ').slice(0, 2).join(' ')}</span>
                  <strong>{eventTime(e)}</strong>
                </div>
                <span className="ccy">{e.currency}</span>
                <ImpactBadge impact={e.impact} compact />
                <div className="ellipsis" style={{ flex: 1 }} title={e.title}>
                  <span style={{ color: 'var(--text)' }}>{e.title_fr || e.title}</span>
                  {e.title_fr && <span className="hint" style={{ marginLeft: 6 }}>{e.title}</span>}
                </div>
                {isPast
                  ? <div className="mini-event-side"><ReactionChip r={strongest(e)} /></div>
                  : <div className="mini-event-side hint">{countdown(e.timestamp)}{e.forecast ? ` · ${t('prév.')} ${e.forecast}` : ''}</div>}
                <ChevronRight size={14} className="mini-event-chevron" aria-hidden="true" />
              </div>
              {open && (
                <div className="mini-event-detail">
                  <div className="label">{t("Pourquoi c'est important")}</div>
                  <div>{e.why || t('Indicateur secondaire : il fait rarement bouger les marchés, sauf grosse surprise par rapport à la prévision.')}</div>
                  {(e.actual || e.forecast || e.previous) && (
                    <div className="mini-event-figures">
                      <span>{t('Réel')} <b>{e.actual ?? '—'}</b></span>
                      <span>{t('Prévision')} <b>{e.forecast ?? '—'}</b></span>
                      <span>{t('Précédent')} <b>{e.previous ?? '—'}</b></span>
                    </div>
                  )}
                  {e.forecast && <div className="hint">{t("Le marché réagit surtout à l'écart entre le chiffre publié et la prévision ({f}).", { f: e.forecast })}</div>}
                  {e.reaction?.length > 0 && (
                    <>
                      <div className="label" style={{ marginTop: 8 }}>{t("Réaction le jour de l'annonce")}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{e.reaction.map(r => <ReactionChip key={r.ticker} r={r} />)}</div>
                    </>
                  )}
                </div>
              )}
              </div>
            );
          })}
        </div>
      )}
      <div className="hint" style={{ marginTop: 10 }}>
        {t('Une annonce dans une devise fait bouger les actifs cotés dans cette devise (et les paires de change). Pour les annonces passées : variation de l’actif le jour de l’annonce, et comparaison à un jour normal (« 2× la normale » = deux fois son mouvement habituel). Survolez une réaction pour le détail.')}
      </div>
    </div>
  );
}
