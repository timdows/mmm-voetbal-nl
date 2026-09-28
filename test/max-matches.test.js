const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const Module = require("node:module");

function loadNodeHelper() {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "node_helper") return { create: (definition) => definition };
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const modulePath = require.resolve("../node_helper");
    delete require.cache[modulePath];
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

function loadFrontend() {
  let definition;
  const source = fs.readFileSync(path.join(__dirname, "..", "MMM-voetbal-nl.js"), "utf8");
  vm.runInNewContext(source, {
    Module: {
      register(_name, moduleDefinition) {
        definition = moduleDefinition;
      },
    },
  });
  return definition;
}

const matches = [
  { date: "3 september 2026", round: "3" },
  { date: "2 september 2026", round: "2" },
  { date: "1 september 2026", round: "1" },
];

test("node helper limits results for numeric and string config values", () => {
  const helper = loadNodeHelper();
  assert.equal(helper.limitMatches(matches, 2).length, 2);
  assert.equal(helper.limitMatches(matches, "2").length, 2);
});

test("frontend enforces maxMatches on received results", () => {
  const frontend = loadFrontend();
  const instance = {
    ...frontend,
    config: { maxMatches: 2 },
    updateDom() {},
  };

  instance.socketNotificationReceived("MATCHES_RESULT", matches);
  assert.equal(instance.matches.length, 2);
});

test("frontend formats a match date as a compact day and month", () => {
  const frontend = loadFrontend();
  assert.equal(frontend.formatMatchDate("Zaterdag 26 september 2026"), "26 sep");
});
