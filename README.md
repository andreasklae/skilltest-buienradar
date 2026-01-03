# Dutch Weather Analysis (Buienradar) — Solution

**TL;DR**
- Live dashboard: `https://andreasklae.github.io/skilltest-buienradar/`
- Backend: Python fetches Buienradar → updates `data/weather.sqlite` → exports JSON for the frontend
- Frontend: React dashboard that shows Part 1 ERD, Part 2 answers (Q5–Q8), and Part 3 visualizations (9B)
- Automation: GitHub Actions refreshes the dataset **every 20 minutes** and redeploys GitHub Pages

The original skill test description is in **`TASK.md`**.  
This `README.md` explains my implementation, how it runs, and how it stays updated automatically.

## Live dashboard
`https://andreasklae.github.io/skilltest-buienradar/`


## What the backend does (Python + SQLite)

The backend is a set of small Python scripts that:

- **Fetch** the latest Buienradar JSON snapshot
- **Normalize** the data into a 3NF/BCNF-style model
- **Store** it in SQLite (`.sqlite`)
- **Export** frontend-friendly JSON files

### Data model (Part 1)

SQLite database file:
- `data/weather.sqlite`

Tables:
- **`stations`**
  - PK: `stationid`
  - Columns: `stationname`, `lat`, `lon`, `regio`
- **`measurements`**
  - PK: `measurementid` (AUTOINCREMENT)
  - FK: `stationid` → `stations.stationid`
  - Unique (dedupe): `(stationid, timestamp)`
  - Columns: `timestamp`, `temperature`, `groundtemperature`, `feeltemperature`, `windgusts`, `windspeedBft`, `humidity`, `precipitation`, `sunpower`

ERD image used in the dashboard:
- `ERD1.png`

### Scripts

- **Fetch JSON**: `src/fetch_JSON.py`  
  Saves raw snapshots under `data/raw/`.

- **Load/update database**: `src/load_json_to_sql.py`  
  Reads the latest raw snapshot, writes to `data/weather.sqlite`, and avoids duplicate inserts via the unique key.

- **Export for the frontend**: `src/export_db_to_json.py`  
  Exports:
  - `web/public/data/stations.json`
  - `web/public/data/measurements.json`
  - `web/public/data/meta.json` (includes `generated_at_utc` shown on the site)

## What the frontend does (React)

The frontend lives in `web/` and is deployed to GitHub Pages.

It loads the exported JSON and renders a simple dashboard split into:

- **Part 1**: ERD shown first
- **Part 2 (Q5–Q8)**: answers based on the full dataset (no visualization filters)
- **Part 3 (9B)**: data visualization for a single selected **region**, with:
  - region navigation (**Previous / Next**) + a dropdown to jump to a region
  - a “Most recent measurements” panel
  - time-series charts underneath (per metric)
  - time range buttons (6h / 24h / 7d / All)

## Automation (Part 3 — 9A): how it’s actually done here

Automation is done with **GitHub Actions**.

### Scheduled refresh + deploy (every 20 minutes)

Workflow: `.github/workflows/update-data.yml`

Every 20 minutes it:
- fetches new Buienradar data
- updates `data/weather.sqlite`
- exports JSON into `web/public/data/`
- builds the React site
- deploys the site to GitHub Pages

This is why the dashboard’s “Updated” timestamp should advance automatically.

### Manual/push deploy

Workflow: `.github/workflows/deploy-pages.yml`

This is a standard “deploy Pages” workflow that runs on pushes to `main` or manually.

## Run locally

### Update database and exports

```bash
python3 -m pip install -r requirements.txt
python3 src/fetch_JSON.py
python3 src/load_json_to_sql.py
python3 src/export_db_to_json.py
```

### Build the website

```bash
cd web
npm install
npm run build
```


