<p align="center"><img src="assets/logo.png" alt="CrossMatch" width="330"></p>


Find the behavioural differences between a native iOS app and its Android twin, and document each
one with a side-by-side video.

crossmatch is built on [Argent](https://github.com/software-mansion/argent), Software Mansion's
toolkit that lets coding agents drive iOS simulators and Android emulators. An agent explores both
apps with the bundled Claude Code skill and writes one short flow per feature. crossmatch then
replays every flow on both devices **in lockstep**, records both screens, diffs the accessibility
trees after each step, has a judge decide which differences matter (and which are just platform
idioms), renders a branded side-by-side mp4 with callouts for every confirmed difference, and writes
an HTML report.

```bash
npm install && npm run build
crossmatch init      # write crossmatch.config.json (app paths, bundle ids, devices, limits)
crossmatch doctor    # check argent, ffmpeg (libx264), adb, simctl, claude
crossmatch setup     # boot both devices, install both apps fresh
crossmatch compare   # run every flow, judge, render videos, write crossmatch-out/report/index.html
```

Requirements: macOS, Node 20+, Xcode + Android SDK, ffmpeg with libx264, Argent 0.25+ on PATH,
and the Claude Code CLI for the judge (optional).

- `docs/USAGE.md` — commands, configuration, flow syntax, how a difference becomes an artifact
- `skills/crossmatch/SKILL.md` — the exploration procedure the agent follows
- `docs/argent-notes.md` — Argent behaviours crossmatch depends on or works around
- `fixtures/` — two "Dog Tinder" apps (SwiftUI and Compose) with planted differences, used for testing
