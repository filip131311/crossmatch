/** Writes natively-out/report/index.html: every confirmed difference with its side-by-side video. */
import fs from "node:fs";
import path from "node:path";
import type { LoadedConfig } from "./config.js";
import { outDir } from "./config.js";
import { readCoverage } from "./coverage.js";
import { diffRun } from "./diff.js";
import { KEY_SEP, verdictKey } from "./judge.js";
import { TAXONOMY } from "./taxonomy.js";
import type { RunOutput, Severity, Verdict } from "./types.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const ORDER: Severity[] = ["high", "medium", "low", "ignore"];

interface Item { flow: RunOutput["run"]["flow"]; run: string; verdict: Verdict; steps: string[]; alsoIn: Item[] }

export function collectRuns(loaded: LoadedConfig): RunOutput[] {
  const dir = path.join(outDir(loaded), "runs");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((n) => path.join(dir, n, "output.json"))
    .filter((f) => fs.existsSync(f))
    .map((f) => JSON.parse(fs.readFileSync(f, "utf8")) as RunOutput);
}

export function writeReport(loaded: LoadedConfig, log: (s: string) => void): string {
  const runs = collectRuns(loaded);
  const dir = path.join(outDir(loaded), "report");
  fs.mkdirSync(dir, { recursive: true });
  const items: Item[] = [];
  for (const r of runs) {
    // Keys are recomputed so grouping stays consistent when the diff evolves. Stored candidates keep
    // the ids the judge used; a candidate saved without a signature gets it from a fresh diff by summary.
    const fresh = diffRun(r.run);
    const cands = new Map(
      r.candidates.map((c) => [c.id, { ...c, signature: c.signature ?? fresh.find((f) => f.summary === c.summary)?.signature ?? `summary:${c.summary}` }]),
    );
    for (const v of r.verdicts ?? []) {
      const own = v.candidateIds.map((id) => cands.get(id)).filter((c): c is NonNullable<typeof c> => !!c);
      if (own.length) v.key = verdictKey(v.category, own);
      const [a, b] = v.stepRange;
      items.push({ flow: r.run.flow, run: r.run.flow.name, verdict: v, steps: r.run.steps.slice(a, b + 1).map((s) => `${s.index + 1}. ${s.label}`), alsoIn: [] });
    }
  }
  // The same difference found by several flows is reported once (highest severity first), with the
  // other flows listed. Two verdicts are the same difference when they share a category and at least
  // one candidate signature (`category|sig,sig,...` keys).
  const claimed = new Map<string, Item>();
  for (const it of [...items]) {
    const k = it.verdict.key;
    if (!k || it.verdict.severity === "ignore") continue;
    const cut = k.indexOf("|");
    const category = k.slice(0, cut);
    const sigs = k.slice(cut + 1);
    const parts = sigs ? sigs.split(KEY_SEP).filter(Boolean).map((sg) => `${category}|${sg}`) : [];
    const owner = parts.map((pt) => claimed.get(pt)).find((o) => o && o !== it);
    if (owner) {
      // the primary card is the highest severity (items are sorted by severity), then the one with a video
      if (!owner.verdict.video && it.verdict.video && ORDER.indexOf(it.verdict.severity) <= ORDER.indexOf(owner.verdict.severity)) {
        items.splice(items.indexOf(it), 1);
        items.splice(items.indexOf(owner), 1, it);
        it.alsoIn.push(owner, ...owner.alsoIn);
        for (const pt of parts) claimed.set(pt, it);
        for (const [k, o] of claimed) if (o === owner) claimed.set(k, it);
      } else {
        owner.alsoIn.push(it);
        items.splice(items.indexOf(it), 1);
      }
      continue;
    }
    for (const pt of parts) if (!claimed.has(pt)) claimed.set(pt, it);
  }
  items.sort((x, y) => ORDER.indexOf(x.verdict.severity) - ORDER.indexOf(y.verdict.severity));
  const real = items.filter((i) => i.verdict.severity !== "ignore");
  const ignored = items.filter((i) => i.verdict.severity === "ignore");
  const cov = readCoverage(loaded);
  const brand = loaded.config.brand;
  const counts = ORDER.map((s) => [s, real.filter((i) => i.verdict.severity === s).length] as const).filter(([, n]) => n > 0);
  const card = (it: Item, i: number) => {
    const v = it.verdict;
    const video = v.video ? `<video controls preload="metadata" src="../runs/${esc(it.run)}/${esc(v.video)}"></video>` : `<p class="muted">No video rendered for this difference.</p>`;
    return `<article class="diff" id="d${i + 1}">
  <header><span class="sev ${v.severity}">${v.severity}</span><span class="cat">${esc(v.category.replace("-", " "))}</span>${v.judge === "rules" ? `<span class="review">needs review · rule-based, not judged</span>` : ""}<span class="flow">${esc(it.flow.title ?? it.flow.name)}</span></header>
  <h2>${i + 1}. ${esc(v.title)}</h2>
  <p>${esc(v.description)}</p>
  ${video}
  ${it.alsoIn.length ? `<p class="muted">Also seen in: ${it.alsoIn.map((o) => esc(o.flow.title ?? o.flow.name)).join(", ")}</p>` : ""}
  <details><summary>Steps shown (${it.steps.length})</summary><ol start="${parseInt(it.steps[0]) || 1}">${it.steps.map((s) => `<li>${esc(s.replace(/^\d+\.\s*/, ""))}</li>`).join("")}</ol><p class="muted">Judged by ${v.judge}. Flow file: <code>${esc(path.basename(it.flow.path))}</code></p></details>
</article>`;
  };
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(brand.name)} report</title>
<style>
:root{--accent:${brand.accent};--ink:${brand.ink};--paper:${brand.paper}}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:#f6f5fb}
header.top{background:var(--ink);color:#fff;padding:28px 32px}header.top h1{margin:0;font-size:28px}header.top .brand{display:inline-block;background:var(--accent);padding:4px 12px;border-radius:10px;font-weight:800;margin-right:12px}
main{max-width:1180px;margin:0 auto;padding:24px 32px 64px}
.summary{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0 28px}.summary div{background:#fff;border-radius:12px;padding:12px 18px;box-shadow:0 1px 3px rgba(0,0,0,.08)}.summary b{display:block;font-size:26px}
.diff{background:#fff;border-radius:16px;padding:20px 24px;margin:0 0 22px;box-shadow:0 1px 4px rgba(0,0,0,.08)}.diff header{display:flex;gap:10px;align-items:center;font-size:13px}.diff h2{margin:8px 0 6px;font-size:22px}
.sev{padding:2px 10px;border-radius:8px;color:#fff;font-weight:700;text-transform:uppercase;font-size:12px}.sev.high{background:#E5484D}.sev.medium{background:#F5A524}.sev.low{background:#3E8BFF}.sev.ignore{background:#9AA0A6}
.review{padding:2px 10px;border-radius:8px;background:#FFF3CD;color:#7A5A00;font-weight:600}
.cat{padding:2px 10px;border-radius:8px;background:color-mix(in srgb,var(--accent) 12%,#fff);color:var(--accent);font-weight:600}.flow{color:#666}
video{width:100%;max-height:70vh;border-radius:12px;background:#000;margin:10px 0}details{margin-top:8px}summary{cursor:pointer;font-weight:600}.muted{color:#777;font-size:14px}
table{border-collapse:collapse;width:100%;background:#fff;border-radius:12px;overflow:hidden}td,th{text-align:left;padding:8px 12px;border-bottom:1px solid #eee;font-size:14px}
pre.rubric{white-space:pre-wrap;background:#fff;padding:16px;border-radius:12px;font-size:13px}
</style></head><body>
<header class="top"><h1><span class="brand">${esc(brand.name)}</span>iOS vs Android differences</h1><p>${esc(path.basename(loaded.config.ios.app))} vs ${esc(path.basename(loaded.config.android.app))} · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")}</p></header>
<main>
<section class="summary"><div><b>${real.length}</b>differences</div>${counts.map(([s, n]) => `<div><b>${n}</b>${s}</div>`).join("")}<div><b>${runs.length}</b>flows compared</div><div><b>${cov.screens.length}</b>screens registered</div><div><b>${ignored.length}</b>filtered as noise</div></section>
${real.length ? real.map(card).join("\n") : `<p>No differences confirmed. ${runs.length ? "Every candidate was judged to be a platform idiom or noise." : "Run <code>natively compare</code> first."}</p>`}
<h2>Filtered as platform idiom or noise (${ignored.length})</h2>
<table><tr><th>Flow</th><th>Category</th><th>Title</th></tr>${ignored.map((i) => `<tr><td>${esc(i.flow.title ?? i.flow.name)}</td><td>${esc(i.verdict.category)}</td><td>${esc(i.verdict.title)}</td></tr>`).join("")}</table>
<h2>Coverage</h2>
<table><tr><th>Flows compared</th><td>${runs.map((r) => esc(r.run.flow.title ?? r.run.flow.name)).join("<br>") || "—"}</td></tr><tr><th>Screens registered</th><td>${cov.screens.map((s) => esc(s.name + (s.note ? ` — ${s.note}` : ""))).join("<br>") || "—"}</td></tr><tr><th>Steps run</th><td>${cov.stepsRun}</td></tr></table>
<h2>Rubric</h2><pre class="rubric">${esc(TAXONOMY)}</pre>
</main></body></html>`;
  const file = path.join(dir, "index.html");
  fs.writeFileSync(file, html);
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), differences: real.map((i) => ({ flow: i.run, ...i.verdict })), ignored: ignored.map((i) => ({ flow: i.run, ...i.verdict })), coverage: cov }, null, 2));
  log(`Report: ${file} (${real.length} difference(s), ${ignored.length} filtered)`);
  return file;
}
