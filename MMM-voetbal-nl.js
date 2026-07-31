Module.register("MMM-voetbal-nl", {
  defaults: {
    updateInterval: 60 * 60 * 1000, // elk uur verversen
    maxMatches: 10,
    title: "",
    teamName: "Bilt De FC MO15-2",
    teamId: "T707686914",
    teams: null,
    dailyUpdateTime: "13:00",
    email: "",
    password: "",
  },

  start() {
    this.matches = [];
    this.lastSuccessfulSyncAt = null;
    this.usedCache = false;
    this.staleCache = false;
    this.syncError = null;
    this.loginAttempted = false;
    this.loginSuccessful = null;
    this.loaded = false;
    this.getData();
    setInterval(() => this.getData(), this.config.updateInterval);
  },

  getData() {
    this.sendSocketNotification("FETCH_MATCHES", {
      maxMatches: this.config.maxMatches,
      teamName: this.config.teamName,
      teamId: this.config.teamId,
      teams: this.config.teams,
      dailyUpdateTime: this.config.dailyUpdateTime,
      email: this.config.email,
      password: this.config.password,
    });
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "MATCHES_RESULT") {
      const data = Array.isArray(payload) ? { matches: payload } : payload || {};
      this.matches = Array.isArray(data.matches) ? data.matches : [];
      if (typeof data.lastSuccessfulSyncAt === "number") {
        this.lastSuccessfulSyncAt = data.lastSuccessfulSyncAt;
      }
      if (typeof data.usedCache === "boolean") {
        this.usedCache = data.usedCache;
      }
      if (typeof data.staleCache === "boolean") {
        this.staleCache = data.staleCache;
      }
      if (data.error !== undefined) {
        this.syncError = data.error ? String(data.error) : null;
      }
      if (typeof data.loginAttempted === "boolean") {
        this.loginAttempted = data.loginAttempted;
      }
      if (typeof data.loginSuccessful === "boolean" || data.loginSuccessful === null) {
        this.loginSuccessful = data.loginSuccessful;
      }
      this.loaded = true;
      this.updateDom();
    }

    if (notification === "MATCHES_META") {
      const data = payload || {};
      this.lastSuccessfulSyncAt = typeof data.lastSuccessfulSyncAt === "number" ? data.lastSuccessfulSyncAt : null;
      this.usedCache = Boolean(data.usedCache);
      this.staleCache = Boolean(data.staleCache);
      this.syncError = data.error ? String(data.error) : null;
      this.loginAttempted = Boolean(data.loginAttempted);
      this.loginSuccessful = typeof data.loginSuccessful === "boolean" ? data.loginSuccessful : null;
      if (this.loaded) {
        this.updateDom();
      }
    }
  },

  getLoginStatusText() {
    if (!this.loginAttempted) return "Inloggen: niet gebruikt";
    if (this.loginSuccessful === true) return "Inloggen: gelukt";
    if (this.loginSuccessful === false) return "Inloggen: mislukt";
    return "Inloggen: onbekend";
  },

  formatSyncTimestamp() {
    if (!this.lastSuccessfulSyncAt) return "onbekend";
    return new Intl.DateTimeFormat("nl-NL", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(this.lastSuccessfulSyncAt));
  },

  getConfiguredTitle() {
    const configuredTitle = String(this.config.title || "").trim();
    if (configuredTitle) return configuredTitle;
    return `Laatste Uitslagen - ${this.config.teamName}`;
  },

  getHeader() {
    return this.getConfiguredTitle();
  },

  appendSyncStatus(wrapper) {
    const syncMeta = document.createElement("div");
    syncMeta.className = "voetbal-sync-meta dimmed xsmall";
    const syncSource = this.staleCache ? "oude cache" : this.usedCache ? "cache" : "live";
    syncMeta.innerText = `Laatst succesvol gesynced: ${this.formatSyncTimestamp()} (${syncSource})`;
    wrapper.appendChild(syncMeta);

    const loginMeta = document.createElement("div");
    loginMeta.className = "voetbal-login-meta dimmed xsmall";
    loginMeta.innerText = this.getLoginStatusText();
    wrapper.appendChild(loginMeta);

    if (this.syncError) {
      const errorMeta = document.createElement("div");
      errorMeta.className = "voetbal-sync-error dimmed xsmall";
      errorMeta.innerText = `Laatste refresh mislukte: ${this.syncError}`;
      wrapper.appendChild(errorMeta);
    }
  },

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = "mmm-voetbal-nl";

    if (!this.loaded) {
      const loading = document.createElement("div");
      loading.className = "dimmed light small";
      loading.innerText = "Laden...";
      wrapper.appendChild(loading);
      return wrapper;
    }

    if (this.matches.length === 0) {
      const empty = document.createElement("div");
      empty.className = "dimmed light small";
      empty.innerText = "Geen uitslagen gevonden.";
      wrapper.appendChild(empty);
      this.appendSyncStatus(wrapper);
      return wrapper;
    }

    const list = document.createElement("ul");
    list.className = "voetbal-list";

    this.matches.forEach((match) => {
      const item = document.createElement("li");
      item.className = `voetbal-match voetbal-match--${match.won ?? "unknown"}`;

      const dateEl = document.createElement("span");
      dateEl.className = "voetbal-date";
      dateEl.innerText = match.date + (match.round ? ` · ${match.round}` : "");

      const scoreRow = document.createElement("div");
      scoreRow.className = "voetbal-score-row";

      const homeEl = document.createElement("span");
      homeEl.className = "voetbal-team voetbal-team--home";
      homeEl.innerText = match.homeTeam;

      const scoreCenter = document.createElement("span");
      scoreCenter.className = "voetbal-score-center";

      if (match.homeLogo) {
        const homeLogo = document.createElement("img");
        homeLogo.className = "voetbal-team-logo voetbal-team-logo--home";
        homeLogo.src = match.homeLogo;
        homeLogo.alt = match.homeTeam;
        scoreCenter.appendChild(homeLogo);
      }

      const scoreEl = document.createElement("span");
      scoreEl.className = "voetbal-score";
      scoreEl.innerText = match.score;
      scoreCenter.appendChild(scoreEl);

      if (match.awayLogo) {
        const awayLogo = document.createElement("img");
        awayLogo.className = "voetbal-team-logo voetbal-team-logo--away";
        awayLogo.src = match.awayLogo;
        awayLogo.alt = match.awayTeam;
        scoreCenter.appendChild(awayLogo);
      }

      const awayEl = document.createElement("span");
      awayEl.className = "voetbal-team voetbal-team--away";
      awayEl.innerText = match.awayTeam;

      scoreRow.appendChild(homeEl);
      scoreRow.appendChild(scoreCenter);
      scoreRow.appendChild(awayEl);

      item.appendChild(dateEl);
      item.appendChild(scoreRow);
      list.appendChild(item);
    });

    wrapper.appendChild(list);
    this.appendSyncStatus(wrapper);

    return wrapper;
  },

  getStyles() {
    return ["MMM-voetbal-nl.css"];
  },
});
