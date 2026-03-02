import { useState, useEffect, useMemo, useRef } from 'react'

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
  5: { icon: '🎯', cls: 'pts-5', text: 'Resultat exacte!'    },
  3: { icon: '⭐', cls: 'pts-3', text: 'Diferència correcta' },
  1: { icon: '✓',  cls: 'pts-1', text: 'Resultat correcte'  },
  0: { icon: '✗',  cls: 'pts-0', text: 'Incorrecte'         },
}

// ─── Countdown helper ─────────────────────────────────────────────────────────
function timeLeft(matchDate) {
  const diff = matchDate - new Date()
  if (diff <= 0) return null
  const totalMin = Math.floor(diff / 60_000)
  const days  = Math.floor(totalMin / (60 * 24))
  const hours = Math.floor((totalMin % (60 * 24)) / 60)
  const mins  = totalMin % 60
  if (days >= 2)  return `${days} dies`
  if (days === 1) return `${hours > 0 ? `1d ${hours}h` : '1 dia'}`
  if (hours > 0)  return `${hours}h ${mins}m`
  return `${mins}m`
}

// ─── Season helper ────────────────────────────────────────────────────────────
function getMatchSeason(date) {
  const y = date.getFullYear()
  const m = date.getMonth()           // 0 = Jan, 7 = Aug
  const startYear = m >= 7 ? y : y - 1
  return `${startYear}/${String(startYear + 1).slice(2)}`
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
            dateStr:      date.toLocaleDateString('ca', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }),
            timeStr:      date.toLocaleTimeString('ca', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }) + ' CET',
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
            dateStr:       date.toLocaleDateString('ca', { day: '2-digit', month: 'short', year: 'numeric' }),
            opponent:      opponent.team?.displayName ?? 'Unknown',
            opponentLogo:  opponent.team?.logos?.[0]?.href ?? null,
            isHome:        barca.homeAway === 'home',
            barcaGoals:    Math.round(barca.score?.value    ?? -1),
            opponentGoals: Math.round(opponent.score?.value ?? -1),
            result,
            season:      getMatchSeason(date),
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

// ─── ESPN: player stats ───────────────────────────────────────────────────────
// ESPN season year = start year of season (2025 → 2025/26, 2024 → 2024/25)
const PLAYER_SEASON_LABELS = { '2025': '2025/26', '2024': '2024/25', '2023': '2023/24' }
const PLAYER_CACHE_TTL = 12 * 60 * 60 * 1000  // 12 h

// Radar axes: attacking at top (0°, 60°, 300°), defensive at bottom (120°, 180°, 240°)
const RADAR_AXES = [
  { key: 'goals',          label: 'Gols'    },  // 0°   top          ← atac
  { key: 'assists',        label: 'Assist.' },  // 60°  sup-dreta    ← atac
  { key: 'totalShots',     label: 'Tirs'    },  // 120° inf-dreta    ← esforç
  { key: 'foulsCommitted', label: 'Pressió' },  // 180° baix         ← defensa
  { key: 'foulsWon',       label: 'Duels'   },  // 240° inf-esquerra ← defensa
  { key: 'shotsOnTarget',  label: 'Tirs/P'  },  // 300° sup-esquerra ← atac
]

// Position → display group
function posGroup(pos) {
  const p = (pos ?? '').toUpperCase()
  if (['G', 'GK'].includes(p)) return 'Porter'
  if (p.startsWith('CD') || ['CB','LB','RB','LWB','RWB','DF','SW','D'].includes(p)) return 'Defenses'
  if (['F','FW','ST','CF','LW','RW','SS'].includes(p)) return 'Davanters'
  return 'Migcampistes'
}

// Single API call with localStorage caching
async function fetchPlayerStats(seasonYear = '2025') {
  const cacheKey = `barca_players_${seasonYear}`
  try {
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      const { ts, data } = JSON.parse(cached)
      if (Date.now() - ts < PLAYER_CACHE_TTL) return data
    }
  } catch { /* ignore */ }

  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/teams/${BARCA_ID}/roster?enable=stats&season=${seasonYear}`
    )
    if (!res.ok) return []
    const d = await res.json()

    const players = (d.athletes ?? []).map(ath => {
      const statsMap = {}
      ;(ath.statistics?.splits?.categories ?? []).forEach(cat => {
        ;(cat.stats ?? []).forEach(s => { statsMap[s.name] = s.value ?? 0 })
      })
      const appearances = statsMap.appearances ?? 0
      if (appearances === 0) return null
      return {
        id:             ath.id,
        name:           ath.fullName ?? ath.displayName ?? '',
        shortName:      ath.shortName ?? ath.displayName ?? '',
        jersey:         ath.jersey ?? '',
        position:       ath.position?.abbreviation ?? '?',
        goals:          statsMap.totalGoals    ?? 0,
        assists:        statsMap.goalAssists   ?? 0,
        shotsOnTarget:  statsMap.shotsOnTarget ?? 0,
        totalShots:     statsMap.totalShots    ?? 0,
        foulsWon:       statsMap.foulsSuffered ?? 0,
        foulsCommitted: statsMap.foulsCommitted ?? 0,
        yellowCards:    statsMap.yellowCards   ?? 0,
        redCards:       statsMap.redCards      ?? 0,
        appearances,
        saves:          statsMap.saves         ?? 0,
        shotsFaced:     statsMap.shotsFaced    ?? 0,
        goalsConceded:  statsMap.goalsConceded ?? 0,
      }
    }).filter(Boolean)
      .sort((a, b) => b.goals - a.goals || b.assists - a.assists || b.appearances - a.appearances)

    try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: players })) } catch { }
    return players
  } catch { return [] }
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
  const [filterRes,    setFilterRes    ] = useState('all')
  const [filterSeason, setFilterSeason ] = useState('all')

  const [playerSeason,    setPlayerSeason   ] = useState('2025')
  const [playerStats,     setPlayerStats    ] = useState([])
  const [loadingPlayers,  setLoadingPlayers ] = useState(false)
  const playersFetchedRef = useRef(new Set())

  // Live clock — updates every 30 s so the lock engages at kickoff
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    fetchUpcoming().then(u => { setUpcoming(u); setLoadingUp(false) })
    fetchCompleted().then(c => { setCompleted(c); setLoadingComp(false) })
    fetchPredictions().then(p => { setPredictions(p); setLoadingPreds(false) })
  }, [])

  // Fetch player stats lazily when the Players tab is first visited (per season)
  useEffect(() => {
    if (tab !== 'players') return
    if (playersFetchedRef.current.has(playerSeason)) return
    setLoadingPlayers(true)
    fetchPlayerStats(playerSeason).then(stats => {
      setPlayerStats(stats)
      setLoadingPlayers(false)
      playersFetchedRef.current.add(playerSeason)
    })
  }, [tab, playerSeason])

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

  const isMatchLocked = nextMatch ? nextMatch.date <= now : false

  async function handleSave() {
    if (!nextMatch || predH === '' || predA === '' || !player) return
    if (nextMatch.date <= new Date()) return  // hard guard — match already started
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
    setSavedMsg('Desat ✓')
    setTimeout(() => setSavedMsg(''), 3000)
  }

  const seasons = useMemo(() =>
    Array.from(new Set(completed.map(m => m.season))).filter(Boolean).sort().reverse(),
    [completed]
  )

  const filteredCompleted = useMemo(() => {
    let list = completed
    if (filterSeason !== 'all') list = list.filter(m => m.season === filterSeason)
    if (filterRes    !== 'all') list = list.filter(m => m.result === filterRes)
    return list
  }, [completed, filterSeason, filterRes])

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
                  filterSeason={filterSeason}
                  onFilterSeason={setFilterSeason}
                  seasons={seasons}
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

              {tab === 'players' && (
                <PlayersTab
                  stats={playerStats}
                  loading={loadingPlayers}
                  season={playerSeason}
                  onSeason={s => {
                    if (s === playerSeason) return
                    setPlayerSeason(s)
                    setPlayerStats([])
                  }}
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
          <h1>Pronòstics FCB</h1>
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
      <p className="gate-label">Qui juga?</p>
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
        { id: 'predict',   label: '🔮 Pronostica'    },
        { id: 'results',   label: '📊 Resultats'    },
        { id: 'standings', label: '🏆 Classificació' },
        { id: 'players',   label: '👥 Jugadors'      },
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
        ? <Spinner label="Cercant el proper partit…" />
        : !nextMatch
        ? <EmptyCard icon="⏳" text="No s'ha trobat cap partit en els propers 90 dies." />
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
          <h2 className="section-title">Pròxims partits</h2>
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
  const remaining = !isLocked ? timeLeft(match.date) : null

  const playerLabel = { victor: '👨 Victor', max: '👦 Max' }
  const oppLabel    = { victor: '👨 Victor', max: '👦 Max' }

  return (
    <div className="predict-card">
      {/* League + date */}
      <div className="pc-header">
        <span className="pc-league" style={{ background: match.leagueColor }}>{match.league}</span>
        <span className="pc-date">{match.dateStr} · {match.timeStr}</span>
        {isLocked
          ? <span className="locked-badge">🔒 Tancat</span>
          : remaining && <span className="time-left">⏱ {remaining} per apostar</span>
        }
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
      <p className="pc-venue-note">{match.isHome ? '🏟️ Camp Nou — Partit a casa' : `✈️ Fora, contra el ${match.opponent}`}</p>

      {/* Your prediction */}
      <div className="pc-pred-section">
        <div className="pc-pred-label">Pronòstic de {playerLabel[player]}</div>
        <div className="pc-inputs-row">
          <input type="number" min="0" max="20" className="score-input" placeholder="–"
            value={predH} onChange={e => onH(e.target.value)} disabled={isLocked} />
          <span className="input-sep">–</span>
          <input type="number" min="0" max="20" className="score-input" placeholder="–"
            value={predA} onChange={e => onA(e.target.value)} disabled={isLocked} />

          {!isLocked && (
            <button className="save-btn" onClick={onSave}
              disabled={saving || predH === '' || predA === ''}>
              {saving ? '…' : myPredStored ? 'Actualitza' : 'Desa'}
            </button>
          )}
        </div>
        {savedMsg && <div className="saved-msg">{savedMsg}</div>}
      </div>

      {/* Other player's prediction (revealed after you submit) */}
      <div className="pc-opp-pred">
        <div className="pc-pred-label">Pronòstic de {oppLabel[oppId]}</div>
        {myPredStored
          ? oppPred
            ? <div className="opp-revealed">{oppPred.h} – {oppPred.a}</div>
            : <div className="opp-pending">Encara no enviat</div>
          : <div className="opp-hidden">🙈 Envia el teu per veure el seu</div>
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
  const leader = standings.victor > standings.max ? '👨 Victor guanya'
               : standings.max > standings.victor ? '👦 Max guanya'
               : 'Empatats!'
  return (
    <div className="mini-standings">
      <div className="ms-title">Classificació · {leader}</div>
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
function ResultsTab({ scoredMatches, completed, filtered, filterRes, onFilter, filterSeason, onFilterSeason, seasons, loadingComp, loadingPreds }) {
  const loading = loadingComp || loadingPreds

  // Stats computed from the season-filtered subset (or all if no season selected)
  const base = filterSeason === 'all' ? completed : completed.filter(m => m.season === filterSeason)
  const w  = base.filter(m => m.result === 'W').length
  const d  = base.filter(m => m.result === 'D').length
  const l  = base.filter(m => m.result === 'L').length
  const wr = base.length > 0 ? Math.round(w / base.length * 100) : 0

  return (
    <div>
      {/* Prediction game results section */}
      {!loading && scoredMatches.length > 0 && (
        <section style={{ marginBottom: '2.5rem' }}>
          <h2 className="section-title">🎯 Resultats dels pronòstics</h2>
          <div className="matches-list">
            {scoredMatches.map(m => <ScoredMatchCard key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {/* ESPN history */}
      <section>
        <h2 className="section-title">📋 Historial · Últims 2 anys</h2>

        {/* Season filter */}
        {!loading && seasons.length > 1 && (
          <div className="filter-bar">
            {[{ val: 'all', label: 'Totes' }, ...seasons.map(s => ({ val: s, label: s }))].map(o => (
              <button key={o.val}
                className={filterSeason === o.val ? 'pill active' : 'pill'}
                style={filterSeason === o.val ? { background: 'var(--barca-blue)', borderColor: 'var(--barca-blue)' } : {}}
                onClick={() => onFilterSeason(o.val)}
              >{o.label}</button>
            ))}
          </div>
        )}

        {/* Stats */}
        {!loading && (
          <div className="stats-bar">
            {[
              { label: 'Jugats',      val: base.length, color: 'var(--text)' },
              { label: 'Guanyats',   val: w,            color: '#27ae60' },
              { label: 'Empats',     val: d,            color: '#f39c12' },
              { label: 'Perduts',    val: l,            color: '#e74c3c' },
              { label: '% Victòries', val: `${wr}%`,   color: '#27ae60' },
            ].map(s => (
              <div key={s.label} className="stat-pill" style={{ borderTopColor: s.color }}>
                <span className="sp-val" style={{ color: s.color }}>{s.val}</span>
                <span className="sp-label">{s.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Result filter */}
        {!loading && (
          <div className="filter-bar">
            {[
              { val: 'all', label: 'Tots',      color: 'var(--barca-blue)' },
              { val: 'W',   label: 'Victòries', color: '#27ae60' },
              { val: 'D',   label: 'Empats',    color: '#f39c12' },
              { val: 'L',   label: 'Derrotes',  color: '#e74c3c' },
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
          ? <Spinner label="Carregant historial de partits…" />
          : <>
              <p className="matches-count">
                Mostrant <strong>{filtered.length}</strong> de {completed.length} partits
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
  const resultChar  = bh > bo ? 'V' : bh === bo ? 'E' : 'D'

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
        : <span className="pred-pts pts-0">✗ 0pts</span>
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
        <span className="mc-venue">{match.isHome ? 'Casa' : 'Fora'}</span>
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
          <div className="mc-result-badge">{{ W: 'V', D: 'E', L: 'D' }[match.result]}</div>
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
  if (loading) return <Spinner label="Carregant classificació…" />

  if (scoredMatches.length === 0) return (
    <div>
      <EmptyCard icon="🏆" text="Encara no hi ha partits puntuats.">
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          Un cop envieu els pronòstics i es jugui un partit,<br />els punts apareixeran aquí automàticament.
        </p>
      </EmptyCard>
      <ScoringGuide />
    </div>
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

      <ScoringGuide />

      <h2 className="section-title" style={{ marginTop: '2rem' }}>Resum per partits</h2>
      <div className="breakdown">
        <div className="bd-header">
          <span>Partit</span>
          <span>Resultat</span>
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
              <span className={`bd-pts ${vp != null ? PT[vp].cls : 'pts-0'}`}>
                {vp != null ? `${PT[vp].icon} ${vp}` : '✗ 0'}
                {pred.victorHome !== '' && pred.victorHome != null
                  ? <span className="bd-pred">({pred.victorHome}–{pred.victorAway})</span>
                  : <span className="bd-pred muted">sense pronòstic</span>}
              </span>
              <span className={`bd-pts ${mp != null ? PT[mp].cls : 'pts-0'}`}>
                {mp != null ? `${PT[mp].icon} ${mp}` : '✗ 0'}
                {pred.maxHome !== '' && pred.maxHome != null
                  ? <span className="bd-pred">({pred.maxHome}–{pred.maxAway})</span>
                  : <span className="bd-pred muted">sense pronòstic</span>}
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
      {leading && <div className="bpc-crown">👑 Guanyant</div>}
      <div className="bpc-emoji">{emoji}</div>
      <div className="bpc-name">{label}</div>
      <div className="bpc-pts">{pts}<span className="bpc-label">pts</span></div>
    </div>
  )
}

// ─── Scoring guide ────────────────────────────────────────────────────────────
function ScoringGuide() {
  const rules = [
    { icon: '🎯', cls: 'pts-5', pts: '5 punts', desc: 'Resultat exacte — tots dos gols encertats',         example: 'ex. pronòstic 2–1, resultat 2–1' },
    { icon: '⭐', cls: 'pts-3', pts: '3 punts', desc: 'Resultat correcte i diferència de gols exacta',     example: 'ex. pronòstic 3–1, resultat 4–2 (totes dues victòries per 2)' },
    { icon: '✓',  cls: 'pts-1', pts: '1 punt',  desc: 'Resultat correcte (victòria / empat / derrota)',    example: 'ex. pronòstic 1–0, resultat 3–1' },
    { icon: '✗',  cls: 'pts-0', pts: '0 punts', desc: 'Resultat incorrecte',                               example: 'ex. pronòstic victòria, el Barça perd' },
  ]
  return (
    <div className="scoring-guide">
      <h2 className="scoring-guide-title">Com s'atorguen els punts</h2>
      <div className="scoring-rules">
        {rules.map(r => (
          <div key={r.pts} className="scoring-rule">
            <span className={`sr-icon ${r.cls}`}>{r.icon}</span>
            <div className="sr-body">
              <span className={`sr-pts ${r.cls}`}>{r.pts}</span>
              <span className="sr-desc">{r.desc}</span>
              <span className="sr-example">{r.example}</span>
            </div>
          </div>
        ))}
      </div>
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
      <strong>⚙️ Connecta Google Sheets per desar els pronòstics</strong>
      <p>Afegeix la URL del teu Apps Script a <code>.env.local</code> com a <code>VITE_SCRIPT_URL</code>.</p>
    </div>
  )
}

// ─── Players tab ───────────────────────────────────────────────────────────────
const POS_COLOR = { G: '#f39c12', GK: '#f39c12', D: '#3498db', M: '#27ae60', F: '#e74c3c', FW: '#e74c3c' }
const GROUPS    = ['Porter', 'Defenses', 'Migcampistes', 'Davanters']

function PlayersTab({ stats, loading, season, onSeason }) {
  // Team max values per metric for radar normalization
  const maxValues = useMemo(() => {
    const m = {}
    RADAR_AXES.forEach(ax => {
      m[ax.key] = Math.max(1, ...stats.map(p => p[ax.key] ?? 0))
    })
    return m
  }, [stats])

  // Group by position
  const grouped = useMemo(() => {
    const g = {}
    GROUPS.forEach(grp => { g[grp] = [] })
    stats.forEach(p => {
      const grp = posGroup(p.position)
      ;(g[grp] ?? g['Migcampistes']).push(p)
    })
    return g
  }, [stats])

  return (
    <div>
      {/* Season selector */}
      <div className="filter-bar" style={{ marginBottom: '1.5rem' }}>
        {Object.entries(PLAYER_SEASON_LABELS).map(([year, label]) => (
          <button key={year}
            className={season === year ? 'pill active' : 'pill'}
            style={season === year ? { background: 'var(--barca-blue)', borderColor: 'var(--barca-blue)' } : {}}
            onClick={() => onSeason(year)}
          >{label} · La Liga</button>
        ))}
      </div>

      {loading
        ? <Spinner label="Carregant estadístiques dels jugadors…" />
        : stats.length === 0
        ? <EmptyCard icon="📊" text="No s'han trobat estadístiques per a aquesta temporada." />
        : GROUPS.filter(g => (grouped[g]?.length ?? 0) > 0).map(grp => (
            <section key={grp} style={{ marginBottom: '2rem' }}>
              <h2 className="section-title">{grp}</h2>
              <div className="players-grid">
                {grouped[grp].map(p => <PlayerCard key={p.id} player={p} maxValues={maxValues} />)}
              </div>
            </section>
          ))
      }
    </div>
  )
}

function PlayerCard({ player: p, maxValues }) {
  const posColor = POS_COLOR[p.position] ?? POS_COLOR[p.position?.[0]] ?? 'var(--muted)'
  const isGK     = ['G', 'GK'].includes(p.position)
  const initials = (p.shortName || p.name).split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="player-card">
      {/* Header: avatar + name + position */}
      <div className="plc-header">
        <div className="plc-avatar" style={{ borderColor: posColor }}>
          <span className="plc-avatar-num">{p.jersey || initials}</span>
          <span className="plc-avatar-pos" style={{ background: posColor }}>{p.position}</span>
        </div>
        <div className="plc-info">
          <span className="plc-name">{p.shortName || p.name}</span>
          <span className="plc-apps">{p.appearances} partits</span>
        </div>
      </div>

      {/* Radar or GK stats */}
      {isGK
        ? <div className="plc-gk-grid">
            <GkStat val={p.appearances}   label="Partits" />
            <GkStat val={p.saves}         label="Aturades" />
            <GkStat val={p.shotsFaced}    label="Tirs rebuts" />
            <GkStat val={p.goalsConceded} label="Gols encaixats" />
          </div>
        : <RadarChart player={p} maxValues={maxValues} />
      }

      {/* Bottom stats strip (outfield only) */}
      {!isGK && (
        <div className="plc-strip">
          <StripStat icon="⚽" val={p.goals}         label="Gols" gold />
          <StripStat icon="🎯" val={p.assists}       label="Assist." />
          <StripStat icon="👟" val={p.shotsOnTarget} label="Tirs/P" />
          <StripStat icon="💪" val={p.foulsWon}      label="Duels" />
          {p.yellowCards > 0 && <span className="card-y">{p.yellowCards}</span>}
          {p.redCards    > 0 && <span className="card-r">{p.redCards}</span>}
        </div>
      )}
    </div>
  )
}

function GkStat({ val, label }) {
  return (
    <div className="plc-gk-stat">
      <span className="plc-gk-val">{Math.round(val)}</span>
      <span className="plc-gk-label">{label}</span>
    </div>
  )
}

function StripStat({ icon, val, label, gold }) {
  return (
    <div className="plc-strip-stat">
      <span className={`plc-strip-val${gold ? ' gold' : ''}`}>{Math.round(val)}</span>
      <span className="plc-strip-label">{icon} {label}</span>
    </div>
  )
}

// ─── Radar chart ───────────────────────────────────────────────────────────────
function RadarChart({ player, maxValues, size = 180 }) {
  const N  = RADAR_AXES.length
  const cx = size / 2
  const cy = size / 2
  const R  = size * 0.30      // polygon radius
  const LABEL_OFFSET = 18
  const LEVELS = 4

  const angleOf = i => (i / N) * 2 * Math.PI - Math.PI / 2   // 0 = top

  const toXY = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)]

  // Grid polygon points for one level
  const gridPoints = level => {
    const r = R * ((level + 1) / LEVELS)
    return RADAR_AXES.map((_, i) => toXY(r, angleOf(i)).join(',')).join(' ')
  }

  // Data polygon
  const dataPts = RADAR_AXES.map((ax, i) => {
    const frac = Math.min((player[ax.key] ?? 0) / maxValues[ax.key], 1)
    return toXY(R * frac, angleOf(i))
  })
  const dataPath = dataPts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ') + 'Z'

  // Label positions
  const labels = RADAR_AXES.map((ax, i) => {
    const a = angleOf(i)
    const [x, y] = toXY(R + LABEL_OFFSET, a)
    const anchor = x > cx + 4 ? 'start' : x < cx - 4 ? 'end' : 'middle'
    return { ...ax, x: x.toFixed(1), y: y.toFixed(1), anchor }
  })

  const vb = `${-LABEL_OFFSET} ${-LABEL_OFFSET} ${size + LABEL_OFFSET * 2} ${size + LABEL_OFFSET * 2}`

  return (
    <svg width={size} height={size} viewBox={vb} className="radar-svg">
      {/* Subtle attack/defense shading */}
      <path d={`M${cx},${cy} ${RADAR_AXES.slice(0,3).concat(RADAR_AXES[5]).map((_,i2) => {
        const idx = [0,1,2,5][i2]; const [x,y] = toXY(R,angleOf(idx)); return `L${x.toFixed(1)},${y.toFixed(1)}`
      }).join(' ')} Z`} fill="rgba(237,187,0,0.04)" />
      <path d={`M${cx},${cy} ${[2,3,4].map(idx => {
        const [x,y]=toXY(R,angleOf(idx)); return `L${x.toFixed(1)},${y.toFixed(1)}`
      }).join(' ')} Z`} fill="rgba(120,120,160,0.05)" />

      {/* Grid levels */}
      {Array.from({ length: LEVELS }, (_, l) => (
        <polygon key={l} points={gridPoints(l)} fill="none"
          stroke={`rgba(255,255,255,${0.05 + l * 0.025})`} strokeWidth="0.75" />
      ))}

      {/* Axes */}
      {RADAR_AXES.map((_, i) => {
        const [x2, y2] = toXY(R, angleOf(i))
        return <line key={i} x1={cx} y1={cy} x2={x2.toFixed(1)} y2={y2.toFixed(1)}
          stroke="rgba(255,255,255,0.12)" strokeWidth="0.75" />
      })}

      {/* Axis labels */}
      {labels.map((l, i) => (
        <text key={i} x={l.x} y={l.y} textAnchor={l.anchor} dominantBaseline="middle"
          fontSize="8.5" fontWeight="600"
          fill={i < 2 || i === 5 ? 'rgba(237,187,0,0.85)' : 'rgba(150,150,200,0.85)'}>
          {l.label}
        </text>
      ))}

      {/* Data fill */}
      <path d={dataPath} fill="rgba(0,77,152,0.28)" stroke="#004D98" strokeWidth="1.75" strokeLinejoin="round" />

      {/* Data points */}
      {dataPts.map(([x, y], i) => (
        <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="2.5"
          fill="#004D98" stroke="rgba(255,255,255,0.6)" strokeWidth="0.75" />
      ))}
    </svg>
  )
}
