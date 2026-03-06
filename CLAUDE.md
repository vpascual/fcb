# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server (Vite, hot reload)
npm run build    # Production build
npm run preview  # Preview production build
```

No test runner is configured.

## Environment

Copy `.env.local.example` to `.env.local` and set `VITE_SCRIPT_URL` to the deployed Google Apps Script URL. Without it, prediction saving and loading are silently disabled.

The app is deployed under the `/fcb/` base path (configured in `vite.config.js`).

## Architecture

This is a single-file React app — all logic lives in `src/App.jsx` (~1300 lines). There are no components split across files. `src/index.css` contains all styles with no CSS framework.

### Data sources

- **ESPN API** (public, no auth): Two fetch functions hit `site.api.espn.com`:
  - `fetchUpcoming()` — queries the scoreboard endpoint across all 4 leagues for the next 90 days, filtered to Barca (team ID `83`) matches
  - `fetchCompleted()` — queries the team schedule endpoint for 3 seasons per league, filtered to completed matches within the last ~2 years
  - `fetchPlayerStats(seasonYear)` — queries the roster endpoint with stats; results are cached in `localStorage` for 12 hours
- **Google Apps Script** (`VITE_SCRIPT_URL`): Backs a Google Sheet with columns `matchId | victorHome | victorAway | maxHome | maxAway`. Two operations:
  - `fetchPredictions()` — GET `?action=getData`
  - `savePrediction()` — GET `?action=save&...` (GET to avoid CORS preflight)

### App state

- **Player identity** (`victor` or `max`) is stored in `localStorage` as `barca_player` and selected via a gate screen on first visit
- **Tab routing** uses URL hash (`#predict`, `#results`, `#standings`, `#players`) — synced via `window.location.hash` and a `hashchange` listener
- **Predictions** are keyed by ESPN event ID and held in a `predictions` state map (`{ [matchId]: { victorHome, victorAway, maxHome, maxAway } }`). The column names mean **home team goals** and **away team goals** — always in standard football notation regardless of which team is Barca. The UI always renders the home team on the left and the away team on the right, so the left input binds to `predH` (home) and the right input to `predA` (away) with no swapping.
- **Scoring**: `calcPoints(barcaGoals, oppGoals, predBarca, predOpp)` returns 5 (exact), 3 (correct GD), 1 (correct result), or 0. Because `victorHome`/`victorAway` follow home/away order (not Barca/opponent order), the caller must pass the values in the right order: for home games `(victorHome, victorAway)`, for away games `(victorAway, victorHome)` — see the `scoredMatches` useMemo.

### Tabs

| Tab | Description |
|-----|-------------|
| `predict` | Prediction form for the next upcoming match + list of next 5 matches. Inputs are locked once `match.date <= now` (clock ticks every 30s). Shows opponent's prediction only after the match is locked. |
| `results` | Filterable list of completed matches with each player's prediction and points. Filters: result (W/D/L) and season. |
| `standings` | Head-to-head point totals, a breakdown table of every scored match, and a scoring guide. |
| `players` | Player cards with radar charts (outfield) or stat grids (GK). Radar modal rendered via `createPortal` to escape card `transform` context. Player stats cached per season. |

### Key conventions

- ESPN's Barca team ID is `83` (`BARCA_ID` constant)
- Leagues are defined in the `LEAGUES` array at the top of `App.jsx`; adding a new competition only requires adding an entry there
- UI text is in Catalan
- CSS custom properties are defined in `:root` in `index.css` — use `var(--barca-blue)`, `var(--surface)`, etc. for all colors
