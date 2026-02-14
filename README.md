# Unofficial FPL Snapshot (MVP)

A lightweight, mobile-friendly dashboard for FPL team **403618**.

## What it does

- Shows the next FPL deadline and a live countdown timer.
- Shows team summary stats from entry history:
  - Total points
  - Latest overall rank
  - Best gameweek points
  - Worst gameweek points
- Includes a manual **Refresh** button.
- Caches API responses in `localStorage` for 10 minutes to reduce repeat requests.

## Public endpoints used (no login)

- `https://fantasy.premierleague.com/api/bootstrap-static/`
- `https://fantasy.premierleague.com/api/entry/403618/history/`

## Run locally

From the project root:

```bash
python3 -m http.server 8000
```

Then open:

- `http://localhost:8000`

## Deploy to GitHub Pages

1. Push this repo to GitHub (branch: `main`).
2. Open your repo on GitHub.
3. Go to **Settings** → **Pages**.
4. Under **Build and deployment**, set:
   - **Source**: Deploy from a branch
   - **Branch**: `main`
   - **Folder**: `/ (root)`
5. Save and wait for Pages to publish.
