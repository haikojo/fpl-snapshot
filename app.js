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

const DEFAULT_REFRESH_LABEL = "Refresh";
let countdownInterval = null;
let lastRenderedHistory = [];
let currentTheme = "light";
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
    const msLeft = getMsLeft(next.deadline_time);
    const urgency = getUrgencyInfo(msLeft);
    const countdownText = formatCountdown(next.deadline_time);
    const riskProgress = computeRiskProgress(msLeft);
    const riskFillClass = getRiskFillClass(urgency.badgeClass);

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
      <h3 class="section-mini-title">CHECKLIST</h3>
      <ul class="checklist">
        <li><span class="check-indicator">☐</span>Transfers checked</li>
        <li><span class="check-indicator">☐</span>Captain set</li>
        <li><span class="check-indicator">☐</span>Bench order set</li>
      </ul>
      <p class="helper-note">Manual reminders (not auto-detected).</p>
      <p class="helper-note">Tip: Make transfers before the deadline to lock in points.</p>
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

    renderDeadlineCard(bootstrap.events || []);
    const current = history.current || [];
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
});

initializeTheme();
initializeDataSourceSettings();
loadAndRender();
