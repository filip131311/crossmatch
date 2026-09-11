/**
 * Flow files use Argent's flow YAML step syntax (a subset: no relational selectors, no snapshots).
 * crossmatch adds two optional top-level keys, `title` and `description`; Argent's own runner rejects
 * unknown top-level keys, so strip them (or move them into a leading `echo:`) to replay a flow with
 * `argent flow run`.
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { Condition, Directive, Flow, FlowStep, Selector, Side } from "./types.js";

const SELECTOR_KEYS = new Set(["id", "identifier", "text", "role"]);
const UNSUPPORTED_SELECTOR_KEYS = new Set(["within", "after", "next", "any"]);

function toSelector(v: unknown, ctx: string): Selector {
  // a bare string is loose: Argent tries id first, then text
  if (typeof v === "string") return { id: v, text: v, loose: true };
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      if (UNSUPPORTED_SELECTOR_KEYS.has(k)) throw new Error(`${ctx}: relational selector "${k}:" is not supported by crossmatch; name the element by id or text`);
      if (!SELECTOR_KEYS.has(k)) throw new Error(`${ctx}: unknown selector key "${k}"`);
    }
    const sel: Selector = {};
    const id = o.id ?? o.identifier;
    if (typeof id === "string") sel.id = id;
    if (typeof o.text === "string") sel.text = o.text;
    else if (o.text && typeof o.text === "object" && typeof (o.text as any).matches === "string") sel.matches = (o.text as any).matches;
    if (typeof o.role === "string") sel.role = o.role;
    if (!sel.id && !sel.text && !sel.matches && !sel.role) throw new Error(`${ctx}: selector needs id, text or role`);
    return sel;
  }
  throw new Error(`${ctx}: invalid selector ${JSON.stringify(v)}`);
}

function toCondition(o: Record<string, unknown>, ctx: string): Condition {
  if (o.idle) return { type: "idle" };
  if (o.visible !== undefined) return { type: "visible", selector: toSelector(o.visible, ctx) };
  if (o.exists !== undefined) return { type: "exists", selector: toSelector(o.exists, ctx) };
  if (o.hidden !== undefined) return { type: "hidden", selector: toSelector(o.hidden, ctx) };
  if (o.text !== undefined) {
    const t = o.text as Record<string, unknown>;
    const sel = toSelector(t.in ?? t.of ?? t.selector, `${ctx} text condition`);
    const match: "contains" | "equals" | "matches" = t.equals !== undefined ? "equals" : t.matches !== undefined ? "matches" : "contains";
    const expected = t.equals ?? t.matches ?? t.contains;
    if (typeof expected !== "string") throw new Error(`${ctx}: text condition needs { in: <selector>, equals|contains|matches: <string> }`);
    return { type: "text", selector: sel, expected, match };
  }
  throw new Error(`${ctx}: unknown condition ${JSON.stringify(o)}`);
}

export function parseDirective(raw: unknown, ctx: string): Directive {
  if (!raw || typeof raw !== "object") throw new Error(`${ctx}: step must be a map`);
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => k !== "steps" && k !== "args");
  if (keys.length !== 1) throw new Error(`${ctx}: step must have exactly one directive, got ${keys.join(", ")}`);
  const key = keys[0];
  const v = o[key];
  const obj = (what: string): Record<string, unknown> => {
    if (!v || typeof v !== "object") throw new Error(`${ctx}: ${what} needs a map, got ${JSON.stringify(v)}`);
    return v as Record<string, unknown>;
  };
  switch (key) {
    case "launch": {
      if (typeof v === "string") return { kind: "launch", bundleId: v };
      if (v && typeof v === "object") {
        const m = v as Record<string, unknown>;
        const perPlatform: Partial<Record<Side, string>> = {};
        if (typeof m.ios === "string") perPlatform.ios = m.ios;
        if (typeof m.android === "string") perPlatform.android = m.android;
        if (typeof m.native === "string") perPlatform.ios = perPlatform.android = m.native;
        return { kind: "launch", perPlatform };
      }
      return { kind: "launch" };
    }
    case "tap": {
      if (v && typeof v === "object" && "x" in (v as object) && "y" in (v as object)) {
        const t = v as any;
        return { kind: "tap", x: +t.x, y: +t.y, times: t.times };
      }
      if (v && typeof v === "object" && "on" in (v as object)) {
        const t = v as any;
        return { kind: "tap", selector: toSelector(t.on, ctx), times: t.times };
      }
      return { kind: "tap", selector: toSelector(v, ctx) };
    }
    case "long-press": {
      if (v && typeof v === "object" && "on" in (v as object)) {
        const t = v as any;
        return { kind: "long-press", selector: toSelector(t.on, ctx), duration: t.duration };
      }
      return { kind: "long-press", selector: toSelector(v, ctx) };
    }
    case "swipe": {
      const DIRS = ["up", "down", "left", "right"];
      if (typeof v === "string") {
        if (!DIRS.includes(v)) throw new Error(`${ctx}: swipe direction must be up|down|left|right`);
        return { kind: "swipe", direction: v as any };
      }
      const s = obj("swipe:");
      for (const k of Object.keys(s)) if (!["direction", "from", "duration"].includes(k)) throw new Error(`${ctx}: swipe "${k}:" is not supported by crossmatch (use direction, from, duration)`);
      if (!DIRS.includes(String(s.direction))) throw new Error(`${ctx}: swipe needs direction up|down|left|right`);
      return { kind: "swipe", direction: s.direction as any, from: s.from ? toSelector(s.from, ctx) : undefined, duration: typeof s.duration === "number" ? s.duration : undefined };
    }
    case "type": {
      const t = obj("type:") as any;
      if (t.text === undefined) throw new Error(`${ctx}: type: needs text`);
      return { kind: "type", into: toSelector(t.into, ctx), text: String(t.text), submit: t.submit };
    }
    case "scroll-to": {
      const t = obj("scroll-to:") as any;
      return { kind: "scroll-to", target: toSelector(t.target ?? t, ctx), direction: t.direction, maxSwipes: t.maxSwipes };
    }
    case "await": {
      const a = obj("await:");
      return { kind: "await", condition: toCondition(a, ctx), timeout: typeof a.timeout === "number" ? a.timeout : undefined };
    }
    case "assert":
      return { kind: "assert", condition: toCondition(obj("assert:"), ctx) };
    case "wait":
      return { kind: "wait", ms: Number(v) };
    case "echo":
      return { kind: "echo", message: String(v) };
    case "button":
      return { kind: "button", button: String(v) };
    case "when": {
      const w = v as any;
      const platform = (w.platform ?? w) as Side;
      if (platform !== "ios" && platform !== "android") throw new Error(`${ctx}: when: needs platform ios|android`);
      const steps = parseSteps(o.steps ?? w.steps, ctx);
      return { kind: "when", platform, steps };
    }
    case "tool": {
      return { kind: "tool", tool: String(v), args: (o.args as Record<string, unknown>) ?? {} };
    }
    default:
      throw new Error(`${ctx}: unknown directive "${key}"`);
  }
}

function parseSteps(raw: unknown, ctx: string): FlowStep[] {
  if (!Array.isArray(raw)) throw new Error(`${ctx}: steps must be a list`);
  return raw.map((r, i) => ({ index: i, directive: parseDirective(r, `${ctx} step ${i + 1}`), raw: r }));
}

export function parseFlow(file: string): Flow {
  const text = fs.readFileSync(file, "utf8");
  const doc = YAML.parse(text) as Record<string, unknown>;
  if (!doc || typeof doc !== "object") throw new Error(`${file}: empty flow`);
  const name = path.basename(file).replace(/\.ya?ml$/, "");
  return {
    name,
    path: file,
    title: typeof doc.title === "string" ? doc.title : undefined,
    description: typeof doc.description === "string" ? doc.description : undefined,
    steps: parseSteps(doc.steps, name),
  };
}

export function listFlows(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

export function stepLabel(d: Directive): string {
  switch (d.kind) {
    case "launch":
      return `launch ${d.bundleId ?? (d.perPlatform ? Object.values(d.perPlatform).join(" / ") : "app")}`;
    case "tap":
      return d.selector ? `tap ${sel(d.selector)}` : `tap (${d.x}, ${d.y})`;
    case "long-press":
      return `long-press ${sel(d.selector)}`;
    case "swipe":
      return `swipe ${d.direction}${d.from ? ` from ${sel(d.from)}` : ""}`;
    case "type":
      return `type "${d.text}" into ${sel(d.into)}`;
    case "scroll-to":
      return `scroll to ${sel(d.target)}`;
    case "await":
      return `await ${cond(d.condition)}`;
    case "assert":
      return `assert ${cond(d.condition)}`;
    case "wait":
      return `wait ${d.ms}ms`;
    case "echo":
      return d.message;
    case "button":
      return `press ${d.button}`;
    case "when":
      return `only on ${d.platform}: ${d.steps.length} step(s)`;
    case "tool":
      return `tool ${d.tool}`;
  }
}

function sel(s: Selector): string {
  if (s.loose) return `"${s.text}"`;
  if (s.id) return `#${s.id}`;
  if (s.text) return `"${s.text}"`;
  if (s.matches) return `/${s.matches}/`;
  return `role:${s.role}`;
}

function cond(c: Condition): string {
  switch (c.type) {
    case "idle":
      return "idle";
    case "text":
      return `${sel(c.selector)} text ${c.match} "${c.expected}"`;
    default:
      return `${c.type} ${sel(c.selector)}`;
  }
}
