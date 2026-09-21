import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, parsePlatforms } from "../config.js";
import { parseDescribe } from "../describe.js";
import { diffRun } from "../diff.js";
import { parseFlow } from "../flow.js";
import { taxonomyFor } from "../taxonomy.js";
import { voiceFor } from "../voice.js";
import type { RunRecord, StepResult } from "../types.js";

// Argent's Chromium tree: ARIA role or lowercase tag name, value = own text
const WEB = parseDescribe(`Source: cdp-dom
Mode: nested

ROOT  html (0.000, 0.000, 1.000, 1.000)

  body  (0.000, 0.000, 1.000, 1.000)
    div id="app"  (0.000, 0.000, 1.000, 1.000)
      header id="header"  (0.000, 0.000, 1.000, 0.072)
        h1 value="Settings"  (0.041, 0.017, 0.323, 0.048)
      main id="main"  (0.000, 0.072, 1.000, 0.869)
          span value="Max distance"  (0.041, 0.105, 0.262, 0.027)
          span value="10 mi" id="distance-value"  (0.458, 0.105, 0.107, 0.027)
            button "Increment" value="+" id="distance-plus" [clickable]  (0.846, 0.098, 0.113, 0.043)
          switch "Notifications" id="notifications-toggle" [clickable]  (0.918, 0.181, 0.033, 0.015)
          input "Message" id="chat-input" [clickable, focused]  (0.1, 0.9, 0.6, 0.05)
          input "Remember me" [clickable, checked]  (0.1, 0.8, 0.05, 0.03)
          a value="Terms" [clickable]  (0.1, 0.7, 0.2, 0.03)
          div value="Card" [clickable]  (0.1, 0.5, 0.8, 0.1)
          img "Logo"  (0.1, 0.3, 0.2, 0.1)`);

test("web roles are normalised from tags and ARIA roles", () => {
  const role = (text: string) => WEB.nodes.find((n) => n.text === text)?.role;
  assert.equal(role("Settings"), "heading");
  assert.equal(role("Max distance"), "text");
  assert.equal(role("Increment"), "button");
  assert.equal(role("Notifications"), "switch");
  assert.equal(role("Message"), "textfield");
  assert.equal(role("Remember me"), "checkbox");
  assert.equal(role("Terms"), "button");
  assert.equal(role("Card"), "button", "a clickable div is a button");
  assert.equal(role("Logo"), "image");
  assert.equal(WEB.nodes.find((n) => n.id === "app")?.role, "container");
});

test("platform pairs: two different known platforms, as a list or a comma string", () => {
  assert.deepEqual(parsePlatforms(["ios", "web"], "p"), ["ios", "web"]);
  assert.deepEqual(parsePlatforms("web, android", "p"), ["web", "android"]);
  assert.throws(() => parsePlatforms(["web", "web"], "p"), /two different platforms/);
  assert.throws(() => parsePlatforms(["ios"], "p"), /two different platforms/);
  assert.throws(() => parsePlatforms(["ios", "windows"], "p"), /two different platforms/);
});

test("config defaults to ios and android and fills in the web block", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crossmatch-"));
  fs.writeFileSync(path.join(dir, "crossmatch.config.json"), JSON.stringify({ web: { url: "http://localhost:5000", viewport: { width: 412 } } }));
  const { config } = loadConfig(path.join(dir, "crossmatch.config.json"));
  assert.deepEqual(config.platforms, ["ios", "android"]);
  assert.equal(config.web.url, "http://localhost:5000");
  assert.equal(config.web.port, 9222);
  assert.deepEqual(config.web.viewport, { width: 412, height: 844, deviceScaleFactor: 2 });
});

test("an ios/web run names its sides and keeps a web page's top content", () => {
  const ios = parseDescribe(`Source: ax-service\nMode: flat\n\nROOT  AXGroup (0.000, 0.000, 1.000, 1.000)\n\n  AXStaticText "9:41"  (0.1, 0.01, 0.1, 0.03)\n  AXStaticText "10 km" id="distance-value"  (0.5, 0.3, 0.1, 0.04)`);
  const web = parseDescribe(`Source: cdp-dom\nMode: nested\n\nROOT  html (0.000, 0.000, 1.000, 1.000)\n\n  span value="10 mi" id="distance-value"  (0.5, 0.3, 0.1, 0.04)\n  a value="Sign in" [clickable]  (0.7, 0.01, 0.2, 0.04)`);
  const step = { index: 0, directive: { kind: "echo", message: "" }, label: "s0", ios: { status: "pass", startMs: 0, endMs: 0, tree: ios }, web: { status: "pass", startMs: 0, endMs: 0, tree: web } } as StepResult;
  const run: RunRecord = {
    flow: { name: "f", path: "f.yaml" },
    sides: ["ios", "web"],
    startedAt: "",
    finishedAt: "",
    devices: { ios: { id: "i", name: "i" }, web: { id: "chromium-cdp-9222", name: "Chrome 390×844" } },
    video: {},
    ok: true,
    steps: [step],
  };
  const summaries = diffRun(run).map((c) => c.summary);
  assert.ok(summaries.some((s) => s === '#distance-value reads "10 km" on iOS but "10 mi" on Web'), summaries.join("\n"));
  assert.ok(summaries.some((s) => s.includes('Control "Sign in" exists only on Web')), "a web header is not a status bar");
  assert.ok(!summaries.some((s) => s.includes("9:41")), "the iOS status bar is still ignored");
});

test("judge rubric and voice name the compared platforms", () => {
  assert.match(voiceFor(["android", "web"]), /"Android" and "Web"/);
  assert.match(taxonomyFor(["ios", "web"]), /between iOS and Web/);
  assert.match(taxonomyFor(["ios", "web"]), /browser-native form controls/);
  assert.doesNotMatch(taxonomyFor(["ios", "android"]), /browser-native/);
});

test("flows accept web in launch and when", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "crossmatch-")), "f.yaml");
  fs.writeFileSync(f, `steps:\n  - launch: { ios: com.x, web: "http://localhost:3000/app" }\n  - when: { platform: web }\n    steps:\n      - button: back\n`);
  const flow = parseFlow(f);
  assert.deepEqual(flow.steps[0].directive, { kind: "launch", perPlatform: { ios: "com.x", web: "http://localhost:3000/app" } });
  assert.equal(flow.steps[1].directive.kind === "when" && flow.steps[1].directive.platform, "web");
});
