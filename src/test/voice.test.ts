import { test } from "node:test";
import assert from "node:assert/strict";
import { tidyDescription, tidyTitle } from "../voice.js";

test("descriptions are cut to two sentences and lose detection jargon", () => {
  const d = tidyDescription(
    'On iOS the Send button is greyed out while the message field is empty, so tapping it does nothing (0% pixel change). On Android the Send button stays enabled, and tapping it with an empty field posts a blank message bubble (the small empty pill at the top right in step 9). The blank bubble persists and is still visible above "Hello" after step 12, so the empty submission is stored as real chat data.',
  );
  assert.equal(d.split(/[.!?]\s/).length, 2, d);
  assert.ok(!/pixel|step \d/.test(d), d);
});

test("titles stay on one line", () => {
  assert.equal(tidyTitle("Android has a Super Like button, iOS does not."), "Android has a Super Like button, iOS does not");
  const long = tidyTitle("iOS shows an It's a match alert after liking a mutual match; Android gives no feedback and just advances to the next card");
  assert.ok(long.length <= 91 && long.endsWith("…"), long);
});
