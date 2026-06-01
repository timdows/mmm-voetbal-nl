const NodeHelper = require("node_helper");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

let fileCredentials = { email: "", password: "" };
try {
  fileCredentials = require("./credentials");
} catch (_) {
  try {
    fileCredentials = require("./local_testing/credentials");
  } catch (_) {}
}

const DEFAULT_TEAM_ID = "T707686914";
const DEFAULT_RESULTS_URL = `https://www.voetbal.nl/team/${DEFAULT_TEAM_ID}/uitslagen`;
const LOGIN_URL = "https://www.voetbal.nl/inloggen";
const DEFAULT_TEAM_NAME = "Bilt De FC MO15-2";
const CACHE_FILE = path.join(__dirname, "cache.json");

function isCacheValid(cachedAt) {
  const now = Date.now();
  const d = new Date();
  const todayNoon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0).getTime();
  const lastNoon = now < todayNoon ? todayNoon - 86400000 : todayNoon;
  return cachedAt >= lastNoon;
}

function readCache() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, "utf8");
    const data = JSON.parse(raw);
    if (data && typeof data.cachedAt === "number" && Array.isArray(data.matches)) return data;
  } catch (_) {}
  return null;
}

function writeCache(matches) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ cachedAt: Date.now(), matches }, null, 2), "utf8");
  } catch (_) {}
}

function maskEmail(email) {
  const [name, domain] = String(email).split("@");
  if (!name || !domain) return "***";
  return `${name.slice(0, 2)}***@${domain}`;
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

function mergeCredentials(runtimeConfig) {
  const merged = { ...fileCredentials };
  if (!runtimeConfig || typeof runtimeConfig !== "object") return merged;

  ["email", "password", "teamName", "teamId", "resultsUrl", "resultUrl"].forEach((key) => {
    const value = runtimeConfig[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      merged[key] = value;
    }
  });

  if (Array.isArray(runtimeConfig.teams)) {
    merged.teams = runtimeConfig.teams;
  }

  return merged;
}

function getConfiguredTeams(activeCredentials) {
  if (Array.isArray(activeCredentials.teams) && activeCredentials.teams.length > 0) {
    return activeCredentials.teams
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
      name: String(activeCredentials.teamName || DEFAULT_TEAM_NAME).trim() || DEFAULT_TEAM_NAME,
      resultsUrl: resolveResultsUrlFromConfig(activeCredentials),
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

module.exports = NodeHelper.create({
  start() {
    console.log("[MMM-voetbal-nl] Node helper gestart");
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "FETCH_MATCHES") {
      this.scrapeMatches(payload.maxMatches, payload);
    }
  },

  async scrapeMatches(maxMatches, runtimeConfig) {
    const activeCredentials = mergeCredentials(runtimeConfig);
    const cached = readCache();
    if (cached && isCacheValid(cached.cachedAt)) {
      console.log("[MMM-voetbal-nl] Cache gebruikt (" + new Date(cached.cachedAt).toLocaleString("nl-NL") + ")");
      const matches = this.limitMatches(cached.matches, maxMatches);
      this.sendSocketNotification("MATCHES_RESULT", matches);
      return;
    }

    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
      );

      if (activeCredentials.email && activeCredentials.password) {
        await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 20000 });
        await page.type('input[name="email"]', activeCredentials.email);
        await page.type('input[name="password"]', activeCredentials.password);
        await Promise.all([
          page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => null),
          page.evaluate(() => {
            const emailInput = document.querySelector('input[name="email"]');
            const form = emailInput?.form || document.querySelector("form");
            if (!form) throw new Error("Login form niet gevonden");
            form.submit();
          }),
        ]);
        console.log("[MMM-voetbal-nl] Ingelogd als", maskEmail(activeCredentials.email));
      }

      const teams = getConfiguredTeams(activeCredentials);
      const allMatches = [];

      for (const team of teams) {
        await page.goto(team.resultsUrl, { waitUntil: "networkidle2", timeout: 30000 });
        await this.switchToMyTeamView(page);
        const snapshots = await this.collectSeasonSnapshots(page);

        snapshots.forEach((html) => {
          allMatches.push(...this.parseHtml(html, team.name));
        });
      }

      const deduped = this.dedupeMatches(allMatches);
      const sorted = this.limitMatches(deduped, null);
      writeCache(sorted);
      console.log("[MMM-voetbal-nl] Cache opgeslagen (", sorted.length, "wedstrijden)");
      const matches = this.limitMatches(sorted, maxMatches);
      this.sendSocketNotification("MATCHES_RESULT", matches);
    } catch (err) {
      console.error("[MMM-voetbal-nl] Fout bij scrapen:", err.message);
      this.sendSocketNotification("MATCHES_RESULT", []);
    } finally {
      if (browser) await browser.close();
    }
  },

  parseHtml(html, teamName) {
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
            won: this.didWin(teamName, homeTeam, awayTeam, score),
          });
        });
    });

    return results.reverse();
  },

  async switchToMyTeamView(page) {
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
  },

  async collectSeasonSnapshots(page) {
    const snapshots = [];

    const seasonUrls = await this.getSeasonUrls(page);
    for (const seasonUrl of seasonUrls) {
      await page.goto(seasonUrl, { waitUntil: "networkidle2", timeout: 30000 });
      await this.switchToMyTeamView(page);
      await this.expandAllResults(page);
      snapshots.push(await page.content());
    }

    return snapshots;
  },

  async getSeasonUrls(page) {
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
      .map((value) => this.resolveSeasonUrl(currentUrl, value))
      .filter(Boolean)
      .forEach((url) => urls.push(url));

    return [...new Set(urls)];
  },

  resolveSeasonUrl(baseUrl, value) {
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
  },

  async expandAllResults(page) {
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
  },

  dedupeMatches(matches) {
    const seen = new Set();
    return matches.filter((match) => {
      const key = [match.team, match.homeTeam, match.awayTeam, match.score, match.date, match.url].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },

  limitMatches(matches, maxMatches) {
    const sorted = [...matches].sort((a, b) => {
      const timeA = parseDutchDate(a.date) ?? 0;
      const timeB = parseDutchDate(b.date) ?? 0;
      if (timeA !== timeB) return timeB - timeA;
      return (b.round || "").localeCompare(a.round || "", "nl-NL", { numeric: true });
    });

    if (typeof maxMatches === "number" && maxMatches > 0) {
      return sorted.slice(0, maxMatches);
    }
    return sorted;
  },

  didWin(teamName, homeTeam, awayTeam, score) {
    const parts = score.split("-").map((s) => parseInt(s.trim(), 10));
    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
    const [homeGoals, awayGoals] = parts;
    if (homeGoals === awayGoals) return "draw";
    const myTeamIsHome = homeTeam === teamName;
    const myTeamWon = myTeamIsHome ? homeGoals > awayGoals : awayGoals > homeGoals;
    return myTeamWon ? "win" : "loss";
  },
});
