/**
 * Renders one side-by-side mp4 per confirmed difference: iOS on the left, Android on the right,
 * both cut from the lockstep recordings at the same step, with branded callouts pointing at the
 * elements the judge named. The agent only says *where*; the look is uniform across artifacts.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { logoBadgeSvg } from "./logo.js";
import type { LoadedConfig } from "./config.js";
import { ffmpegBin } from "./ffmpeg.js";
import { resolveSelector } from "./describe.js";
import { ffprobeSize, runDirFor } from "./lockstep.js";
import type { Brand, Frame, Pointer, RunOutput, Side, Verdict } from "./types.js";

const FONT = "-apple-system, 'Helvetica Neue', Helvetica, Arial, Roboto, sans-serif";
const ROUNDED = "'Arial Rounded MT Bold', 'Nunito', 'Varela Round', 'Helvetica Neue', Arial, sans-serif";
const PANEL_H = 1100;
const MARGIN = 40;
const GAP = 48;
const HEADER_H = 196;
const LABEL_H = 56;
const FOOTER_H = 84;
const LEAD_MS = 700;
const TAIL_MS = 2600;

interface Layout { W: number; H: number; panels: Record<Side, { x: number; y: number; w: number; h: number }> }

function layoutFor(output: RunOutput): Layout {
  const v = output.run.video;
  const w = (s: Side) => Math.round(((v[s].width || 1080) / (v[s].height || 2400)) * PANEL_H);
  const wi = w("ios");
  const wa = w("android");
  const W = MARGIN * 2 + wi + GAP + wa;
  const y = HEADER_H + LABEL_H;
  return {
    W: W % 2 ? W + 1 : W,
    H: (y + PANEL_H + FOOTER_H) % 2 ? y + PANEL_H + FOOTER_H + 1 : y + PANEL_H + FOOTER_H,
    panels: { ios: { x: MARGIN, y, w: wi, h: PANEL_H }, android: { x: MARGIN + wi + GAP, y, w: wa, h: PANEL_H } },
  };
}

function hex(h: string, alpha = 1): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(h);
  if (!m) return h;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

const SEVERITY_COLOUR: Record<string, string> = { high: "#E5484D", medium: "#F5A524", low: "#3E8BFF", ignore: "#9AA0A6" };

/** The CrossMatch mark: tile badge (from the shared SVG) plus a rounded two-tone wordmark. */
function drawLogo(ctx: SKRSContext2D, badge: Image, brand: Brand, right: number, top: number, height: number) {
  const fontSize = height * 0.56;
  ctx.font = `800 ${fontSize}px ${ROUNDED}`;
  const wCross = ctx.measureText("Cross").width;
  const wMatch = ctx.measureText("Match").width;
  const textW = wCross + wMatch;
  const total = height + height * 0.25 + textW;
  const x = right - total;
  ctx.drawImage(badge, x, top, height, height);
  const tx = x + height + height * 0.25;
  const ty = top + height * 0.5 + fontSize * 0.36;
  ctx.fillStyle = brand.ink;
  ctx.fillText("Cross", tx, ty);
  const grad = ctx.createLinearGradient(tx + wCross, 0, tx + textW, 0);
  grad.addColorStop(0, brand.accent);
  grad.addColorStop(1, "#FF6FA5");
  ctx.fillStyle = grad;
  ctx.fillText("Match", tx + wCross, ty);
}

/** Static frame: background, header with title/severity/logo, panel labels, footer. Transparent where the videos go. */
function drawFrame(L: Layout, brand: Brand, verdict: Verdict, output: RunOutput, index: number, badge: Image): Buffer {
  const c = createCanvas(L.W, L.H);
  const ctx = c.getContext("2d");
  ctx.fillStyle = brand.paper;
  ctx.fillRect(0, 0, L.W, L.H);
  // header
  ctx.fillStyle = brand.ink;
  ctx.font = `600 22px ${FONT}`;
  ctx.fillText(`${output.run.flow.title ?? output.run.flow.name}  ·  difference ${index + 1}`, MARGIN, 44);
  // severity badge + category chip
  const sev = verdict.severity.toUpperCase();
  ctx.font = `700 18px ${FONT}`;
  const sw = ctx.measureText(sev).width + 28;
  ctx.fillStyle = SEVERITY_COLOUR[verdict.severity] ?? brand.accent;
  roundRect(ctx, MARGIN, 60, sw, 32, 8);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText(sev, MARGIN + 14, 83);
  const cat = verdict.category.replace("-", " ");
  ctx.font = `600 18px ${FONT}`;
  const cw = ctx.measureText(cat).width + 28;
  ctx.fillStyle = hex(brand.accent, 0.12);
  roundRect(ctx, MARGIN + sw + 12, 60, cw, 32, 8);
  ctx.fill();
  ctx.fillStyle = brand.accent;
  ctx.fillText(cat, MARGIN + sw + 26, 83);
  // title (wrapped to two lines)
  ctx.fillStyle = brand.ink;
  ctx.font = `700 30px ${FONT}`;
  wrapText(ctx, verdict.title, MARGIN, 128, L.W - MARGIN * 2, 36, 2);
  // logo
  drawLogo(ctx, badge, brand, L.W - MARGIN, 22, 52);
  // panel labels + device frames
  for (const side of ["ios", "android"] as Side[]) {
    const p = L.panels[side];
    const name = side === "ios" ? "iOS" : "Android";
    ctx.fillStyle = brand.ink;
    ctx.font = `700 24px ${FONT}`;
    ctx.fillText(name, p.x, p.y - 18);
    ctx.fillStyle = hex(brand.ink, 0.55);
    ctx.font = `500 18px ${FONT}`;
    ctx.fillText(output.run.devices[side].name, p.x + ctx.measureText(name).width + 34, p.y - 18);
    // rounded bezel around the video
    ctx.strokeStyle = hex(brand.ink, 0.15);
    ctx.lineWidth = 3;
    roundRect(ctx, p.x - 6, p.y - 6, p.w + 12, p.h + 12, 26);
    ctx.stroke();
    // transparent hole
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000"; // must be opaque: destination-out removes by the SOURCE alpha
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.restore();
  }
  // footer
  ctx.fillStyle = hex(brand.ink, 0.45);
  ctx.font = `500 16px ${FONT}`;
  ctx.fillText(`CrossMatch · recorded in lockstep with Argent · ${new Date(output.run.startedAt).toISOString().slice(0, 10)}`, MARGIN, L.H - 30);
  return c.toBuffer("image/png");
}

function wrapText(ctx: SKRSContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines: number) {
  const words = text.split(/\s+/);
  let line = "";
  let lines = 0;
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) {
      if (lines === maxLines - 1) {
        while (ctx.measureText(`${line}…`).width > maxW) line = line.slice(0, -1);
        ctx.fillText(`${line}…`, x, y + lines * lineH);
        return;
      }
      ctx.fillText(line, x, y + lines * lineH);
      lines++;
      line = w;
    } else line = t;
  }
  if (line) ctx.fillText(line, x, y + lines * lineH);
}

interface Rect { x: number; y: number; w: number; h: number }
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * A callout: highlight box around the element + label pill with a small arrow. Whole-canvas
 * transparent PNG. The pill avoids the rects in `avoid` (labels already on screen at the same time).
 */
function drawPointer(L: Layout, brand: Brand, side: Side, frame: Frame, label: string, ghost: boolean, avoid: Rect[]): { png: Buffer; labelRect: Rect } {
  const c = createCanvas(L.W, L.H);
  const ctx = c.getContext("2d");
  const p = L.panels[side];
  const pad = 8;
  const x = p.x + frame.x * p.w - pad;
  const y = p.y + frame.y * p.h - pad;
  const w = Math.max(24, frame.width * p.w + pad * 2);
  const h = Math.max(24, frame.height * p.h + pad * 2);
  // glow + box
  ctx.save();
  if (ghost) ctx.setLineDash([10, 8]);
  ctx.shadowColor = hex(brand.accent, ghost ? 0.25 : 0.6);
  ctx.shadowBlur = 18;
  ctx.strokeStyle = ghost ? hex(brand.accent, 0.7) : brand.accent;
  ctx.lineWidth = 5;
  roundRect(ctx, x, y, w, h, 14);
  ctx.stroke();
  ctx.restore();
  // label pill: above the box when possible, else below; slide away from labels already shown
  ctx.font = `700 22px ${FONT}`;
  const tw = ctx.measureText(label).width;
  const pw = tw + 36;
  const ph = 44;
  const px = Math.min(Math.max(p.x, x + w / 2 - pw / 2), p.x + p.w - pw);
  const candidates: Array<{ py: number; above: boolean }> = [];
  for (let k = 0; k < 4; k++) {
    candidates.push({ py: y - ph - 18 - k * (ph + 10), above: true });
    candidates.push({ py: y + h + 18 + k * (ph + 10), above: false });
  }
  const fits = (cand: { py: number }) => cand.py >= p.y - 4 && cand.py + ph <= p.y + p.h + 4 && !avoid.some((r) => overlaps(r, { x: px, y: cand.py, w: pw, h: ph }));
  const chosen = candidates.find(fits) ?? candidates[0];
  const { py, above } = chosen;
  ctx.fillStyle = ghost ? hex(brand.ink, 0.75) : brand.accent;
  roundRect(ctx, px, py, pw, ph, 12);
  ctx.fill();
  // arrow
  const ax = Math.min(Math.max(x + w / 2, px + 22), px + pw - 22);
  ctx.beginPath();
  if (above) {
    ctx.moveTo(ax - 11, py + ph);
    ctx.lineTo(ax + 11, py + ph);
    ctx.lineTo(ax, py + ph + 12);
  } else {
    ctx.moveTo(ax - 11, py);
    ctx.lineTo(ax + 11, py);
    ctx.lineTo(ax, py - 12);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText(label, px + 18, py + 30);
  return { png: c.toBuffer("image/png"), labelRect: { x: px, y: py, w: pw, h: ph } };
}

function drawCaption(L: Layout, brand: Brand, text: string): Buffer {
  const c = createCanvas(L.W, L.H);
  const ctx = c.getContext("2d");
  ctx.font = `600 20px ${FONT}`;
  const tw = ctx.measureText(text).width;
  const pw = tw + 40;
  const px = L.W - MARGIN - pw;
  const py = L.H - FOOTER_H + 22;
  ctx.fillStyle = hex(brand.ink, 0.08);
  roundRect(ctx, px, py, pw, 40, 10);
  ctx.fill();
  ctx.fillStyle = brand.ink;
  ctx.fillText(text, px + 20, py + 27);
  return c.toBuffer("image/png");
}

interface ResolvedPointer { side: Side; frame: Frame; label: string; fromMs: number; ghost: boolean; stepIndex: number }

function resolvePointers(output: RunOutput, v: Verdict, log: (s: string) => void): ResolvedPointer[] {
  const out: ResolvedPointer[] = [];
  for (const p of v.pointers) {
    if (p.side === "both") continue;
    const step = output.run.steps[p.stepIndex];
    if (!step) continue;
    const tree = step[p.side].tree;
    let frame = p.frame;
    if (p.element && tree) {
      const node = resolveSelector(tree, p.element);
      if (node) frame = node.frame;
      else if (!frame) {
        // the element may be in a neighbouring step's tree (the judge names the step loosely)
        for (const d of [-1, 1, -2, 2]) {
          const alt = output.run.steps[p.stepIndex + d]?.[p.side].tree;
          const n2 = alt && resolveSelector(alt, p.element);
          if (n2) {
            frame = n2.frame;
            break;
          }
        }
      }
    }
    if (!frame) {
      log(`  pointer "${p.label}" (${p.side}, step ${p.stepIndex + 1}) not drawn: ${JSON.stringify(p.element)} is not in that step's tree`);
      continue;
    }
    out.push({ side: p.side, frame, label: p.label, fromMs: step[p.side].startMs, ghost: false, stepIndex: p.stepIndex });
  }
  // A missing control gets a ghost marker at the same place on the other side.
  if (v.category === "missing-feature" && out.length && out.every((p) => p.side === out[0].side)) {
    const src = out[0];
    const other: Side = src.side === "ios" ? "android" : "ios";
    const step = output.run.steps[src.stepIndex];
    out.push({ side: other, frame: src.frame, label: `Not on ${other === "ios" ? "iOS" : "Android"}`, fromMs: step ? step[other].startMs : src.fromMs, ghost: true, stepIndex: src.stepIndex });
  }
  return out;
}

export async function renderRun(loaded: LoadedConfig, output: RunOutput, log: (s: string) => void): Promise<string[]> {
  const runDir = runDirFor(loaded, output.run.flow.name);
  const verdicts = (output.verdicts ?? []).filter((v) => v.severity !== "ignore");
  const files: string[] = [];
  const L = layoutFor(output);
  const brand = loaded.config.brand;
  const tmp = path.join(runDir, ".compose");
  fs.mkdirSync(tmp, { recursive: true });
  if (!output.run.video.ios.file || !output.run.video.android.file) {
    log("  no side-by-side videos: a recording is missing on one side");
    return files;
  }
  const badge = await loadImage(Buffer.from(logoBadgeSvg(brand, 256)));
  verdicts.forEach((v, i) => {
    const file = `diff-${i + 1}.mp4`;
    try {
      composeOne(output, v, i, L, brand, runDir, tmp, file, log, badge);
      files.push(file);
      v.video = file;
      log(`  rendered ${file}: ${v.title}`);
    } catch (e) {
      log(`  failed to render ${file}: ${e instanceof Error ? e.message : e}`);
    }
  });
  if (!process.env.CROSSMATCH_KEEP_TMP) fs.rmSync(tmp, { recursive: true, force: true });
  return files;
}

function composeOne(output: RunOutput, v: Verdict, index: number, L: Layout, brand: Brand, runDir: string, tmp: string, file: string, log: (s: string) => void, badge: Image) {
  const steps = output.run.steps;
  const [a, b] = v.stepRange;
  for (const side of ["ios", "android"] as Side[]) {
    if (output.run.video[side].durationMs) continue;
    const probed = ffprobeSize(path.join(runDir, output.run.video[side].file));
    if (!probed.durationMs) throw new Error(`cannot determine the length of ${output.run.video[side].file}`);
    output.run.video[side] = { ...output.run.video[side], ...probed };
  }
  const duration = (side: Side) => output.run.video[side].durationMs;
  // clamp to the recording: a flow can outlive the recording's time limit
  const clipStart = (side: Side) => Math.max(0, Math.min(steps[a][side].startMs - LEAD_MS, duration(side) - 1500));
  const clipEnd = (side: Side) => Math.min(duration(side), Math.max(steps[b][side].endMs, steps[a][side].startMs) + TAIL_MS);
  for (const side of ["ios", "android"] as Side[]) if (steps[b][side].endMs > duration(side)) log(`  warning: step ${b + 1} on ${side} lies beyond the end of the recording (raise recording.timeLimitSeconds)`);
  const lenMs = Math.max(clipEnd("ios") - clipStart("ios"), clipEnd("android") - clipStart("android"), 1500);
  const len = lenMs / 1000;
  const frame = path.join(tmp, `frame-${index}.png`);
  fs.writeFileSync(frame, drawFrame(L, brand, v, output, index, badge));
  const inputs: string[] = ["-ss", (clipStart("ios") / 1000).toFixed(3), "-t", len.toFixed(3), "-i", path.join(runDir, output.run.video.ios.file), "-ss", (clipStart("android") / 1000).toFixed(3), "-t", len.toFixed(3), "-i", path.join(runDir, output.run.video.android.file), "-loop", "1", "-framerate", "30", "-t", len.toFixed(3), "-i", frame];
  const overlays: Array<{ file: string; from: number; to: number }> = [];
  // captions: one per step in range, timed by the iOS side (both sides are within a few hundred ms)
  for (let s = a; s <= b; s++) {
    const st = steps[s];
    const from = Math.max(0, st.ios.startMs - clipStart("ios")) / 1000;
    const next = steps[s + 1];
    const to = next && s < b ? Math.max(0, next.ios.startMs - clipStart("ios")) / 1000 : len;
    const cap = path.join(tmp, `cap-${index}-${s}.png`);
    fs.writeFileSync(cap, drawCaption(L, brand, `Step ${s + 1} · ${st.label}`));
    overlays.push({ file: cap, from, to });
  }
  const pointers = resolvePointers(output, v, log);
  // A callout is valid only while its step's screen is on: it appears a beat after the action and
  // disappears when the next step starts on that side (or at the end of the clip for the last step).
  // passive steps (await/assert/wait/echo) do not change the screen, so a callout survives them
  const PASSIVE = new Set(["await", "assert", "wait", "echo"]);
  const nextStart = (side: Side, stepIndex: number) => {
    for (let s = stepIndex + 1; s <= b; s++) {
      const st = steps[s];
      if (PASSIVE.has(st.directive.kind)) continue;
      if (st.directive.kind === "when" && st.directive.platform !== side) continue;
      if (st[side].startMs > 0 && st[side].status !== "skip") return st[side].startMs;
    }
    return undefined;
  };
  const placed: Array<{ side: Side; from: number; to: number; rect: Rect }> = [];
  pointers.forEach((p, k) => {
    const from = Math.min(Math.max(0, p.fromMs - clipStart(p.side) + 300) / 1000, len - 0.5);
    const next = nextStart(p.side, p.stepIndex);
    const to = next !== undefined ? Math.max(from + 1.5, (next - clipStart(p.side)) / 1000) : len;
    const avoid = placed.filter((q) => q.side === p.side && q.from < to && from < q.to).map((q) => q.rect);
    const png = path.join(tmp, `ptr-${index}-${k}.png`);
    const drawn = drawPointer(L, brand, p.side, p.frame, p.label, p.ghost, avoid);
    fs.writeFileSync(png, drawn.png);
    placed.push({ side: p.side, from, to, rect: drawn.labelRect });
    overlays.push({ file: png, from, to: Math.min(to, len) });
  });
  for (const o of overlays) inputs.push("-loop", "1", "-framerate", "30", "-t", len.toFixed(3), "-i", o.file);
  const P = L.panels;
  const fc: string[] = [
    // everything is composited in RGBA so the full-range (yuvj420p) recordings are not washed out
    `color=c=${brand.paper}:s=${L.W}x${L.H}:r=30:d=${len.toFixed(3)},format=rgba[bg]`,
    `[0:v]format=rgba,scale=${P.ios.w}:${P.ios.h}:flags=lanczos,tpad=stop_mode=clone:stop_duration=${len.toFixed(3)},setpts=PTS-STARTPTS[ios]`,
    `[1:v]format=rgba,scale=${P.android.w}:${P.android.h}:flags=lanczos,tpad=stop_mode=clone:stop_duration=${len.toFixed(3)},setpts=PTS-STARTPTS[and]`,
    `[bg][ios]overlay=${P.ios.x}:${P.ios.y}:shortest=1[t0]`,
    `[t0][and]overlay=${P.android.x}:${P.android.y}[t1]`,
    `[t1][2:v]overlay=0:0[t2]`,
  ];
  let last = "t2";
  overlays.forEach((o, k) => {
    const out = `t${3 + k}`;
    fc.push(`[${last}][${3 + k}:v]overlay=0:0:enable='between(t,${o.from.toFixed(3)},${o.to.toFixed(3)})'[${out}]`);
    last = out;
  });
  fc.push(`[${last}]format=yuv420p[out]`);
  const args = ["-y", "-loglevel", "error", ...inputs, "-filter_complex", fc.join(";"), "-map", "[out]", "-t", len.toFixed(3), "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(runDir, file)];
  const res = spawnSync(ffmpegBin(), args, { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`ffmpeg: ${res.stderr.slice(-800)}`);
}
