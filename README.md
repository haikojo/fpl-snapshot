# Unofficial FPL Snapshot

A lightweight, mobile-friendly dashboard for FPL team **403618**.

## What it does

- Shows the next FPL deadline and a live countdown timer.
- Shows team summary stats and trends from entry history.
- Includes manual refresh.
- Caches API responses in `localStorage` for 10 minutes.
- Supports **Direct/Proxy** fetch mode for environments where CORS blocks direct FPL requests.

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

## Fixing fetch errors on GitHub Pages (CORS)

GitHub Pages runs in a browser context where direct requests to FPL can be blocked by CORS. This repo includes a simple Cloudflare Worker proxy.

### Worker files in this repo

- `worker.js`
- `wrangler.toml`

The proxy is **read-only** and supports public GET routes only:

- `GET /bootstrap-static`
- `GET /entry/403618/history`

### Deploy the Worker

1. Install Wrangler:

```bash
npm install -g wrangler
```

2. Authenticate:

```bash
wrangler login
```

3. Deploy from repo root:

```bash
wrangler deploy
```

4. Copy the deployed Worker URL (for example: `https://fpl-snapshot-proxy.<subdomain>.workers.dev`).

### Connect the app to your proxy

1. Open the app.
2. Enable **Proxy mode** in the settings row.
3. Paste your Worker URL into the proxy URL input.
4. Click **Save**.

The app stores these settings in `localStorage`.

## Notes

- The proxy does not use secrets.
- It only forwards public FPL API data.
- It adds CORS headers and short cache headers (`max-age=300`).
