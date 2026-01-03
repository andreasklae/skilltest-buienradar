# Solution overview (Zypp Skill Test — Dutch Weather Analysis)

This repository collects Buienradar weather station data, stores it in a small SQLite database, and presents the answers in a simple React website hosted on GitHub Pages.

## Live website

Live dashboard:

- `https://andreasklae.github.io/skilltest-buienradar/`

**GitHub Pages setting to use:** set Pages **Source** to **GitHub Actions**.  
(The `deploy-pages.yml` workflow builds and deploys the React site automatically.)

## What I built

- **Data collection (Part 1)**: A Python script fetches the latest Buienradar JSON snapshot and updates a local SQLite database.
- **Data model (Part 1 + ERD)**: The database uses two tables:
  - `stations`: station metadata (one row per station)
  - `measurements`: measurement values per station + timestamp (many rows per station)
- **Analysis (Part 2)**: The React site reads exported JSON (generated from the SQLite database) and answers:
  - Q5: station with the highest temperature (latest snapshot)
  - Q6: average temperature (across all stored measurements)
  - Q7: station with the biggest difference between “feel temperature” and actual temperature
  - Q8: station located in the North Sea
- **Visualization (Part 3 — 9B)**: The website includes a chart showing the average temperature over time.

## How the automation works (Part 3 — 9A)

Buienradar updates the station data roughly every 20 minutes. Instead of running anything manually:

- A **GitHub Action** runs automatically every **20 minutes**.
- Each run:
  - fetches the newest Buienradar snapshot,
  - inserts it into the SQLite database (without duplicating the same station+timestamp),
  - exports the database tables to JSON for the website,
  - commits the updated database + exports back to `main`.

When new exports are committed to `main`, a second workflow deploys the updated React site to GitHub Pages.

This means the database is continuously populated during the day, and the website always reflects the newest measurements without you doing anything.

Note: the site redeploy is triggered automatically after each scheduled data refresh.

## How to run locally (quick)

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


