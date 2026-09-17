/**
 * Mechanical comparison of the two sides of a lockstep run. Produces *candidates*: things that
 * differ and might matter. The judge decides which ones are real differences.
 *
 * Filters are deliberately narrow: platform chrome (status bar, back navigation), accessibility
 * artefacts (scroll bars, SF Symbol names) and the software keyboard — the last one only where a
 * keyboard is actually detected on screen, so an app's own "Delete" or "+" button is never dropped.
 */
import { meaningfulNodes } from "./describe.js";
import { SIDE_NAME, otherSide, runPair, sideOf, type Candidate, type Pair, type Pointer, type RunRecord, type Side, type StepResult, type UiNode, type UiTree } from "./types.js";

const INTERACTIVE = new Set(["button", "textfield", "switch", "checkbox", "slider", "tab", "link"]);
/** Back navigation is idiomatic per platform and never a difference. */
const IDIOM_TEXT = new Set(["back", "navigate up", "chevron", "tab bar"]);
const IDIOM_IDS = new Set(["backbutton"]);
const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\s️]+$/u;
/** SF Symbol names leak into the iOS tree as ids of icon artefacts (flame.fill, gearshape.fill, heart.fill). */
const SYMBOL_ID = /^[a-z0-9]+(\.[a-z0-9]+)*\.(fill|circle|square|slash|badge|rectangle|triangle|bubble|left|right|up|down|\d)(\.[a-z0-9]+)*$/i;
const ARTEFACT_TEXT = /^(vertical|horizontal) scroll bar|^\d+ pages?$|^page \d+ of \d+$/i;
const KEYBOARD_WORDS = /^(shift|emoji|return|dictate|dictation|delete|space|next keyboard|typing predictions?|predictions?|show emoji keyboard|more stylus options|got it|hold and drag.*|switch input method|hide keyboard|keyboard)$/i;
/** Extra words that only count as keyboard chrome inside an aggregated IME toolbar label. */
const IME_ACTION_WORDS = /^(done|go|search|send|next|previous)$/i;
const PREDICTION_BAR = /^typing predictions?$|^predictions?$/i;
/** Ids iOS gives its keyboard keys (labels are localised: "usuń", "cyfry"). */
const KEYBOARD_IDS = /^(shift|delete|more|emoji|space|return|dictation|nextkeyboard|globe|numbers|letters|symbols)$/i;
const STATE_FLAGS = ["disabled", "checked", "selected"];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const isInteractive = (n: UiNode) => INTERACTIVE.has(n.role) || n.flags.includes("clickable");
const contains = (outer: UiNode, inner: UiNode) =>
  inner.frame.x >= outer.frame.x - 0.01 && inner.frame.y >= outer.frame.y - 0.01 && inner.frame.x + inner.frame.width <= outer.frame.x + outer.frame.width + 0.01 && inner.frame.y + inner.frame.height <= outer.frame.y + outer.frame.height + 0.01;

/** An IME toolbar exposed as one aggregated label ("Delete / Done / Show emoji keyboard / …"). */
function isImeToolbar(t: string): boolean {
  const parts = t.split(/\s*\/\s*/);
  return parts.length > 1 && parts.every((p) => KEYBOARD_WORDS.test(p) || IME_ACTION_WORDS.test(p) || p.length === 1);
}

/** Per-tree view with the platform chrome and keyboard removed. */
class Screen {
  readonly nodes: UiNode[];
  constructor(readonly tree: UiTree, readonly side: Side) {
    const all = meaningfulNodes(tree);
    // keyboard detection: a cluster of single-character keys in the lower half of the screen
    const keys = all.filter((n) => n.text.length === 1 && n.frame.y > 0.45);
    let keyboardTop = keys.length >= 12 ? Math.min(...keys.map((n) => n.frame.y)) : undefined;
    // Android exposes no letter keys, but a floating IME toolbar (one aggregated node whose buttons
    // are nested inside it, anywhere on screen): the toolbar and everything inside it is chrome
    const toolbars = all.filter((n) => isImeToolbar(norm(n.text)));
    this.keyboard = keyboardTop !== undefined || toolbars.length > 0;
    const bars = [...toolbars, ...all.filter((n) => PREDICTION_BAR.test(n.text) && n.frame.width > 0.3 && n.frame.height < 0.08 && n.frame.y > 0.4)];
    this.nodes = all.filter((n) => !this.isChrome(n, keyboardTop, bars));
  }

  /** True when a software keyboard was detected on this screen. */
  readonly keyboard: boolean;

  private isChrome(n: UiNode, keyboardTop: number | undefined, bars: UiNode[]): boolean {
    if (this.side !== "web" && n.frame.y + n.frame.height <= 0.06 && !n.id) return true; // status bar (a web page has none)
    if (n.id && (SYMBOL_ID.test(n.id) || IDIOM_IDS.has(n.id.toLowerCase()))) return true;
    const t = norm(n.text);
    if (IDIOM_TEXT.has(t) || ARTEFACT_TEXT.test(t) || PREDICTION_BAR.test(t)) return true;
    if (keyboardTop !== undefined && n.frame.y >= keyboardTop - 0.01) {
      // on the keyboard: keys, keyboard words and anonymous decorations are chrome; the app's own
      // input bar (an id, or an interactive control with a real label) is not
      if (t.length <= 1 || KEYBOARD_WORDS.test(t) || IME_ACTION_WORDS.test(t)) return true;
      if (n.id && KEYBOARD_IDS.test(n.id)) return true;
      if (n.role === "image") return true; // iOS keys are images
      if (!n.id && !isInteractive(n)) return true;
    }
    if (bars.some((b) => b !== n && contains(b, n))) return true; // prediction bar / IME toolbar items
    if (this.keyboard && KEYBOARD_WORDS.test(t)) return true; // keyboard tips ("Got it", "Hold and drag …") while a keyboard is up
    return isImeToolbar(t);
  }

  /** Text fragments on screen → the first node that shows them. Aggregated labels are split. */
  atoms(): Map<string, UiNode> {
    const out = new Map<string, UiNode>();
    for (const n of this.nodes) for (const f of fragments(n.text, !this.keyboard)) if (!out.has(f)) out.set(f, n);
    return out;
  }

  /** Nodes by id. SwiftUI often puts one identifier on both a cell and its inner control: nested twins count once. */
  byId(): Map<string, { n: number; node: UiNode }> {
    const out = new Map<string, { n: number; node: UiNode }>();
    const seen: UiNode[] = [];
    for (const n of this.nodes) {
      if (!n.id) continue;
      if (seen.some((m) => m.id === n.id && (contains(m, n) || contains(n, m)))) continue;
      seen.push(n);
      const e = out.get(n.id);
      if (e) e.n++;
      else out.set(n.id, { n: 1, node: n });
    }
    return out;
  }

  interactiveByText(): Map<string, UiNode> {
    const out = new Map<string, UiNode>();
    for (const n of this.nodes) {
      if (!isInteractive(n) || !n.text) continue;
      const k = norm(n.text);
      if (!EMOJI_ONLY.test(k) && !out.has(k)) out.set(k, n);
    }
    return out;
  }
}

/**
 * Split an aggregated accessibility label into its fragments: " / " (Android), newlines, then ", ".
 * Single characters are kept only when asked (they are keyboard keys when a keyboard is up).
 */
export function fragments(text: string, keepShort = true): string[] {
  const coarse = text.split(/\s*\/\s*|\n/).map(norm).filter(Boolean);
  const fine = coarse.flatMap((c) => c.split(/,\s+/).map(norm).filter(Boolean));
  return [...new Set([norm(text), ...coarse, ...fine])].filter((t) => t && (keepShort || t.length > 1) && !EMOJI_ONLY.test(t) && !IDIOM_TEXT.has(t));
}

/** Same visible content: equal after normalisation, or equal sets of fragments (separators differ per platform). */
function sameContent(a: string, b: string): boolean {
  if (norm(a) === norm(b)) return true;
  const fa = new Set(fragments(a).filter((t) => !t.includes(",") && !t.includes("/")));
  const fb = new Set(fragments(b).filter((t) => !t.includes(",") && !t.includes("/")));
  if (fa.size <= 1 && fb.size <= 1) return false; // plain labels that differ
  if (fa.size !== fb.size) return false;
  for (const t of fa) if (!fb.has(t)) return false;
  return true;
}

/** Stable identity of a node for signatures: its id, else role + vertical position bucket. */
const elementKey = (n: UiNode) => (n.id ? `#${n.id}` : `${n.role}@${n.frame.y.toFixed(1)}`);

interface Raw { kind: Candidate["kind"]; signature: string; summary: string; detail: string; pointers: Pointer[]; step: number }

function pointerFor(side: Side, step: number, n: UiNode, label: string): Pointer {
  return { side, stepIndex: step, element: n.id ? { id: n.id } : { text: n.text }, frame: n.frame, label };
}

/** Ids that both apps use somewhere in the run: a difference in their presence or count is meaningful even for passive elements. */
function sharedIds(run: RunRecord, pair: Pair): Set<string> {
  const [sa, sb] = pair;
  const seen = { [sa]: new Set<string>(), [sb]: new Set<string>() } as Record<Side, Set<string>>;
  for (const st of run.steps) for (const side of pair) for (const n of st[side]?.tree?.nodes ?? []) if (n.id && !SYMBOL_ID.test(n.id)) seen[side].add(n.id);
  return new Set([...seen[sa]].filter((id) => seen[sb].has(id)));
}

function compareStep(step: StepResult, shared: Set<string>, pair: Pair): Raw[] {
  const out: Raw[] = [];
  const i = step.index;
  const [sa, sb] = pair;
  const ra = sideOf(step, sa);
  const rb = sideOf(step, sb);
  const [na, nb] = [SIDE_NAME[sa], SIDE_NAME[sb]];
  const failedSide = pair.find((s) => sideOf(step, s).status === "fail" || sideOf(step, s).status === "error");
  if (failedSide) {
    const other = otherSide(pair, failedSide);
    const ro = sideOf(step, other);
    const rf = sideOf(step, failedSide);
    if (ro.status === "pass") {
      const pointers: Pointer[] = [];
      if (ro.target) pointers.push(pointerFor(other, i, ro.target, `Works on ${SIDE_NAME[other]}`));
      out.push({ kind: "outcome", signature: `outcome:${step.label}:${failedSide}`, summary: `Step ${i + 1} (${step.label}) passes on ${SIDE_NAME[other]} but fails on ${SIDE_NAME[failedSide]}`, detail: `${SIDE_NAME[failedSide]}: ${rf.reason ?? rf.status}. Later steps were skipped on ${SIDE_NAME[failedSide]}.`, pointers, step: i });
    }
  }
  if (ra.status !== "pass" || rb.status !== "pass") return out;

  // one screen reacted to the action and the other did not (pixels, independent of the trees)
  const pa = ra.screenChange;
  const pb = rb.screenChange;
  const acted = !["await", "assert", "wait", "echo", "launch", "when", "tool"].includes(step.directive.kind);
  if (acted && pa !== undefined && pb !== undefined) {
    // calibrated on real captures: an empty chat bubble is ~0.24% of the screen, a blinking caret ~0.02%
    const moved = (x: number) => x >= 0.0015;
    const still = (x: number) => x <= 0.0004;
    if ((moved(pa) && still(pb)) || (moved(pb) && still(pa))) {
      const reacted: Side = moved(pa) ? sa : sb;
      const idle = otherSide(pair, reacted);
      const pointers: Pointer[] = [];
      for (const side of pair) {
        const target = sideOf(step, side).target;
        if (target) pointers.push(pointerFor(side, i, target, side === reacted ? `Screen changed on ${SIDE_NAME[side]}` : `No change on ${SIDE_NAME[side]}`));
      }
      out.push({ kind: "outcome", signature: `reaction:${step.label}:${reacted}`, summary: `After "${step.label}" the screen changed on ${SIDE_NAME[reacted]} (${((reacted === sa ? pa : pb) * 100).toFixed(1)}% of pixels) but not on ${SIDE_NAME[idle]}`, detail: `Pixel change between the screenshots before and after the step: ${na} ${(pa * 100).toFixed(2)}%, ${nb} ${(pb * 100).toFixed(2)}%. The trees may not expose what changed (an empty element, a state without text).`, pointers, step: i });
    }
  }

  if (!ra.tree || !rb.tree) return out;
  const A = new Screen(ra.tree, sa);
  const B = new Screen(rb.tree, sb);
  const ia = A.byId();
  const ib = B.byId();
  const xa = A.atoms();
  const xb = B.atoms();
  const comparedText = new Set<string>(); // texts already covered by an id-level comparison

  for (const id of new Set([...ia.keys(), ...ib.keys()])) {
    const ea = ia.get(id);
    const eb = ib.get(id);
    if (ea && eb) {
      for (const f of fragments(ea.node.text)) comparedText.add(f);
      for (const f of fragments(eb.node.text)) comparedText.add(f);
      const ta = norm(ea.node.text);
      const tb = norm(eb.node.text);
      if (ta && tb && ta !== tb && !sameContent(ea.node.text, eb.node.text)) {
        out.push({ kind: "text", signature: `text:#${id}`, summary: `#${id} reads "${ea.node.text}" on ${na} but "${eb.node.text}" on ${nb}`, detail: `Same element id, different visible text.`, pointers: [pointerFor(sa, i, ea.node, `"${ea.node.text}"`), pointerFor(sb, i, eb.node, `"${eb.node.text}"`)], step: i });
      }
      for (const f of STATE_FLAGS) {
        const fa = ea.node.flags.includes(f);
        const fb = eb.node.flags.includes(f);
        if (fa === fb) continue;
        const where: Side = fa ? sa : sb;
        const other = otherSide(pair, where);
        out.push({ kind: "flags", signature: `flag:#${id}:${f}:${where}`, summary: `#${id} ("${ea.node.text || eb.node.text}") is ${f} on ${SIDE_NAME[where]} but not on ${SIDE_NAME[other]}`, detail: `${na} flags: [${ea.node.flags.join(", ")}]; ${nb} flags: [${eb.node.flags.join(", ")}]`, pointers: [pointerFor(sa, i, ea.node, fa ? `${f} on ${na}` : `not ${f} on ${na}`), pointerFor(sb, i, eb.node, fb ? `${f} on ${nb}` : `not ${f} on ${nb}`)], step: i });
      }
      if (ea.n !== eb.n) out.push({ kind: "elements", signature: `count:#${id}`, summary: `${ea.n} × #${id} on ${na} but ${eb.n} × on ${nb}`, detail: `Different number of #${id} elements after this step (e.g. list rows or message bubbles).`, pointers: [pointerFor(sa, i, ea.node, `${ea.n} on ${na}`), pointerFor(sb, i, eb.node, `${eb.n} on ${nb}`)], step: i });
      continue;
    }
    const only: Side = ea ? sa : sb;
    const other = otherSide(pair, only);
    const e = (ea ?? eb)!;
    const otherAtoms = only === sa ? xb : xa;
    const textElsewhere = fragments(e.node.text).some((f) => otherAtoms.has(f));
    if (isInteractive(e.node) && textElsewhere && shared.has(id)) {
      // the other side knows this id (other steps) and shows the same label right now: an id that
      // drops out while the control is selected/focused (Compose NavigationBar does this), not a difference
      for (const f of fragments(e.node.text)) comparedText.add(f);
    } else if (isInteractive(e.node)) {
      out.push({ kind: "elements", signature: `only-${only}:#${id}`, summary: `Control "${e.node.text || id}" (#${id}) exists only on ${SIDE_NAME[only]}`, detail: `${SIDE_NAME[only]} has ${e.node.role} #${id} "${e.node.text}" at (${e.node.frame.x.toFixed(2)}, ${e.node.frame.y.toFixed(2)}); ${SIDE_NAME[other]} has no element with that id${textElsewhere ? `, though the text "${e.node.text}" does appear there` : ""}.`, pointers: [pointerFor(only, i, e.node, `Only on ${SIDE_NAME[only]}: ${e.node.text || id}`)], step: i });
      for (const f of fragments(e.node.text)) comparedText.add(f);
    } else if (shared.has(id)) {
      out.push({ kind: "elements", signature: `only-${only}:#${id}`, summary: `Element #${id} ("${e.node.text}") is shown on ${SIDE_NAME[only]} but not on ${SIDE_NAME[other]}`, detail: `Both apps use #${id} elsewhere; after this step only ${SIDE_NAME[only]} shows it.`, pointers: [pointerFor(only, i, e.node, `Only on ${SIDE_NAME[only]}`)], step: i });
      for (const f of fragments(e.node.text)) comparedText.add(f);
    } else if (e.node.text && !textElsewhere) {
      out.push({ kind: "text", signature: `text-only:${only}:#${id}`, summary: `"${e.node.text}" (#${id}) is shown on ${SIDE_NAME[only]} but nothing like it on ${SIDE_NAME[other]}`, detail: `${SIDE_NAME[other]} has neither the id nor the text.`, pointers: [pointerFor(only, i, e.node, `Only on ${SIDE_NAME[only]}`)], step: i });
      for (const f of fragments(e.node.text)) comparedText.add(f);
    }
    // an id-less twin with the same text on the other side counts as the same element: nothing to report
    if (textElsewhere) for (const f of fragments(e.node.text)) comparedText.add(f);
  }

  // interactive controls matched by label when ids are absent
  const la = A.interactiveByText();
  const lb = B.interactiveByText();
  for (const [side, mine, theirs, theirAtoms] of [[sa, la, lb, xb], [sb, lb, la, xa]] as Array<[Side, Map<string, UiNode>, Map<string, UiNode>, Map<string, UiNode>]>) {
    for (const [t, n] of mine) {
      if (theirs.has(t) || comparedText.has(t) || n.id) continue;
      if (theirAtoms.has(t)) continue; // present as text on the other side, just not interactive
      out.push({ kind: "elements", signature: `only-${side}:"${t}"`, summary: `Control "${n.text}" exists only on ${SIDE_NAME[side]}`, detail: `${SIDE_NAME[side]} ${n.role} "${n.text}"; nothing with that label on the other side.`, pointers: [pointerFor(side, i, n, `Only on ${SIDE_NAME[side]}: ${n.text}`)], step: i });
      for (const f of fragments(n.text)) comparedText.add(f);
    }
  }

  // order of repeated elements (list rows share an id prefix: match-row-biscuit, match-row-luna, …)
  const groups = (m: Map<string, { node: UiNode }>) => {
    const g = new Map<string, UiNode[]>();
    for (const [id, e] of m) {
      const prefix = id.replace(/-[^-]+$/, "");
      if (prefix === id) continue;
      g.set(prefix, [...(g.get(prefix) ?? []), e.node]);
    }
    return g;
  };
  const ga = groups(ia);
  const gb = groups(ib);
  for (const [prefix, rowsA] of ga) {
    const rowsB = gb.get(prefix);
    if (!rowsB || rowsA.length < 2 || rowsB.length < 2) continue;
    // reading order with a tolerance: segments of one control sit on one row even if their frames differ by a few px
    const row = (n: UiNode) => Math.round(n.frame.y / 0.03);
    const order = (ns: UiNode[]) => [...ns].sort((p, q) => row(p) - row(q) || p.frame.x - q.frame.x).map((n) => n.id!);
    const oa = order(rowsA);
    const ob = order(rowsB);
    if (oa.length === ob.length && oa.join() !== ob.join() && [...oa].sort().join() === [...ob].sort().join()) {
      out.push({ kind: "text", signature: `order:${prefix}`, summary: `${prefix}-* rows are ordered ${oa.map((x) => x.slice(prefix.length + 1)).join(", ")} on ${na} but ${ob.map((x) => x.slice(prefix.length + 1)).join(", ")} on ${nb}`, detail: `Same items, different order.`, pointers: [pointerFor(sa, i, rowsA[0], `Order on ${na}`), pointerFor(sb, i, rowsB[0], `Order on ${nb}`)], step: i });
    }
  }

  // plain text present on one side only, keyed by the element that shows it
  const restA = [...xa].filter(([t]) => !xb.has(t) && !comparedText.has(t));
  const restB = [...xb].filter(([t]) => !xa.has(t) && !comparedText.has(t));
  if (restA.length || restB.length) {
    // keyed by the element that shows the text; an id-less element also carries the texts themselves
    const keyOf = (rest: Array<[string, UiNode]>) => (rest.length ? (rest[0][1].id ? elementKey(rest[0][1]) : `${elementKey(rest[0][1])}{${rest.map(([t]) => t).sort().join("|")}}`) : "");
    const keyA = keyOf(restA);
    const keyB = keyOf(restB);
    const pointers: Pointer[] = [];
    if (restA.length) pointers.push(pointerFor(sa, i, restA[0][1], `Only on ${na}: "${restA[0][1].text}"`));
    if (restB.length) pointers.push(pointerFor(sb, i, restB[0][1], `Only on ${nb}: "${restB[0][1].text}"`));
    out.push({
      kind: "text",
      signature: `atoms:${keyA}::${keyB}`,
      summary: `Different text on screen: ${restA.length ? `${na} only [${restA.map(([t]) => `"${t}"`).join(", ")}]` : ""}${restA.length && restB.length ? "; " : ""}${restB.length ? `${nb} only [${restB.map(([t]) => `"${t}"`).join(", ")}]` : ""}`,
      detail: `Compared every visible text fragment after the step.`,
      pointers,
      step: i,
    });
  }
  return out;
}

export function diffRun(run: RunRecord): Candidate[] {
  const merged = new Map<string, Candidate>();
  const pair = runPair(run);
  const shared = sharedIds(run, pair);
  let n = 0;
  for (const step of run.steps) {
    for (const raw of compareStep(step, shared, pair)) {
      const existing = merged.get(raw.signature);
      if (existing) {
        existing.steps.push(raw.step);
        continue;
      }
      merged.set(raw.signature, { id: `c${++n}`, stepIndex: raw.step, steps: [raw.step], kind: raw.kind, signature: raw.signature, summary: raw.summary, detail: raw.detail, pointers: raw.pointers });
    }
  }
  return [...merged.values()];
}
