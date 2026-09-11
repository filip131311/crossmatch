/**
 * Parse the text rendering that Argent's `describe` tool returns and normalise it across platforms.
 *
 * Line format (both platforms):
 *   <indent><Role> ["label"] [value="…"] [id="…"] [[flag, flag]]  (x, y, w, h)
 */
import type { Frame, Role, Selector, UiNode, UiTree } from "./types.js";

const LINE_RE = /^(\s*)(\S+)(.*?)\s*\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\)\s*$/;

function unquote(s: string): string {
  return s.replace(/\\"/g, '"');
}

export function parseDescribe(raw: string): UiTree {
  const lines = raw.split("\n");
  let source = "unknown";
  const nodes: UiNode[] = [];
  for (const line of lines) {
    const src = /^Source:\s*(\S+)/.exec(line);
    if (src) {
      source = src[1];
      continue;
    }
    if (line.startsWith("ROOT")) continue;
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const [, indent, rawRole, rest, x, y, w, h] = m;
    const frame: Frame = { x: +x, y: +y, width: +w, height: +h };
    let label: string | undefined;
    let value: string | undefined;
    let id: string | undefined;
    const flags: string[] = [];
    let body = rest.trim();
    // leading quoted label
    const lab = /^"((?:[^"\\]|\\.)*)"/.exec(body);
    if (lab) {
      label = unquote(lab[1]);
      body = body.slice(lab[0].length).trim();
    }
    for (const attr of body.matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) {
      if (attr[1] === "value") value = unquote(attr[2]);
      else if (attr[1] === "id") id = unquote(attr[2]);
    }
    const fl = /\[([^\]]+)\]/.exec(body);
    if (fl) flags.push(...fl[1].split(",").map((s) => s.trim()).filter(Boolean));
    const depth = Math.max(0, Math.floor(indent.length / 2) - 1);
    nodes.push({
      role: normaliseRole(rawRole, flags),
      rawRole,
      label,
      value,
      id: id ? shortId(id) : undefined,
      text: (label ?? value ?? "").trim(),
      frame,
      flags,
      depth,
    });
  }
  return { source, nodes, raw };
}

export function shortId(id: string): string {
  const i = id.indexOf(":id/");
  return i >= 0 ? id.slice(i + 4) : id;
}

const ROLE_MAP: Array<[RegExp, Role]> = [
  [/^AXButton$|^Button$|ImageButton|^AXLink$|^Link$/i, "button"],
  [/^AXStaticText$|^StaticText$|^TextView$|^Text$/i, "text"],
  [/^AXTextField$|^TextField$|EditText|SearchField|^AXSearchField$|^AXSecureTextField$/i, "textfield"],
  [/^AXImage$|^Image$|ImageView/i, "image"],
  [/^AXSwitch$|^Switch$|Toggle/i, "switch"],
  [/CheckBox|Checkbox|RadioButton/i, "checkbox"],
  [/^AXAdjustable$|Slider|SeekBar|Stepper/i, "slider"],
  [/^AXTabBar$|^AXTab$|^Tab$|TabBar|NavigationBar|BottomNavigation/i, "tab"],
  [/^AXHeading$|Heading|Header/i, "heading"],
  [/List|RecyclerView|ScrollView|AXTable|AXCollection|Grid/i, "list"],
  [/Cell|Row|ListItem/i, "cell"],
  [/Alert|Dialog|Sheet/i, "alert"],
  [/Group|Layout|Screen|View|Container|Column|Frame|Compose|Window/i, "container"],
];

export function normaliseRole(raw: string, flags: string[]): Role {
  // Compose exposes buttons as clickable generic Views; treat a clickable container as a button
  if (flags.includes("clickable") && /View$|Layout|Group|Compose|^View$/i.test(raw) && !/Scroll|List|Recycler/i.test(raw)) return "button";
  for (const [re, role] of ROLE_MAP) if (re.test(raw)) return role;
  if (flags.includes("clickable")) return "button";
  return "other";
}

/** Elements that carry meaning for a functional comparison: text-bearing or interactive. */
export function meaningfulNodes(tree: UiTree): UiNode[] {
  return tree.nodes.filter((n) => {
    if (n.frame.width <= 0 || n.frame.height <= 0) return false;
    if (n.text.length > 0) return true;
    if (n.id) return true;
    return ["button", "textfield", "switch", "checkbox", "slider"].includes(n.role);
  });
}

export function selectorMatches(node: UiNode, sel: Selector): boolean {
  if (sel.id !== undefined && (node.id ?? "").toLowerCase() !== sel.id.toLowerCase()) return false;
  if (sel.matches !== undefined && !new RegExp(sel.matches, "i").test(node.text)) return false;
  if (sel.text !== undefined && !node.text.toLowerCase().includes(sel.text.toLowerCase())) return false;
  if (sel.role !== undefined) {
    const r = sel.role.toLowerCase();
    if (!node.rawRole.toLowerCase().includes(r) && node.role !== r) return false;
  }
  return true;
}

/**
 * Pick the element a flow action should hit: exact text/id match first, then the smallest visible
 * frame, then reading order. Mirrors Argent's flow runner rule.
 */
export function resolveSelector(tree: UiTree, sel: Selector): UiNode | undefined {
  const visible = tree.nodes.filter((n) => n.frame.width > 0 && n.frame.height > 0 && selectorMatches(n, sel));
  if (visible.length === 0) return undefined;
  const exact = visible.filter((n) => {
    if (sel.id && (n.id ?? "").toLowerCase() === sel.id.toLowerCase()) return true;
    if (sel.text && n.text.toLowerCase() === sel.text.toLowerCase()) return true;
    return false;
  });
  const pool = exact.length ? exact : visible;
  // Prefer interactive elements over plain text when both match (a button whose label equals the text).
  const interactive = pool.filter((n) => n.role !== "text" && n.role !== "container" && n.role !== "other");
  const pool2 = interactive.length ? interactive : pool;
  pool2.sort((a, b) => {
    const area = a.frame.width * a.frame.height - b.frame.width * b.frame.height;
    if (Math.abs(area) > 1e-6) return area;
    if (a.frame.y !== b.frame.y) return a.frame.y - b.frame.y;
    return a.frame.x - b.frame.x;
  });
  return pool2[0];
}

export function centre(frame: Frame): { x: number; y: number } {
  return { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
}

export function describeSelector(sel: Selector): string {
  const parts: string[] = [];
  if (sel.id) parts.push(`id=${sel.id}`);
  if (sel.text) parts.push(`text="${sel.text}"`);
  if (sel.matches) parts.push(`matches=/${sel.matches}/`);
  if (sel.role) parts.push(`role=${sel.role}`);
  return parts.join(" ");
}

/** Compact one-line-per-element rendering for agents (normalised roles, short ids). */
export function renderTree(tree: UiTree): string {
  return tree.nodes
    .map((n) => {
      const bits = [n.role.padEnd(9), n.text ? JSON.stringify(n.text) : ""];
      if (n.id) bits.push(`#${n.id}`);
      if (n.flags.length) bits.push(`[${n.flags.join(",")}]`);
      const c = centre(n.frame);
      bits.push(`@(${c.x.toFixed(3)}, ${c.y.toFixed(3)})`);
      return "  ".repeat(n.depth) + bits.filter(Boolean).join(" ");
    })
    .join("\n");
}
