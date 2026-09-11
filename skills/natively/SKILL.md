---
name: natively
description: Find and document behavioural differences between a native iOS app and its Android twin. Use when the user has an iOS build and an Android build of "the same" app and wants to know where they diverge, wants a cross-platform parity check, or asks for side-by-side videos of platform differences. Drives both devices through Argent, records lockstep videos, judges what matters, and produces an HTML report.
---

# natively — cross-platform parity exploration

You are the explorer. `natively` (a CLI on top of Argent) is your instrument: it drives an iOS
simulator and an Android emulator **in lockstep**, records both screens, diffs the accessibility
trees after every step, judges the candidates with a rubric, renders branded side-by-side videos
with callouts, and writes the report. Your job is to walk both apps, find every feature, and turn
each feature into a flow file. Do not stop when you find the first difference: the goal is the
complete list.

Everything below assumes `natively.config.json` exists in the project (`natively init` writes one).

## 0. Setup (once)

```bash
natively doctor        # argent, ffmpeg+libx264, adb, simctl, claude (judge), config, apps
natively setup         # boots both devices, reinstalls both apps fresh, pins status bars, launches
natively status        # exploration budget: screens / flows / steps / minutes vs limits
```

If `doctor` says the ffmpeg on PATH has no libx264, fix PATH **before** Argent's tool-server
starts (macOS: `export PATH=/opt/homebrew/bin:$PATH`, then `argent server stop`); recordings fail
otherwise. Argent's own MCP tools work alongside `natively`; both talk to the same tool-server.

## 1. Explore both apps together

Look at both sides at once, screen by screen:

```bash
natively describe                  # normalised trees, both sides (roles, text, #id, tap centre)
natively describe -s android --fresh   # if the Android tree does not match the screenshot
natively argent screenshot -s ios      # any Argent tool, device id injected; -a '{"json":"args"}'
natively argent gesture-tap -s android -a '{"x":0.5,"y":0.93}'
natively screen <name> --note "what it is"    # register a screen you reached on BOTH sides
```

Rules of exploration:

- Reach each screen on both sides, then `natively screen <name>`. That records coverage, saves
  both trees and screenshots under `natively-out/screens/`, and refuses (exit code 2) once the
  screen budget is used. When `natively status` says `exhausted: true`, stop authoring and run
  what you have.
- Keep a coverage map in your head (or a scratch file): screen → controls seen → controls
  exercised. A control is "done" when a flow exercises it. Every interactive element in both trees
  should end up in some flow: buttons, switches, segments, list rows, text fields, swipes on cards.
- Prefer ids (`#id` in the tree) over text in selectors; both platforms should expose the same ids.
  When only text is available, use the visible text; matches are case-insensitive substrings.
- Never do destructive or external actions (purchases, account deletion, sending real messages,
  logging out of a shared account) unless the user explicitly asked for them.
- The two apps must start from the same state. Every end-to-end flow starts with `launch:`, and
  `natively compare --fresh` reinstalls both apps first. Do not carry state between flows.
- Android trees can go stale after a screen change (Argent helper bug). If the tree contradicts the
  screenshot, use `natively describe --fresh`. Lockstep runs handle this automatically.

## 2. Write one flow per feature

Flows live in the `flows/` directory (see config). They use Argent's flow step syntax (subset: no
relational selectors such as `within:`/`after:`, no `snapshot:`), plus two natively-only top-level
keys `title` and `description` (Argent's own `argent flow run` rejects unknown top-level keys, so
remove them if you ever replay a flow there):

```yaml
title: Send a message to a match
description: Like Biscuit (a mutual match), open the chat, try Send empty, then send "Hello".
steps:
  - launch: com.example.app
  - await: { visible: { id: dog-card } }
  - tap: { id: like-button }
  - when: { platform: ios }          # platform-only steps: only when one side NEEDS them
    steps:
      - await: { visible: { text: "It's a match!" } }
      - tap: { text: Keep swiping }
  - tap: { text: Matches }
  - await: { visible: { id: match-row-biscuit } }
  - tap: { id: match-row-biscuit }
  - await: { visible: { id: chat-input } }
  - tap: { id: send-button }
  - type: { into: { id: chat-input }, text: "Hello", submit: false }
  - tap: { id: send-button }
  - await: { visible: { text: Hello } }
```

Directives: `launch` (bundle id, or `{ ios: …, android: … }`), `tap` (selector, `{on, times}` or
`{x, y}`), `long-press {on, duration}`, `swipe` (`up|down|left|right` or `{direction, from, duration}`;
the direction is the finger's travel), `type {into, text, submit}`, `scroll-to {target, direction,
maxSwipes}`, `await` / `assert` with a condition — `{ visible: sel }`, `{ exists: sel }`,
`{ hidden: sel }`, `{ idle: true }`, `{ text: { in: sel, contains|equals|matches: "…" } }` — plus
`timeout` (ms) on `await`, `wait <ms>`, `echo <message>`, `button <home|back>`,
`when: { platform: ios|android }` with nested `steps:`, `tool: <argent tool>` with `args:`.
Selectors: `{ id }`, `{ text }` (case-insensitive substring), `{ text: { matches: regex } }`,
`{ role }`, or a bare string (id first, then text).

Guidelines that make the diff useful:

- Short flows, one feature each (5–15 steps). Long flows blur which step caused what.
- Put an `await` after every navigation so both sides settle before the next step.
- A step that **fails on one side only** is itself a finding (the recorder keeps going on the other
  side); do not "fix" the flow with `when:` to hide it. Use `when:` only for known, accepted
  platform mechanics (dismissing an alert that exists by design on one side, a system dialog).
- When you already saw a difference while exploring, still write a flow that reproduces it: the
  report is built only from flows.
- Cover the boring paths too: empty states, back navigation, re-visiting a screen (state
  persistence), the last item of a list, validation with empty input.

## 3. Compare, judge, render, report

```bash
natively compare                   # all flows: lockstep run + diff + judge + videos + report
natively compare chat-send --fresh # one flow, reinstalling both apps first
natively judge chat-send           # re-judge a run (e.g. after editing judgeRules in the config)
natively judge chat-send --rules  # rule-based only (no LLM): every candidate becomes a "needs review" item
natively judge chat-send --from verdicts.json   # import verdicts you wrote by hand (schema below)
natively render chat-send          # re-render the side-by-side videos
natively report                    # rebuild natively-out/report/index.html
```

Read the compare output. For every run look at `natively-out/runs/<flow>/candidates.json` and
`verdicts.json`. The judge is a headless `claude -p` session with the rubric in
`natively-out/report/index.html` (Rubric section). If you disagree with a verdict, or `claude` is
not installed (rule-based verdicts report everything), write `verdicts.json` yourself and import it:

```json
[{ "candidateIds": ["c2"], "category": "missing-feature", "severity": "medium",
   "title": "Android has Super Like; iOS does not", "description": "…",
   "stepRange": [1, 3],
   "pointers": [{ "side": "android", "stepIndex": 1, "element": { "id": "super-like-button" }, "label": "Only on Android" }],
   "judge": "human" }]
```

`stepRange` and `stepIndex` are 0-based here (`step`, 1-based, is also accepted on pointers, as in
the judge prompt). Imports are validated the same way as judge output: unknown categories become
noise, candidate ids must exist, and candidates you do not mention keep a rule-based verdict marked
"needs review". Pointers are all you supply for the callouts; natively draws the uniform branded
highlight, label and ghost marker. Elements are looked up in the named step's tree (and the
neighbouring steps); a pointer that resolves nowhere is logged and skipped.

## 4. Finish

- Run `natively status`; if screens or controls remain unexercised and the budget allows, go back
  to step 1. Finish only when every screen registered has every control exercised by a flow, or
  the budget is exhausted.
- Open `natively-out/report/index.html` and check every difference has a video and the callouts
  point at the right things. Re-judge or hand-write verdicts where the judge was wrong.
- Tell the user: number of differences by severity, the titles, the report path, and what was
  filtered as platform idiom or noise (the report lists it).
