import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronRight, RotateCcw, Search, Clock, ArrowDownToLine } from 'lucide-react';
import { ImpactBadge, ReactionChip, EventReading } from '../components/Calendar';
import { EmptyState } from '../components/ui';
import { LEVELS, impactOf, levelOf, fetchCalendar, eventTime, eventDayKey, dayLabel, countdown } from '../calendar';
import { useLang, trName, getLocale } from '../i18n';

const REFRESH_MS = 30 * 60 * 1000; // la fenêtre (10 j passés + 3 semaines à venir) avance d'elle-même côté serveur
const DEFAULT_MIN_LEVEL = 3; // par défaut on masque les annonces mineures, très nombreuses

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function EventRow({ e, isPast, open, onToggle, onAnalyze }) {
  const { t } = useLang();
  const level = levelOf(e);
  return (
    <>
      <tr className={`ev-row ${isPast ? 'past' : ''} ${open ? 'open' : ''}`} style={{ '--impact': impactOf(level).color }} onClick={onToggle}>
        <td className="ev-time">{level === 0 ? t('Journée') : eventTime(e)}</td>
        <td><span className="ccy" title={e.country}>{e.currency}</span>{e.country_code && e.currency === 'EUR' && e.country_code !== 'EU' && <span className="hint" style={{ marginLeft: 4 }}>{e.country_code}</span>}</td>
        <td><ImpactBadge level={level} /></td>
        <td className="ev-title">
          <div className="ellipsis" title={e.title}>
            <span style={{ color: 'var(--text)', fontWeight: level >= 4 ? 600 : 400 }}>{e.title_fr || e.title}</span>
            {e.title_fr && <span className="hint" style={{ marginLeft: 8 }}>{e.title}</span>}
          </div>
          {/* Ce que représente le chiffre : « 29 k », oui, mais 29 000 quoi ? */}
          {e.measure && <div className="ev-measure ellipsis" title={e.measure}>{e.measure}</div>}
        </td>
        <td className="num">
          {e.actual ?? '—'}
          {e.surprise && <span className={`surprise ${e.surprise}`} title={e.surprise === 'above' ? t('Supérieur à la prévision') : t('Inférieur à la prévision')}>{e.surprise === 'above' ? '▲' : '▼'}</span>}
        </td>
        <td className="num">{e.forecast ?? '—'}</td>
        <td className="num" style={{ color: 'var(--muted-2)' }}>{e.previous ?? '—'}</td>
        <td className="ev-reaction">
          <div className="ev-reaction-inner">
            {e.reaction?.length ? e.reaction.slice(0, 2).map(r => <ReactionChip key={r.ticker} r={r} />) : <span className="hint">{isPast ? '' : countdown(e.timestamp)}</span>}
          </div>
        </td>
        <td>
          <button type="button" className="icon-btn" aria-expanded={open} aria-label={t('Voir le détail de l’annonce')} title={t('Voir le détail de l’annonce')}
            onClick={(ev) => { ev.stopPropagation(); onToggle(); }}>
            <ChevronRight size={14} className="ev-chevron" />
          </button>
        </td>
      </tr>
      {open && (
        <tr className="ev-detail">
          <td colSpan={9}>
            <div className="ev-detail-body">
              <div style={{ flex: '1 1 380px', minWidth: 0, whiteSpace: 'normal', color: 'var(--text-2)', lineHeight: 1.5 }}>
                <EventReading e={e} isPast={isPast} />
              </div>
              <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                <div className="label">{t('Actifs concernés ({c}) — cliquer pour analyser', { c: e.country })}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {e.assets.map(a => (
                    <button key={a.ticker} type="button" className="btn btn-sm" onClick={(ev) => { ev.stopPropagation(); onAnalyze(a.ticker); }}>{trName(a.name)}</button>
                  ))}
                </div>
                {e.reaction?.length > 0 && (
                  <>
                    <div className="label" style={{ marginTop: 12 }}>{t("Réaction mesurée le jour de l'annonce")}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {e.reaction.map(r => <ReactionChip key={r.ticker} r={r} onAnalyze={onAnalyze} />)}
                    </div>
                  </>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function CalendarView({ active, onAnalyze }) {
  const { t, lang } = useLang();
  const [reload, setReload] = useState(0);
  const [loadedAt, setLoadedAt] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [ccys, setCcys] = useState([]);           // vide = toutes
  const [minLevel, setMinLevel] = useState(DEFAULT_MIN_LEVEL);
  const [hidePast, setHidePast] = useState(false);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const nowRef = useRef(null);
  const rootRef = useRef(null);
  const scrollRef = useRef(null);
  const [listHeight, setListHeight] = useState(null);

  // Chargement à l'ouverture de l'onglet, au changement de langue et toutes les 30 min (nouvelles annonces, chiffres publiés)
  useEffect(() => {
    if (!active) return;
    let alive = true;
    fetchCalendar()
      .then(d => { if (alive) { setData(d); setError(null); setLoadedAt(new Date()); } })
      .catch(err => alive && setError(err.response?.data?.detail || t("Impossible de charger le calendrier (le serveur Python est-il lancé ?).")));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, lang, reload]);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setReload(r => r + 1), REFRESH_MS);
    return () => clearInterval(id);
  }, [active]);

  // Rafraîchit les comptes à rebours chaque minute
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now() / 1000), 60000);
    return () => clearInterval(id);
  }, [active]);

  const events = useMemo(() => {
    if (!data) return [];
    const q = norm(query).trim();
    return data.events.filter(e => {
      const level = levelOf(e);
      return (!ccys.length || ccys.includes(e.currency)) &&
        (level === 0 ? minLevel <= 3 : level >= minLevel) && // jours fériés : affichés sauf si l'on ne garde que l'essentiel
        (!hidePast || e.timestamp >= now) &&
        (!q || norm(e.title).includes(q) || norm(e.title_fr).includes(q));
    });
  }, [data, ccys, minLevel, hidePast, query, now]);

  // Une seule liste dans l'ordre du temps : le passé au-dessus, l'avenir en dessous
  const days = useMemo(() => {
    const m = new Map();
    for (const e of events) {
      const k = eventDayKey(e);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(e);
    }
    return [...m.entries()];
  }, [events]);
  const firstUpcomingId = events.find(e => e.timestamp >= now)?.id;
  const pastCount = events.filter(e => e.timestamp < now).length;

  // Volets figés, comme dans Excel : tout ce qui est au-dessus de la liste reste à l'écran, seule la liste défile.
  // Sa hauteur = la place restante entre son bord haut et la barre d'onglets du bas (recalculée si le haut change de taille).
  useLayoutEffect(() => {
    if (!active || !rootRef.current) return;
    const fit = () => {
      const box = scrollRef.current;
      if (!box) return;
      const top = box.getBoundingClientRect().top + window.scrollY;
      const bottomBar = document.querySelector('.sheet-tabs')?.offsetHeight || 0;
      setListHeight(Math.max(320, Math.floor(window.innerHeight - top - bottomBar - 28)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(rootRef.current);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, [active, data]);

  // « Maintenant » : on fait défiler la liste (et non la page) jusqu'à la ligne, juste sous les titres de colonnes
  const scrollToNow = (smooth = true) => {
    const box = scrollRef.current, row = nowRef.current;
    if (!box || !row) return;
    const head = box.querySelector('thead')?.offsetHeight || 0;
    box.scrollTo({ top: Math.max(0, row.offsetTop - head), behavior: smooth ? 'smooth' : 'auto' });
  };
  // À l'ouverture de l'onglet, on se place sur « maintenant » : les annonces passées sont au-dessus, il suffit de remonter
  const ready = Boolean(data);
  useEffect(() => {
    if (!active || !ready) return;
    const id = setTimeout(() => scrollToNow(false), 60);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ready, listHeight === null]);

  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
  const todayKey = new Date().toLocaleDateString('sv-SE');
  const next = data?.events.find(e => levelOf(e) >= 4 && e.timestamp >= now);
  const range = data?.events.length ? `${dayLabel(eventDayKey(data.events[0]))} → ${dayLabel(eventDayKey(data.events[data.events.length - 1]))}` : '';
  const nextColor = impactOf(next ? levelOf(next) : 1).color;

  return (
    <div ref={rootRef}>
      <div className="result-head">
        <div className="result-title">
          <h1>{t('Calendrier économique')}</h1>
          {data && <span className="tag">{t('{n} annonces affichées sur {m}', { n: events.length, m: data.events.length })}</span>}
        </div>
        <div className="result-meta">{range} · {t('heures de votre fuseau')} · {t('source')} {data?.source || '…'}{loadedAt && ` · ${t('actualisé à {h}', { h: loadedAt.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }) })}`}</div>
      </div>

      {error && <div className="error-box" role="alert">{error}</div>}
      {!data && !error && <EmptyState icon={CalendarDays} busy title="Chargement du calendrier…" />}

      {data && (<>
        <div className="cal-top">
          <div className="panel next-card" style={{ '--impact': next ? nextColor : 'var(--border-2)' }}>
            <Clock size={16} style={{ color: next ? nextColor : 'var(--muted)', flexShrink: 0 }} />
            {next ? (
              <div className="ellipsis">
                <span className="label" style={{ marginBottom: 2 }}>{t('Prochaine annonce importante (niveau {n} sur 5)', { n: levelOf(next) })} · {countdown(next.timestamp)}</span>
                <strong>{next.currency} — {next.title_fr || next.title}</strong>
                <span className="hint" style={{ marginLeft: 8 }}>{t('{d} à {h}', { d: dayLabel(eventDayKey(next)), h: eventTime(next) })}</span>
              </div>
            ) : (
              <div>
                <span className="label" style={{ marginBottom: 2 }}>{t('Aucune annonce importante à venir sur la période couverte')}</span>
                <span className="hint">{t('La source de secours (Forex Factory) ne couvre que la semaine en cours. Les annonces passées montrent la réaction des marchés.')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Mode d'emploi : c'est l'écart à la prévision qui fait bouger les marchés */}
        <details className="panel cal-guide">
          <summary>{t('Comment lire une annonce économique')}</summary>
          <ol>
            <li>{t('Avant l’annonce, les économistes publient une prévision (le « consensus »). Les investisseurs se positionnent en fonction d’elle : ce chiffre attendu est donc déjà dans les cours.')}</li>
            <li>{t('Au moment de l’annonce, le marché ne réagit pas au chiffre lui-même mais à l’écart avec la prévision : la « surprise ». Un chiffre conforme ne fait presque rien bouger, même s’il est très bon.')}</li>
            <li>{t('Le sens de la réaction dépend de l’indicateur. Une inflation plus forte que prévu fait craindre des taux plus hauts : mauvais pour les actions et les obligations, bon pour la devise. Un chômage plus élevé que prévu signale une économie qui ralentit.')}</li>
            <li>{t('La théorie ne suffit pas : pour chaque annonce passée, le site mesure ce qui s’est réellement passé (variation de l’actif ce jour-là, comparée à un jour normal). Cliquez sur une annonce pour le détail.')}</li>
          </ol>
          <p className="hint">{t('Importance sur 5 : échelle propre à ce site, pas un chiffre officiel. Elle croise le type d’indicateur (décision de taux, inflation, emploi, croissance…) et le poids de la zone économique (États-Unis, puis zone euro, puis les autres), sans jamais dépasser ce que permet le classement de la source. La source ne distingue que 3 niveaux, et beaucoup de ses annonces « fortes » font peu bouger les marchés mondiaux ; son classement d’origine reste indiqué dans le détail de chaque annonce.')}</p>
        </details>

        <div className="panel" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="search-box">
              <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
              <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('Rechercher une annonce')} style={{ width: '100%', paddingLeft: 28 }} />
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {Object.keys(data.currencies).map(c => (
                <button key={c} type="button" className={`btn btn-sm ${ccys.includes(c) ? 'is-on' : ''}`} title={data.currencies[c]} aria-pressed={ccys.includes(c)} onClick={() => toggle(ccys, setCcys, c)}>{c}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }} role="group" aria-label={t('Importance minimale')}>
              <span className="label" style={{ margin: 0 }}>{t('Importance minimale')}</span>
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button" className={`btn btn-sm impact-toggle ${minLevel === n ? 'is-on' : ''}`} style={{ '--impact': LEVELS[n].color }}
                  aria-pressed={minLevel === n} title={t('Afficher les annonces d’importance {n} sur 5 et plus ({x})', { n, x: t(LEVELS[n].label).toLowerCase() })} onClick={() => setMinLevel(n)}>
                  <span className="impact-dot" /> {n}
                </button>
              ))}
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={hidePast} onChange={(e) => setHidePast(e.target.checked)} /> {t('Masquer les annonces passées')}
            </label>
            <div style={{ flex: 1 }} />
            <button type="button" className="btn btn-sm" onClick={() => scrollToNow()} disabled={!firstUpcomingId}>
              <ArrowDownToLine size={12} /> {t('Revenir à maintenant')}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => { setCcys([]); setMinLevel(DEFAULT_MIN_LEVEL); setHidePast(false); setQuery(''); }}>
              <RotateCcw size={12} /> {t('Réinitialiser')}
            </button>
          </div>
        </div>

        <div className="hint" style={{ margin: '0 0 10px' }}>
          {t('Les annonces sont dans l’ordre du temps : les plus anciennes en haut, les prochaines en bas. La liste s’ouvre sur « maintenant » : remontez dans la liste pour voir ce qui a déjà été publié. ▲ / ▼ : chiffre publié supérieur / inférieur à la prévision.')}
        </div>
        <div className="panel" style={{ padding: 0, overflow: 'hidden', marginBottom: 0 }}>
          {days.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>{t('Aucune annonce ne correspond aux filtres.')}</div>
          ) : (
            <div ref={scrollRef} className="cal-scroll" style={listHeight ? { height: listHeight } : undefined}
              tabIndex={0} aria-label={t('Liste des annonces')}>
              <table className="table cal-table">
                <thead>
                  <tr>
                    <th>{t('Heure')}</th><th>{t('Devise')}</th><th>{t('Importance')}</th><th>{t('Annonce')}</th>
                    <th className="num">{t('Réel')}</th><th className="num">{t('Prévision')}</th><th className="num">{t('Précédent')}</th>
                    <th>{t('Réaction du marché')}</th><th />
                  </tr>
                </thead>
                {days.map(([day, list]) => (
                  <tbody key={day}>
                    <tr className={`day-row ${day === todayKey ? 'today' : ''}`}>
                      <td colSpan={9}>{dayLabel(day)}{day === todayKey && <span className="tag" style={{ marginLeft: 8 }}>{t("Aujourd'hui")}</span>}</td>
                    </tr>
                    {list.map(e => (
                      <FragmentRow key={e.id} marker={e.id === firstUpcomingId} markerRef={nowRef} pastCount={pastCount}>
                        <EventRow e={e} isPast={e.timestamp < now} open={openId === e.id}
                          onToggle={() => setOpenId(openId === e.id ? null : e.id)} onAnalyze={onAnalyze} />
                      </FragmentRow>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          )}
        </div>
      </>)}
    </div>
  );
}

/** Insère la ligne « Maintenant » juste avant la première annonce à venir. */
function FragmentRow({ marker, markerRef, pastCount, children }) {
  const { t } = useLang();
  return (
    <>
      {marker && (
        <tr className="now-row" ref={markerRef}>
          <td colSpan={9}>
            <span className="now-dot" aria-hidden="true" /> {t('Maintenant')}
            <span className="hint" style={{ marginLeft: 8 }}>{pastCount > 0 ? t('{n} annonces déjà publiées au-dessus · à venir en dessous', { n: pastCount }) : t('à venir en dessous')}</span>
          </td>
        </tr>
      )}
      {children}
    </>
  );
}

export default memo(CalendarView);
