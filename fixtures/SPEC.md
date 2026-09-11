# Dog Tinder fixture apps — shared spec

Two native apps, `dogtinder-ios` (SwiftUI) and `dogtinder-android` (Kotlin + Jetpack Compose), that are
functionally near-identical. They exist to test `natively`, a tool that diffs iOS and Android apps.
Some differences are PLANTED on purpose (section "Planted differences"). Everything else must match
exactly: same copy, same data, same order, same ids, same behaviour. No randomness, no clocks, no network.

App display name: **DogTinder**. Bundle id / applicationId: `com.natively.dogtinder`.

## Data (identical on both, this exact order)

| # | id | name | age | breed | distanceKm | bio | mutualMatch |
|---|----|------|-----|-------|------------|-----|-------------|
| 1 | biscuit | Biscuit | 3 | Corgi | 2 | Loves belly rubs and long naps in the sun. | yes |
| 2 | rex | Rex | 5 | German Shepherd | 4 | Serious about fetch. Not serious about anything else. | no |
| 3 | mochi | Mochi | 1 | Shiba Inu | 1 | Small, fluffy, judging you. | no |
| 4 | luna | Luna | 4 | Husky | 7 | Will sing you the song of her people. | yes |
| 5 | bruno | Bruno | 6 | Boxer | 3 | Gentle giant with a drool problem. | no |
| 6 | pepper | Pepper | 2 | Dalmatian | 5 | Spots on the outside, chaos on the inside. | no |

Card art: no image assets. Each dog gets a solid rounded rectangle in a fixed colour plus a large 🐶 emoji
and the name. Colours (hex): biscuit #F4A261, rex #264653, mochi #E9C46A, luna #2A9D8F, bruno #8D5B4C, pepper #6D6875.

## Screens

Bottom tab bar with three tabs, in this order: **Discover**, **Matches**, **Settings**.
Tab ids: `tab-discover`, `tab-matches`, `tab-settings`.

### Discover (default tab)
- Title text "Discover" at top.
- Shows the current dog card (`dog-card`): art block, then text `"<Name>, <age>"` (e.g. "Biscuit, 3"),
  then breed, then `"<distanceKm> km away"`.
- Buttons below the card, left to right: **Nope** (`nope-button`) and **Like** (`like-button`).
- Tapping the card (the art or the name) opens the **Profile** screen for that dog.
- Nope: advances to the next dog. Like: advances to the next dog; if the dog is `mutualMatch`, it is added
  to Matches (see planted difference D2 for the dialog behaviour).
- After the last dog: card area shows text "No more dogs nearby" and a **Start over** button
  (`start-over-button`) that resets the deck to dog #1 (matches are kept).

### Profile (pushed from Discover)
- Shows art, `"<Name>, <age>"`, breed, `"<distanceKm> km away"`, bio, and a **Back** navigation control
  (platform-idiomatic: iOS nav-bar back, Android top-app-bar back arrow). Title of the screen = dog name.
- Buttons at the bottom, left to right: **Nope** (`nope-button`) and **Like** (`like-button`) — same effect as on
  Discover, then pop back to Discover.

### Matches
- Title "Matches". List of matched dogs in the order they were matched. Each row (`match-row-<id>`) shows
  the small art block, the name, and the breed. Tapping a row opens **Chat**.
- Empty state text when there are no matches: "No matches yet. Keep swiping!"

### Chat (pushed from Matches)
- Title = dog name. Message list (initially empty) and, at the bottom, a text field (`chat-input`,
  placeholder "Message") and a **Send** button (`send-button`).
- Sending appends the message as a bubble (`message-bubble`) to the list and clears the field.
  Messages persist while the app is running (per dog).

### Settings
- Title "Settings".
- Row "Max distance" with a value label (`distance-value`) and a stepper/- + buttons
  (`distance-minus`, `distance-plus`), range 1..50, step 1, default 10. Label format: see planted D3.
- Row "Notifications" with a switch (`notifications-toggle`), default off.
- Row "Show me" with three segments **Puppies** / **Adults** / **All** (`show-me-puppies`, `show-me-adults`,
  `show-me-all`), default All. Purely a stored value; it does NOT filter the deck.
- Button **Reset swipes** (`reset-swipes-button`): resets the deck to dog #1 and clears all matches and chats.

## Planted differences (the ONLY intentional differences)

- **D1 — missing feature.** Android Discover has a third button **Super Like** (`super-like-button`) between Nope
  and Like. It behaves like Like. iOS has no such button.
- **D2 — behaviour.** Liking a `mutualMatch` dog on iOS shows an alert "It's a match!" with message
  "You and <Name> liked each other." and buttons **Keep swiping** and **Say hi** (Say hi switches to the Matches
  tab). Android shows no alert: the dog is added to matches silently.
- **D3 — content/units.** Settings "Max distance" value label: iOS `"<n> km"`, Android `"<n> mi"`. Same number.
- **D4 — validation.** Chat Send button: iOS disables Send while the field is empty (whitespace counts as empty).
  Android keeps Send enabled and sends an empty bubble.
- **D5 — state.** Notifications switch: on iOS the value persists when you leave the Settings tab and come back.
  On Android it resets to off every time the Settings tab is shown again.

## Expected platform-idiomatic (non-)differences
Tab bar vs Material NavigationBar, nav-bar back vs top-app-bar arrow, iOS Toggle vs Material Switch, fonts,
transitions, alert styling. These are NOT bugs and should not be "fixed" into pixel parity.

## Accessibility ids (required for both platforms)
Every element listed with an id above must expose it:
- iOS: `.accessibilityIdentifier("<id>")` on the control. Text elements need no id.
- Android: `Modifier.testTag("<id>")` and enable `testTagsAsResourceId = true` on the root
  (`Modifier.semantics { testTagsAsResourceId = true }`) so UiAutomator sees it as a resource-id.
  Also set `contentDescription` on icon-only controls to their label.

## Build
- iOS: `fixtures/dogtinder-ios/` with `project.yml` (xcodegen), scheme `DogTinder`, iOS 17.0 deployment target,
  no signing needed (simulator). Build command that must succeed:
  `xcodegen generate && xcodebuild -scheme DogTinder -sdk iphonesimulator -configuration Debug -derivedDataPath build -destination 'generic/platform=iOS Simulator' build`
  Output: `build/Build/Products/Debug-iphonesimulator/DogTinder.app`.
- Android: `fixtures/dogtinder-android/` Gradle project, Kotlin 2.x, Compose (BOM), Material3, minSdk 26,
  targetSdk 35, compileSdk 35, gradle wrapper committed. Build command that must succeed:
  `./gradlew assembleDebug`. Output: `app/build/outputs/apk/debug/app-debug.apk`.
