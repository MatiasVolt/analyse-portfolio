import { memo, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronRight, RotateCcw, Search, Clock } from 'lucide-react';
import { ImpactBadge, ReactionChip } from '../components/Calendar';
import { EmptyState } from '../components/ui';
import { IMPACT, impactOf, fetchCalendar, eventTime, eventDayKey, dayLabel, countdown } from '../calendar';
import { useLang, trName, getLocale } from '../i18n';

const REFRESH_MS = 30 * 60 * 1000; // la fenêtre (10 j passés + 3 semaines à venir) avance d'elle-même côté serveur

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function EventRow({ e, isPast, open, onToggle, onAnalyze }) {
  const { t } = useLang();
  return (
    <>
      <tr className={`ev-row ${isPast ? 'past' : ''} ${open ? 'open' : ''}`} style={{ '--impact': impactOf(e.impact).color }} onClick={onToggle}>
        <td className="ev-time">{e.impact === 'Holiday' ? t('Journée') : eventTime(e)}</td>
        <td><span className="ccy" title={e.country}>{e.currency}</span>{e.country_code && e.currency === 'EUR' && e.country_code !== 'EU' && <span className="hint" style={{ marginLeft: 4 }}>{e.country_code}</span>}</td>
        <td><ImpactBadge impact={e.impact} /></td>
        <td className="ev-title">
          <div className="ellipsis" title={e.title}>
            <span style={{ color: 'var(--text)', fontWeight: e.impact === 'High' ? 600 : 400 }}>{e.title_fr || e.title}</span>
            {e.title_fr && <span className="hint" style={{ marginLeft: 8 }}>{e.title}</span>}
          </div>
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
              <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                <div className="label">{t("Pourquoi c'est important")}</div>
                <div style={{ color: 'var(--text-2)', lineHeight: 1.5, whiteSpace: 'normal' }}>
                  {e.why || t('Indicateur secondaire : il fait rarement bouger les marchés, sauf grosse surprise par rapport à la prévision.')}
                </div>
                {e.forecast && <div className="hint" style={{ marginTop: 6, whiteSpace: 'normal' }}>{t("Le marché réagit surtout à l'écart entre le chiffre publié et la prévision ({f}).", { f: e.forecast })}</div>}
              </div>
              <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                <div className="label">{t('Actifs concernés ({c}) — cliquer pour analyser', { c: e.country })}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {e.assets.map(a => (
                    <button key={a.ticker} type="button" className="btn btn-sm" onClick={(ev) => { ev.stopPropagation(); onAnalyze(a.ticker); }}>{trName(a.name)}</button>
                  ))}
                </div>
                {e.reaction?.length > 0 && (
                  <>
                    <div className="label" style={{ marginTop: 12 }}>{t("Réaction le jour de l'annonce")}</div>
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
  const [impacts, setImpacts] = useState(['High', 'Medium', 'Low', 'Holiday']);
  const [hidePast, setHidePast] = useState(false);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);
  const [now, setNow] = useState(() => Date.now() / 1000);

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
    return data.events.filter(e =>
      (!ccys.length || ccys.includes(e.currency)) &&
      impacts.includes(e.impact) &&
      (!hidePast || e.timestamp >= now) &&
      (!q || norm(e.title).includes(q) || norm(e.title_fr).includes(q)));
  }, [data, ccys, impacts, hidePast, query, now]);

  const sections = useMemo(() => {
    const group = (list) => {
      const m = new Map();
      for (const e of list) {
        const k = eventDayKey(e);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(e);
      }
      return [...m.entries()];
    };
    const upcoming = events.filter(e => e.timestamp >= now);
    const past = events.filter(e => e.timestamp < now).reverse();
    return [
      { id: 'upcoming', label: t('À venir'), days: group(upcoming) },
      { id: 'past', label: t('Déjà publiées — les plus récentes en haut'), days: group(past) },
    ].filter(x => x.days.length);
  }, [events, now, t]);

  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
  const todayKey = new Date().toLocaleDateString('sv-SE');
  const next = data?.events.find(e => e.impact === 'High' && e.timestamp >= now);
  const range = data?.events.length ? `${dayLabel(eventDayKey(data.events[0]))} → ${dayLabel(eventDayKey(data.events[data.events.length - 1]))}` : '';

  return (
    <div>
      <div className="result-head">
        <div className="result-title">
          <h1>{t('Calendrier économique')}</h1>
          {data && <span className="tag">{t('{n} annonces', { n: data.events.length })}</span>}
        </div>
        <div className="result-meta">{range} · {t('heures de votre fuseau')} · {t('source')} {data?.source || '…'}{loadedAt && ` · ${t('actualisé à {h}', { h: loadedAt.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }) })}`}</div>
      </div>

      {error && <div className="error-box" role="alert">{error}</div>}
      {!data && !error && <EmptyState icon={CalendarDays} busy title="Chargement du calendrier…" />}

      {data && (<>
        <div className="cal-top">
          <div className="panel next-card" style={{ '--impact': next ? IMPACT.High.color : 'var(--border-2)' }}>
            <Clock size={16} style={{ color: next ? IMPACT.High.color : 'var(--muted)', flexShrink: 0 }} />
            {next ? (
              <div className="ellipsis">
                <span className="label" style={{ marginBottom: 2 }}>{t('Prochaine annonce à fort impact')} · {countdown(next.timestamp)}</span>
                <strong>{next.currency} — {next.title_fr || next.title}</strong>
                <span className="hint" style={{ marginLeft: 8 }}>{t('{d} à {h}', { d: dayLabel(eventDayKey(next)), h: eventTime(next) })}</span>
              </div>
            ) : (
              <div>
                <span className="label" style={{ marginBottom: 2 }}>{t('Aucune annonce à fort impact à venir')}</span>
                <span className="hint">{t('La source de secours (Forex Factory) ne couvre que la semaine en cours. Les annonces passées montrent la réaction des marchés.')}</span>
              </div>
            )}
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="search-box">
              <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
              <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Rechercher une annonce…')} aria-label={t('Rechercher une annonce…')} style={{ width: '100%', paddingLeft: 28 }} />
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {Object.keys(data.currencies).map(c => (
                <button key={c} type="button" className={`btn btn-sm ${ccys.includes(c) ? 'is-on' : ''}`} title={data.currencies[c]} aria-pressed={ccys.includes(c)} onClick={() => toggle(ccys, setCcys, c)}>{c}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {Object.entries(IMPACT).map(([k, m]) => (
                <button key={k} type="button" className={`btn btn-sm impact-toggle ${impacts.includes(k) ? 'is-on' : ''}`} style={{ '--impact': m.color }} aria-pressed={impacts.includes(k)} onClick={() => toggle(impacts, setImpacts, k)}>
                  <span className="impact-dot" /> {t(m.label)}
                </button>
              ))}
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={hidePast} onChange={(e) => setHidePast(e.target.checked)} /> {t('Masquer les annonces passées')}
            </label>
            <div style={{ flex: 1 }} />
            <button type="button" className="btn btn-sm" onClick={() => { setCcys([]); setImpacts(Object.keys(IMPACT)); setHidePast(false); setQuery(''); }}>
              <RotateCcw size={12} /> {t('Réinitialiser')}
            </button>
          </div>
        </div>

        <div className="hint" style={{ margin: '0 0 10px' }}>
          {t("Cliquez sur une annonce pour voir son explication et les actifs qu'elle fait bouger. « ×2,1 » = l'actif a bougé 2,1 fois plus qu'un jour normal (médiane des 60 dernières séances). ▲ / ▼ : chiffre publié supérieur / inférieur à la prévision.")}
        </div>
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          {sections.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>{t('Aucune annonce ne correspond aux filtres.')}</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table cal-table">
                <thead>
                  <tr>
                    <th>{t('Heure')}</th><th>{t('Devise')}</th><th>Impact</th><th>{t('Annonce')}</th>
                    <th className="num">{t('Réel')}</th><th className="num">{t('Prévision')}</th><th className="num">{t('Précédent')}</th>
                    <th>{t('Réaction du marché')}</th><th />
                  </tr>
                </thead>
                {sections.map(sec => sec.days.map(([day, list], i) => (
                  <tbody key={sec.id + day}>
                    {i === 0 && (
                      <tr className={`section-row ${sec.id}`}>
                        <td colSpan={9}>{sec.label}<span className="hint" style={{ marginLeft: 8 }}>{t('{n} annonces', { n: sec.days.reduce((n, [, l]) => n + l.length, 0) })}</span></td>
                      </tr>
                    )}
                    <tr className={`day-row ${day === todayKey ? 'today' : ''}`}>
                      <td colSpan={9}>{dayLabel(day)}{day === todayKey && <span className="tag" style={{ marginLeft: 8 }}>{t("Aujourd'hui")}</span>}</td>
                    </tr>
                    {list.map(e => (
                      <EventRow key={e.id} e={e} isPast={e.timestamp < now} open={openId === e.id}
                        onToggle={() => setOpenId(openId === e.id ? null : e.id)} onAnalyze={onAnalyze} />
                    ))}
                  </tbody>
                )))}
              </table>
            </div>
          )}
        </div>
      </>)}
    </div>
  );
}

export default memo(CalendarView);
