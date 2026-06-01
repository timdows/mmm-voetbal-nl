Module.register("MMM-voetbal-nl", {
  defaults: {
    updateInterval: 60 * 60 * 1000, // elk uur verversen
    maxMatches: null,
    teamName: "Bilt De FC MO15-2",
    teamId: "T707686914",
    teams: null,
    email: "",
    password: "",
  },

  start() {
    this.matches = [];
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
      email: this.config.email,
      password: this.config.password,
    });
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "MATCHES_RESULT") {
      this.matches = payload;
      this.loaded = true;
      this.updateDom();
    }
  },

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = "mmm-voetbal-nl";

    const title = document.createElement("div");
    title.className = "voetbal-title";
    title.innerText = `Laatste Uitslagen - ${this.config.teamName}`;
    wrapper.appendChild(title);

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
    return wrapper;
  },

  getStyles() {
    return ["MMM-voetbal-nl.css"];
  },
});
