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
  assert.ok(kinds.some((k) => k.includes("#send-button") && k.includes("disabled on ios")));
  assert.ok(kinds.some((k) => k.startsWith("outcome:")));
  const superLike = c.find((x) => x.summary.includes("Super Like"))!;
  assert.deepEqual(superLike.steps, [0, 1], "same difference in two steps is one candidate");
  assert.equal(superLike.pointers[0].side, "android");
  assert.equal(superLike.pointers[0].element?.id, "super-like-button");
});
