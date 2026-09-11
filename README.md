# natively

Find and document behavioural differences between a native iOS app and its Android twin.

`natively` sits on top of [Argent](https://docs.swmansion.com/argent). An agent (Claude Code with the
bundled skill) explores both apps and writes one flow per feature; `natively` replays each flow on an
iOS simulator and an Android emulator **in lockstep**, records both screens, diffs the accessibility
trees after every step, has a judge decide which differences matter, renders branded side-by-side
videos with callouts, and writes an HTML report.

```
natively init            write natively.config.json
natively doctor          check argent, ffmpeg (libx264), adb, simctl, claude, config, apps
natively setup           boot both devices, install both apps fresh, pin status bars
natively describe        normalised UI tree of both sides (what the agent authors flows from)
natively screen <name>   register a screen reached on both sides (coverage + budget)
natively compare [flow]  lockstep run + diff + judge + videos + report
natively judge <run>     re-judge, or import human verdicts (--from)
natively render <run>    re-render side-by-side videos
natively report          rebuild the HTML report
natively argent <tool>   call any Argent tool on one side (-s ios|android)
```

## Requirements

- Node 20+, `ffmpeg`/`ffprobe` with libx264 (macOS: `brew install ffmpeg`, and put `/opt/homebrew/bin`
  first on PATH before Argent's tool-server starts), Xcode (simctl), Android SDK (adb, emulator).
- Argent 0.25+ on PATH (`npm i -g @swmansion/argent`) or `NATIVELY_ARGENT_BIN=/path/to/cli.js`.
- Claude Code CLI for the LLM judge (optional; without it every candidate is reported with a
  rule-based verdict for a human to review).

## Configuration

`natively.config.json` (paths are relative to the file):

```json
{
  "ios":     { "app": "build/App.app",     "bundleId": "com.example.app", "device": "iPhone 17 Pro" },
  "android": { "app": "build/app-debug.apk", "bundleId": "com.example.app", "device": "Pixel_9" },
  "out": "natively-out",
  "flows": "flows",
  "limits": { "maxScreens": 500, "maxFlows": 200, "maxSteps": 20000, "maxMinutes": 720 },
  "brand": { "name": "natively", "accent": "#6C4CF1", "ink": "#14121F", "paper": "#FFFFFF" },
  "recording": { "showTouches": true, "timeLimitSeconds": 300 },
  "judgeRules": ["Prices are shown in local currency on each platform; that is expected."]
}
```

`limits` bound the exploration; the defaults are large so that a small app is explored completely.
`judgeRules` are plain-English, app-specific exceptions added to the judge's rubric.

## How a difference becomes an artifact

1. **Lockstep run** — every flow step starts on both devices at the same moment; the next step waits
   for both. Both screens are recorded (`trimStatic` off, so the two timelines stay aligned) and after
   every step both trees and screenshots are captured. `runs/<flow>/run.json`.
2. **Diff** — mechanical candidates: a step that passes on one side and fails on the other, controls
   that exist on one side only, the same element with different text or state, text present on one
   side only. Accessibility artefacts and platform chrome are filtered. `candidates.json`.
3. **Judge** — the rubric in `src/taxonomy.ts` (categories: missing-feature, behaviour, validation,
   content, state, layout, navigation; and the non-differences platform-idiom and noise, plus the
   "one root cause, not its consequences" rule) is applied by a headless `claude -p` session that can
   look at the screenshots. `verdicts.json`.
4. **Render** — for every confirmed difference a side-by-side mp4 (`diff-N.mp4`) cut from both
   recordings at the same steps, with the uniform brand frame, step captions and callouts at the
   elements the judge pointed at (a ghost marker shows where a missing control would be).
5. **Report** — `natively-out/report/index.html` lists every difference with its video, groups the
   same difference found by several flows, and shows what was filtered and why.

## Flow files

Argent-compatible YAML (a flow also runs with `argent flow run`), plus `title` and `description`.
See `skills/natively/SKILL.md` for the directive list and authoring rules; `flows/` in this repo holds
the flows for the bundled Dog Tinder fixture apps.

## Fixtures

`fixtures/dogtinder-ios` (SwiftUI) and `fixtures/dogtinder-android` (Compose) are near-identical apps
with five planted differences, documented in `fixtures/SPEC.md`. They are what the tool is tested
against:

```bash
(cd fixtures/dogtinder-ios && xcodegen generate && xcodebuild -scheme DogTinder -sdk iphonesimulator -configuration Debug -derivedDataPath build -destination 'generic/platform=iOS Simulator' build)
(cd fixtures/dogtinder-android && JAVA_HOME=/opt/homebrew/opt/openjdk@21 ./gradlew assembleDebug)
natively doctor && natively setup && natively compare
```

## Development

```bash
npm install && npm run build && npm test
```

`docs/argent-notes.md` records the Argent behaviours natively works around.
