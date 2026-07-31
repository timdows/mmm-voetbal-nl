/**
 * Lokale testserver voor MMM-voetbalnl
 * Start met: npm test
 * Open dan: http://localhost:3456
 */

const http = require("http");
const path = require("path");
const fs = require("fs");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer");

const DEFAULT_TEAM_ID = "T707686914";
const DEFAULT_RESULTS_URL = `https://www.voetbal.nl/team/${DEFAULT_TEAM_ID}/uitslagen`;
const LOGIN_URL = "https://www.voetbal.nl/inloggen";
const DEFAULT_TEAM_NAME = "Bilt De FC MO15-2";
const PORT = 3456;
const CACHE_FILE = path.join(__dirname, "cache.json");
  const DEFAULT_DAILY_UPDATE_TIME = "13:00"; // Updated to reflect new naming
const DEFAULT_MAX_MATCHES = 10;

function normalizeDailyUpdateTime(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  if (!match) return DEFAULT_DAILY_UPDATE_TIME;

  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2] || "0", 10);
  if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return DEFAULT_DAILY_UPDATE_TIME;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseDailyUpdateTime(value) {
  const normalized = normalizeDailyUpdateTime(value);
  const [hourPart, minutePart] = normalized.split(":");
  return {
    hour: parseInt(hourPart, 10),
    minute: parseInt(minutePart, 10),
    normalized,
  };
}

function getLastRefreshBoundary(nowTs, dailyUpdateTime) {
  const { hour, minute } = parseDailyUpdateTime(dailyUpdateTime);
  const nowDate = new Date(nowTs);
  const todayBoundary = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate(),
    hour,
    minute,
    0,
    0
  ).getTime();

  return nowTs < todayBoundary ? todayBoundary - 86400000 : todayBoundary;
}

function isCacheValid(cachedAt, dailyUpdateTime, nowTs = Date.now()) {
  const lastBoundary = getLastRefreshBoundary(nowTs, dailyUpdateTime);
  return cachedAt >= lastBoundary;
}

function readCache() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    const data = JSON.parse(raw);
    if (data && typeof data.cachedAt === "number" && Array.isArray(data.matches)) return data;
  } catch (_) {}
  return null;
}

function writeCache(matches, dailyUpdateTime, nowTs = Date.now()) {
  try {
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify(
        {
          cachedAt: nowTs,
          lastSuccessfulSyncAt: nowTs,
          dailyUpdateTime: normalizeDailyUpdateTime(dailyUpdateTime),
          maxMatches: getConfiguredMaxMatches(),
          matches,
        },
        null,
        2
      ),
      "utf8"
    );
  } catch (_) {}
}

let credentials = { email: "", password: "" };
try {
  credentials = require("./credentials");
} catch (_) {}

function maskEmail(email) {
  const [name, domain] = String(email).split("@");
  if (!name || !domain) return "***";
  return `${name.slice(0, 2)}***@${domain}`;
}

function getConfiguredDailyUpdateTime() {
  return normalizeDailyUpdateTime(credentials.dailyUpdateTime || DEFAULT_DAILY_UPDATE_TIME);
}

function getConfiguredMaxMatches() {
  const parsed = parseInt(credentials.maxMatches, 10);
  if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  return DEFAULT_MAX_MATCHES;
}

function formatSyncTimestamp(ts) {
  if (!ts) return "onbekend";
  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(ts));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDutchDate(dateRaw) {
  if (!dateRaw) return null;
  const months = {
    januari: 0,
    februari: 1,
    maart: 2,
    april: 3,
    mei: 4,
    juni: 5,
    juli: 6,
    augustus: 7,
    september: 8,
    oktober: 9,
    november: 10,
    december: 11,
  };

  const cleaned = String(dateRaw).toLowerCase().replace(/\s+/g, " ").trim();
  const match = cleaned.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = months[match[2]];
  const year = parseInt(match[3], 10);
  if (Number.isNaN(day) || Number.isNaN(year) || month === undefined) return null;

  return new Date(year, month, day).getTime();
}

function toBaseResultsUrl(url) {
  try {
    const parsed = new URL(String(url || DEFAULT_RESULTS_URL));
    parsed.pathname = parsed.pathname.replace(/\/uitslagen\/\d+\/?$/, "/uitslagen");
    return parsed.toString();
  } catch (_) {
    return String(url || DEFAULT_RESULTS_URL);
  }
}

function normalizeTeamId(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (/^T\d+$/.test(raw)) return raw;
  const match = raw.match(/(T\d{6,})/);
  return match ? match[1] : null;
}

function teamIdFromResultsUrl(url) {
  const value = String(url || "").trim();
  if (!value) return null;
  const pathMatch = value.match(/\/team\/(T\d+)/i);
  if (pathMatch) return normalizeTeamId(pathMatch[1]);
  return normalizeTeamId(value);
}

function buildResultsUrlFromTeamId(teamId) {
  const normalized = normalizeTeamId(teamId) || DEFAULT_TEAM_ID;
  return `https://www.voetbal.nl/team/${normalized}/uitslagen`;
}

function resolveResultsUrlFromConfig(config) {
  if (!config || typeof config !== "object") return DEFAULT_RESULTS_URL;
  const teamId = normalizeTeamId(config.teamId);
  if (teamId) return buildResultsUrlFromTeamId(teamId);

  const configuredUrl =
    String(config.resultsUrl || "").trim() ||
    String(config.resultUrl || "").trim();
  if (configuredUrl) {
    const inferredTeamId = teamIdFromResultsUrl(configuredUrl);
    if (inferredTeamId) return buildResultsUrlFromTeamId(inferredTeamId);
    return toBaseResultsUrl(configuredUrl);
  }

  return DEFAULT_RESULTS_URL;
}

function getConfiguredTeams() {
  if (Array.isArray(credentials.teams) && credentials.teams.length > 0) {
    return credentials.teams
      .map((team) => {
        if (!team || typeof team !== "object") return null;
        const name = String(team.name || "").trim();
        if (!name) return null;
        return {
          name,
          resultsUrl: resolveResultsUrlFromConfig(team),
        };
      })
      .filter(Boolean);
  }

  return [
    {
      name: String(credentials.teamName || DEFAULT_TEAM_NAME).trim() || DEFAULT_TEAM_NAME,
      resultsUrl: resolveResultsUrlFromConfig(credentials),
    },
  ];
}

function normalizeUrl(value) {
  const src = String(value || "").trim();
  if (!src) return null;
  if (src.startsWith("//")) return `https:${src}`;
  if (src.startsWith("/")) return `https://www.voetbal.nl${src}`;
  return src;
}

function extractBackgroundImage(value) {
  const style = String(value || "");
  const match = style.match(/url\((['"]?)(.*?)\1\)/i);
  if (!match || !match[2]) return null;
  return normalizeUrl(match[2]);
}

function didWin(teamName, homeTeam, awayTeam, score) {
  const parts = score.split("-").map((s) => parseInt(s.trim(), 10));
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return "unknown";
  const [homeGoals, awayGoals] = parts;
  if (homeGoals === awayGoals) return "draw";
  const myTeamIsHome = homeTeam === teamName;
  const myTeamWon = myTeamIsHome ? homeGoals > awayGoals : awayGoals > homeGoals;
  return myTeamWon ? "win" : "loss";
}

function parseHtml(html, teamName) {
  const $ = cheerio.load(html);
  const results = [];

  $(".table").each((_, table) => {
    const dateRaw = $(table).find(".header .title span").first().text().trim();
    const round = $(table).find(".header .subtitle span").first().text().trim();

    $(table)
      .find("a.row")
      .each((_, row) => {
        const homeTeam = $(row).find(".value.home .team").text().trim();
        const awayTeam = $(row).find(".value.away .team").text().trim();
        const score = $(row).find(".value.center").text().trim();
        const href = $(row).attr("href") || "";

        const homeLogo =
          normalizeUrl($(row).find(".value.home img").first().attr("src")) ||
          normalizeUrl($(row).find(".value.home source").first().attr("srcset")) ||
          extractBackgroundImage($(row).find(".value.home [style*='background-image']").first().attr("style"));

        const awayLogo =
          normalizeUrl($(row).find(".value.away img").first().attr("src")) ||
          normalizeUrl($(row).find(".value.away source").first().attr("srcset")) ||
          extractBackgroundImage($(row).find(".value.away [style*='background-image']").first().attr("style"));

        if (homeTeam !== teamName && awayTeam !== teamName) return;

        results.push({
          team: teamName,
          homeTeam,
          awayTeam,
          score,
          homeLogo,
          awayLogo,
          date: dateRaw,
          round,
          url: `https://www.voetbal.nl${href}`,
          won: didWin(teamName, homeTeam, awayTeam, score),
        });
      });
  });

  return results.reverse();
}

async function switchToMyTeamView(page) {
  const clicked = await page.evaluate(() => {
    const button = document.querySelector("[data-button-switch='my_team']");
    if (!button) return false;
    if (button.offsetParent === null) return false;
    button.click();
    return true;
  });

  if (clicked) {
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 7000 }).catch(() => null);
    await sleep(300);
  }
}

async function getSeasonOptions(page) {
  const currentUrl = page.url();
  const urls = [currentUrl];

  const opened = await page.evaluate(() => {
    const trigger = document.querySelector("[class*='ScheduleResults-viewSelectTrigger']");
    if (!trigger) return false;
    if (trigger.offsetParent === null) return false;
    trigger.click();
    return true;
  });

  if (!opened) return urls;

  await sleep(250);

  const optionValues = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll("[role='option'], [data-radix-collection-item], [class*='SelectItem'], li, a, button, div")
    );

    return candidates
      .map((el) => (el.getAttribute("data-value") || el.getAttribute("value") || el.getAttribute("href") || "").trim())
      .filter((value) => value && /\d{4}|\/uitslagen\//.test(value));
  });

  await page.keyboard.press("Escape").catch(() => null);

  optionValues
    .map((value) => resolveSeasonUrl(currentUrl, value))
    .filter(Boolean)
    .forEach((url) => urls.push(url));

  return [...new Set(urls)];
}

function resolveSeasonUrl(baseUrl, value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) return raw;

  try {
    const base = new URL(baseUrl);

    if (raw.startsWith("/")) {
      return new URL(raw, base.origin).toString();
    }

    if (/^\d+$/.test(raw)) {
      const path = base.pathname.replace(/\/uitslagen(?:\/\d+)?\/?$/, `/uitslagen/${raw}`);
      return new URL(path, base.origin).toString();
    }

    if (/\/uitslagen\//.test(raw)) {
      return new URL(raw, base.origin).toString();
    }
  } catch (_) {
    return null;
  }

  return null;
}

async function expandAllResults(page) {
  for (let i = 0; i < 12; i += 1) {
    const clicked = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll("button, a, [role='button']"));
      const target = candidates.find((el) => {
        const text = (el.textContent || "").trim().toLowerCase();
        if (!text.includes("toon alle uitslagen")) return false;
        if (el instanceof HTMLButtonElement && el.disabled) return false;
        return el.offsetParent !== null;
      });

      if (!target) return false;
      target.click();
      return true;
    });

    if (!clicked) break;

    await page.waitForNetworkIdle({ idleTime: 500, timeout: 7000 }).catch(() => null);
    await sleep(350);
  }
}

async function collectSeasonSnapshots(page) {
  const snapshots = [];

  await expandAllResults(page);
  snapshots.push(await page.content());

  const seasonUrls = await getSeasonOptions(page);
  for (const seasonUrl of seasonUrls) {
    await page.goto(seasonUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await switchToMyTeamView(page);
    await expandAllResults(page);
    snapshots.push(await page.content());
  }

  return snapshots;
}

function dedupeMatches(matches) {
  const seen = new Set();
  return matches.filter((match) => {
    const key = [match.team, match.homeTeam, match.awayTeam, match.score, match.date, match.url].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortMatchesNewestFirst(matches) {
  return [...matches].sort((a, b) => {
    const timeA = parseDutchDate(a.date) ?? 0;
    const timeB = parseDutchDate(b.date) ?? 0;
    if (timeA !== timeB) return timeB - timeA;
    return (b.round || "").localeCompare(a.round || "", "nl-NL", { numeric: true });
  });
}

async function scrapeMatches(maxMatches = null) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    );

    if (credentials.email && credentials.password) {
      await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 20000 });
      await page.type('input[name="email"]', credentials.email);
      await page.type('input[name="password"]', credentials.password);
      await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => null),
        page.evaluate(() => {
          const emailInput = document.querySelector('input[name="email"]');
          const form = emailInput?.form || document.querySelector("form");
          if (!form) throw new Error("Login form niet gevonden");
          form.submit();
        }),
      ]);
      console.log("Ingelogd als", maskEmail(credentials.email));
    }

    const teams = getConfiguredTeams();
    const allMatches = [];

    for (const team of teams) {
      await page.goto(team.resultsUrl, { waitUntil: "networkidle2", timeout: 30000 });
      await switchToMyTeamView(page);
      const snapshots = await collectSeasonSnapshots(page);

      snapshots.forEach((snapshotHtml) => {
        allMatches.push(...parseHtml(snapshotHtml, team.name));
      });
    }

    const deduped = dedupeMatches(allMatches);
    const ordered = sortMatchesNewestFirst(deduped);

    if (typeof maxMatches === "number" && maxMatches > 0) {
      return ordered.slice(0, maxMatches);
    }
    return ordered;
  } finally {
    await browser.close();
  }
}

function renderHtml(matches, metadata = {}) {
  const error = metadata.error || null;
  const lastSuccessfulSyncAt = metadata.lastSuccessfulSyncAt || null;
  const usedCache = Boolean(metadata.usedCache);
  const staleCache = Boolean(metadata.staleCache);
  const dailyUpdateTime = normalizeDailyUpdateTime(metadata.dailyUpdateTime || getConfiguredDailyUpdateTime());

  const rows = error
    ? `<p style="color:#f44336">Fout: ${error}</p>`
    : matches
        .map(
          (m) => `
      <li class="voetbal-match voetbal-match--${m.won}">
        <span class="voetbal-date">${m.date}${m.round ? ` · ${m.round}` : ""}</span>
        <div class="voetbal-score-row">
          <span class="voetbal-team voetbal-team--home">${m.homeTeam}</span>
          <span class="voetbal-score-center">${
            m.homeLogo ? `<img class="voetbal-team-logo voetbal-team-logo--home" src="${m.homeLogo}" alt="${m.homeTeam}" />` : ""
          }<span class="voetbal-score">${m.score}</span>${
            m.awayLogo ? `<img class="voetbal-team-logo voetbal-team-logo--away" src="${m.awayLogo}" alt="${m.awayTeam}" />` : ""
          }</span>
          <span class="voetbal-team voetbal-team--away">${m.awayTeam}</span>
        </div>
      </li>`
        )
        .join("\n");

  const syncSource = staleCache ? "oude cache" : usedCache ? "cache" : "live";
  const syncStatus = `Laatst succesvol gesynced: ${formatSyncTimestamp(lastSuccessfulSyncAt)} (${syncSource})`;

    return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8" />
  <title>MMM-voetbalnl – Test</title>
  <style>
    body { background:#000; color:#fff; font-family:Arial,sans-serif; display:flex; justify-content:center; padding:40px; margin:0; }
    ${fs.readFileSync(path.join(__dirname, "..", "MMM-voetbalnl.css"), "utf8")}
    .meta { color:#555; font-size:0.75em; margin-top:20px; }
  </style>
</head>
<body>
  <div>
    <div class="mmm-voetbal-nl">
      <div class="voetbal-title">Laatste Uitslagen – Bilt De FC MO15-2</div>
      <ul class="voetbal-list">${rows}</ul>
      <div class="voetbal-sync-meta dimmed xsmall">${syncStatus}</div>
      ${error ? `<div class="voetbal-sync-error dimmed xsmall">Laatste refresh mislukte: ${error}</div>` : ""}
    </div>
    <p class="meta">Dagelijkse sync: ${dailyUpdateTime} · standaard max wedstrijden: ${getConfiguredMaxMatches()} · <a href="/" style="color:#555">verversen</a> · <a href="/?force" style="color:#555">forceer refresh</a></p>
  </div>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  if (req.url !== "/" && req.url !== "/?force") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const forceRefresh = req.url === "/?force";
  const dailyUpdateTime = getConfiguredDailyUpdateTime();
  const maxMatches = getConfiguredMaxMatches();
  const cached = readCache();

  if (!forceRefresh && cached && isCacheValid(cached.cachedAt, dailyUpdateTime)) {
    const cachedTime = new Date(cached.cachedAt).toLocaleString("nl-NL");
    console.log(`Cache gebruikt (${cachedTime})`);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    const matches = sortMatchesNewestFirst(cached.matches).slice(0, maxMatches);
    res.end(
      renderHtml(matches, {
        lastSuccessfulSyncAt: cached.lastSuccessfulSyncAt || cached.cachedAt,
        usedCache: true,
        dailyUpdateTime,
      })
    );
    return;
  }

  try {
    console.log("Uitslagen ophalen van voetbal.nl...");
    const allMatches = await scrapeMatches(null);
    const syncTimestamp = Date.now();
    writeCache(allMatches, dailyUpdateTime, syncTimestamp);
    const matches = allMatches.slice(0, maxMatches);
    console.log(`${allMatches.length} wedstrijd(en) gevonden, cache opgeslagen`);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      renderHtml(matches, {
        lastSuccessfulSyncAt: syncTimestamp,
        usedCache: false,
        dailyUpdateTime,
      })
    );
  } catch (err) {
    console.error("Fout:", err.message);
    if (cached && Array.isArray(cached.matches) && cached.matches.length > 0) {
      console.log("Fallback naar bestaande cache na scrape-fout");
      const matches = sortMatchesNewestFirst(cached.matches).slice(0, maxMatches);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        renderHtml(matches, {
          error: err.message,
          lastSuccessfulSyncAt: cached.lastSuccessfulSyncAt || cached.cachedAt,
          usedCache: true,
          staleCache: true,
          dailyUpdateTime,
        })
      );
      return;
    }

    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      renderHtml([], {
        error: err.message,
        dailyUpdateTime,
      })
    );
  }
});

server.listen(PORT, () => {
  console.log(`\nTestserver draait op http://localhost:${PORT}\n`);
});
