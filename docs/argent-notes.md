# Argent behaviours natively depends on or works around

Observed with Argent 0.25.0 (tool-server from `radon-lite`), iOS 26.4 simulator, Android API 35 emulator.

## Stale Android accessibility tree (worked around)

`describe` on Android (source `android-devtools`, helper `com.argent.androiddevtools`) keeps returning
the previous screen's tree after some Jetpack Compose screen changes: e.g. Discover → Settings →
Discover → Settings reliably reports Discover after the second Settings tap while the screenshot shows
Settings. The tree stays stale for at least 10 s. Restarting the helper (`adb shell am force-stop
com.argent.androiddevtools`) makes the next `describe` fresh; the app under test is not affected
(the activity is not recreated).

Likely cause: the helper (`SnapshotInstrumentation.java`) reads `UiAutomation.getRootInActiveWindow()`
/ `getWindows()`; the UiAutomation `AccessibilityNodeInfo` cache is only invalidated by accessibility
events, and Compose's `TYPE_WINDOW_CONTENT_CHANGED` events do not always reach it. Candidate fixes in
the helper: call `UiAutomation.clearCache()` (API 34+) before every capture, or set
`serviceInfo.eventTypes = TYPES_ALL_MASK` / `flags |= FLAG_REPORT_VIEW_IDS` so the cache sees the
subtree-changed events, or `AccessibilityNodeInfo.refresh()` the roots.

natively mitigation (`src/runner.ts`): after an action step, if the Android tree is byte-identical to
the tree before the action, restart the helper and describe again; inside `await`/`assert` polling,
restart once after ~1.2 s of unchanged trees. `natively describe --fresh` does it on demand.

## Recording defaults that break side-by-side sync

`screen-recording-start` defaults `trimStatic: true` (drops still frames, destroying the real-time
timeline) and burns an Argent watermark. natively passes `trimStatic: false`; the watermark is
controlled by Argent's `video-watermark` flag (`argent disable video-watermark`).

## ffmpeg

The tool-server records with the `ffmpeg` on its own PATH and needs libx264. A conda ffmpeg without
x264 fails with `Unrecognized option 'preset'`. `natively doctor` checks both natively's ffmpeg and
the one on PATH.

## No install tool, no status-bar tool

Argent has `reinstall-app` (uninstall + install, clears app data) but no plain install, and no tool to
pin the status bar or set appearance/locale. natively pins the clock/battery itself with
`xcrun simctl status_bar` and Android SystemUI demo mode.

## `describe` returns text, not JSON

The tool renders the tree to one line per element; natively parses that format (`src/describe.ts`).
Roles are not harmonised across platforms (`AXButton` vs `Button`, clickable `View`s on Compose), so
natively maps them to a small shared vocabulary.

## iOS tab items lose their identifiers

SwiftUI `.accessibilityIdentifier` on a `tabItem` label does not reach the tab bar button on iOS 26;
Android drops the `testTag` id of the *selected* `NavigationBarItem`. Flows should select tabs by text.
