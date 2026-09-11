/**
 * Mechanical comparison of the two sides of a lockstep run. Produces *candidates*: things that
 * differ and might matter. The judge decides which ones are real differences.
 */
import { meaningfulNodes } from "./describe.js";
import type { Candidate, Pointer, RunRecord, Side, StepResult, UiNode, UiTree } from "./types.js";

const INTERACTIVE = new Set(["button", "textfield", "switch", "checkbox", "slider", "tab", "link"]);
/** Platform chrome that never counts as a difference. */
const IDIOM_TEXT = new Set(["back", "navigate up", "chevron", "tab bar", "more options", "more", "menu", "close", "done", "search"]);
const IDIOM_IDS = new Set(["backbutton", "back", "navigate up", "up"]);
const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\s️]+$/u;
const SYMBOL_ID = /^[a-z0-9]+(\.[a-z0-9]+)+$/i; // SF Symbol names leak into the iOS tree as ids
/** Accessibility artefacts of the platform, not app content. */
const ARTEFACT_TEXT = /^(vertical|horizontal) scroll bar|^\d+ pages?$|^page \d+ of \d+$/i;
/** The software keyboard and IME toolbars (present whenever a text field is focused). */
const KEYBOARD_TEXT = /^(shift|emoji|return|dictate|dictation|delete|space|next keyboard|typing predictions?|predictions?|show emoji keyboard|more stylus options|got it|hold and drag.*|done|go|search|send key|switch input method|hide keyboard|keyboard)$/i;
const KEYBOARD_IDS = new Set(["shift", "emoji", "return", "dictation", "delete", "space", "nextkeyboard"]);

function isKeyboard(n: UiNode): boolean {
  const t = norm(n.text);
  if (t.length === 1) return true; // a single letter/digit key
  if (KEYBOARD_TEXT.test(t)) return true;
  if (n.id && KEYBOARD_IDS.has(n.id.toLowerCase())) return true;
  // a prediction/candidate bar item: a quoted word in the bottom half of the screen
  if (/^[„"“].+[”"]$/.test(n.text) && n.frame.y > 0.5) return true;
  return false;
}

function isArtefact(n: UiNode): boolean {
  return (!!n.id && (SYMBOL_ID.test(n.id) || IDIOM_IDS.has(n.id.toLowerCase()))) || ARTEFACT_TEXT.test(n.text) || IDIOM_TEXT.has(norm(n.text)) || isChrome(n) || isKeyboard(n);
}

/** Split an aggregated accessibility label into its fragments: " / " (Android), newlines, then ", ". */
function fragments(text: string): string[] {
  const coarse = text.split(/\s*\/\s*|\n/).map(norm).filter(Boolean);
  const fine = coarse.flatMap((c) => c.split(/,\s+/).map(norm).filter(Boolean));
  return [...new Set([norm(text), ...coarse, ...fine])].filter((t) => t && !EMOJI_ONLY.test(t) && !IDIOM_TEXT.has(t));
}

function sameContent(a: string, b: string): boolean {
  const fa = new Set(fragments(a).filter((t) => !t.includes(",") && !t.includes("/")));
  const fb = new Set(fragments(b).filter((t) => !t.includes(",") && !t.includes("/")));
  if (fa.size !== fb.size) return false;
  for (const t of fa) if (!fb.has(t)) return false;
  return true;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function isChrome(n: UiNode): boolean {
  return n.frame.y + n.frame.height <= 0.06; // status bar
}

function isInteractive(n: UiNode): boolean {
  return INTERACTIVE.has(n.role) || n.flags.includes("clickable");
}

/** Text atoms visible on screen (aggregated labels are split into their parts). */
export function textAtoms(tree: UiTree): Map<string, UiNode> {
  const out = new Map<string, UiNode>();
  for (const n of meaningfulNodes(tree)) {
    if (isArtefact(n)) continue;
    for (const p of fragments(n.text)) if (!out.has(p)) out.set(p, n);
  }
  return out;
}

function byId(tree: UiTree): Map<string, UiNode> {
  const out = new Map<string, UiNode>();
  for (const n of meaningfulNodes(tree)) {
    if (!n.id || isArtefact(n)) continue;
    if (!out.has(n.id)) out.set(n.id, n);
  }
  return out;
}

function interactiveByText(tree: UiTree): Map<string, UiNode> {
  const out = new Map<string, UiNode>();
  for (const n of meaningfulNodes(tree)) {
    if (!isInteractive(n) || isArtefact(n) || !n.text) continue;
    const k = norm(n.text);
    if (IDIOM_TEXT.has(k) || EMOJI_ONLY.test(k)) continue;
    if (!out.has(k)) out.set(k, n);
  }
  return out;
}

const STATE_FLAGS = ["disabled", "checked", "selected", "focused"];

interface Raw { kind: Candidate["kind"]; signature: string; summary: string; detail: string; pointers: Pointer[]; step: number }

function pointerFor(side: Side, step: number, n: UiNode, label: string): Pointer {
  return { side, stepIndex: step, element: n.id ? { id: n.id } : { text: n.text }, frame: n.frame, label };
}

function compareStep(step: StepResult): Raw[] {
  const out: Raw[] = [];
  const i = step.index;
  if (step.ios.status !== step.android.status) {
    const failed: Side = step.ios.status === "pass" ? "android" : "ios";
    const passed: Side = failed === "ios" ? "android" : "ios";
    const reason = step[failed].reason ?? step[failed].status;
    const pointers: Pointer[] = [];
    if (step[passed].target) pointers.push(pointerFor(passed, i, step[passed].target!, `Works on ${passed}`));
    out.push({
      kind: "outcome",
      signature: `outcome:${i}`,
      summary: `Step ${i + 1} (${step.label}) ${step[passed].status === "pass" ? "passes" : step[passed].status} on ${passed} but ${step[failed].status}s on ${failed}`,
      detail: `${failed}: ${reason}`,
      pointers,
      step: i,
    });
  }
  const a = step.ios.tree;
  const b = step.android.tree;
  if (!a || !b) return out;
  // interactive elements by id
  const ia = byId(a);
  const ib = byId(b);
  for (const [id, n] of ia) {
    if (ib.has(id)) continue;
    if (!isInteractive(n)) continue;
    out.push({ kind: "elements", signature: `only-ios:#${id}`, summary: `Control "${n.text || id}" (#${id}) exists only on iOS`, detail: `iOS has ${n.role} #${id} "${n.text}" at (${n.frame.x.toFixed(2)}, ${n.frame.y.toFixed(2)}); Android has no element with that id.`, pointers: [pointerFor("ios", i, n, `Only on iOS: ${n.text || id}`)], step: i });
  }
  for (const [id, n] of ib) {
    if (ia.has(id)) continue;
    if (!isInteractive(n)) continue;
    out.push({ kind: "elements", signature: `only-android:#${id}`, summary: `Control "${n.text || id}" (#${id}) exists only on Android`, detail: `Android has ${n.role} #${id} "${n.text}" at (${n.frame.x.toFixed(2)}, ${n.frame.y.toFixed(2)}); iOS has no element with that id.`, pointers: [pointerFor("android", i, n, `Only on Android: ${n.text || id}`)], step: i });
  }
  // same id, different text or state
  for (const [id, na] of ia) {
    const nb = ib.get(id);
    if (!nb) continue;
    const ta = norm(na.text);
    const tb = norm(nb.text);
    if (ta && tb && ta !== tb && !sameContent(na.text, nb.text)) {
      out.push({ kind: "text", signature: `text:#${id}:${ta}|${tb}`, summary: `#${id} reads "${na.text}" on iOS but "${nb.text}" on Android`, detail: `Same element id, different visible text.`, pointers: [pointerFor("ios", i, na, `"${na.text}"`), pointerFor("android", i, nb, `"${nb.text}"`)], step: i });
    }
    for (const f of STATE_FLAGS) {
      const fa = na.flags.includes(f);
      const fb = nb.flags.includes(f);
      if (fa !== fb) {
        const where: Side = fa ? "ios" : "android";
        out.push({ kind: "flags", signature: `flag:#${id}:${f}:${where}`, summary: `#${id} ("${na.text || nb.text}") is ${f} on ${where} but not on ${where === "ios" ? "Android" : "iOS"}`, detail: `iOS flags: [${na.flags.join(", ")}]; Android flags: [${nb.flags.join(", ")}]`, pointers: [pointerFor("ios", i, na, fa ? `${f} on iOS` : `not ${f} on iOS`), pointerFor("android", i, nb, fb ? `${f} on Android` : `not ${f} on Android`)], step: i });
      }
    }
  }
  // interactive controls matched by label when ids are absent on one side
  const la = interactiveByText(a);
  const lb = interactiveByText(b);
  const idTexts = new Set([...ia.values(), ...ib.values()].map((n) => norm(n.text)));
  for (const [t, n] of la) {
    if (lb.has(t) || idTexts.has(t)) continue;
    if (textAtoms(b).has(t)) continue; // present as text on the other side, just not interactive
    out.push({ kind: "elements", signature: `only-ios:"${t}"`, summary: `Control "${n.text}" exists only on iOS`, detail: `iOS ${n.role} "${n.text}"; nothing with that label on Android.`, pointers: [pointerFor("ios", i, n, `Only on iOS: ${n.text}`)], step: i });
  }
  for (const [t, n] of lb) {
    if (la.has(t) || idTexts.has(t)) continue;
    if (textAtoms(a).has(t)) continue;
    out.push({ kind: "elements", signature: `only-android:"${t}"`, summary: `Control "${n.text}" exists only on Android`, detail: `Android ${n.role} "${n.text}"; nothing with that label on iOS.`, pointers: [pointerFor("android", i, n, `Only on Android: ${n.text}`)], step: i });
  }
  // plain text differences
  const xa = textAtoms(a);
  const xb = textAtoms(b);
  const onlyA = [...xa.keys()].filter((t) => !xb.has(t) && !ib.has(t));
  const onlyB = [...xb.keys()].filter((t) => !xa.has(t) && !ia.has(t));
  const coveredA = new Set([...ia.keys()].filter((id) => !ib.has(id)).map((id) => norm(ia.get(id)!.text)));
  const coveredB = new Set([...ib.keys()].filter((id) => !ia.has(id)).map((id) => norm(ib.get(id)!.text)));
  const restA = onlyA.filter((t) => !coveredA.has(t) && !la.has(t));
  const restB = onlyB.filter((t) => !coveredB.has(t) && !lb.has(t));
  if (restA.length || restB.length) {
    const pointers: Pointer[] = [];
    if (restA.length) pointers.push(pointerFor("ios", i, xa.get(restA[0])!, `Only on iOS: "${xa.get(restA[0])!.text}"`));
    if (restB.length) pointers.push(pointerFor("android", i, xb.get(restB[0])!, `Only on Android: "${xb.get(restB[0])!.text}"`));
    out.push({
      kind: "text",
      signature: `atoms:${restA.sort().join("|")}::${restB.sort().join("|")}`,
      summary: `Different text on screen: ${restA.length ? `iOS only [${restA.map((t) => `"${t}"`).join(", ")}]` : ""}${restA.length && restB.length ? "; " : ""}${restB.length ? `Android only [${restB.map((t) => `"${t}"`).join(", ")}]` : ""}`,
      detail: `Compared every visible text fragment after the step.`,
      pointers,
      step: i,
    });
  }
  return out;
}

export function diffRun(run: RunRecord): Candidate[] {
  const merged = new Map<string, Candidate>();
  let n = 0;
  for (const step of run.steps) {
    if (step.ios.status === "skip" && step.android.status === "skip") continue;
    for (const raw of compareStep(step)) {
      const existing = merged.get(raw.signature);
      if (existing) {
        existing.steps.push(raw.step);
        continue;
      }
      merged.set(raw.signature, { id: `c${++n}`, stepIndex: raw.step, steps: [raw.step], kind: raw.kind, summary: raw.summary, detail: raw.detail, pointers: raw.pointers });
    }
  }
  return [...merged.values()];
}
