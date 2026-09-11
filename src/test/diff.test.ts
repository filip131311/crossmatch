import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDescribe } from "../describe.js";
import { diffRun } from "../diff.js";
import type { RunRecord, StepResult } from "../types.js";

const ios = (body: string) => parseDescribe(`Source: ax-service\nMode: flat\n\nROOT  AXGroup (0.000, 0.000, 1.000, 1.000)\n\n${body}`);
const and = (body: string) => parseDescribe(`Source: android-devtools\nMode: nested\n\nROOT  Screen (0.000, 0.000, 1.000, 1.000)\n\n${body}`);

function run(steps: Array<Partial<StepResult>>): RunRecord {
  return {
    flow: { name: "f", path: "f.yaml" },
    startedAt: "",
    finishedAt: "",
    devices: { ios: { id: "i", name: "i" }, android: { id: "a", name: "a" } },
    video: { ios: { file: "", durationMs: 0, width: 0, height: 0 }, android: { file: "", durationMs: 0, width: 0, height: 0 } },
    ok: true,
    steps: steps.map((s, i) => ({ index: i, directive: { kind: "echo", message: "" }, label: `s${i}`, ios: { status: "pass", startMs: 0, endMs: 0 }, android: { status: "pass", startMs: 0, endMs: 0 }, ...s })) as StepResult[],
  };
}

test("identical screens with platform-idiomatic trees produce no candidates", () => {
  const r = run([
    {
      ios: { status: "pass", startMs: 0, endMs: 0, tree: ios(`  AXStaticText "9:41"  (0.1, 0.01, 0.1, 0.03)\n  AXButton "🐶, Biscuit, Biscuit, 3, Corgi, 2 km away" id="dog-card"  (0.04, 0.2, 0.9, 0.4)\n  AXStaticText "Biscuit, 3"  (0.04, 0.5, 0.3, 0.04)\n  AXButton "Like" id="like-button"  (0.5, 0.7, 0.1, 0.04)\n  AXButton "Back" id="BackButton"  (0.0, 0.07, 0.1, 0.05)\n  AXGroup "Vertical scroll bar, 2 pages"  (0.9, 0.1, 0.05, 0.8)\n  AXTextField "Flame" id="flame.fill"  (0.2, 0.9, 0.05, 0.03)`) },
      android: { status: "pass", startMs: 0, endMs: 0, tree: and(`  View "🐶 / Biscuit / Biscuit, 3 / Corgi / 2 km away" id="dog-card" [clickable]  (0.04, 0.2, 0.9, 0.5)\n  View "Like" id="like-button" [clickable]  (0.6, 0.8, 0.2, 0.05)\n  ImageButton "Navigate up" [clickable]  (0.0, 0.1, 0.1, 0.05)`) },
    },
  ]);
  assert.deepEqual(diffRun(r), []);
});

test("controls on one side, differing text for one id, state flags and outcomes become candidates, deduplicated across steps", () => {
  const iosTree = ios(`  AXButton "Like" id="like-button"  (0.5, 0.7, 0.1, 0.04)\n  AXStaticText "10 km" id="distance-value"  (0.5, 0.3, 0.1, 0.04)\n  AXButton "Send" id="send-button" [disabled]  (0.8, 0.9, 0.1, 0.04)`);
  const andTree = and(`  View "Like" id="like-button" [clickable]  (0.6, 0.8, 0.2, 0.05)\n  View "Super Like" id="super-like-button" [clickable]  (0.4, 0.8, 0.2, 0.05)\n  StaticText "10 mi" id="distance-value"  (0.5, 0.3, 0.1, 0.04)\n  Button "Send" id="send-button" [clickable]  (0.8, 0.9, 0.1, 0.04)`);
  const r = run([
    { ios: { status: "pass", startMs: 0, endMs: 0, tree: iosTree }, android: { status: "pass", startMs: 0, endMs: 0, tree: andTree } },
    { ios: { status: "pass", startMs: 0, endMs: 0, tree: iosTree }, android: { status: "pass", startMs: 0, endMs: 0, tree: andTree } },
    { ios: { status: "pass", startMs: 0, endMs: 0, target: { role: "button", rawRole: "AXButton", text: "Go", frame: { x: 0, y: 0, width: 0.1, height: 0.1 }, flags: [], depth: 0 } }, android: { status: "fail", reason: "no element", startMs: 0, endMs: 0 } },
  ]);
  const c = diffRun(r);
  const kinds = c.map((x) => `${x.kind}:${x.summary}`);
  assert.ok(kinds.some((k) => k.startsWith('elements:Control "Super Like" (#super-like-button) exists only on Android')), kinds.join("\n"));
  assert.ok(kinds.some((k) => k.includes('#distance-value reads "10 km" on iOS but "10 mi" on Android')));
  assert.ok(kinds.some((k) => k.includes("#send-button") && k.includes("disabled on iOS")));
  assert.ok(kinds.some((k) => k.startsWith("outcome:")));
  const superLike = c.find((x) => x.summary.includes("Super Like"))!;
  assert.deepEqual(superLike.steps, [0, 1], "same difference in two steps is one candidate");
  assert.equal(superLike.pointers[0].side, "android");
  assert.equal(superLike.pointers[0].element?.id, "super-like-button");
});

test("keyboard keys are ignored only when a keyboard is on screen; app buttons with short labels survive", () => {
  const keys = Array.from({ length: 14 }, (_, k) => `  AXButton "${String.fromCharCode(97 + k)}"  (${(0.05 + k * 0.06).toFixed(2)}, 0.80, 0.05, 0.05)`).join("\n");
  const withKeyboard = ios(`  AXButton "Send" id="send-button"  (0.8, 0.6, 0.1, 0.04)\n  AXGroup "Typing Predictions"  (0.0, 0.70, 1.0, 0.05)\n  AXButton "hello"  (0.1, 0.71, 0.2, 0.03)\n${keys}`);
  const android = and(`  Button "Send" id="send-button" [clickable]  (0.8, 0.6, 0.1, 0.04)\n  Button "Delete / Done / Show emoji keyboard / More stylus options" [clickable]  (0.0, 0.9, 1.0, 0.05)`);
  const r = run([{ ios: { status: "pass", startMs: 0, endMs: 0, tree: withKeyboard }, android: { status: "pass", startMs: 0, endMs: 0, tree: android } }]);
  assert.deepEqual(diffRun(r), [], "keyboard rows, prediction bar and IME toolbar are chrome");
  // no keyboard on screen: a lone "+" or "Delete" button is app content
  const r2 = run([{ ios: { status: "pass", startMs: 0, endMs: 0, tree: ios(`  AXButton "+" id="add"  (0.8, 0.3, 0.1, 0.04)\n  AXButton "Delete"  (0.1, 0.5, 0.2, 0.04)`) }, android: { status: "pass", startMs: 0, endMs: 0, tree: and(`  StaticText "Nothing"  (0.1, 0.1, 0.3, 0.04)`) } }]);
  const s2 = diffRun(r2).map((c) => c.summary);
  assert.ok(s2.some((x) => x.includes("#add")), s2.join("\n"));
  assert.ok(s2.some((x) => x.includes('"Delete" exists only on iOS')), s2.join("\n"));
});

test("a one-sided failure yields one outcome candidate, not one per skipped step", () => {
  const r = run([
    { ios: { status: "pass", startMs: 0, endMs: 10 }, android: { status: "fail", reason: "no element", startMs: 0, endMs: 10 } },
    { ios: { status: "pass", startMs: 0, endMs: 20 }, android: { status: "skip", startMs: 0, endMs: 0 } },
    { ios: { status: "pass", startMs: 0, endMs: 30 }, android: { status: "skip", startMs: 0, endMs: 0 } },
  ]);
  const c = diffRun(r);
  assert.equal(c.filter((x) => x.kind === "outcome").length, 1);
  assert.match(c[0].summary, /passes on iOS but fails on Android/);
});

test("same rows in a different order are reported once", () => {
  const rows = (order: string[]) => order.map((id, k) => `  View "${id}" id="match-row-${id}" [clickable]  (0.0, ${(0.2 + k * 0.1).toFixed(2)}, 1.0, 0.08)`).join("\n");
  const r = run([{ ios: { status: "pass", startMs: 0, endMs: 0, tree: ios(rows(["biscuit", "luna"]).replace(/View/g, "AXButton").replace(/ \[clickable\]/g, "")) }, android: { status: "pass", startMs: 0, endMs: 0, tree: and(rows(["luna", "biscuit"])) } }]);
  const c = diffRun(r);
  assert.equal(c.length, 1, c.map((x) => x.summary).join("\n"));
  assert.match(c[0].summary, /ordered biscuit, luna on iOS but luna, biscuit on Android/);
});

test("the same changing value is one candidate across steps, keyed by its element", () => {
  const mk = (v: string, side: "ios" | "android") => (side === "ios" ? ios(`  AXStaticText "${v} km" id="distance-value"  (0.5, 0.3, 0.1, 0.04)`) : and(`  StaticText "${v} mi" id="distance-value"  (0.5, 0.3, 0.1, 0.04)`));
  const r = run([10, 11, 12].map((v) => ({ ios: { status: "pass" as const, startMs: 0, endMs: 0, tree: mk(String(v), "ios") }, android: { status: "pass" as const, startMs: 0, endMs: 0, tree: mk(String(v), "android") } })));
  const c = diffRun(r);
  assert.equal(c.length, 1, c.map((x) => x.summary).join("\n"));
  assert.deepEqual(c[0].steps, [0, 1, 2]);
});

test("segments on one row with slightly different frame tops are not an order difference; Android IME toolbar buttons are chrome", () => {
  const segs = (side: "ios" | "android") => {
    const mk = (id: string, x: number, y: number) => (side === "ios" ? `  AXButton "${id}" id="show-me-${id}"  (${x}, ${y}, 0.1, 0.03)` : `  View "${id}" id="show-me-${id}" [clickable]  (${x}, ${y}, 0.1, 0.03)`);
    return side === "ios" ? ios([mk("all", 0.8, 0.349), mk("puppies", 0.45, 0.356), mk("adults", 0.66, 0.356)].join("\n")) : and([mk("puppies", 0.45, 0.35), mk("adults", 0.66, 0.35), mk("all", 0.8, 0.35)].join("\n"));
  };
  const r = run([{ ios: { status: "pass", startMs: 0, endMs: 0, tree: segs("ios") }, android: { status: "pass", startMs: 0, endMs: 0, tree: segs("android") } }]);
  assert.deepEqual(diffRun(r).map((c) => c.summary), []);
  const ime = and(`  Button "Send" id="send-button" [clickable]  (0.8, 0.6, 0.1, 0.04)\n  View "Delete / Done / Show emoji keyboard / More stylus options"  (0.0, 0.9, 1.0, 0.05)\n  Button "Delete" [clickable]  (0.0, 0.9, 0.2, 0.05)\n  Button "Done" [clickable]  (0.2, 0.9, 0.2, 0.05)\n  Button "Got it" [clickable]  (0.5, 0.95, 0.2, 0.04)`);
  const r2 = run([{ ios: { status: "pass", startMs: 0, endMs: 0, tree: ios(`  AXButton "Send" id="send-button"  (0.8, 0.6, 0.1, 0.04)`) }, android: { status: "pass", startMs: 0, endMs: 0, tree: ime } }]);
  assert.deepEqual(diffRun(r2).map((c) => c.summary), []);
});
