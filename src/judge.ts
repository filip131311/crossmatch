/**
 * The judge turns mechanical candidates into verdicts. Rule-based verdicts are always computed; when
 * the Claude Code CLI is available the candidates, screenshots and rubric are handed to a headless
 * `claude -p` session which returns the final verdicts (it may merge, reclassify or dismiss).
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import type { LoadedConfig } from "./config.js";
import { runDirFor } from "./lockstep.js";
import { CATEGORIES, SEVERITIES, TAXONOMY } from "./taxonomy.js";
import { meaningfulNodes } from "./describe.js";
import type { Candidate, Category, Pointer, RunOutput, Severity, UiTree, Verdict } from "./types.js";

export interface JudgeOptions { rulesOnly?: boolean; model?: string }

/** Separator between signatures inside a verdict key (signatures themselves contain commas and pipes). */
export const KEY_SEP = "\u001f";

/** Identity of a difference independent of the flow it was found in: category + the elements it points at. */
export function verdictKey(category: Category, cands: Candidate[]): string {
  const sigs = cands.map((c) => c.signature);
  return `${category}|${[...new Set(sigs)].sort().join(KEY_SEP)}`;
}

export function rulesVerdicts(candidates: Candidate[]): Verdict[] {
  return candidates.map((c) => {
    let category: Category = "content";
    let severity: Severity = "low";
    if (c.kind === "outcome") [category, severity] = ["behaviour", "high"];
    else if (c.kind === "elements") [category, severity] = ["missing-feature", "medium"];
    else if (c.kind === "flags") [category, severity] = ["validation", "medium"];
    else if (c.summary.startsWith("#")) [category, severity] = ["content", "medium"];
    const last = c.steps[c.steps.length - 1];
    return { candidateIds: [c.id], category, severity, title: c.summary, description: c.detail, stepRange: [Math.max(0, c.stepIndex - 1), last], pointers: c.pointers, judge: "rules", key: verdictKey(category, [c]) };
  });
}

export function claudeAvailable(): boolean {
  return spawnSync("claude", ["--version"], { encoding: "utf8" }).status === 0;
}

/**
 * Import verdicts written by a human or an agent, in the on-disk format: `stepRange` and pointer
 * `stepIndex` are 0-based (as in verdicts.json); a pointer may use `step` (1-based) instead.
 */
export function importVerdicts(items: unknown, output: RunOutput): Verdict[] {
  if (!Array.isArray(items)) throw new Error("verdicts file must contain a JSON array");
  const n = output.run.steps.length;
  const normalised = items.map((it) => {
    if (!it || typeof it !== "object") return it;
    const v = { ...(it as Record<string, any>) };
    if (Array.isArray(v.stepRange) && v.stepRange.length === 2) {
      const [a, b] = v.stepRange.map(Number);
      v.stepRange = [a + 1, b + 1]; // sanitise() expects the judge prompt's 1-based form
    }
    if (Array.isArray(v.pointers)) v.pointers = v.pointers.map((p: any) => (p && typeof p === "object" && p.step === undefined && Number.isFinite(+p.stepIndex) ? { ...p, step: +p.stepIndex + 1 } : p));
    return v;
  });
  const verdicts = sanitise(normalised, output);
  for (const v of verdicts) v.judge = "human";
  const covered = new Set(verdicts.flatMap((v) => v.candidateIds));
  for (const r of rulesVerdicts(output.candidates)) if (!covered.has(r.candidateIds[0])) verdicts.push(r);
  return verdicts;
}

export async function judgeRun(loaded: LoadedConfig, output: RunOutput, log: (s: string) => void, opts: JudgeOptions = {}): Promise<Verdict[]> {
  const rules = rulesVerdicts(output.candidates);
  if (opts.rulesOnly || !claudeAvailable()) {
    if (!opts.rulesOnly) log("claude CLI not found: using rule-based verdicts (every candidate is reported; review verdicts.json by hand)");
    return rules;
  }
  const brief = buildBrief(loaded, output);
  log(`Judging ${output.candidates.length} candidate(s) with claude…`);
  const raw = await runClaude(brief, opts.model);
  const parsed = extractJson(raw);
  if (!Array.isArray(parsed)) {
    log("Judge returned no JSON array; falling back to rule-based verdicts");
    return rules;
  }
  const verdicts = sanitise(parsed, output);
  // every candidate must be covered; uncovered ones keep their rule verdict
  const covered = new Set(verdicts.flatMap((v) => v.candidateIds));
  for (const r of rules) if (!covered.has(r.candidateIds[0])) verdicts.push(r);
  return verdicts;
}

function buildBrief(loaded: LoadedConfig, output: RunOutput): string {
  const { run, candidates } = output;
  const runDir = runDirFor(loaded, run.flow.name);
  const steps = run.steps
    .map((s) => `${String(s.index + 1).padStart(2)}. ${s.label}  [ios: ${s.ios.status}${s.ios.reason ? ` – ${s.ios.reason}` : ""}${s.ios.captureError ? " – NOT COMPARED (capture failed)" : ""}; android: ${s.android.status}${s.android.reason ? ` – ${s.android.reason}` : ""}${s.android.captureError ? " – NOT COMPARED (capture failed)" : ""}]`)
    .join("\n");
  const shotSteps = new Set<number>();
  const cands = candidates
    .map((c) => {
      for (const i of c.steps.slice(0, 2)) shotSteps.add(i);
      return `- ${c.id} [${c.kind}] steps ${c.steps.map((i) => i + 1).join(",")}: ${c.summary}\n   ${c.detail}`;
    })
    .join("\n");
  const excerpt = (tree: UiTree | undefined) =>
    tree
      ? meaningfulNodes(tree)
          .slice(0, 30)
          .map((n) => `${n.role} ${n.text ? JSON.stringify(n.text) : ""}${n.id ? ` #${n.id}` : ""}${n.flags.length ? ` [${n.flags.join(",")}]` : ""}`)
          .join("; ")
      : "(no tree)";
  const evidence = [...shotSteps]
    .sort((a, b) => a - b)
    .map((i) => {
      const st = run.steps[i];
      return `step ${i + 1} (${st.label})\n  ios screenshot: ${st.ios.screenshot ? path.join(runDir, st.ios.screenshot) : "(none)"}\n  ios tree: ${excerpt(st.ios.tree)}\n  android screenshot: ${st.android.screenshot ? path.join(runDir, st.android.screenshot) : "(none)"}\n  android tree: ${excerpt(st.android.tree)}`;
    })
    .join("\n");
  const extra = loaded.config.judgeRules.length ? `\n## Project-specific rules\n${loaded.config.judgeRules.map((r) => `- ${r}`).join("\n")}\n` : "";
  return `You are the judge in "crossmatch", a tool that compares an iOS app with its Android twin. A flow was
replayed on both devices in lockstep; after every step both accessibility trees were compared. The
mechanical comparison produced the candidate differences below. Decide which are real, user-relevant
differences between the two apps and which are platform idioms or noise. Look at the screenshots
(use the Read tool on the paths) whenever the text alone is ambiguous — the screenshots are the
ground truth, the trees are approximations.

## Flow: ${run.flow.title ?? run.flow.name}
${run.flow.description ?? ""}

## Steps (1-based)
${steps}

## Candidates
${cands}

## Evidence per step (trees are abbreviated; read the screenshots when in doubt)
${evidence}

${TAXONOMY}
${extra}
## Output

Reply with ONLY a JSON array (no prose, no code fence). One object per real difference; group the
candidates that share a root cause into one object, and give every candidate id that is noise or a
platform idiom its own object with severity "ignore" (so every candidate id appears exactly once).
Schema:
[
  {
    "candidateIds": ["c1", "c4"],
    "category": ${JSON.stringify(CATEGORIES)}[i],
    "severity": ${JSON.stringify(SEVERITIES)}[i],
    "title": "short headline a developer would file as a bug title (mention which side is which)",
    "description": "2-4 sentences: what each side does, why it matters, consequences seen in later steps",
    "stepRange": [firstStep1Based, lastStep1Based],   // the steps the side-by-side video should cover; include the step before the difference appears
    "pointers": [                                       // where to point in the video; one per side when both sides show something
      { "side": "ios" | "android", "step": step1Based, "element": { "id": "like-button" } | { "text": "It's a match!" }, "label": "<= 6 words shown next to the pointer" }
    ]
  }
]
Use element ids or exact visible text that appear in the candidates. Keep labels short and factual.`;
}

function runClaude(prompt: string, model?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "json", "--allowedTools", "Read", "--max-turns", "40"];
    if (model) args.push("--model", model);
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CLAUDE_CODE_CHILD_SESSION: "1" }, shell: process.platform === "win32" });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && !out) return reject(new Error(`claude exited with ${code}: ${err.slice(0, 500)}`));
      try {
        const j = JSON.parse(out);
        resolve(typeof j.result === "string" ? j.result : out);
      } catch {
        resolve(out);
      }
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15 * 60_000);
    child.on("close", () => clearTimeout(timer));
    child.stdin.end(prompt);
  });
}

export function extractJson(text: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fence ? fence[1] : text;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start < 0 || end < start) return undefined;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function sanitise(items: unknown[], output: RunOutput): Verdict[] {
  const ids = new Set(output.candidates.map((c) => c.id));
  const byId = new Map(output.candidates.map((c) => [c.id, c]));
  const n = output.run.steps.length;
  const out: Verdict[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const v = it as Record<string, any>;
    const candidateIds = (Array.isArray(v.candidateIds) ? v.candidateIds : []).filter((id: unknown) => typeof id === "string" && ids.has(id) && !seen.has(id));
    if (!candidateIds.length) continue;
    for (const id of candidateIds) seen.add(id);
    // an unrecognised category or severity must not turn into a reported difference
    const catRaw = String(v.category ?? "").toLowerCase().replace(/[\s_]+/g, "-");
    const category: Category = CATEGORIES.includes(catRaw as Category) ? (catRaw as Category) : "noise";
    const sevRaw = String(v.severity ?? "").toLowerCase().trim();
    // a real category with an unrecognised severity stays a difference; only the category can dismiss it
    let severity: Severity = SEVERITIES.includes(sevRaw as Severity) ? (sevRaw as Severity) : category === "noise" ? "ignore" : "medium";
    if (category === "noise" || category === "platform-idiom") severity = "ignore";
    const cands = candidateIds.map((id: string) => byId.get(id)!);
    const allSteps = cands.flatMap((c) => c.steps);
    let range: [number, number] = [Math.max(0, Math.min(...allSteps) - 1), Math.max(...allSteps)];
    const lastRan = Math.max(0, ...output.run.steps.filter((st) => st.ios.endMs > 0 || st.android.endMs > 0).map((st) => st.index));
    if (Array.isArray(v.stepRange) && v.stepRange.length === 2 && Number.isFinite(+v.stepRange[0]) && Number.isFinite(+v.stepRange[1])) {
      const a = Math.min(lastRan, Math.max(0, Math.round(+v.stepRange[0]) - 1));
      const b = Math.min(lastRan, Math.max(a, Math.round(+v.stepRange[1]) - 1));
      range = [a, b];
    } else range = [Math.min(range[0], lastRan), Math.min(range[1], lastRan)];
    const pointers: Pointer[] = [];
    if (Array.isArray(v.pointers)) {
      for (const p of v.pointers) {
        if (!p || typeof p !== "object") continue;
        const side = p.side === "ios" || p.side === "android" ? p.side : undefined;
        const step = Number.isFinite(+p.step) ? Math.min(n - 1, Math.max(0, Math.round(+p.step) - 1)) : undefined;
        if (!side || step === undefined) continue;
        const element = p.element && typeof p.element === "object" ? (typeof p.element.id === "string" ? { id: p.element.id } : typeof p.element.text === "string" ? { text: p.element.text } : undefined) : undefined;
        if (!element) continue;
        pointers.push({ side, stepIndex: step, element, label: String(p.label ?? "").slice(0, 60) || cands[0].summary.slice(0, 60) });
      }
    }
    if (!pointers.length) pointers.push(...cands[0].pointers);
    out.push({
      candidateIds,
      category,
      severity,
      title: String(v.title ?? cands[0].summary).slice(0, 140),
      description: String(v.description ?? cands[0].detail),
      stepRange: range,
      pointers,
      judge: "llm",
      key: verdictKey(category, cands),
    });
  }
  return out;
}
