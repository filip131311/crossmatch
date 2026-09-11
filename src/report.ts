/** Writes crossmatch-out/report/index.html: every confirmed difference with its side-by-side video. */
import fs from "node:fs";
import path from "node:path";
import type { LoadedConfig } from "./config.js";
import { outDir } from "./config.js";
import { readCoverage } from "./coverage.js";
import { diffRun } from "./diff.js";
import { KEY_SEP, verdictKey } from "./judge.js";
import { logoBadgeSvg } from "./logo.js";
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
  items.sort((x, y) => ORDER.indexOf(x.verdict.severity) - ORDER.indexOf(y.verdict.severity));
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
  const real = items.filter((i) => i.verdict.severity !== "ignore");
  const ignored = items.filter((i) => i.verdict.severity === "ignore");
  const cov = readCoverage(loaded);
  const brand = loaded.config.brand;
  const counts = ORDER.map((s) => [s, real.filter((i) => i.verdict.severity === s).length] as const).filter(([, n]) => n > 0);
  const sevLabel: Record<string, string> = { high: "High", medium: "Medium", low: "Low", ignore: "Ignored" };
  const card = (it: Item, i: number) => {
    const v = it.verdict;
    const video = v.video ? `<video controls preload="metadata" src="../runs/${esc(it.run)}/${esc(v.video)}"></video>` : `<p class="muted">No video rendered for this difference.</p>`;
    return `<section class="diff" id="d${i + 1}">
  <p class="eyebrow"><span class="sev ${v.severity}">${sevLabel[v.severity] ?? v.severity}</span><span class="sep">·</span><span>${esc(v.category.replace("-", " "))}</span>${v.judge === "rules" ? `<span class="sep">·</span><span class="review">needs review</span>` : ""}<span class="sep">·</span><span class="flow">${esc(it.flow.title ?? it.flow.name)}</span></p>
  <h2>${esc(v.title)}</h2>
  <p class="desc">${esc(v.description)}</p>
  ${video}
  <p class="notes">${it.alsoIn.length ? `Also seen in ${it.alsoIn.map((o) => esc(o.flow.title ?? o.flow.name)).join(", ")}. ` : ""}<details><summary>Steps shown</summary><ol start="${parseInt(it.steps[0]) || 1}">${it.steps.map((s) => `<li>${esc(s.replace(/^\d+\.\s*/, ""))}</li>`).join("")}</ol><span class="muted">Judged by ${v.judge} · <code>${esc(path.basename(it.flow.path))}</code></span></details></p>
</section>`;
  };
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CrossMatch report</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500&family=Nunito:wght@800&family=Nunito+Sans:wght@400;600&display=swap">
<style>
:root{
  --accent:${brand.accent};
  --ink:${brand.ink};--ink-2:#4B4668;--muted:#8A86A3;--rule:#E6E3F0;
  --ground:#FAFAFD;
  --high:#C2334A;--medium:#9A6300;--low:#2A62B8;--ignore:#8A86A3;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--ink:#F1EEFA;--ink-2:#C9C3E4;--muted:#8F89AE;--rule:#2A2745;--ground:#131226;--high:#FF8A9A;--medium:#F0BE5E;--low:#7FB4FF;--ignore:#8F89AE}}
:root[data-theme="dark"]{--ink:#F1EEFA;--ink-2:#C9C3E4;--muted:#8F89AE;--rule:#2A2745;--ground:#131226;--high:#FF8A9A;--medium:#F0BE5E;--low:#7FB4FF;--ignore:#8F89AE}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font:17px/1.6 "Nunito Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.page{max-width:920px;margin:0 auto;padding:56px 32px 80px}
.top{display:flex;align-items:center;gap:14px;margin-bottom:72px}
.top svg{height:44px;width:auto;display:block}
.top .word{font-family:"Nunito","Arial Rounded MT Bold",Arial,sans-serif;font-weight:800;font-size:24px;letter-spacing:-.2px;color:var(--ink)}
.top .word i{font-style:normal;color:var(--accent)}
.diff{padding:0 0 64px;margin:0 0 64px;border-bottom:1px solid var(--rule)}
.diff:last-of-type{border-bottom:0;margin-bottom:0}
.eyebrow{margin:0 0 14px;font-size:12.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600}
.eyebrow .sep{margin:0 .6em;opacity:.6}
.sev.high{color:var(--high)}.sev.medium{color:var(--medium)}.sev.low{color:var(--low)}.sev.ignore{color:var(--ignore)}
.review{color:var(--medium)}
h2{font-family:"Newsreader",Georgia,"Times New Roman",serif;font-weight:500;font-size:38px;line-height:1.15;letter-spacing:-.01em;margin:0 0 16px;text-wrap:balance;max-width:22em}
.desc{margin:0 0 28px;color:var(--ink-2);max-width:62ch;font-size:18px}
video{width:100%;max-height:80vh;display:block;background:var(--ground);border-radius:6px}
.notes{margin:18px 0 0;font-size:14px;color:var(--muted)}
details{display:inline}summary{cursor:pointer;display:inline;color:var(--accent);font-weight:600}details ol{margin:10px 0 6px;padding-left:22px;color:var(--ink-2)}
.muted{color:var(--muted)}code{font-size:12.5px;color:var(--ink-2)}
footer{max-width:920px;margin:0 auto;padding:0 32px 48px;color:var(--muted);font-size:13px}
@media (max-width:600px){.page{padding:36px 20px 56px}.top{margin-bottom:44px}h2{font-size:29px}.diff{padding-bottom:44px;margin-bottom:44px}.desc{font-size:17px}}
</style></head><body>
<div class="page">
<header class="top">${logoBadgeSvg(brand, 44, "hdr")}<span class="word">Cross<i>Match</i></span></header>
${real.length ? real.map(card).join("\n") : `<section class="diff"><h2>No differences confirmed</h2><p class="desc">${runs.length ? "Every candidate was judged to be a platform idiom or noise." : "Run <code>crossmatch compare</code> first."}</p></section>`}
</div>
<footer>${ignored.length} candidate${ignored.length === 1 ? "" : "s"} filtered as platform idiom or noise (report.json) · recorded in lockstep with Argent · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</footer>
</body></html>`;
  const file = path.join(dir, "index.html");
  fs.writeFileSync(file, html);
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), differences: real.map((i) => ({ flow: i.run, ...i.verdict })), ignored: ignored.map((i) => ({ flow: i.run, ...i.verdict })), coverage: cov }, null, 2));
  log(`Report: ${file} (${real.length} difference(s), ${ignored.length} filtered)`);
  return file;
}
