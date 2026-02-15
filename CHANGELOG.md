# Changelog

## [1.1.1] – 2026-02-15

### Added
- Support for viewing any public Fantasy Premier League team via Entry ID
- Stable Cloudflare proxy routing for all entry IDs

### Changed
- Replaced empty divider cards with subtle glowing section dividers
- Improved visual rhythm and spacing between dashboard sections
- Reduced chart-like or misleading decorative elements

### Fixed
- Proxy configuration inconsistencies that prevented some team IDs from loading
- Edge cases where data failed to load when switching entry IDs

### Added
- Demo / placeholder league history for the league standings chart when only 0–1 snapshots are available
- Clear “Demo history” labeling to distinguish simulated data from uploaded snapshots

### Changed
- League standings chart now renders meaningful trends even with limited historical data
- Demo data is generated at render time and never persisted as real snapshot data

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
