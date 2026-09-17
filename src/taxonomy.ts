import { DEFAULT_PAIR, SIDE_NAME, type Category, type Pair, type Severity } from "./types.js";

export const CATEGORIES: Category[] = ["missing-feature", "behaviour", "validation", "content", "state", "layout", "navigation", "platform-idiom", "noise"];
export const SEVERITIES: Severity[] = ["high", "medium", "low", "ignore"];

/** The rubric the judge applies. Also rendered into the report so readers know what was filtered. */
const TAXONOMY_TEMPLATE = `
## What counts as a difference (document it)

- missing-feature — a control, screen, action or piece of functionality exists on one side only
  (a button, a menu entry, a settings row, a whole screen). Severity: high if a user task cannot be
  completed on one side, medium otherwise.
- behaviour — the same action produces a different outcome (a dialog on one side, none on the other;
  navigation to a different place; a different result of the same input). Severity: high when the
  outcome changes what the user can do next, medium when it is cosmetic feedback (toast vs. alert).
- validation — one side accepts input the other rejects, or enables a control the other disables
  (empty-field submission, error messages, length limits). Severity: medium, high if data can be corrupted.
- content — the same element shows different text, numbers, units or formats ("10 km" vs "10 mi",
  different copy, different list contents or order). Severity: low for wording, medium for units,
  data or order.
- state — a value persists on one side and resets on the other, or state leaks between screens
  differently. Severity: medium, high if user data is lost.
- layout — the same controls exist but in a materially different order or grouping that changes how
  the feature is used (not spacing, not size). Severity: low.
- navigation — the same action leads to a different screen, or the back path differs in what it shows
  (not how it animates). Severity: medium.

## What is NOT a difference (severity: ignore)

- platform-idiom — expected native differences: tab bar vs. Material navigation bar, nav-bar back
  chevron vs. top-app-bar arrow, iOS Toggle vs. Material Switch, alerts vs. Material dialogs *with the
  same options*, pickers, share sheets, keyboards, fonts, colours, corner radii, shadows, spacing,
  animation and transition style, system status bar, accessibility labels joined with ", " vs " / ",
  capitalisation conventions of buttons, ripple vs. highlight feedback, scroll indicators.{WEB}
- noise — accessibility artefacts (scroll bar descriptions, "N pages", SF Symbol names, icon labels
  such as "Flame" / "love" / "gearshape.fill"), the same aggregated label rendered with different
  separators, a tab losing its id while selected, timing differences of a few hundred ms.
- consequences — when one root difference makes later steps diverge (an alert on one side blocks the
  next tap, so the screens differ afterwards), report ONE difference for the root cause and mention
  the consequence in its description; do not report the downstream candidates separately.
`.trim();

const WEB_IDIOMS = `
  On the web side also: browser-native form controls (select dropdowns, date inputs) in place of
  native pickers, hover and focus styles, links that look like text, the browser's history back in
  place of a system back button, cookie or consent banners, "open in app" / install prompts, web
  fonts, and a page that scrolls as a whole where the app scrolls a list.`;

/** The rubric, naming the platforms compared (web adds its own idioms). */
export function taxonomyFor(pair: Pair): string {
  return TAXONOMY_TEMPLATE.replace("{WEB}", pair.includes("web") ? WEB_IDIOMS : "").replace("(document it)", `between ${SIDE_NAME[pair[0]]} and ${SIDE_NAME[pair[1]]} (document it)`);
}

export const TAXONOMY = taxonomyFor(DEFAULT_PAIR);
