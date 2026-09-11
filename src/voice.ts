/**
 * How CrossMatch talks about a difference. Shared by the judge prompt, the verdict sanitiser and
 * the skill, so titles and descriptions read the same whoever wrote them.
 */
export const VOICE = `
## Voice: short, plain, friendly

Write for a teammate skimming the report, not for a log file.

- Title: one plain sentence of at most 70 characters that says what differs. Name the sides as
  "iOS" and "Android". No step numbers, no ids, no percentages, no quotes around app copy unless the
  copy itself is the difference. Example: "Android has a Super Like button, iOS does not".
- Description: at most two short sentences, about 30 words in total. First sentence: what happens
  on each side. Second sentence (only if it adds something): why it matters for the user.
  Example: "Liking a mutual match shows a match dialog on iOS, while Android moves straight to
  the next dog. Android users never learn they matched."
- Never mention: step numbers, element ids (#like-button), pixel percentages, accessibility trees,
  candidates, or how the difference was detected. Do not repeat the title in the description.
- Callout labels: at most four words, e.g. "Match dialog", "No feedback", "Empty message sent".
- Tone: matter-of-fact and kind. No exclamation marks, no blame, no jargon.
`.trim();

const MAX_TITLE = 90;
const MAX_DESCRIPTION_SENTENCES = 2;
const MAX_DESCRIPTION_CHARS = 260;

/** Trim a title to one line of reasonable length. */
export function tidyTitle(title: string): string {
  let t = title.replace(/\s+/g, " ").trim().replace(/[.;]+$/, "");
  if (t.length > MAX_TITLE) {
    const cut = t.lastIndexOf(" ", MAX_TITLE - 1);
    t = `${t.slice(0, cut > 40 ? cut : MAX_TITLE - 1)}…`;
  }
  return t;
}

/** Keep at most two sentences and a modest length; drop detection jargon the judge was asked to avoid. */
export function tidyDescription(description: string): string {
  let d = description.replace(/\s+/g, " ").trim();
  d = d.replace(/\s*\((?:[^()]*?)(?:pixel|step \d+|#[a-z0-9-]+|candidate)[^()]*\)/gi, ""); // parenthetical jargon
  const sentences = d.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [d];
  d = sentences.slice(0, MAX_DESCRIPTION_SENTENCES).join("").trim();
  if (d.length > MAX_DESCRIPTION_CHARS) {
    const cut = d.lastIndexOf(" ", MAX_DESCRIPTION_CHARS - 1);
    d = `${d.slice(0, cut > 80 ? cut : MAX_DESCRIPTION_CHARS - 1)}…`;
  }
  return d;
}
