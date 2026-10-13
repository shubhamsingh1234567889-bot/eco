# 🌱 EcoTrack

A personal **carbon footprint tracker** for the sustainability track of a hackathon. Log your travel, food, home energy and waste, and EcoTrack turns it into an eco score, a trend forecast and personalised swaps that save the most CO₂.

## Features

- **Activity logging** across transport, food, energy and waste, with a live CO₂e preview
- **Dashboard**: today's total, 7-day average, eco score, green streak
- **Charts**: 14-day trend with a 7-day forecast, category breakdown
- **Smart tips**: ranked by the kg CO₂e *your own* habits would save per week
- **What-if simulator**: "what if I replaced 100 km of car with bus?"
- **Leaderboard** and an adjustable daily goal
- Light and dark mode, keyboard accessible, mobile friendly

## Tech stack

| Layer    | Choice |
|----------|--------|
| Backend  | Node.js (20+), Express |
| Database | SQLite via `better-sqlite3` |
| Frontend | Vanilla HTML/CSS/JS, Chart.js (CDN) |
| Tests    | Node's built-in test runner |

No build step. One `npm install` and it runs.

## Quick start

```bash
npm install
npm run seed     # optional: demo users + 3 weeks of data
npm start        # http://localhost:3000
npm test
```

Environment variables: `PORT` (default `3000`), `DB_FILE` (default `data/ecotrack.db`).

## Project structure

```
server.js              entry point
src/
  app.js               Express app factory and REST API
  db.js                SQLite schema
  emissions.js         emission factors + CO2e calculation
  algorithms.js        scoring, streak, forecast, tips, simulator
public/                frontend (index.html, styles.css, app.js)
scripts/seed.js        demo data
tests/                 algorithm and API tests
```

## The algorithms

All live in `src/algorithms.js` and are unit-tested.

1. **Emission calculation**: `kg CO2e = quantity × emission factor` (`src/emissions.js`).
2. **Eco score (0-100)**: with `ratio = 7-day average ÷ daily goal`, the score is 100 at ratio ≤ 0.5, 0 at ratio ≥ 2, and linear in between.
3. **Green streak**: consecutive days that were logged *and* within the daily goal. An unlogged today does not break the streak.
4. **Trend forecast**: ordinary least-squares linear regression over logged days, projected 7 days ahead (clamped at 0), plus a projected monthly total. Needs at least 3 logged days.
5. **Recommendation engine**: rule-based. Each rule inspects the last 7 days (e.g. km driven, beef meals, kWh, landfill kg), proposes a realistic swap, computes the weekly saving from the user's real numbers, and the top 3 are shown.
6. **What-if simulator**: `saving = quantity × (factor_from − factor_to)`, shown as tree-years of absorption (≈ 21 kg CO₂ per tree per year).

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/factors` | Categories, activity types, factors |
| POST | `/api/users` | Create user `{ name }` |
| GET | `/api/users/:id` | Get user |
| PUT | `/api/users/:id/goal` | Set daily goal `{ dailyGoal }` |
| POST | `/api/activities` | Log `{ userId, category, type, quantity, date }` |
| GET | `/api/activities?userId=&limit=` | Recent activities |
| DELETE | `/api/activities/:id?userId=` | Delete an activity |
| GET | `/api/dashboard?userId=&today=` | Stats, charts data, forecast, tips |
| POST | `/api/simulate` | `{ category, fromType, toType, quantity }` |
| GET | `/api/leaderboard` | Top 10 by eco score |

## Notes and limitations

- Emission factors are rounded public averages (DEFRA, IPCC and Our World in Data style figures; India grid factor for electricity). They are for awareness, not official carbon accounting. Localise them in `src/emissions.js`.
- Users are name-only profiles stored in the browser, with no passwords. Add real authentication before any public deployment.

## Ideas for next steps

- Real authentication and per-user privacy
- Receipt or bill scanning for energy and food
- Team challenges and badges
- Region-specific factors from a public dataset
- Deploy to Render, Railway or Fly.io

## Credits

All application code in this repository was written from scratch for this project. Third-party packages: [Express](https://expressjs.com), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) and [Chart.js](https://www.chartjs.org), each under its own open-source license.

## License

MIT
