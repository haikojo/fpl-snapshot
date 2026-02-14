# Changelog

## v1.1.0 — Entry ID selection and sharing

### Added
- Entry ID selector to view any public Fantasy Premier League team
- Shareable links using `?entry=ID` query parameter
- Team name display in the summary panel for selected entry
- Improved personalization when viewing shared dashboards

### Notes
- All data remains read-only and sourced from public FPL endpoints
- No authentication or user data is stored

## v1.0.0 — Initial public release

### Added
- Live Fantasy Premier League data via public API (proxied for GitHub Pages)
- Gameweek deadline countdown with status indicators
- Gameweek type detection (Normal / Double / Blank)
- Team performance summary and trends
- Historical points and rank charts
- Private league snapshot upload via CSV
- Full league comparison chart with color-coded teams

### Visuals
- FPL-inspired energetic color theme (original, non-branded)
- Clean card-based dashboard layout
- Decorative SVG section dividers for visual rhythm
- Responsive design for desktop and mobile

### Technical
- Static HTML/CSS/JS architecture
- Cloudflare Worker proxy for CORS-safe data access
- GitHub Pages deployment
- Local caching for improved performance

---

This is an unofficial Fantasy Premier League companion app.  
No affiliation with the Premier League or the official FPL site.
