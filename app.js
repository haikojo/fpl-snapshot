const TEAM_ID = 403618;
const TTL_MS = 10 * 60 * 1000;
const BOOTSTRAP_URL = "https://fantasy.premierleague.com/api/bootstrap-static/";
const ENTRY_HISTORY_URL = `https://fantasy.premierleague.com/api/entry/${TEAM_ID}/history/`;
const FIXTURES_URL = "https://fantasy.premierleague.com/api/fixtures/";
const SETTINGS_KEY = "fpl_snapshot_settings";
const DEFAULT_PROXY_BASE_URL = "https://fpl-proxy.fpl-snapshot.workers.dev";

function isGitHubPages() {
  return location.hostname.endsWith("github.io");
}

let settings = {
  useProxy: isGitHubPages(), // default ON for GitHub Pages
  proxyBaseUrl: DEFAULT_PROXY_BASE_URL,
};

const deadlineCard = document.getElementById("deadlineCard");
const summaryCard = document.getElementById("summaryCard");
const refreshBtn = document.getElementById("refreshBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const errorBanner = document.getElementById("errorBanner");
const retryLoadBtn = document.getElementById("retryLoadBtn");
const useProxyToggle = document.getElementById("useProxyToggle");
const proxyBaseUrlInput = document.getElementById("proxyBaseUrlInput");
const saveProxySettingsBtn = document.getElementById("saveProxySettingsBtn");
const modeLabel = document.getElementById("modeLabel");
const modeValueText = document.getElementById("modeValueText");
const pointsChart = document.getElementById("pointsChart");
const rankChart = document.getElementById("rankChart");
const last6TableContainer = document.getElementById("last6TableContainer");
const leagueCsvInput = document.getElementById("leagueCsvInput");
const importLeagueBtn = document.getElementById("importLeagueBtn");
const loadDemoLeagueBtn = document.getElementById("loadDemoLeagueBtn");
const clearLeagueBtn = document.getElementById("clearLeagueBtn");
const leagueStatus = document.getElementById("leagueStatus");
const highlightSelect = document.getElementById("highlightSelect");
const highlightNameInput = document.getElementById("highlightNameInput");
const leagueContent = document.getElementById("leagueContent");
const leagueOverviewContent = document.getElementById("leagueOverviewContent");

const DEFAULT_REFRESH_LABEL = "Refresh";
const LEAGUE_HISTORY_KEY = "fpl_private_league_history";
const LEAGUE_HIGHLIGHT_KEY = "fpl_private_league_highlight_name";
let countdownInterval = null;
let lastRenderedHistory = [];
let currentTheme = "light";
let hiddenLeagueTeams = new Set();
const lastUpdatedLabel = document.getElementById("lastUpdatedLabel");

function updateLastUpdated(value) {
  if (!lastUpdatedLabel) return;
  const dateValue = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dateValue.getTime())) return;
  const shortTime = dateValue.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  lastUpdatedLabel.textContent = shortTime;
}

function showErrorBanner(message = "Could not load data — retry?") {
  if (!errorBanner) return;
  const text = errorBanner.querySelector("span");
  if (text) text.textContent = message;
  errorBanner.classList.add("is-visible");
}

function hideErrorBanner() {
  if (!errorBanner) return;
  errorBanner.classList.remove("is-visible");
}

function pulseGameweekIconOnce() {
  const icon = document.querySelector("#deadlineCard h2 .mini-icon");
  if (!icon) return;

  icon.classList.remove("pulse-once");
  // Force restart so repeated successful refreshes can replay once.
  void icon.offsetWidth;
  icon.classList.add("pulse-once");
  icon.addEventListener(
    "animationend",
    () => {
      icon.classList.remove("pulse-once");
    },
    { once: true },
  );
}

function setRefreshButtonState(isLoading) {
  if (!refreshBtn) return;
  refreshBtn.disabled = isLoading;
  if (isLoading) {
    refreshBtn.textContent = "Refreshing...";
  } else {
    refreshBtn.textContent = DEFAULT_REFRESH_LABEL;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "-";
  return Number(value).toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setLeagueStatus(message, isError = false) {
  if (!leagueStatus) return;
  leagueStatus.textContent = message;
  leagueStatus.classList.toggle("pl-status-error", isError);
}

function readLeagueHistory() {
  try {
    const raw = localStorage.getItem(LEAGUE_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLeagueHistory(snapshots) {
  localStorage.setItem(LEAGUE_HISTORY_KEY, JSON.stringify(snapshots));
}

function getHighlightName() {
  try {
    return localStorage.getItem(LEAGUE_HIGHLIGHT_KEY) || "Your Team";
  } catch {
    return "Your Team";
  }
}

function setHighlightName(name) {
  const value = String(name || "").trim();
  try {
    localStorage.setItem(LEAGUE_HIGHLIGHT_KEY, value);
  } catch {
    // Ignore storage errors.
  }
}

function parseCsvLine(line) {
  const raw = String(line).trim();
  const normalized = (
    raw.length >= 2
    && raw.startsWith('"')
    && raw.endsWith('"')
    && raw.includes(",")
  )
    ? raw.slice(1, -1)
    : raw;

  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (ch === '"') {
      if (inQuotes && normalized[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseLeagueCsv(text) {
  const lines = String(text)
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) throw new Error("CSV is empty.");

  const first = parseCsvLine(lines[0]).map((v) => v.toLowerCase());
  const isHeader = first.includes("gw") || first.includes("name") || first.includes("points") || first.includes("rank");
  const startIdx = isHeader ? 1 : 0;

  const rows = [];
  for (let i = startIdx; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 4) throw new Error(`Invalid row ${i + 1}: expected 4 columns.`);
    const gw = Number(cols[0]);
    const name = String(cols[1] || "").trim();
    const points = Number(cols[2]);
    const rank = Number(cols[3]);
    if (!Number.isFinite(gw) || !Number.isInteger(gw)) throw new Error(`Invalid gw at row ${i + 1}.`);
    if (!name) throw new Error(`Missing name at row ${i + 1}.`);
    if (!Number.isFinite(points)) throw new Error(`Invalid points at row ${i + 1}.`);
    if (!Number.isFinite(rank)) throw new Error(`Invalid rank at row ${i + 1}.`);
    rows.push({ gw, name, points, rank });
  }

  if (!rows.length) throw new Error("No data rows found in CSV.");

  const gw = rows[0].gw;
  const mixedGw = rows.some((row) => row.gw !== gw);
  if (mixedGw) throw new Error("CSV must contain a single GW snapshot.");

  const snapshotRows = rows
    .map((row) => ({ name: row.name, points: row.points, rank: row.rank }))
    .sort((a, b) => a.rank - b.rank);

  return { gw, rows: snapshotRows };
}

function getLeagueNames(snapshots) {
  const set = new Set();
  snapshots.forEach((snap) => snap.rows.forEach((row) => set.add(row.name)));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function renderHighlightControls(snapshots) {
  if (!highlightSelect || !highlightNameInput) return;
  const names = getLeagueNames(snapshots);
  const saved = getHighlightName();
  const current = saved || "Your Team";

  highlightSelect.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "Custom...";
  highlightSelect.appendChild(blank);

  names.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    highlightSelect.appendChild(option);
  });

  if (names.includes(current)) {
    highlightSelect.value = current;
  } else {
    highlightSelect.value = "";
  }
  highlightNameInput.value = current;
}

function buildLeagueSeries(snapshots, highlightName) {
  const sorted = [...snapshots].sort((a, b) => a.gw - b.gw);
  const pointsGap = [];
  const rankSeries = [];

  sorted.forEach((snap) => {
    const rows = [...snap.rows];
    const your = rows.find((row) => row.name === highlightName);
    const leaderPoints = rows.reduce((max, row) => Math.max(max, Number(row.points) || 0), 0);
    if (your) {
      rankSeries.push({ gw: snap.gw, value: Number(your.rank), points: Number(your.points) });
      pointsGap.push({ gw: snap.gw, value: leaderPoints - Number(your.points) });
    } else {
      rankSeries.push({ gw: snap.gw, value: null, points: null });
      pointsGap.push({ gw: snap.gw, value: null });
    }
  });

  return { sorted, rankSeries, pointsGap };
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function getTeamColor(name) {
  const hue = hashString(String(name)) % 360;
  return `hsl(${hue} 68% 46%)`;
}

function getLeagueOverviewData(snapshots) {
  const sortedSnapshots = [...snapshots].sort((a, b) => a.gw - b.gw);
  const gws = sortedSnapshots.map((s) => s.gw);
  const teamSet = new Set();
  sortedSnapshots.forEach((snapshot) => {
    snapshot.rows.forEach((row) => {
      teamSet.add(row.name);
    });
  });
  const teamNames = Array.from(teamSet).sort((a, b) => a.localeCompare(b));

  const teamSeries = teamNames.map((name) => {
    const values = sortedSnapshots.map((snapshot) => {
      const row = snapshot.rows.find((r) => r.name === name);
      return {
        gw: snapshot.gw,
        value: row ? Number(row.rank) : null,
      };
    });
    return {
      name,
      color: getTeamColor(name),
      values,
    };
  });

  return { gws, teamSeries };
}

function getNiceRankStep(maxRank) {
  if (maxRank <= 6) return 1;
  if (maxRank <= 12) return 2;
  if (maxRank <= 20) return 5;
  if (maxRank <= 40) return 10;
  return Math.max(10, Math.ceil(maxRank / 5));
}

function drawLeagueOverviewChart(canvas, gws, teamSeries, highlightName) {
  if (!canvas) return;
  const ratio = window.devicePixelRatio || 1;
  const cssWidth = Math.max(canvas.clientWidth || 680, 300);
  const cssHeight = 360;
  canvas.width = Math.floor(cssWidth * ratio);
  canvas.height = Math.floor(cssHeight * ratio);
  canvas.style.height = `${cssHeight}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  const pad = { left: 46, right: 14, top: 16, bottom: 34 };
  const styles = getComputedStyle(document.documentElement);
  const grid = styles.getPropertyValue("--chart-grid").trim() || "#d2dde9";
  const text = styles.getPropertyValue("--muted").trim() || "#6b7280";
  const axis = styles.getPropertyValue("--border-strong").trim() || "#c3cfdd";

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = styles.getPropertyValue("--chart-bg").trim() || "#f5f8fc";
  ctx.fillRect(0, 0, width, height);

  const allValues = teamSeries.flatMap((team) => team.values.map((v) => v.value).filter((v) => Number.isFinite(v)));
  const maxRank = Math.max(1, ...allValues, teamSeries.length);
  const yStep = getNiceRankStep(maxRank);
  const yTicks = [];
  for (let rank = 1; rank <= maxRank; rank += yStep) yTicks.push(rank);
  if (yTicks[yTicks.length - 1] !== maxRank) yTicks.push(maxRank);

  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const minGw = Math.min(...gws);
  const maxGw = Math.max(...gws);
  const gwRange = maxGw - minGw || 1;

  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  yTicks.forEach((tick) => {
    const norm = (tick - 1) / ((maxRank - 1) || 1);
    const y = pad.top + norm * chartH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
  });

  ctx.fillStyle = text;
  ctx.font = "12px sans-serif";
  yTicks.forEach((tick) => {
    const norm = (tick - 1) / ((maxRank - 1) || 1);
    const y = pad.top + norm * chartH;
    ctx.fillText(String(tick), 8, y + 4);
  });

  const xTickStride = Math.max(1, Math.ceil(gws.length / 8));
  gws.forEach((gw, index) => {
    if (index % xTickStride !== 0 && index !== gws.length - 1) return;
    const x = pad.left + ((gw - minGw) / gwRange) * chartW;
    ctx.strokeStyle = grid;
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, height - pad.bottom);
    ctx.stroke();

    ctx.fillStyle = text;
    ctx.fillText(String(gw), x - 8, height - 12);
  });

  ctx.strokeStyle = axis;
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.left, pad.top, chartW, chartH);
  ctx.fillStyle = text;
  ctx.fillText("GW", width - 28, height - 8);
  ctx.fillText("Rank (1 is best)", 8, 12);

  teamSeries.forEach((team) => {
    if (hiddenLeagueTeams.has(team.name) && team.name !== highlightName) return;
    const isHighlighted = team.name === highlightName;
    ctx.strokeStyle = team.color;
    ctx.lineWidth = isHighlighted ? 3 : 1.4;
    ctx.globalAlpha = isHighlighted ? 1 : 0.32;
    ctx.beginPath();
    let started = false;

    team.values.forEach((point) => {
      if (!Number.isFinite(point.value)) {
        started = false;
        return;
      }
      const x = pad.left + ((point.gw - minGw) / gwRange) * chartW;
      const y = pad.top + ((point.value - 1) / ((maxRank - 1) || 1)) * chartH;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

function renderLeagueOverviewCard(snapshots, highlightName) {
  if (!leagueOverviewContent) return;
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    leagueOverviewContent.innerHTML = `
      <p class="muted">No snapshots yet. Upload a CSV to start tracking your private league.</p>
    `;
    return;
  }

  const { gws, teamSeries } = getLeagueOverviewData(snapshots);
  hiddenLeagueTeams = new Set(
    Array.from(hiddenLeagueTeams).filter((name) => teamSeries.some((team) => team.name === name)),
  );
  if (highlightName) hiddenLeagueTeams.delete(highlightName);

  const legendItems = teamSeries.map((team) => {
    const isHighlighted = team.name === highlightName;
    const isHidden = hiddenLeagueTeams.has(team.name) && !isHighlighted;
    return `
      <button
        type="button"
        class="pl-legend-item ${isHidden ? "is-hidden" : ""} ${isHighlighted ? "is-locked" : ""}"
        data-team-name="${escapeHtml(team.name)}"
        title="${isHighlighted ? "Highlighted team stays visible" : "Toggle line visibility"}"
      >
        <span class="pl-legend-swatch" style="background:${team.color};"></span>
        <span>${escapeHtml(team.name)}</span>
      </button>
    `;
  }).join("");

  leagueOverviewContent.innerHTML = `
    <div class="pl-overview-tools">
      <p class="pl-overview-highlight">
        Highlight: <span class="badge badge--neutral">${escapeHtml(highlightName || "None")}</span>
      </p>
      <div class="pl-overview-actions">
        <button id="leagueShowAllBtn" type="button" class="btn btn-secondary btn-small">Show all</button>
        <button id="leagueHideAllBtn" type="button" class="btn btn-secondary btn-small">Hide all</button>
      </div>
    </div>
    <canvas id="leagueAllRankChart" class="pl-overview-canvas" aria-label="Private league all teams rank over time chart"></canvas>
    <p class="pl-overview-note">Rank 1 is best (top).</p>
    <div id="leagueAllLegend" class="pl-overview-legend">${legendItems}</div>
  `;

  drawLeagueOverviewChart(
    document.getElementById("leagueAllRankChart"),
    gws,
    teamSeries,
    highlightName,
  );

  const legend = document.getElementById("leagueAllLegend");
  if (legend) {
    legend.addEventListener("click", (event) => {
      const button = event.target.closest(".pl-legend-item");
      if (!button) return;
      const teamName = button.getAttribute("data-team-name");
      if (!teamName || teamName === highlightName) return;
      if (hiddenLeagueTeams.has(teamName)) hiddenLeagueTeams.delete(teamName);
      else hiddenLeagueTeams.add(teamName);
      renderLeagueOverviewCard(snapshots, highlightName);
    });
  }

  const showAllBtn = document.getElementById("leagueShowAllBtn");
  if (showAllBtn) {
    showAllBtn.addEventListener("click", () => {
      hiddenLeagueTeams.clear();
      renderLeagueOverviewCard(snapshots, highlightName);
    });
  }

  const hideAllBtn = document.getElementById("leagueHideAllBtn");
  if (hideAllBtn) {
    hideAllBtn.addEventListener("click", () => {
      hiddenLeagueTeams = new Set(teamSeries.map((team) => team.name));
      if (highlightName) hiddenLeagueTeams.delete(highlightName);
      renderLeagueOverviewCard(snapshots, highlightName);
    });
  }
}

function drawLeagueLineChart(canvas, points, labelText, invertY = false) {
  if (!canvas) return;
  const ratio = window.devicePixelRatio || 1;
  const cssWidth = Math.max(canvas.clientWidth || 300, 300);
  const cssHeight = 160;
  canvas.width = Math.floor(cssWidth * ratio);
  canvas.height = Math.floor(cssHeight * ratio);
  canvas.style.height = `${cssHeight}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  const pad = { left: 34, right: 12, top: 16, bottom: 26 };
  const styles = getComputedStyle(document.documentElement);
  const grid = styles.getPropertyValue("--chart-grid").trim() || "#d2dde9";
  const text = styles.getPropertyValue("--muted").trim() || "#6b7280";
  const line = styles.getPropertyValue("--chart-rank").trim() || "#3b82f6";

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.left, pad.top, width - pad.left - pad.right, height - pad.top - pad.bottom);

  const valid = points.filter((p) => Number.isFinite(p.value));
  if (valid.length < 2) {
    ctx.strokeStyle = grid;
    ctx.beginPath();
    ctx.moveTo(pad.left + 8, height / 2);
    ctx.lineTo(width - pad.right - 8, height / 2);
    ctx.stroke();
  } else {
    const minX = Math.min(...points.map((p) => p.gw));
    const maxX = Math.max(...points.map((p) => p.gw));
    const minY = Math.min(...valid.map((p) => p.value));
    const maxY = Math.max(...valid.map((p) => p.value));
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;

    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;

    points.forEach((p) => {
      if (!Number.isFinite(p.value)) {
        started = false;
        return;
      }
      const x = pad.left + ((p.gw - minX) / rangeX) * (width - pad.left - pad.right);
      const normY = (p.value - minY) / rangeY;
      const y = invertY
        ? pad.top + normY * (height - pad.top - pad.bottom)
        : height - pad.bottom - normY * (height - pad.top - pad.bottom);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  }

  ctx.fillStyle = text;
  ctx.font = "12px sans-serif";
  ctx.fillText("GW", width - 28, height - 8);
  ctx.fillText(labelText, 8, 12);
}

function renderLeagueLatestTable(snapshot, highlightName) {
  if (!snapshot) return `<p class="muted">No snapshots yet. Upload a CSV to start tracking your private league.</p>`;
  const sortedRows = [...snapshot.rows].sort((a, b) => a.rank - b.rank);
  const top5 = sortedRows.slice(0, 5);
  const yourRow = sortedRows.find((row) => row.name === highlightName);
  const hasYouInTop5 = top5.some((row) => row.name === highlightName);
  const displayRows = hasYouInTop5 || !yourRow ? top5 : [...top5, yourRow];

  const rows = displayRows
    .map((row) => `
      <tr class="${row.name === highlightName ? "pl-you-row" : ""}">
        <td>${row.rank}</td>
        <td>${escapeHtml(row.name)} ${row.name === highlightName ? `<span class="badge badge--good">you</span>` : ""}</td>
        <td>${row.points}</td>
      </tr>
    `)
    .join("");
  return `
    <table class="pl-mini-table">
      <thead><tr><th>Rank</th><th>Name</th><th>Points</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderLeagueCard() {
  if (!leagueContent) return;
  const snapshots = readLeagueHistory().sort((a, b) => a.gw - b.gw);
  renderHighlightControls(snapshots);
  const highlightName = (highlightNameInput?.value || getHighlightName() || "Your Team").trim();
  const latest = snapshots[snapshots.length - 1];

  if (!snapshots.length) {
    leagueContent.innerHTML = `<p class="muted">No snapshots yet. Upload a CSV to start tracking your private league.</p>`;
    renderLeagueOverviewCard([], highlightName);
    return;
  }

  const series = buildLeagueSeries(snapshots, highlightName);
  const currentGapPoint = [...series.pointsGap].reverse().find((p) => Number.isFinite(p.value));
  const currentGap = currentGapPoint ? currentGapPoint.value : "n/a";

  leagueContent.innerHTML = `
    <div class="pl-summary">
      <span>Snapshots: <strong>${snapshots.length}</strong></span>
      <span>Last GW: <strong>${latest.gw}</strong></span>
    </div>
    ${renderLeagueLatestTable(latest, highlightName)}
    <div class="pl-chart-wrap">
      <p class="pl-chart-label">Rank over time (${escapeHtml(highlightName)})</p>
      <canvas id="leagueRankChart" class="pl-chart" aria-label="Private league rank history chart"></canvas>
      <p class="pl-gap">Current gap to leader: ${currentGap}</p>
    </div>
    <div class="pl-chart-wrap">
      <p class="pl-chart-label">Points gap to leader</p>
      <canvas id="leagueGapChart" class="pl-chart" aria-label="Private league gap history chart"></canvas>
    </div>
  `;

  drawLeagueLineChart(
    document.getElementById("leagueRankChart"),
    series.rankSeries,
    "Rank (1 is best)",
    true,
  );
  drawLeagueLineChart(
    document.getElementById("leagueGapChart"),
    series.pointsGap,
    "Gap to leader",
    false,
  );

  renderLeagueOverviewCard(snapshots, highlightName);
}

function upsertSnapshot(snapshot) {
  const snapshots = readLeagueHistory();
  const idx = snapshots.findIndex((s) => s.gw === snapshot.gw);
  if (idx >= 0) {
    const ok = window.confirm(`GW ${snapshot.gw} already exists. Overwrite snapshot?`);
    if (!ok) return false;
    snapshots[idx] = snapshot;
    setLeagueStatus(`Overwrote GW ${snapshot.gw} snapshot.`);
  } else {
    snapshots.push(snapshot);
    setLeagueStatus(`Imported GW ${snapshot.gw} snapshot.`);
  }
  snapshots.sort((a, b) => a.gw - b.gw);
  writeLeagueHistory(snapshots);
  return true;
}

function loadDemoLeagueData() {
  const names = ["Your Team", "North XI", "Pressing Unit", "Expected Goals", "Wildcards FC", "Bench Boosters", "Captain Chaos", "Set Piece Lab"];
  const snapshots = [24, 25, 26, 27, 28, 29].map((gw, idx) => {
    const rows = names.map((name, i) => {
      const points = 1500 + idx * 45 + (names.length - i) * 17 + (i % 3) * 9;
      return { name, points, rank: 0 };
    });
    rows.sort((a, b) => b.points - a.points).forEach((row, i) => {
      row.rank = i + 1;
    });
    const your = rows.find((r) => r.name === "Your Team");
    if (your) your.points += idx % 2 === 0 ? 10 : -8;
    rows.sort((a, b) => b.points - a.points).forEach((row, i) => {
      row.rank = i + 1;
    });
    return { gw, rows };
  });
  writeLeagueHistory(snapshots);
  setHighlightName("Your Team");
  setLeagueStatus("Demo data loaded.");
  renderLeagueCard();
}

async function importLeagueCsvFromInput() {
  if (!leagueCsvInput?.files?.length) {
    setLeagueStatus("Select a CSV file first.", true);
    return;
  }
  try {
    const file = leagueCsvInput.files[0];
    const text = await file.text();
    const snapshot = parseLeagueCsv(text);
    const ok = upsertSnapshot(snapshot);
    if (ok) renderLeagueCard();
  } catch (error) {
    setLeagueStatus(error instanceof Error ? error.message : "Failed to import CSV.", true);
  }
}

function clearLeagueHistory() {
  const ok = window.confirm("Clear all private league snapshots?");
  if (!ok) return;
  localStorage.removeItem(LEAGUE_HISTORY_KEY);
  setLeagueStatus("League history cleared.");
  renderLeagueCard();
}

function initializePrivateLeague() {
  renderLeagueCard();

  if (importLeagueBtn) {
    importLeagueBtn.addEventListener("click", () => {
      importLeagueCsvFromInput();
    });
  }

  if (loadDemoLeagueBtn) {
    loadDemoLeagueBtn.addEventListener("click", () => {
      loadDemoLeagueData();
    });
  }

  if (clearLeagueBtn) {
    clearLeagueBtn.addEventListener("click", () => {
      clearLeagueHistory();
    });
  }

  if (highlightSelect) {
    highlightSelect.addEventListener("change", () => {
      const value = highlightSelect.value || highlightNameInput?.value || "";
      if (highlightNameInput) highlightNameInput.value = value;
      setHighlightName(value);
      renderLeagueCard();
    });
  }

  if (highlightNameInput) {
    highlightNameInput.addEventListener("change", () => {
      setHighlightName(highlightNameInput.value);
      renderLeagueCard();
    });
  }
}

function getPreferredTheme() {
  try {
    const stored = localStorage.getItem("fpl_theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Ignore storage access issues.
  }

  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme) {
  currentTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", currentTheme);
  if (themeToggleBtn) {
    themeToggleBtn.textContent = "Light/Dark";
    themeToggleBtn.setAttribute("aria-pressed", String(currentTheme === "dark"));
    themeToggleBtn.setAttribute("title", `Current theme: ${currentTheme}`);
  }
}

function initializeTheme() {
  applyTheme(getPreferredTheme());

  if (!themeToggleBtn) return;
  themeToggleBtn.addEventListener("click", () => {
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    try {
      localStorage.setItem("fpl_theme", nextTheme);
    } catch {
      // Ignore storage access issues.
    }
    renderTrendsCard(lastRenderedHistory);
    renderLeagueCard();
  });
}

function normalizeProxyBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function renderSettingsUi() {
  if (useProxyToggle) useProxyToggle.checked = settings.useProxy;
  if (proxyBaseUrlInput) {
    proxyBaseUrlInput.value = settings.proxyBaseUrl;
    proxyBaseUrlInput.disabled = !settings.useProxy;
  }
  if (modeLabel) modeLabel.textContent = settings.useProxy ? "Proxy mode" : "Direct mode";
  if (modeValueText) modeValueText.textContent = settings.useProxy ? "Proxy" : "Direct";
}

function loadSettings() {
  // Start from safe defaults (in case settings was modified elsewhere)
  if (typeof settings.useProxy !== "boolean") settings.useProxy = isGitHubPages();
  if (!settings.proxyBaseUrl) settings.proxyBaseUrl = DEFAULT_PROXY_BASE_URL;

  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);

    if (typeof parsed?.useProxy === "boolean") settings.useProxy = parsed.useProxy;

    if (typeof parsed?.proxyBaseUrl === "string") {
      const normalized = normalizeProxyBaseUrl(parsed.proxyBaseUrl);
      if (normalized) settings.proxyBaseUrl = normalized;
    }
  } catch {
    // Ignore malformed settings.
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage access issues.
  }
}

function initializeDataSourceSettings() {
  loadSettings();
  renderSettingsUi();

  if (useProxyToggle) {
    useProxyToggle.addEventListener("change", () => {
      settings.useProxy = useProxyToggle.checked;
      renderSettingsUi();
    });
  }

  if (saveProxySettingsBtn) {
    saveProxySettingsBtn.addEventListener("click", () => {
      settings.useProxy = Boolean(useProxyToggle?.checked);
      settings.proxyBaseUrl = normalizeProxyBaseUrl(proxyBaseUrlInput?.value);
      saveSettings();
      renderSettingsUi();
      loadAndRender(true);
    });
  }
}

function getDataSourceLabel() {
  return settings.useProxy ? "Proxy" : "Direct";
}

function getBootstrapApiUrl() {
  if (settings.useProxy) return `${settings.proxyBaseUrl}/bootstrap-static`;
  return BOOTSTRAP_URL;
}

function getEntryHistoryApiUrl() {
  if (settings.useProxy) return `${settings.proxyBaseUrl}/entry/${TEAM_ID}/history`;
  return ENTRY_HISTORY_URL;
}

function getFixturesApiUrl(eventId) {
  if (settings.useProxy) return `${settings.proxyBaseUrl}/fixtures?event=${eventId}`;
  return `${FIXTURES_URL}?event=${eventId}`;
}

function getSourceCacheSuffix() {
  const source = settings.useProxy ? `proxy:${settings.proxyBaseUrl}` : "direct";
  return encodeURIComponent(source);
}

function getCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.timestamp !== "number") return null;
    if (Date.now() - parsed.timestamp > TTL_MS) return null;

    return parsed.data;
  } catch {
    return null;
  }
}

function setCache(key, data) {
  try {
    const payload = {
      timestamp: Date.now(),
      data,
    };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore storage errors (private mode/quota).
  }
}

async function fetchWithCache(url, cacheKey, forceRefresh = false) {
  if (!forceRefresh) {
    const cached = getCache(cacheKey);
    if (cached) return cached;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  const data = await response.json();
  setCache(cacheKey, data);
  return data;
}

function fetchBootstrap(forceRefresh = false) {
  if (settings.useProxy && !settings.proxyBaseUrl) {
    throw new Error("Proxy mode is enabled but proxyBaseUrl is empty. Save a Worker URL or switch to Direct mode.");
  }
  const cacheKey = `fpl_bootstrap_${getSourceCacheSuffix()}`;
  return fetchWithCache(getBootstrapApiUrl(), cacheKey, forceRefresh);
}

function fetchEntryHistory(forceRefresh = false) {
  if (settings.useProxy && !settings.proxyBaseUrl) {
    throw new Error("Proxy mode is enabled but proxyBaseUrl is empty. Save a Worker URL or switch to Direct mode.");
  }
  const cacheKey = `fpl_entry_${TEAM_ID}_history_${getSourceCacheSuffix()}`;
  return fetchWithCache(getEntryHistoryApiUrl(), cacheKey, forceRefresh);
}

function fetchFixturesByEvent(eventId, forceRefresh = false) {
  if (!Number.isFinite(Number(eventId))) {
    throw new Error("Invalid event id for fixtures fetch.");
  }
  if (settings.useProxy && !settings.proxyBaseUrl) {
    throw new Error("Proxy mode is enabled but proxyBaseUrl is empty. Save a Worker URL or switch to Direct mode.");
  }
  const cacheKey = `fpl_fixtures_event_${eventId}_${getSourceCacheSuffix()}`;
  return fetchWithCache(getFixturesApiUrl(eventId), cacheKey, forceRefresh);
}

function formatDate(iso) {
  return new Date(iso).toLocaleString();
}

function formatCountdown(targetIso) {
  const msLeft = new Date(targetIso).getTime() - Date.now();
  if (Number.isNaN(msLeft)) return "Invalid deadline";
  if (msLeft <= 0) return "Deadline passed";

  const totalSeconds = Math.floor(msLeft / 1000);
  const days = Math.floor(totalSeconds / (24 * 3600));
  const hours = Math.floor((totalSeconds % (24 * 3600)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function getMsLeft(targetIso) {
  return new Date(targetIso).getTime() - Date.now();
}

function getUrgencyInfo(msLeft) {
  if (!Number.isFinite(msLeft)) return { text: "Unknown", badgeClass: "badge--neutral" };
  const hoursLeft = msLeft / (1000 * 60 * 60);
  if (hoursLeft > 72) return { text: "Plenty of time", badgeClass: "badge--good" };
  if (hoursLeft >= 24) return { text: "Approaching", badgeClass: "badge--neutral" };
  if (hoursLeft >= 6) return { text: "Soon", badgeClass: "badge--warn" };
  return { text: "Imminent", badgeClass: "badge--danger" };
}

function getRiskFillClass(urgencyBadgeClass) {
  if (urgencyBadgeClass === "badge--good") return "risk-good";
  if (urgencyBadgeClass === "badge--warn") return "risk-warn";
  if (urgencyBadgeClass === "badge--danger") return "risk-danger";
  return "";
}

function computeRiskProgress(msLeft) {
  // Use a fixed 7-day window when precise GW open/start window is unavailable.
  const windowMs = 7 * 24 * 60 * 60 * 1000;
  const progress = ((windowMs - msLeft) / windowMs) * 100;
  return Math.max(0, Math.min(100, progress));
}

function formatLocalDeadline(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString();
}

function getLocalTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || "Local";
  } catch {
    return "Local";
  }
}

function getNextDeadlineEvent(events) {
  if (!Array.isArray(events) || events.length === 0) return null;
  const now = Date.now();
  const upcoming = events
    .filter((event) => {
      const deadline = new Date(event.deadline_time).getTime();
      return Number.isFinite(deadline) && deadline > now;
    })
    .sort((a, b) => new Date(a.deadline_time).getTime() - new Date(b.deadline_time).getTime());
  if (upcoming.length > 0) return upcoming[0];
  return events.find((event) => event.is_next) || null;
}

function getGameweekType(fixtures, teams) {
  const teamIds = Array.isArray(teams) ? teams.map((team) => Number(team.id)).filter((id) => Number.isFinite(id)) : [];
  if (!Array.isArray(fixtures) || fixtures.length === 0 || teamIds.length === 0) {
    return { label: "n/a", badgeClass: "badge--neutral", note: "" };
  }

  const matchCounts = new Map(teamIds.map((id) => [id, 0]));
  fixtures.forEach((fixture) => {
    const home = Number(fixture.team_h);
    const away = Number(fixture.team_a);
    if (matchCounts.has(home)) matchCounts.set(home, (matchCounts.get(home) || 0) + 1);
    if (matchCounts.has(away)) matchCounts.set(away, (matchCounts.get(away) || 0) + 1);
  });

  const counts = Array.from(matchCounts.values());
  const doubleTeams = counts.filter((count) => count >= 2).length;
  const blankTeams = counts.filter((count) => count === 0).length;

  if (doubleTeams > 0) {
    return {
      label: "Double",
      badgeClass: "badge--good",
      note: `Teams with 2 fixtures: ${doubleTeams}`,
    };
  }
  if (blankTeams > 0) {
    return {
      label: "Blank",
      badgeClass: "badge--warn",
      note: `Teams with 0 fixtures: ${blankTeams}`,
    };
  }
  return {
    label: "Normal",
    badgeClass: "badge--neutral",
    note: "Standard schedule",
  };
}

function getLastGwSummary(current) {
  if (!Array.isArray(current) || current.length === 0) {
    return {
      value: "n/a",
      deltaText: "vs prior GW: n/a",
      badgeClass: "badge--neutral",
    };
  }

  const lastPoints = Number(current[current.length - 1]?.points);
  if (!Number.isFinite(lastPoints)) {
    return {
      value: "n/a",
      deltaText: "vs prior GW: n/a",
      badgeClass: "badge--neutral",
    };
  }

  if (current.length < 2 || !Number.isFinite(Number(current[current.length - 2]?.points))) {
    return {
      value: `${lastPoints} pts •`,
      deltaText: "vs prior GW: n/a",
      badgeClass: "badge--neutral",
    };
  }

  const prevPoints = Number(current[current.length - 2].points);
  const delta = lastPoints - prevPoints;
  const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "•";
  const signedDelta = delta > 0 ? `+${delta}` : String(delta);
  return {
    value: `${lastPoints} pts ${arrow}`,
    deltaText: `vs prior GW: ${signedDelta}`,
    badgeClass: delta > 0 ? "badge--good" : delta < 0 ? "badge--warn" : "badge--neutral",
  };
}

function computeRankPercentile(latestRank, totalPlayers) {
  if (!Number.isFinite(latestRank) || !Number.isFinite(totalPlayers) || totalPlayers <= 0) return "n/a";
  const percentile = ((totalPlayers - latestRank) / totalPlayers) * 100;
  return `${Math.max(0, percentile).toFixed(1)}%`;
}

function computeLast6Stats(current) {
  const last6 = Array.isArray(current) ? current.slice(-6) : [];
  const points = last6.map((gw) => Number(gw.points)).filter((v) => Number.isFinite(v));
  const avgPoints = points.length ? (points.reduce((sum, value) => sum + value, 0) / points.length).toFixed(1) : "n/a";

  let rankDeltaText = "• 0";
  let trendDirection = "Flat";
  if (last6.length >= 2) {
    const oldest = Number(last6[0].overall_rank);
    const latest = Number(last6[last6.length - 1].overall_rank);
    if (Number.isFinite(oldest) && Number.isFinite(latest)) {
      const delta = oldest - latest;
      if (delta > 0) {
        rankDeltaText = `▲ ${formatNumber(delta)}`;
        trendDirection = "Up";
      } else if (delta < 0) {
        rankDeltaText = `▼ ${formatNumber(Math.abs(delta))}`;
        trendDirection = "Down";
      }
    }
  }

  return { last6, avgPoints, rankDeltaText, trendDirection };
}

function getTrendSummarySentence(current) {
  const last6 = Array.isArray(current) ? current.slice(-6) : [];
  if (last6.length < 2) return "Rank steady overall. Points consistent.";

  const oldestRank = Number(last6[0].overall_rank);
  const latestRank = Number(last6[last6.length - 1].overall_rank);
  let rankSentence = "Rank steady overall.";
  if (Number.isFinite(oldestRank) && Number.isFinite(latestRank)) {
    if (latestRank < oldestRank) rankSentence = "Rank improving overall.";
    else if (latestRank > oldestRank) rankSentence = "Rank slipping overall.";
  }

  const points = last6.map((gw) => Number(gw.points)).filter((v) => Number.isFinite(v));
  const stdDev = calculateStdDev(points);
  let pointsSentence = "Points consistent.";
  if (Number.isFinite(stdDev)) {
    if (stdDev < 10) pointsSentence = "Points consistent.";
    else if (stdDev <= 20) pointsSentence = "Points variable.";
    else pointsSentence = "Points volatile.";
  }

  return `${rankSentence} ${pointsSentence}`;
}

function iconClockSvg() {
  return `<span class="mini-icon" aria-hidden="true"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="6.4"/><path d="M9 5.6v3.7l2.5 1.6"/></svg></span>`;
}

function iconStarSvg() {
  return `<span class="mini-icon" aria-hidden="true"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2.8l1.7 3.5 3.9.6-2.8 2.8.7 4-3.5-1.9-3.5 1.9.7-4-2.8-2.8 3.9-.6z"/></svg></span>`;
}

function iconRankSvg(direction = "neutral") {
  if (direction === "up") {
    return `<span class="mini-icon" aria-hidden="true"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14V4"/><path d="M5.8 7.2L9 4l3.2 3.2"/></svg></span>`;
  }
  if (direction === "down") {
    return `<span class="mini-icon" aria-hidden="true"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v10"/><path d="M5.8 10.8L9 14l3.2-3.2"/></svg></span>`;
  }
  return `<span class="mini-icon" aria-hidden="true"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 9h9"/></svg></span>`;
}

function iconForCardTitle(title) {
  if (title === "Next Deadline") return iconClockSvg();
  if (title === "Team Summary") return iconStarSvg();
  if (title === "Trends") return iconRankSvg("neutral");
  return "";
}

function badgePill(text, badgeClass = "badge--neutral") {
  return `<span class="badge ${badgeClass}">${text}</span>`;
}

function cardHead(title, badgeText, badgeClass = "badge--neutral", extraBadgesHtml = "") {
  return `
    <div class="card-head">
      <h2>${iconForCardTitle(title)}${title}</h2>
      <div class="card-head-meta">
        ${badgePill(badgeText, badgeClass)}
        ${extraBadgesHtml}
      </div>
    </div>
  `;
}

function getRankMovement(latestRank, previousRank) {
  if (!Number.isFinite(latestRank) || !Number.isFinite(previousRank)) {
    return { text: "● n/a", badgeClass: "badge--neutral", direction: "neutral" };
  }

  const change = previousRank - latestRank;
  if (change > 0) {
    return { text: `▲ ${Math.abs(change).toLocaleString()}`, badgeClass: "badge--good", direction: "up" };
  }
  if (change < 0) {
    return { text: `▼ ${Math.abs(change).toLocaleString()}`, badgeClass: "badge--warn", direction: "down" };
  }
  return { text: "● 0", badgeClass: "badge--neutral", direction: "neutral" };
}

function getFormLast5(current) {
  if (!Array.isArray(current) || current.length === 0) {
    return { points: null, badgeClass: "badge--neutral", text: "● Form5: n/a" };
  }

  const last5 = current.slice(-5);
  const points = last5.reduce((sum, gw) => sum + (Number(gw.points) || 0), 0);
  return { points, badgeClass: "badge--neutral", text: `● Form5: ${points}` };
}

function getBestWorstBadges(current) {
  if (!Array.isArray(current) || current.length === 0) {
    return {
      bestBadgeText: "Best GW: n/a",
      worstBadgeText: "Worst GW: n/a",
    };
  }

  const pointsList = current.map((gw) => Number(gw.points));
  const bestPoints = Math.max(...pointsList);
  const worstPoints = Math.min(...pointsList);
  const bestGw = current.find((gw) => Number(gw.points) === bestPoints);
  const worstGw = current.find((gw) => Number(gw.points) === worstPoints);

  return {
    bestBadgeText: `Best GW: ${formatNumber(bestPoints)} (GW ${bestGw?.event ?? "-"})`,
    worstBadgeText: `Worst GW: ${formatNumber(worstPoints)} (GW ${worstGw?.event ?? "-"})`,
  };
}

function getMomentum(current) {
  if (!Array.isArray(current) || current.length < 4) {
    return "Momentum: Flat";
  }

  const last4 = current.slice(-4);
  const deltas = [
    (Number(last4[1].points) || 0) - (Number(last4[0].points) || 0),
    (Number(last4[2].points) || 0) - (Number(last4[1].points) || 0),
    (Number(last4[3].points) || 0) - (Number(last4[2].points) || 0),
  ];
  const up = deltas.filter((d) => d > 0).length;
  const down = deltas.filter((d) => d < 0).length;

  if (up > down) return "Momentum: Up";
  if (down > up) return "Momentum: Down";
  return "Momentum: Flat";
}

function calculateStdDev(values) {
  const safeValues = values.filter((value) => Number.isFinite(value));
  if (safeValues.length === 0) return null;
  const mean = safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length;
  const variance = safeValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / safeValues.length;
  return Math.sqrt(variance);
}

function getAchievements(current) {
  if (!Array.isArray(current) || current.length === 0) {
    return {
      bestGwText: "Best GW: n/a",
      biggestJumpText: "Biggest rank jump: n/a",
      consistencyText: "Consistency: n/a",
      consistencyBadgeClass: "badge--neutral",
    };
  }

  const pointsList = current.map((gw) => Number(gw.points));
  const bestPoints = Math.max(...pointsList);
  const bestGw = current.find((gw) => Number(gw.points) === bestPoints);

  let biggestJump = null;
  for (let i = 1; i < current.length; i += 1) {
    const prevRank = Number(current[i - 1].overall_rank);
    const nextRank = Number(current[i].overall_rank);
    if (!Number.isFinite(prevRank) || !Number.isFinite(nextRank)) continue;

    const improvement = prevRank - nextRank;
    if (improvement > 0 && (!biggestJump || improvement > biggestJump.improvement)) {
      biggestJump = {
        improvement,
        fromGw: current[i - 1].event,
        toGw: current[i].event,
      };
    }
  }

  const last6Points = current.slice(-6).map((gw) => Number(gw.points));
  const stdDev = calculateStdDev(last6Points);
  const isSteady = Number.isFinite(stdDev) && stdDev <= 10;

  return {
    bestGwText: `Best GW: ${formatNumber(bestPoints)} pts (GW ${bestGw?.event ?? "-"})`,
    biggestJumpText: biggestJump
      ? `Biggest rank jump: ▲ ${formatNumber(biggestJump.improvement)} (GW ${biggestJump.fromGw} -> ${biggestJump.toGw})`
      : "Biggest rank jump: n/a",
    consistencyText: Number.isFinite(stdDev)
      ? `Consistency: ${isSteady ? "Steady" : "Spiky"} (sigma ${stdDev.toFixed(1)})`
      : "Consistency: n/a",
    consistencyBadgeClass: Number.isFinite(stdDev)
      ? (isSteady ? "badge--good" : "badge--warn")
      : "badge--neutral",
  };
}

function renderErrorDetails(detail) {
  if (!detail) return "";
  return `
    <details>
      <summary class="muted" style="cursor:pointer;">Details</summary>
      <p class="muted" style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78rem; word-break: break-word;">
        ${escapeHtml(detail)}
      </p>
    </details>
  `;
}

function ensureChartLegend() {
  const existing = document.getElementById("chartLegend");
  if (existing) return existing;
  const rankBlock = rankChart?.closest(".trend-block");
  if (!rankBlock) return null;

  const legend = document.createElement("p");
  legend.id = "chartLegend";
  legend.className = "muted chart-caption";
  legend.textContent = "Legend: points trend (green), rank trend (blue, lower rank is better).";
  rankBlock.insertAdjacentElement("afterend", legend);
  return legend;
}

function renderDeadlineCard(events, currentHistory = [], teams = [], fixtures = null) {
  const next = getNextDeadlineEvent(events);
  if (!next) {
    deadlineCard.innerHTML = `
      ${cardHead("Next Deadline", "Unavailable", "badge--warn")}
      <p class="error">No upcoming deadline found.</p>
    `;
    return;
  }

  const render = () => {
    const msLeft = getMsLeft(next.deadline_time);
    const urgency = getUrgencyInfo(msLeft);
    const countdownText = formatCountdown(next.deadline_time);
    const riskProgress = computeRiskProgress(msLeft);
    const riskFillClass = getRiskFillClass(urgency.badgeClass);
    const gwType = getGameweekType(fixtures, teams);
    const lastGw = getLastGwSummary(currentHistory);
    const gwTypeNote = gwType.note ? `<p class="helper-note">${gwType.note}</p>` : "";

    deadlineCard.innerHTML = `
      ${cardHead("Next Deadline", `GW ${next.id}`, "badge--good")}
      <p><strong>Gameweek ${next.id}:</strong> ${formatDate(next.deadline_time)}</p>
      <p class="muted">Countdown: ${countdownText}</p>
      <h3 class="section-mini-title">DEADLINE STATUS</h3>
      <div class="status-grid">
        <div class="status-row"><span class="status-label">Time left</span><span class="status-value">${countdownText}</span></div>
        <div class="status-row"><span class="status-label">Urgency</span><span class="status-value">${badgePill(urgency.text, urgency.badgeClass)}</span></div>
        <div class="status-row"><span class="status-label">Deadline (local)</span><span class="status-value">${formatLocalDeadline(next.deadline_time)}</span></div>
        <div class="status-row"><span class="status-label">Timezone</span><span class="status-value">Local time</span></div>
      </div>
      <div class="risk-wrap">
        <div class="risk-track">
          <div class="risk-fill ${riskFillClass}" style="width:${riskProgress.toFixed(1)}%"></div>
        </div>
      </div>
      <h3 class="section-mini-title">GAMEWEEK TYPE</h3>
      <div class="status-grid">
        <div class="status-row"><span class="status-label">Type</span><span class="status-value">${badgePill(gwType.label, gwType.badgeClass)}</span></div>
      </div>
      ${gwTypeNote}
      <h3 class="section-mini-title">LAST GW</h3>
      <div class="status-grid">
        <div class="status-row"><span class="status-label">Points</span><span class="status-value">${badgePill(lastGw.value, lastGw.badgeClass)}</span></div>
      </div>
      <p class="helper-note">${lastGw.deltaText}</p>
    `;
  };

  render();

  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(render, 1000);
}

function renderSummaryCard(current, totalPlayers = null) {
  if (!Array.isArray(current) || current.length === 0) {
    summaryCard.innerHTML = `
      ${cardHead("Team Summary", "No Data", "badge--warn")}
      <p class="error">No entry history available.</p>
    `;
    return;
  }

  const totalPoints = current[current.length - 1].total_points;
  const latestRank = current[current.length - 1].overall_rank;
  const previousRank = current[current.length - 2]?.overall_rank;
  const rankMovement = getRankMovement(latestRank, previousRank);
  const formLast5 = getFormLast5(current);
  const momentum = getMomentum(current);
  const achievements = getAchievements(current);
  const bestWorst = getBestWorstBadges(current);
  const form5Values = current.slice(-5).map((gw) => Number(gw.points));
  const last6Stats = computeLast6Stats(current);
  const rankPercentile = computeRankPercentile(Number(latestRank), Number(totalPlayers));
  const shortHistoryMessage = current.length < 6
    ? `<p class="muted">Only ${current.length} gameweek${current.length === 1 ? "" : "s"} recorded so far.</p>`
    : "";

  summaryCard.innerHTML = `
    ${cardHead(
      "Team Summary",
      "Live",
      "badge--good",
      `${badgePill(formLast5.text, "badge--neutral")}<span class="form-mini-wrap"><canvas id="form5Sparkline" aria-label="Form 5 sparkline"></canvas></span>`,
    )}
    <p><strong>${iconStarSvg()}Total points:</strong> ${totalPoints}</p>
    <p>
      <strong>${iconRankSvg(rankMovement.direction)}Latest overall rank:</strong> ${formatNumber(latestRank)}
      ${badgePill(rankMovement.text, rankMovement.badgeClass)}
    </p>
    <p>
      ${badgePill(bestWorst.bestBadgeText, "badge--neutral")}
      ${badgePill(bestWorst.worstBadgeText, "badge--neutral")}
    </p>
    <p class="muted">${momentum}</p>
    <h3 class="section-mini-title">QUICK STATS</h3>
    <div class="kpi-grid">
      <div class="kpi-tile">
        <p class="kpi-label">Rank percentile</p>
        <p class="kpi-value">${rankPercentile}</p>
      </div>
      <div class="kpi-tile">
        <p class="kpi-label">Avg points (last 6)</p>
        <p class="kpi-value">${last6Stats.avgPoints}</p>
      </div>
      <div class="kpi-tile">
        <p class="kpi-label">Rank Δ (last 6)</p>
        <p class="kpi-value">${last6Stats.rankDeltaText}</p>
      </div>
    </div>
    <p class="summary-line">Summary: ${last6Stats.trendDirection} momentum over the last 6 gameweeks.</p>
    <div class="achievements">
      <h3>Achievements</h3>
      <p>${achievements.bestGwText}</p>
      <p>${achievements.biggestJumpText}</p>
      <p>
        ${achievements.consistencyText}
        <span class="badge ${achievements.consistencyBadgeClass}">
          ${achievements.consistencyBadgeClass === "badge--good" ? "Steady" : achievements.consistencyBadgeClass === "badge--warn" ? "Spiky" : "n/a"}
        </span>
      </p>
    </div>
    ${shortHistoryMessage}
  `;

  drawMiniSparkline(document.getElementById("form5Sparkline"), form5Values);
}

function fitCanvasToDisplaySize(canvas, fallbackHeight = 120) {
  if (!canvas) return;
  const ratio = window.devicePixelRatio || 1;
  const cssWidth = Math.max(canvas.clientWidth || 240, 240);
  const cssHeight = fallbackHeight;

  canvas.width = Math.floor(cssWidth * ratio);
  canvas.height = Math.floor(cssHeight * ratio);
  canvas.style.height = `${cssHeight}px`;
}

function drawCanvasMessage(canvas, message) {
  if (!canvas) return;
  fitCanvasToDisplaySize(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const ratio = window.devicePixelRatio || 1;
  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  const styles = getComputedStyle(document.documentElement);
  const background = styles.getPropertyValue("--chart-bg").trim() || "#f7fafc";
  const border = styles.getPropertyValue("--chart-grid").trim() || "#d1d5db";
  const mutedColor = styles.getPropertyValue("--muted").trim() || "#6b7280";

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = border;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  ctx.fillStyle = mutedColor;
  ctx.font = "12px sans-serif";
  ctx.fillText(message, 10, Math.floor(height / 2));
  animateCanvasIn(canvas);
}

function drawCanvasSkeleton(canvas) {
  if (!canvas) return;
  fitCanvasToDisplaySize(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const ratio = window.devicePixelRatio || 1;
  const width = canvas.width / ratio;
  const height = canvas.height / ratio;

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f2f2f2";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#cccccc";
  ctx.fillRect(12, 18, width * 0.8, 10);
  ctx.fillRect(12, 40, width * 0.6, 10);
  ctx.fillRect(12, 62, width * 0.7, 10);
}

function animateCanvasIn(canvas) {
  if (!canvas) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  canvas.classList.remove("chart-fade-in");
  requestAnimationFrame(() => {
    canvas.classList.add("chart-fade-in");
  });
}

function drawMiniSparkline(canvas, values) {
  if (!canvas) return;

  const ratio = window.devicePixelRatio || 1;
  const cssWidth = 76;
  const cssHeight = 18;
  canvas.width = Math.floor(cssWidth * ratio);
  canvas.height = Math.floor(cssHeight * ratio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  const safeValues = values.filter((v) => Number.isFinite(v));
  const styles = getComputedStyle(document.documentElement);
  const lineColor = styles.getPropertyValue("--chart-points").trim() || "#1f8f78";
  const mutedColor = styles.getPropertyValue("--chart-grid").trim() || "#cfd9ea";

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  if (safeValues.length < 2) {
    ctx.strokeStyle = mutedColor;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(4, Math.round(height / 2));
    ctx.lineTo(width - 4, Math.round(height / 2));
    ctx.stroke();
    animateCanvasIn(canvas);
    return;
  }

  const min = Math.min(...safeValues);
  const max = Math.max(...safeValues);
  const range = max - min || 1;
  const stepX = (width - 8) / (safeValues.length - 1);

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  safeValues.forEach((value, index) => {
    const x = 4 + index * stepX;
    const y = height - 3 - ((value - min) / range) * (height - 6);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  animateCanvasIn(canvas);
}

function drawSparkline(canvas, values, color) {
  if (!canvas) return;
  fitCanvasToDisplaySize(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const ratio = window.devicePixelRatio || 1;
  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  const padX = 8;
  const padY = 10;
  const safeValues = values.filter((v) => Number.isFinite(v));

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const resolvedStyles = getComputedStyle(document.documentElement);
  const gridColor = resolvedStyles.getPropertyValue("--chart-grid").trim() || "#d1d5db";
  const mutedColor = resolvedStyles.getPropertyValue("--muted").trim() || "#6b7280";

  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX, height - padY);
  ctx.lineTo(width - padX, height - padY);
  ctx.stroke();

  if (safeValues.length === 0) {
    ctx.fillStyle = mutedColor;
    ctx.font = "12px sans-serif";
    ctx.fillText("No data", padX, height / 2);
    return;
  }

  const min = Math.min(...safeValues);
  const max = Math.max(...safeValues);
  const range = max - min || 1;
  const stepX = safeValues.length > 1 ? (width - padX * 2) / (safeValues.length - 1) : 0;

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();

  safeValues.forEach((value, index) => {
    const x = padX + stepX * index;
    const normalized = (value - min) / range;
    const y = height - padY - normalized * (height - padY * 2);

    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();

  const last = safeValues[safeValues.length - 1];
  const lastX = padX + stepX * (safeValues.length - 1);
  const lastY = height - padY - ((last - min) / range) * (height - padY * 2);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(lastX, lastY, 2.8, 0, Math.PI * 2);
  ctx.fill();
  animateCanvasIn(canvas);
}

function renderLast6Table(current) {
  if (!last6TableContainer) return;
  if (!Array.isArray(current) || current.length === 0) {
    last6TableContainer.innerHTML = `
      <p class="muted">No gameweek data available yet.</p>
      <div class="trend-summary">
        <h3 class="section-mini-title">TREND SUMMARY</h3>
        <p class="summary-line">Rank steady overall. Points consistent.</p>
      </div>
    `;
    return;
  }

  const last6 = current.slice(-6).reverse();
  const summaryLineParts = [];
  if (current.length < 10) {
    summaryLineParts.push(`Showing ${current.length} gameweeks for 10-GW trend views.`);
  }
  if (current.length < 6) {
    summaryLineParts.push(`Only ${current.length} gameweeks available for the table.`);
  }

  const rows = last6
    .map((gw) => {
      const rank = Number.isFinite(gw.overall_rank) ? gw.overall_rank.toLocaleString() : "-";
      return `
        <tr>
          <td>${gw.event ?? "-"}</td>
          <td>${gw.points ?? "-"}</td>
          <td>${rank}</td>
        </tr>
      `;
    })
    .join("");

  last6TableContainer.innerHTML = `
    ${summaryLineParts.length ? `<p class="muted">${summaryLineParts.join(" ")}</p>` : ""}
    <table class="gw-table">
      <thead>
        <tr>
          <th>GW</th>
          <th>Points</th>
          <th>Overall Rank</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    <div class="trend-summary">
      <h3 class="section-mini-title">TREND SUMMARY</h3>
      <p class="summary-line">${getTrendSummarySentence(current)}</p>
    </div>
  `;
}

function renderTrendsCard(current) {
  const history = Array.isArray(current) ? current : [];
  lastRenderedHistory = history;
  const last10 = history.slice(-10);
  const points = last10.map((gw) => Number(gw.points));
  const ranks = last10.map((gw) => Number(gw.overall_rank));
  const resolvedStyles = getComputedStyle(document.documentElement);
  const pointsColor = resolvedStyles.getPropertyValue("--chart-points").trim() || "#0f766e";
  const rankColor = resolvedStyles.getPropertyValue("--chart-rank").trim() || "#2563eb";
  const legend = ensureChartLegend();
  if (legend) {
    legend.textContent = "Legend: points trend (green), rank trend (blue, lower rank is better).";
  }

  if (history.length === 0) {
    drawCanvasMessage(pointsChart, "No points history yet.");
    drawCanvasMessage(rankChart, "No rank history yet.");
    renderLast6Table(history);
    return;
  }

  drawSparkline(pointsChart, points, pointsColor);
  drawSparkline(rankChart, ranks, rankColor);
  renderLast6Table(history);
}

function showError(message, detail) {
  const friendly = message || "We could not load FPL data right now. Please try again.";
  const detailPanel = renderErrorDetails(detail);
  showErrorBanner("Could not load data — retry?");

  deadlineCard.innerHTML = `
    ${cardHead("Next Deadline", "Error", "badge--warn")}
    <p class="error">Could not load deadline information right now.</p>
    <p class="muted">${friendly}</p>
    ${detailPanel}
  `;

  summaryCard.innerHTML = `
    ${cardHead("Team Summary", "Error", "badge--warn")}
    <p class="error">Could not load team summary right now.</p>
    <p class="muted">${friendly}</p>
    ${detailPanel}
  `;

  if (last6TableContainer) {
    last6TableContainer.innerHTML = `
      <p class="error">Could not load trends data right now.</p>
      <p class="muted">${friendly}</p>
      ${detailPanel}
    `;
  }
  drawCanvasMessage(pointsChart, "Data unavailable.");
  drawCanvasMessage(rankChart, "Data unavailable.");
}

function renderLoadingState() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  deadlineCard.innerHTML = `
    ${cardHead("Next Deadline", "Syncing", "badge--neutral")}
    <div class="skeleton-line w-80"></div>
    <div class="skeleton-line w-60"></div>
  `;

  summaryCard.innerHTML = `
    ${cardHead("Team Summary", "Syncing", "badge--neutral")}
    <div class="skeleton-line w-80"></div>
    <div class="skeleton-line w-60"></div>
    <div class="skeleton-line w-40"></div>
  `;

  if (last6TableContainer) {
    last6TableContainer.innerHTML = `
      <div class="skeleton-line w-80"></div>
      <div class="skeleton-line w-80"></div>
      <div class="skeleton-line w-60"></div>
    `;
  }

  drawCanvasSkeleton(pointsChart);
  drawCanvasSkeleton(rankChart);
}

async function loadAndRender(forceRefresh = false) {
  if (refreshBtn?.disabled) return;

  const startedAt = Date.now();
  setRefreshButtonState(true);
  hideErrorBanner();
  renderLoadingState();

  try {
    const [bootstrap, history] = await Promise.all([
      fetchBootstrap(forceRefresh),
      fetchEntryHistory(forceRefresh),
    ]);

    const current = history.current || [];
    let fixtures = null;
    const nextEvent = getNextDeadlineEvent(bootstrap.events || []);
    if (nextEvent?.id) {
      try {
        fixtures = await fetchFixturesByEvent(nextEvent.id, forceRefresh);
      } catch {
        fixtures = null;
      }
    }

    renderDeadlineCard(bootstrap.events || [], current, bootstrap.teams || [], fixtures);
    renderSummaryCard(current, bootstrap.total_players);
    renderTrendsCard(current);
    pulseGameweekIconOnce();
    updateLastUpdated(new Date());
    hideErrorBanner();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    showError("We hit a temporary issue fetching data.", detail);
  } finally {
    const elapsed = Date.now() - startedAt;
    if (elapsed < 500) {
      await delay(500 - elapsed);
    }
    setRefreshButtonState(false);
  }
}

refreshBtn.addEventListener("click", () => {
  if (refreshBtn.disabled) return;
  loadAndRender(true);
});

if (retryLoadBtn) {
  retryLoadBtn.addEventListener("click", () => {
    loadAndRender(true);
  });
}

window.addEventListener("resize", () => {
  renderTrendsCard(lastRenderedHistory);
  renderLeagueCard();
});

initializeTheme();
initializeDataSourceSettings();
initializePrivateLeague();
loadAndRender();
