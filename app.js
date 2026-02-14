const TEAM_ID = 403618;
const TTL_MS = 10 * 60 * 1000;
const BOOTSTRAP_URL = "https://fantasy.premierleague.com/api/bootstrap-static/";
const ENTRY_HISTORY_URL = `https://fantasy.premierleague.com/api/entry/${TEAM_ID}/history/`;
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
const useProxyToggle = document.getElementById("useProxyToggle");
const proxyBaseUrlInput = document.getElementById("proxyBaseUrlInput");
const saveProxySettingsBtn = document.getElementById("saveProxySettingsBtn");
const modeLabel = document.getElementById("modeLabel");
const pointsChart = document.getElementById("pointsChart");
const rankChart = document.getElementById("rankChart");
const last6TableContainer = document.getElementById("last6TableContainer");

const DEFAULT_REFRESH_LABEL = "Refresh";
let countdownInterval = null;
let lastRenderedHistory = [];
let currentTheme = "light";

function ensureLastUpdatedLabel() {
  const existing = document.getElementById("lastUpdatedLabel");
  if (existing) return existing;

  const header = document.querySelector(".site-header");
  if (!header || !header.parentElement) return null;

  const label = document.createElement("p");
  label.id = "lastUpdatedLabel";
  label.className = "muted";
  label.style.margin = "0 0 0.8rem";
  label.style.fontSize = "0.82rem";
  label.textContent = "Last updated: waiting for first load";
  header.insertAdjacentElement("afterend", label);
  return label;
}

const lastUpdatedLabel = ensureLastUpdatedLabel();

function updateLastUpdated(value) {
  if (!lastUpdatedLabel) return;
  const dateValue = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dateValue.getTime())) return;
  lastUpdatedLabel.textContent = `Last updated: ${dateValue.toLocaleString()} (${getDataSourceLabel()})`;
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

function badgePill(text, badgeClass = "badge--neutral") {
  return `<span class="badge ${badgeClass}">${text}</span>`;
}

function cardHead(title, badgeText, badgeClass = "badge--neutral", extraBadgesHtml = "") {
  return `
    <div class="card-head">
      <h2>${title}</h2>
      <div>
        ${badgePill(badgeText, badgeClass)}
        ${extraBadgesHtml}
      </div>
    </div>
  `;
}

function getRankMovement(latestRank, previousRank) {
  if (!Number.isFinite(latestRank) || !Number.isFinite(previousRank)) {
    return { text: "Rank move: n/a", badgeClass: "badge--neutral" };
  }

  const change = previousRank - latestRank;
  if (change > 0) {
    return { text: `▲ ${Math.abs(change).toLocaleString()}`, badgeClass: "badge--good" };
  }
  if (change < 0) {
    return { text: `▼ ${Math.abs(change).toLocaleString()}`, badgeClass: "badge--warn" };
  }
  return { text: "• 0", badgeClass: "badge--neutral" };
}

function getFormLast5(current) {
  if (!Array.isArray(current) || current.length === 0) {
    return { points: null, badgeClass: "badge--neutral", text: "Form5: n/a" };
  }

  const last5 = current.slice(-5);
  const points = last5.reduce((sum, gw) => sum + (Number(gw.points) || 0), 0);
  return { points, badgeClass: "badge--neutral", text: `Form5: ${points}` };
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

function renderDeadlineCard(events) {
  const next = events.find((event) => event.is_next);
  if (!next) {
    deadlineCard.innerHTML = `
      ${cardHead("Next Deadline", "Unavailable", "badge--warn")}
      <p class="error">No upcoming deadline found.</p>
    `;
    return;
  }

  const render = () => {
    deadlineCard.innerHTML = `
      ${cardHead("Next Deadline", `GW ${next.id}`, "badge--good")}
      <p><strong>Gameweek ${next.id}:</strong> ${formatDate(next.deadline_time)}</p>
      <p class="muted">Countdown: ${formatCountdown(next.deadline_time)}</p>
    `;
  };

  render();

  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(render, 1000);
}

function renderSummaryCard(current) {
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
  const shortHistoryMessage = current.length < 6
    ? `<p class="muted">Only ${current.length} gameweek${current.length === 1 ? "" : "s"} recorded so far.</p>`
    : "";

  summaryCard.innerHTML = `
    ${cardHead("Team Summary", "Live", "badge--good", badgePill(formLast5.text, "badge--neutral"))}
    <p><strong>Total points:</strong> ${totalPoints}</p>
    <p>
      <strong>Latest overall rank:</strong> ${formatNumber(latestRank)}
      ${badgePill(rankMovement.text, rankMovement.badgeClass)}
    </p>
    <p>
      ${badgePill(bestWorst.bestBadgeText, "badge--neutral")}
      ${badgePill(bestWorst.worstBadgeText, "badge--neutral")}
    </p>
    <p class="muted">${momentum}</p>
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
}

function renderLast6Table(current) {
  if (!last6TableContainer) return;
  if (!Array.isArray(current) || current.length === 0) {
    last6TableContainer.innerHTML = `<p class="muted">No gameweek data available yet.</p>`;
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
    <p class="muted">Loading latest deadline...</p>
    <p class="muted">Preparing deadline countdown...</p>
  `;

  summaryCard.innerHTML = `
    ${cardHead("Team Summary", "Syncing", "badge--neutral")}
    <p class="muted">Loading team summary...</p>
    <p class="muted">Calculating form, rank move, and momentum...</p>
    <p class="muted">Source: ${getDataSourceLabel()}</p>
  `;

  if (last6TableContainer) {
    last6TableContainer.innerHTML = `
      <p class="muted">Loading gameweek history...</p>
      <p class="muted">Preparing last 6 table...</p>
    `;
  }

  drawCanvasMessage(pointsChart, "Loading points trend...");
  drawCanvasMessage(rankChart, "Loading rank trend...");
}

async function loadAndRender(forceRefresh = false) {
  if (refreshBtn?.disabled) return;

  const startedAt = Date.now();
  setRefreshButtonState(true);
  renderLoadingState();

  try {
    const [bootstrap, history] = await Promise.all([
      fetchBootstrap(forceRefresh),
      fetchEntryHistory(forceRefresh),
    ]);

    renderDeadlineCard(bootstrap.events || []);
    const current = history.current || [];
    renderSummaryCard(current);
    renderTrendsCard(current);
    updateLastUpdated(new Date());
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

window.addEventListener("resize", () => {
  renderTrendsCard(lastRenderedHistory);
});

initializeTheme();
initializeDataSourceSettings();
loadAndRender();
