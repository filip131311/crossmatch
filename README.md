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
npx crossmatch init      # config (apps auto-detected), the agent skill, Argent — all in one
crossmatch doctor        # check the toolchain
crossmatch setup         # boot both devices, install both apps fresh
```

Then ask your coding agent to explore both apps; it writes one flow per feature and runs
`crossmatch compare`, which judges, renders the videos and writes `crossmatch-out/report/index.html`.

**Needs:** macOS · Node 20+ · Xcode and the Android SDK · ffmpeg with libx264 · Argent 0.25+ · Claude Code (for the judge)

**Read next**

| | |
|---|---|
| [`docs/USAGE.md`](docs/USAGE.md) | commands, configuration, flow syntax |
| [`skills/crossmatch/SKILL.md`](skills/crossmatch/SKILL.md) | what the agent does |
| [`docs/argent-notes.md`](docs/argent-notes.md) | Argent quirks crossmatch works around |
| [`fixtures/`](fixtures/) | the two Dog Tinder test apps |
