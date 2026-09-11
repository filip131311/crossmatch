import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDescribe, resolveSelector, renderTree } from "../describe.js";

const IOS = `Source: ax-service
Mode: flat
Coordinates are normalized [0,1] fractions of the screen (x, y, width, height), not pixels.

ROOT  AXGroup (0.000, 0.000, 1.000, 1.000)

  AXGroup "Discover"  (0.040, 0.137, 0.345, 0.047)
  AXButton "🐶, Biscuit, Biscuit, 3, Corgi, 2 km away" id="dog-card"  (0.040, 0.211, 0.920, 0.430)
  AXStaticText "Biscuit, 3"  (0.040, 0.540, 0.297, 0.039)
  AXButton "Nope" id="nope-button"  (0.321, 0.668, 0.163, 0.039)
  AXButton "Like" id="like-button" [disabled]  (0.543, 0.668, 0.136, 0.039)
  AXTextField "Message" id="chat-input" value="Hi \\"there\\""  (0.1, 0.9, 0.6, 0.05)`;

const ANDROID = `Source: android-devtools
Mode: nested

ROOT  Screen (0.000, 0.000, 1.000, 1.000)

  ComposeView  (0.000, 0.000, 1.000, 1.000)
    StaticText "Discover"  (0.040, 0.137, 0.204, 0.031)
    View "🐶 / Biscuit / Biscuit, 3 / Corgi / 2 km away" id="com.natively.dogtinder:id/dog-card" [clickable]  (0.039, 0.204, 0.922, 0.597)
    View "Super Like" id="super-like-button" [clickable]  (0.371, 0.818, 0.276, 0.052)
    Switch "Notifications" id="notifications-toggle" [clickable, checkable, checked]  (0.8, 0.3, 0.1, 0.04)`;

test("parses iOS flat trees with labels, ids, values and flags", () => {
  const t = parseDescribe(IOS);
  assert.equal(t.source, "ax-service");
  assert.equal(t.nodes.length, 6);
  const like = t.nodes.find((n) => n.id === "like-button")!;
  assert.equal(like.role, "button");
  assert.equal(like.text, "Like");
  assert.deepEqual(like.flags, ["disabled"]);
  assert.deepEqual(like.frame, { x: 0.543, y: 0.668, width: 0.136, height: 0.039 });
  const input = t.nodes.find((n) => n.id === "chat-input")!;
  assert.equal(input.role, "textfield");
  assert.equal(input.value, 'Hi "there"');
});

test("parses Android nested trees, strips resource-id prefixes and maps roles", () => {
  const t = parseDescribe(ANDROID);
  const card = t.nodes.find((n) => n.id === "dog-card")!;
  assert.equal(card.role, "button", "clickable View becomes a button");
  assert.equal(card.depth, 1);
  const sw = t.nodes.find((n) => n.id === "notifications-toggle")!;
  assert.equal(sw.role, "switch");
  assert.ok(sw.flags.includes("checked"));
});

test("selector resolution prefers exact id, then exact text, then interactive elements", () => {
  const t = parseDescribe(IOS);
  assert.equal(resolveSelector(t, { id: "nope-button" })!.text, "Nope");
  assert.equal(resolveSelector(t, { text: "biscuit, 3" })!.rawRole, "AXStaticText");
  // "Like" also appears inside the card label? no - but "Biscuit" appears in the card button and the static text
  const b = resolveSelector(t, { text: "Biscuit" })!;
  assert.equal(b.id, "dog-card", "interactive substring match beats plain text");
  assert.equal(resolveSelector(t, { text: "Nope", role: "button" })!.id, "nope-button");
  assert.equal(resolveSelector(t, { id: "missing" }), undefined);
});

test("renderTree prints one line per node with tap centres", () => {
  const out = renderTree(parseDescribe(ANDROID));
  assert.match(out, /button\s+"Super Like" #super-like-button \[clickable\] @\(0\.509, 0\.844\)/);
});
