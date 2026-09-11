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
  <h2>${esc(v.title)}</h2>
  <p class="desc">${esc(v.description)}</p>
  ${video}
  ${it.alsoIn.length ? `<p class="also">Also seen in ${it.alsoIn.map((o) => esc(o.flow.title ?? o.flow.name)).join(", ")}</p>` : ""}
  <details><summary>Steps shown (${it.steps.length})</summary><ol start="${parseInt(it.steps[0]) || 1}">${it.steps.map((s) => `<li>${esc(s.replace(/^\d+\.\s*/, ""))}</li>`).join("")}</ol><p class="muted">Judged by ${v.judge}. Flow file <code>${esc(path.basename(it.flow.path))}</code>.</p></details>
</article>`;
  };
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CrossMatch report</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@700;800&family=Nunito+Sans:wght@400;600;700&display=swap">
<style>
:root{
  --accent:${brand.accent};--ios:#2F7BE8;--android:#19B984;
  --ink:${brand.ink};--ink-2:#4B4668;--muted:#837E9E;
  --ground:#F7F6FC;--tint:#EFEBFD;--card:#FFFFFF;--line:#E9E5F6;--shadow:0 1px 2px rgba(20,18,31,.05),0 8px 24px rgba(108,76,241,.07);
  --high-bg:#FDE8EC;--high-fg:#B3263A;--med-bg:#FFF1D6;--med-fg:#8A5A00;--low-bg:#E6F0FF;--low-fg:#1F5FC2;--ign-bg:#EEEEF1;--ign-fg:#6B6B75;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--ink:#F1EEFA;--ink-2:#C9C3E4;--muted:#8F89AE;--ground:#15132A;--tint:#221E3E;--card:#1D1935;--line:#2E2950;--shadow:0 1px 2px rgba(0,0,0,.4),0 10px 28px rgba(0,0,0,.35);--high-bg:#3A1F27;--high-fg:#FF8A9A;--med-bg:#3A2E15;--med-fg:#FFC66B;--low-bg:#1C2A45;--low-fg:#7FB4FF;--ign-bg:#2A2A33;--ign-fg:#A9A9B4}}
:root[data-theme="dark"]{--ink:#F1EEFA;--ink-2:#C9C3E4;--muted:#8F89AE;--ground:#15132A;--tint:#221E3E;--card:#1D1935;--line:#2E2950;--shadow:0 1px 2px rgba(0,0,0,.4),0 10px 28px rgba(0,0,0,.35);--high-bg:#3A1F27;--high-fg:#FF8A9A;--med-bg:#3A2E15;--med-fg:#FFC66B;--low-bg:#1C2A45;--low-fg:#7FB4FF;--ign-bg:#2A2A33;--ign-fg:#A9A9B4}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.6 "Nunito Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.top{max-width:1080px;margin:0 auto;padding:40px 24px 20px;display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}
.top svg{height:48px;width:auto;display:block}
.top .word{font-family:"Nunito","Arial Rounded MT Bold",Arial,sans-serif;font-weight:800;font-size:26px;letter-spacing:-.2px;display:flex;align-items:center;gap:14px;color:var(--ink)}
.top .word i{font-style:normal;color:var(--accent)}
.top .apps{font-size:13.5px;color:var(--muted);display:flex;gap:18px;flex-wrap:wrap;align-items:center}
.top .apps i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:1px}
main{max-width:1080px;margin:0 auto;padding:8px 24px 40px;display:grid;gap:22px}
.diff{background:var(--card);border-radius:18px;padding:22px 26px 20px;box-shadow:var(--shadow);border:1px solid var(--line)}
.meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px}
.pill{font-family:"Nunito",sans-serif;font-weight:800;font-size:11.5px;letter-spacing:.4px;text-transform:uppercase;padding:3px 10px;border-radius:999px}
.sev.high{background:var(--high-bg);color:var(--high-fg)}.sev.medium{background:var(--med-bg);color:var(--med-fg)}.sev.low{background:var(--low-bg);color:var(--low-fg)}.sev.ignore{background:var(--ign-bg);color:var(--ign-fg)}
.cat{background:var(--tint);color:var(--accent)}.review{background:var(--med-bg);color:var(--med-fg)}
.flow{color:var(--muted);font-weight:600;margin-left:4px}
h2{font-family:"Nunito","Arial Rounded MT Bold",Arial,sans-serif;font-weight:800;font-size:22px;line-height:1.3;margin:12px 0 8px;text-wrap:balance;max-width:40em}
.desc{margin:0 0 16px;color:var(--ink-2);max-width:78ch}
.player{border-radius:14px;overflow:hidden;background:#F7F6FC;border:1px solid var(--line)}
video{width:100%;max-height:78vh;display:block;background:#F7F6FC}
.also{margin:12px 0 0;font-size:13.5px;color:var(--muted)}
details{margin-top:12px;border-top:1px solid var(--line);padding-top:10px}summary{cursor:pointer;font-family:"Nunito",sans-serif;font-weight:800;font-size:14px;color:var(--accent)}details ol{margin:8px 0 0;padding-left:22px;color:var(--ink-2)}
.muted{color:var(--muted);font-size:13.5px}code{background:var(--tint);padding:1px 6px;border-radius:6px;font-size:12.5px}
footer{max-width:1080px;margin:0 auto;padding:4px 24px 40px;color:var(--muted);font-size:13px}
@media (max-width:600px){.top{padding:28px 16px 12px}main{padding:8px 16px 32px}.diff{padding:18px 18px 16px}h2{font-size:19px}}
</style></head><body>
<header class="top">
  <div class="word">${logoBadgeSvg(brand, 48, "hdr")}<span>Cross<i>Match</i></span></div>
  <div class="apps"><span><i style="background:var(--ios)"></i>iOS · ${esc(path.basename(loaded.config.ios.app))}</span><span><i style="background:var(--android)"></i>Android · ${esc(path.basename(loaded.config.android.app))}</span><span>${real.length} difference${real.length === 1 ? "" : "s"} in ${runs.length} flow${runs.length === 1 ? "" : "s"}</span></div>
</header>
<main>
${real.length ? real.map(card).join("\n") : `<article class="diff"><h2>No differences confirmed</h2><p class="desc">${runs.length ? "Every candidate was judged to be a platform idiom or noise." : "Run <code>crossmatch compare</code> first."}</p></article>`}
</main>
<footer>${ignored.length} candidate${ignored.length === 1 ? "" : "s"} filtered as platform idiom or noise (report.json) · recorded in lockstep with Argent · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</footer>
</body></html>`;
  const file = path.join(dir, "index.html");
  fs.writeFileSync(file, html);
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), differences: real.map((i) => ({ flow: i.run, ...i.verdict })), ignored: ignored.map((i) => ({ flow: i.run, ...i.verdict })), coverage: cov }, null, 2));
  log(`Report: ${file} (${real.length} difference(s), ${ignored.length} filtered)`);
  return file;
}
