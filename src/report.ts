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
    const video = v.video ? `<div class="player"><video controls preload="metadata" src="../runs/${esc(it.run)}/${esc(v.video)}"></video></div>` : `<p class="muted">No video rendered for this difference.</p>`;
    return `<article class="diff" id="d${i + 1}">
  <div class="meta"><span class="pill sev ${v.severity}">${sevLabel[v.severity] ?? v.severity}</span><span class="pill cat">${esc(v.category.replace("-", " "))}</span>${v.judge === "rules" ? `<span class="pill review">needs review</span>` : ""}<span class="flow">${esc(it.flow.title ?? it.flow.name)}</span></div>
  <h2><span class="num">${i + 1}</span>${esc(v.title)}</h2>
  <p class="desc">${esc(v.description)}</p>
  ${video}
  ${it.alsoIn.length ? `<p class="also">Also seen in ${it.alsoIn.map((o) => `<span>${esc(o.flow.title ?? o.flow.name)}</span>`).join("")}</p>` : ""}
  <details><summary>Steps shown (${it.steps.length})</summary><ol start="${parseInt(it.steps[0]) || 1}">${it.steps.map((s) => `<li>${esc(s.replace(/^\d+\.\s*/, ""))}</li>`).join("")}</ol><p class="muted">Judged by ${v.judge}. Flow file <code>${esc(path.basename(it.flow.path))}</code>.</p></details>
</article>`;
  };
  const apps = `${esc(path.basename(loaded.config.ios.app))} vs ${esc(path.basename(loaded.config.android.app))}`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CrossMatch report</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800;900&family=Nunito+Sans:wght@400;600;700&display=swap">
<style>
:root{
  --accent:${brand.accent};--accent-2:#9B7BFF;--ios:#5AA9FF;--ios-2:#2F7BE8;--android:#4DE1B0;--android-2:#19B984;
  --spark:#FFD166;--pink:#FF6FA5;--red:#FF5C7A;
  --ink:${brand.ink};--ink-2:#4B4668;--muted:#7F7A9C;
  --ground:#F4F1FF;--ground-2:#EEE9FF;--card:#FFFFFF;--line:#E6E0FA;--shadow:0 10px 30px rgba(108,76,241,.12),0 1px 2px rgba(20,18,31,.06);
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--ink:#F4F1FF;--ink-2:#CFC8F2;--muted:#9A93BF;--ground:#16132A;--ground-2:#1C1836;--card:#221D40;--line:#332C5A;--shadow:0 12px 32px rgba(0,0,0,.45)}}
:root[data-theme="dark"]{--ink:#F4F1FF;--ink-2:#CFC8F2;--muted:#9A93BF;--ground:#16132A;--ground-2:#1C1836;--card:#221D40;--line:#332C5A;--shadow:0 12px 32px rgba(0,0,0,.45)}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.55 "Nunito Sans","Nunito",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.display{font-family:"Nunito","Arial Rounded MT Bold","Varela Round","Helvetica Neue",Arial,sans-serif}
.top{background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff;padding:36px 32px 64px;position:relative;overflow:hidden}
.top::before{content:"";position:absolute;inset:0 0 50%;background:#fff;opacity:.10;border-radius:0 0 40px 40px}
.top .inner{max-width:1120px;margin:0 auto;position:relative;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}
.top svg{height:64px;width:auto;display:block;filter:drop-shadow(0 6px 14px rgba(20,18,31,.25))}
.top .word{font-family:"Nunito","Arial Rounded MT Bold",Arial,sans-serif;font-weight:900;font-size:34px;letter-spacing:-.3px;display:flex;align-items:center;gap:16px}
.top .word i{font-style:normal;color:var(--spark)}
.top .apps{font-family:"Nunito",sans-serif;font-weight:700;font-size:15px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.top .apps span{background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);padding:6px 14px;border-radius:999px;box-shadow:inset 0 1px 0 rgba(255,255,255,.35)}
.top .apps .ios{background:linear-gradient(180deg,var(--ios),var(--ios-2));border-color:transparent}.top .apps .android{background:linear-gradient(180deg,var(--android),var(--android-2));border-color:transparent}
main{max-width:1120px;margin:-36px auto 0;padding:0 24px 40px;display:grid;gap:24px}
.diff{background:var(--card);border-radius:26px;padding:22px 26px 20px;box-shadow:var(--shadow);position:relative;overflow:hidden}
.diff::before{content:"";position:absolute;left:0;right:0;top:0;height:6px;background:linear-gradient(90deg,var(--accent),var(--pink))}
.meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px;margin-top:4px}
.pill{font-family:"Nunito",sans-serif;font-weight:800;font-size:12.5px;letter-spacing:.3px;padding:5px 12px;border-radius:999px;color:#fff;box-shadow:inset 0 1.5px 0 rgba(255,255,255,.45),0 2px 4px rgba(20,18,31,.15)}
.sev.high{background:linear-gradient(180deg,#FF7A93,#E5484D)}.sev.medium{background:linear-gradient(180deg,#FFD97A,#F5A524);color:#4A3200}.sev.low{background:linear-gradient(180deg,var(--ios),var(--ios-2))}.sev.ignore{background:#9AA0A6}
.cat{background:linear-gradient(180deg,var(--accent-2),var(--accent))}.review{background:linear-gradient(180deg,#FFE8A3,#FFC857);color:#5A3F00}
.flow{color:var(--muted);font-weight:600;margin-left:4px}
h2{font-family:"Nunito","Arial Rounded MT Bold",Arial,sans-serif;font-weight:800;font-size:23px;line-height:1.25;margin:12px 0 8px;text-wrap:balance;display:flex;gap:12px;align-items:flex-start}
h2 .num{flex:none;width:34px;height:34px;border-radius:12px;display:grid;place-items:center;font-size:17px;color:#fff;background:linear-gradient(180deg,var(--accent-2),var(--accent));box-shadow:inset 0 1.5px 0 rgba(255,255,255,.45),0 3px 6px rgba(108,76,241,.35);margin-top:1px}
.desc{margin:0 0 14px;color:var(--ink-2);max-width:78ch}
.player{border-radius:18px;overflow:hidden;background:#0f0d1c;box-shadow:0 8px 24px rgba(20,18,31,.18)}
video{width:100%;max-height:72vh;display:block;background:#0f0d1c}
.also{margin:12px 0 0;font-size:13.5px;color:var(--muted);display:flex;gap:6px;flex-wrap:wrap;align-items:center}.also span{background:var(--ground-2);color:var(--ink-2);padding:3px 10px;border-radius:999px;font-weight:600}
details{margin-top:12px;border-top:1px solid var(--line);padding-top:10px}summary{cursor:pointer;font-family:"Nunito",sans-serif;font-weight:800;color:var(--accent)}details ol{margin:8px 0 0;padding-left:22px;color:var(--ink-2)}
.muted{color:var(--muted);font-size:13.5px}code{background:var(--ground-2);padding:1px 6px;border-radius:6px;font-size:12.5px}
footer{max-width:1120px;margin:0 auto;padding:8px 24px 40px;color:var(--muted);font-size:13px;display:flex;gap:16px;flex-wrap:wrap;align-items:center}
footer .dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:-1px}
@media (prefers-reduced-motion:no-preference){.diff{transition:transform .2s ease}.diff:hover{transform:translateY(-2px)}}
@media (max-width:600px){.top{padding:28px 20px 56px}.top .word{font-size:26px}main{padding:0 16px 32px}.diff{padding:18px 18px 16px;border-radius:20px}h2{font-size:20px}}
</style></head><body>
<header class="top"><div class="inner">
  <div class="word">${logoBadgeSvg(brand, 64, "hdr")}<span>Cross<i>Match</i></span></div>
  <div class="apps"><span class="ios">iOS · ${esc(path.basename(loaded.config.ios.app))}</span><span class="android">Android · ${esc(path.basename(loaded.config.android.app))}</span><span>${real.length} difference${real.length === 1 ? "" : "s"} in ${runs.length} flow${runs.length === 1 ? "" : "s"}</span></div>
</div></header>
<main>
${real.length ? real.map(card).join("\n") : `<article class="diff"><h2>No differences confirmed</h2><p class="desc">${runs.length ? "Every candidate was judged to be a platform idiom or noise." : "Run <code>crossmatch compare</code> first."}</p></article>`}
</main>
<footer><span><i class="dot" style="background:linear-gradient(180deg,var(--ios),var(--ios-2))"></i>iOS on the left</span><span><i class="dot" style="background:linear-gradient(180deg,var(--android),var(--android-2))"></i>Android on the right</span><span>${ignored.length} candidate${ignored.length === 1 ? "" : "s"} filtered as platform idiom or noise (report.json)</span><span>Recorded in lockstep with Argent · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</span></footer>
</body></html>`;
  const file = path.join(dir, "index.html");
  fs.writeFileSync(file, html);
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), differences: real.map((i) => ({ flow: i.run, ...i.verdict })), ignored: ignored.map((i) => ({ flow: i.run, ...i.verdict })), coverage: cov }, null, 2));
  log(`Report: ${file} (${real.length} difference(s), ${ignored.length} filtered)`);
  return file;
}
