import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseFlow, stepLabel } from "../flow.js";

function write(yaml: string): string {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "crossmatch-")), "f.yaml");
  fs.writeFileSync(f, yaml);
  return f;
}

test("parses every directive of the Argent-compatible subset", () => {
  const flow = parseFlow(
    write(`title: T
description: D
steps:
  - launch: com.x
  - await: { visible: { id: a } }
  - tap: { text: Matches }
  - tap: { x: 0.5, y: 0.5 }
  - tap: { on: { id: b }, times: 2 }
  - type: { into: { id: f }, text: "Hi", submit: false }
  - swipe: left
  - swipe: { direction: up, from: { id: list } }
  - scroll-to: { target: { text: Footer }, direction: down }
  - long-press: { on: { id: row }, duration: 900 }
  - assert: { hidden: { text: Spinner } }
  - await: { text: { of: { id: v }, contains: "10" }, timeout: 3000 }
  - wait: 200
  - echo: hello
  - button: back
  - when: { platform: ios }
    steps:
      - tap: { text: OK }
  - tool: keyboard
    args: { key: enter }
`),
  );
  assert.equal(flow.title, "T");
  assert.equal(flow.steps.length, 17);
  const kinds = flow.steps.map((s) => s.directive.kind);
  assert.deepEqual(kinds, ["launch", "await", "tap", "tap", "tap", "type", "swipe", "swipe", "scroll-to", "long-press", "assert", "await", "wait", "echo", "button", "when", "tool"]);
  const when = flow.steps[15].directive;
  assert.ok(when.kind === "when" && when.platform === "ios" && when.steps.length === 1);
  const aw = flow.steps[11].directive;
  assert.ok(aw.kind === "await" && aw.condition.type === "text" && aw.condition.expected === "10" && aw.timeout === 3000);
  assert.equal(stepLabel(flow.steps[2].directive), 'tap "Matches"');
  assert.equal(stepLabel(flow.steps[5].directive), 'type "Hi" into #f');
});

test("rejects steps with two directives or unknown ones", () => {
  assert.throws(() => parseFlow(write("steps:\n  - tap: a\n    wait: 1\n")), /exactly one directive/);
  assert.throws(() => parseFlow(write("steps:\n  - frobnicate: a\n")), /unknown directive/);
});
