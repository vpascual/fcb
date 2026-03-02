import { useState, useEffect, useMemo } from 'react'

// ─── Config ───────────────────────────────────────────────────────────────────
const BARCA_ID   = '83'
const SCRIPT_URL = import.meta.env.VITE_SCRIPT_URL ?? ''

const LEAGUES = [
  { slug: 'esp.1',            name: 'La Liga',          abbr: 'LaLiga', color: '#FF4500' },
  { slug: 'uefa.champions',   name: 'Champions League', abbr: 'UCL',    color: '#1B3FAB' },
  { slug: 'esp.copa_del_rey', name: 'Copa del Rey',     abbr: 'Copa',   color: '#C0392B' },
  { slug: 'esp.super_cup',    name: 'Super Cup',        abbr: 'SSC',    color: '#8E44AD' },
]
const RESULT_SEASONS = ['2025', '2024', '2023']
const TWO_YEARS_AGO  = new Date('2024-02-28T00:00:00Z')

// ─── Scoring ──────────────────────────────────────────────────────────────────
function calcPoints(barcaGoals, oppGoals, predH, predA) {
  if (predH === '' || predH == null || predA === '' || predA == null) return null
  const [bh, bo, ph, po] = [barcaGoals, oppGoals, Number(predH), Number(predA)]
  if (isNaN(ph) || isNaN(po)) return null
  if (bh === ph && bo === po) return 5
  const aGD = bh - bo, pGD = ph - po
  if (Math.sign(aGD) === Math.sign(pGD) && aGD === pGD) return 3
  if (Math.sign(aGD) === Math.sign(pGD)) return 1
  return 0
}

const PT = {
  5: { icon: '🎯', cls: 'pts-5', text: 'Exact score!'      },
  3: { icon: '⭐', cls: 'pts-3', text: 'Correct diff'      },
  1: { icon: '✓',  cls: 'pts-1', text: 'Correct result'    },
  0: { icon: '✗',  cls: 'pts-0', text: 'Wrong'             },
}

// ─── ESPN: upcoming matches ───────────────────────────────────────────────────
function dateStr(d) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

async function fetchUpcoming() {
  const now    = new Date()
  const cutoff = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)
  const range  = `${dateStr(now)}-${dateStr(cutoff)}`

  const results = await Promise.all(
    LEAGUES.map(async league => {
      try {
        const r = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/soccer/${league.slug}/scoreboard?dates=${range}`
        )
        if (!r.ok) return []
        const data = await r.json()
        return (data.events ?? []).flatMap(event => {
          const comp = event.competitions?.[0]
          if (!comp) return []
          const barca    = comp.competitors?.find(c => c.team?.id === BARCA_ID)
          const opponent = comp.competitors?.find(c => c.team?.id !== BARCA_ID)
          if (!barca || !opponent) return []
          const completed = comp.status?.type?.completed ?? false
          if (completed) return []
          const date = new Date(event.date)
          if (date < now) return []
          return [{
            id:           event.id,
            date,
            dateStr:      date.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }),
            timeStr:      date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }) + ' CET',
            opponent:     opponent.team?.displayName ?? 'Unknown',
            opponentLogo: opponent.team?.logos?.[0]?.href ?? null,
            isHome:       barca.homeAway === 'home',
            league:       league.name,
            leagueAbbr:   league.abbr,
            leagueColor:  league.color,
            leagueSlug:   league.slug,
          }]
        })
      } catch { return [] }
    })
  )

  const flat = results.flat()
  const seen = new Set()
  const unique = flat.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true })
  unique.sort((a, b) => a.date - b.date)
  return unique
}

// ─── ESPN: completed results ──────────────────────────────────────────────────
async function fetchCompleted() {
  const now = new Date()
  const promises = LEAGUES.flatMap(l =>
    RESULT_SEASONS.map(s =>
      fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${l.slug}/teams/${BARCA_ID}/schedule?season=${s}`)
        .then(r => r.ok ? r.json() : { events: [] })
        .then(data => (data.events ?? []).flatMap(event => {
          const comp     = event.competitions?.[0]
          if (!comp) return []
          const barca    = comp.competitors?.find(c => c.team?.id === BARCA_ID)
          const opponent = comp.competitors?.find(c => c.team?.id !== BARCA_ID)
          if (!barca || !opponent) return []
          if (!comp.status?.type?.completed) return []
          const date = new Date(event.date)
          if (date < TWO_YEARS_AGO || date > now) return []
          let result = 'D'
          if (barca.winner === true)         result = 'W'
          else if (opponent.winner === true) result = 'L'
          return [{
            id:            event.id,
            date,
            dateStr:       date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
            opponent:      opponent.team?.displayName ?? 'Unknown',
            opponentLogo:  opponent.team?.logos?.[0]?.href ?? null,
            isHome:        barca.homeAway === 'home',
            barcaGoals:    Math.round(barca.score?.value    ?? -1),
            opponentGoals: Math.round(opponent.score?.value ?? -1),
            result,
            league:      l.name,
            leagueAbbr:  l.abbr,
            leagueColor: l.color,
            leagueSlug:  l.slug,
          }]
        }))
        .catch(() => [])
    )
  )
  const flat = (await Promise.all(promises)).flat()
  const seen = new Set()
  const unique = flat.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true })
  unique.sort((a, b) => b.date - a.date)
  return unique
}

// ─── Google Sheets / Apps Script ─────────────────────────────────────────────
// Sheet columns: matchId | victorHome | victorAway | maxHome | maxAway
async function fetchPredictions() {
  if (!SCRIPT_URL) return {}
  try {
    const r = await fetch(`${SCRIPT_URL}?action=getData`)
    if (!r.ok) return {}
    const data = await r.json()
    const map = {}
    ;(data.predictions ?? []).forEach(p => { map[String(p.matchId)] = p })
    return map
  } catch { return {} }
}

// GET-based save avoids CORS preflight
async function savePrediction(matchId, player, h, a) {
  if (!SCRIPT_URL) return
  try {
    await fetch(
      `${SCRIPT_URL}?action=save&matchId=${encodeURIComponent(matchId)}&player=${player}&h=${Number(h)}&a=${Number(a)}`
    )
  } catch { /* fire & forget */ }
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [player, setPlayer] = useState(() => localStorage.getItem('barca_player'))
  const [tab, setTab]       = useState('predict')

  const [upcoming,     setUpcoming    ] = useState([])
  const [completed,    setCompleted   ] = useState([])
  const [predictions,  setPredictions ] = useState({})
  const [loadingUp,    setLoadingUp   ] = useState(true)
  const [loadingComp,  setLoadingComp ] = useState(true)
  const [loadingPreds, setLoadingPreds] = useState(true)

  const [predH,    setPredH   ] = useState('')
  const [predA,    setPredA   ] = useState('')
  const [saving,   setSaving  ] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [filterRes,setFilterRes] = useState('all')

  useEffect(() => {
    fetchUpcoming().then(u => { setUpcoming(u); setLoadingUp(false) })
    fetchCompleted().then(c => { setCompleted(c); setLoadingComp(false) })
    fetchPredictions().then(p => { setPredictions(p); setLoadingPreds(false) })
  }, [])

  const nextMatch     = upcoming[0] ?? null
  const futureMatches = upcoming.slice(1, 6)

  // Pre-fill form with stored prediction
  useEffect(() => {
    if (!nextMatch || !player) return
    const stored = predictions[nextMatch.id]
    if (!stored) { setPredH(''); setPredA(''); return }
    const h = player === 'victor' ? stored.victorHome : stored.maxHome
    const a = player === 'victor' ? stored.victorAway : stored.maxAway
    setPredH(h !== '' && h != null ? String(h) : '')
    setPredA(a !== '' && a != null ? String(a) : '')
  }, [nextMatch?.id, player, predictions])

  // Standings: merge predictions with completed results by ESPN event id
  const scoredMatches = useMemo(() =>
    completed.filter(m => predictions[m.id]).map(m => {
      const p  = predictions[m.id]
      const vp = calcPoints(m.barcaGoals, m.opponentGoals, p.victorHome, p.victorAway)
      const mp = calcPoints(m.barcaGoals, m.opponentGoals, p.maxHome,    p.maxAway)
      return { ...m, pred: p, victorPts: vp, maxPts: mp }
    }),
    [completed, predictions]
  )

  const standings = useMemo(() => ({
    victor: scoredMatches.reduce((s, m) => s + (m.victorPts ?? 0), 0),
    max:    scoredMatches.reduce((s, m) => s + (m.maxPts    ?? 0), 0),
  }), [scoredMatches])

  const myPredStored = nextMatch && (() => {
    const p = predictions[nextMatch.id]
    if (!p) return false
    const h = player === 'victor' ? p.victorHome : p.maxHome
    return h !== '' && h != null
  })()

  const oppId  = player === 'victor' ? 'max' : 'victor'
  const oppPred = nextMatch && (() => {
    const p = predictions[nextMatch.id]
    if (!p) return null
    const h = oppId === 'victor' ? p.victorHome : p.maxHome
    const a = oppId === 'victor' ? p.victorAway : p.maxAway
    if (h === '' || h == null) return null
    return { h, a }
  })()

  function selectPlayer(p) { setPlayer(p); localStorage.setItem('barca_player', p) }

  async function handleSave() {
    if (!nextMatch || predH === '' || predA === '' || !player) return
    setSaving(true)
    await savePrediction(nextMatch.id, player, predH, predA)
    setPredictions(prev => ({
      ...prev,
      [nextMatch.id]: {
        ...(prev[nextMatch.id] ?? { matchId: nextMatch.id }),
        [`${player}Home`]: Number(predH),
        [`${player}Away`]: Number(predA),
      }
    }))
    setSaving(false)
    setSavedMsg('Saved ✓')
    setTimeout(() => setSavedMsg(''), 3000)
  }

  const filteredCompleted = filterRes === 'all'
    ? completed
    : completed.filter(m => m.result === filterRes)

  return (
    <div className="app">
      <Header player={player} standings={standings} onSwitch={() => setPlayer(null)} />

      {!player
        ? <PlayerGate onSelect={selectPlayer} />
        : <>
            <Nav tab={tab} onTab={setTab} />
            <main className="main">

              {tab === 'predict' && (
                <PredictTab
                  nextMatch={nextMatch}
                  futureMatches={futureMatches}
                  loadingUp={loadingUp}
                  player={player}
                  oppId={oppId}
                  predH={predH} predA={predA}
                  onH={setPredH} onA={setPredA}
                  onSave={handleSave}
                  saving={saving} savedMsg={savedMsg}
                  myPredStored={myPredStored}
                  oppPred={oppPred}
                  standings={standings}
                  hasScored={scoredMatches.length > 0}
                  scriptConfigured={!!SCRIPT_URL}
                />
              )}

              {tab === 'results' && (
                <ResultsTab
                  scoredMatches={scoredMatches}
                  completed={completed}
                  filtered={filteredCompleted}
                  filterRes={filterRes}
                  onFilter={setFilterRes}
                  loadingComp={loadingComp}
                  loadingPreds={loadingPreds}
                />
              )}

              {tab === 'standings' && (
                <StandingsTab
                  scoredMatches={scoredMatches}
                  standings={standings}
                  loading={loadingComp || loadingPreds}
                />
              )}

            </main>
          </>
      }
    </div>
  )
}

// ─── Header ───────────────────────────────────────────────────────────────────
function Header({ player, standings, onSwitch }) {
  const p = player ? { victor: { emoji: '👨', label: 'Victor' }, max: { emoji: '👦', label: 'Max' } }[player] : null
  return (
    <header className="header">
      <div className="header-inner">
        <img src="https://a.espncdn.com/i/teamlogos/soccer/500/83.png" alt="FCB" className="crest"
          onError={e => { e.target.style.display = 'none' }} />
        <div className="header-text">
          <h1>FCB Predictions</h1>
          <p>Victor 👨 vs Max 👦 · 2025/26</p>
        </div>
        {p && (
          <button className="player-chip" onClick={onSwitch}>
            {p.emoji} {p.label}
            <span className="chip-pts">{standings[player]}pts</span>
          </button>
        )}
      </div>
    </header>
  )
}

// ─── Player gate ──────────────────────────────────────────────────────────────
function PlayerGate({ onSelect }) {
  return (
    <div className="player-gate">
      <p className="gate-label">Who's playing?</p>
      <div className="gate-buttons">
        {[{ id: 'victor', emoji: '👨', label: 'Victor' }, { id: 'max', emoji: '👦', label: 'Max' }].map(p => (
          <button key={p.id} className="gate-btn" onClick={() => onSelect(p.id)}>
            <span className="gate-emoji">{p.emoji}</span>
            <span>{p.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Nav ──────────────────────────────────────────────────────────────────────
function Nav({ tab, onTab }) {
  return (
    <nav className="nav">
      {[
        { id: 'predict',   label: '🔮 Predict'   },
        { id: 'results',   label: '📊 Results'   },
        { id: 'standings', label: '🏆 Standings' },
      ].map(t => (
        <button key={t.id} className={tab === t.id ? 'nav-btn active' : 'nav-btn'} onClick={() => onTab(t.id)}>
          {t.label}
        </button>
      ))}
    </nav>
  )
}

// ─── Predict tab ──────────────────────────────────────────────────────────────
function PredictTab({
  nextMatch, futureMatches, loadingUp,
  player, oppId, predH, predA, onH, onA,
  onSave, saving, savedMsg,
  myPredStored, oppPred,
  standings, hasScored, scriptConfigured,
}) {
  return (
    <div>
      {!scriptConfigured && <SetupBanner />}

      {loadingUp
        ? <Spinner label="Finding next match…" />
        : !nextMatch
        ? <EmptyCard icon="⏳" text="No upcoming match found in the next 90 days." />
        : <PredictCard
            match={nextMatch}
            player={player} oppId={oppId}
            predH={predH} predA={predA}
            onH={onH} onA={onA}
            onSave={onSave} saving={saving} savedMsg={savedMsg}
            myPredStored={myPredStored} oppPred={oppPred}
          />
      }

      {/* Upcoming fixtures */}
      {!loadingUp && futureMatches.length > 0 && (
        <section style={{ marginTop: '2rem' }}>
          <h2 className="section-title">Coming up next</h2>
          <div className="upcoming-list">
            {futureMatches.map(m => <UpcomingRow key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {/* Mini standings */}
      {hasScored && (
        <section style={{ marginTop: '2rem' }}>
          <MiniStandings standings={standings} />
        </section>
      )}
    </div>
  )
}

function PredictCard({ match, player, oppId, predH, predA, onH, onA, onSave, saving, savedMsg, myPredStored, oppPred }) {
  const now = new Date()
  const isLocked = match.date < now

  const playerLabel = { victor: '👨 Victor', max: '👦 Max' }
  const oppLabel    = { victor: '👨 Victor', max: '👦 Max' }

  return (
    <div className="predict-card">
      {/* League + date */}
      <div className="pc-header">
        <span className="pc-league" style={{ background: match.leagueColor }}>{match.league}</span>
        <span className="pc-date">{match.dateStr} · {match.timeStr}</span>
        {isLocked && <span className="locked-badge">🔒 Locked</span>}
      </div>

      {/* Teams */}
      <div className="pc-teams">
        <div className="pc-team">
          <img src="https://a.espncdn.com/i/teamlogos/soccer/500/83.png" alt="FCB" className="pc-logo"
            onError={e => { e.target.style.display = 'none' }} />
          <span>FC Barcelona</span>
        </div>
        <div className="pc-vs">{match.isHome ? 'vs' : '@'}</div>
        <div className="pc-team pc-team-r">
          <span>{match.opponent}</span>
          {match.opponentLogo && (
            <img src={match.opponentLogo} alt={match.opponent} className="pc-logo"
              onError={e => { e.target.style.display = 'none' }} />
          )}
        </div>
      </div>
      <p className="pc-venue-note">{match.isHome ? '🏟️ Camp Nou — Home match' : `✈️ Away at ${match.opponent}`}</p>

      {/* Your prediction */}
      <div className="pc-pred-section">
        <div className="pc-pred-label">{playerLabel[player]}'s prediction</div>
        <div className="pc-inputs-row">
          <input type="number" min="0" max="20" className="score-input" placeholder="–"
            value={predH} onChange={e => onH(e.target.value)} disabled={isLocked} />
          <span className="input-sep">–</span>
          <input type="number" min="0" max="20" className="score-input" placeholder="–"
            value={predA} onChange={e => onA(e.target.value)} disabled={isLocked} />

          {!isLocked && (
            <button className="save-btn" onClick={onSave}
              disabled={saving || predH === '' || predA === ''}>
              {saving ? '…' : myPredStored ? 'Update' : 'Save'}
            </button>
          )}
        </div>
        {savedMsg && <div className="saved-msg">{savedMsg}</div>}
      </div>

      {/* Other player's prediction (revealed after you submit) */}
      <div className="pc-opp-pred">
        <div className="pc-pred-label">{oppLabel[oppId]}'s prediction</div>
        {myPredStored
          ? oppPred
            ? <div className="opp-revealed">{oppPred.h} – {oppPred.a}</div>
            : <div className="opp-pending">Not submitted yet</div>
          : <div className="opp-hidden">🙈 Submit yours to see theirs</div>
        }
      </div>
    </div>
  )
}

function UpcomingRow({ match }) {
  return (
    <div className="upcoming-row">
      <span className="ur-league" style={{ background: match.leagueColor }}>{match.leagueAbbr}</span>
      <span className="ur-date">{match.dateStr}</span>
      <span className="ur-team">{match.isHome ? 'vs' : '@'} {match.opponent}</span>
    </div>
  )
}

function MiniStandings({ standings }) {
  const total = standings.victor + standings.max
  const vPct  = total > 0 ? (standings.victor / total) * 100 : 50
  const leader = standings.victor > standings.max ? '👨 Victor leading'
               : standings.max > standings.victor ? '👦 Max leading'
               : 'Tied!'
  return (
    <div className="mini-standings">
      <div className="ms-title">Standings · {leader}</div>
      {[
        { label: '👨 Victor', pts: standings.victor, pct: vPct,       color: 'var(--barca-blue)' },
        { label: '👦 Max',    pts: standings.max,    pct: 100 - vPct, color: 'var(--barca-red)' },
      ].map(({ label, pts, pct, color }) => (
        <div key={label} className="ms-row">
          <span className="ms-player">{label}</span>
          <div className="ms-bar-wrap"><div className="ms-bar" style={{ width: `${pct}%`, background: color }} /></div>
          <span className="ms-pts">{pts} pts</span>
        </div>
      ))}
    </div>
  )
}

// ─── Results tab ──────────────────────────────────────────────────────────────
function ResultsTab({ scoredMatches, completed, filtered, filterRes, onFilter, loadingComp, loadingPreds }) {
  const loading = loadingComp || loadingPreds
  const w  = completed.filter(m => m.result === 'W').length
  const d  = completed.filter(m => m.result === 'D').length
  const l  = completed.filter(m => m.result === 'L').length
  const wr = completed.length > 0 ? Math.round(w / completed.length * 100) : 0

  return (
    <div>
      {/* Prediction game results section */}
      {!loading && scoredMatches.length > 0 && (
        <section style={{ marginBottom: '2.5rem' }}>
          <h2 className="section-title">🎯 Prediction Results</h2>
          <div className="matches-list">
            {scoredMatches.map(m => <ScoredMatchCard key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {/* ESPN history */}
      <section>
        <h2 className="section-title">📋 Match History · Last 2 Years</h2>

        {/* Stats */}
        {!loading && (
          <div className="stats-bar">
            {[
              { label: 'Played', val: completed.length, color: 'var(--text)' },
              { label: 'Won',    val: w,                color: '#27ae60' },
              { label: 'Drawn',  val: d,                color: '#f39c12' },
              { label: 'Lost',   val: l,                color: '#e74c3c' },
              { label: 'Win %',  val: `${wr}%`,         color: '#27ae60' },
            ].map(s => (
              <div key={s.label} className="stat-pill" style={{ borderTopColor: s.color }}>
                <span className="sp-val" style={{ color: s.color }}>{s.val}</span>
                <span className="sp-label">{s.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Filter */}
        {!loading && (
          <div className="filter-bar">
            {[
              { val: 'all', label: 'All',  color: 'var(--barca-blue)' },
              { val: 'W',   label: 'Won',  color: '#27ae60' },
              { val: 'D',   label: 'Draw', color: '#f39c12' },
              { val: 'L',   label: 'Lost', color: '#e74c3c' },
            ].map(o => (
              <button key={o.val}
                className={filterRes === o.val ? 'pill active' : 'pill'}
                style={filterRes === o.val ? { background: o.color, borderColor: o.color } : {}}
                onClick={() => onFilter(o.val)}
              >{o.label}</button>
            ))}
          </div>
        )}

        {loading
          ? <Spinner label="Loading match history…" />
          : <>
              <p className="matches-count">
                Showing <strong>{filtered.length}</strong> of {completed.length} matches
              </p>
              <div className="matches-list">
                {filtered.map(m => <HistoryCard key={m.id} match={m} />)}
              </div>
            </>
        }
      </section>
    </div>
  )
}

function ScoredMatchCard({ match }) {
  const { barcaGoals: bh, opponentGoals: bo, pred, victorPts: vp, maxPts: mp } = match
  const resultColor = bh > bo ? '#27ae60' : bh === bo ? '#f39c12' : '#e74c3c'
  const resultChar  = bh > bo ? 'W' : bh === bo ? 'D' : 'L'

  return (
    <div className="scored-card" style={{ borderLeftColor: resultColor }}>
      <div className="sc-top">
        <span className="sc-date">{match.dateStr}</span>
        <span className="sc-comp" style={{ background: match.leagueColor }}>{match.leagueAbbr}</span>
        <span className="sc-badge" style={{ background: resultColor }}>{resultChar}</span>
      </div>
      <div className="sc-match">
        <span>FC Barcelona</span>
        <strong className="sc-score">{bh} – {bo}</strong>
        <span>{match.opponent}</span>
      </div>
      <div className="sc-preds">
        <PredResultRow label="👨 Victor" h={pred.victorHome} a={pred.victorAway} pts={vp} />
        <PredResultRow label="👦 Max"    h={pred.maxHome}    a={pred.maxAway}    pts={mp} />
      </div>
    </div>
  )
}

function PredResultRow({ label, h, a, pts }) {
  const hasPred = h !== '' && h != null
  const ptInfo  = pts != null ? PT[pts] : null
  return (
    <div className="pred-row">
      <span className="pred-player">{label}</span>
      <span className="pred-score">{hasPred ? `${h}–${a}` : '—'}</span>
      {ptInfo
        ? <span className={`pred-pts ${ptInfo.cls}`}>{ptInfo.icon} {pts}pt{pts !== 1 ? 's' : ''}</span>
        : <span className="pred-pts muted">no bet</span>
      }
    </div>
  )
}

const RESULT_COLOR = { W: '#27ae60', D: '#f39c12', L: '#e74c3c' }
function HistoryCard({ match }) {
  const color = RESULT_COLOR[match.result]
  return (
    <div className="match-card" style={{ '--accent': color }}>
      <div className="mc-meta">
        <span className="mc-date">{match.dateStr}</span>
        <span className="mc-league" style={{ background: match.leagueColor }}>{match.leagueAbbr}</span>
        <span className="mc-venue">{match.isHome ? 'H' : 'A'}</span>
      </div>
      <div className="mc-body">
        <div className="mc-team">
          <img src="https://a.espncdn.com/i/teamlogos/soccer/500/83.png" alt="FCB" className="mc-logo"
            onError={e => { e.target.style.display = 'none' }} />
          <span className="mc-name">FC Barcelona</span>
        </div>
        <div className="mc-score-wrap">
          <div className="mc-score">
            <span>{match.barcaGoals >= 0 ? match.barcaGoals : '?'}</span>
            <span className="mc-dash">–</span>
            <span>{match.opponentGoals >= 0 ? match.opponentGoals : '?'}</span>
          </div>
          <div className="mc-result-badge">{match.result}</div>
        </div>
        <div className="mc-team mc-opponent">
          <span className="mc-name">{match.opponent}</span>
          {match.opponentLogo && (
            <img src={match.opponentLogo} alt={match.opponent} className="mc-logo"
              onError={e => { e.target.style.display = 'none' }} />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Standings tab ────────────────────────────────────────────────────────────
function StandingsTab({ scoredMatches, standings, loading }) {
  if (loading) return <Spinner label="Loading standings…" />

  if (scoredMatches.length === 0) return (
    <EmptyCard icon="🏆" text="No scored matches yet.">
      <p className="muted" style={{ marginTop: '0.5rem' }}>
        Once you both submit predictions and a match is played,<br />points will appear here automatically.
      </p>
    </EmptyCard>
  )

  const leader = standings.victor > standings.max ? 'victor'
               : standings.max > standings.victor ? 'max' : null

  return (
    <div>
      <div className="big-scoreboard">
        <BigPlayerCard id="victor" emoji="👨" label="Victor" pts={standings.victor} leading={leader === 'victor'} />
        <div className="bsc-vs">vs</div>
        <BigPlayerCard id="max"    emoji="👦" label="Max"    pts={standings.max}    leading={leader === 'max'}    />
      </div>

      <h2 className="section-title" style={{ marginTop: '2rem' }}>Match breakdown</h2>
      <div className="breakdown">
        <div className="bd-header">
          <span>Match</span>
          <span>Score</span>
          <span>👨 Victor</span>
          <span>👦 Max</span>
        </div>
        {scoredMatches.map(m => {
          const { victorPts: vp, maxPts: mp, pred } = m
          return (
            <div key={m.id} className="bd-row">
              <span className="bd-match">
                <span className="bd-opp">{m.opponent}</span>
                <span className="bd-date muted">{m.dateStr}</span>
              </span>
              <span className="bd-result"
                style={{ color: m.barcaGoals > m.opponentGoals ? '#27ae60' : m.barcaGoals === m.opponentGoals ? '#f39c12' : '#e74c3c' }}>
                {m.barcaGoals}–{m.opponentGoals}
              </span>
              <span className={`bd-pts ${vp != null ? PT[vp].cls : ''}`}>
                {vp != null ? `${PT[vp].icon} ${vp}` : '—'}
                {pred.victorHome !== '' && pred.victorHome != null
                  ? <span className="bd-pred">({pred.victorHome}–{pred.victorAway})</span>
                  : <span className="bd-pred muted">no bet</span>}
              </span>
              <span className={`bd-pts ${mp != null ? PT[mp].cls : ''}`}>
                {mp != null ? `${PT[mp].icon} ${mp}` : '—'}
                {pred.maxHome !== '' && pred.maxHome != null
                  ? <span className="bd-pred">({pred.maxHome}–{pred.maxAway})</span>
                  : <span className="bd-pred muted">no bet</span>}
              </span>
            </div>
          )
        })}
        <div className="bd-row bd-total">
          <span><strong>Total</strong></span>
          <span></span>
          <span className="bd-pts"><strong>{standings.victor} pts</strong></span>
          <span className="bd-pts"><strong>{standings.max} pts</strong></span>
        </div>
      </div>
    </div>
  )
}

function BigPlayerCard({ emoji, label, pts, leading }) {
  return (
    <div className={`bpc ${leading ? 'bpc-leading' : ''}`}>
      {leading && <div className="bpc-crown">👑 Leading</div>}
      <div className="bpc-emoji">{emoji}</div>
      <div className="bpc-name">{label}</div>
      <div className="bpc-pts">{pts}<span className="bpc-label">pts</span></div>
    </div>
  )
}

// ─── Utility components ───────────────────────────────────────────────────────
function Spinner({ label }) {
  return (
    <div className="spinner-wrap">
      <div className="spinner" />
      {label && <p className="muted">{label}</p>}
    </div>
  )
}

function EmptyCard({ icon, text, children }) {
  return (
    <div className="empty-card">
      {icon && <span className="empty-icon">{icon}</span>}
      <p>{text}</p>
      {children}
    </div>
  )
}

function SetupBanner() {
  return (
    <div className="setup-banner">
      <strong>⚙️ Connect Google Sheets to save predictions</strong>
      <p>Add your Apps Script URL to <code>.env.local</code> as <code>VITE_SCRIPT_URL</code>. See the setup guide below.</p>
    </div>
  )
}
