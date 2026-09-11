import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJson, rulesVerdicts, verdictKey } from "../judge.js";
import { parseJsonTail } from "../argent.js";
import type { Candidate } from "../types.js";

test("extractJson tolerates prose and code fences around the array", () => {
  assert.deepEqual(extractJson('Here you go:\n```json\n[{"a":1}]\n```\nDone.'), [{ a: 1 }]);
  assert.deepEqual(extractJson('[{"a":[1,2]}]'), [{ a: [1, 2] }]);
  assert.equal(extractJson("no json here"), undefined);
});

test("parseJsonTail takes the last JSON value after argent notes", () => {
  assert.deepEqual(parseJsonTail('NOTE: recording still running\n{\n  "tapped": true\n}\n'), { tapped: true });
});

test("rule verdicts map kinds to categories and carry a cross-flow key", () => {
  const c: Candidate = { id: "c1", stepIndex: 2, steps: [2, 3], kind: "elements", summary: "x", detail: "y", pointers: [{ side: "android", stepIndex: 2, element: { id: "super-like-button" }, label: "l" }] };
  const [v] = rulesVerdicts([c]);
  assert.equal(v.category, "missing-feature");
  assert.deepEqual(v.stepRange, [1, 3]);
  assert.equal(v.key, "missing-feature|android:super-like-button");
  assert.equal(verdictKey("content", [c]), "content|android:super-like-button");
});
