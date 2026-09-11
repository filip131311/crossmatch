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

/** Device chrome that Argent's Android capture paints into the video: black rounded corners and the camera hole. */
interface Chrome { cornerRadius: number; hole?: { x: number; y: number; w: number; h: number } }

/** Measure the black corners and camera hole in one frame of a recording (all values in source pixels). */
async function detectChrome(video: string, tmp: string): Promise<Chrome> {
  const png = path.join(tmp, `${path.basename(video, ".mp4")}-chrome.png`);
  const res = spawnSync(ffmpegBin(), ["-y", "-loglevel", "error", "-ss", "1", "-i", video, "-frames:v", "1", png], { encoding: "utf8" });
  if (res.status !== 0) return { cornerRadius: 0 };
  try {
    const img = await loadImage(png);
    const w = img.width;
    const h = img.height;
    const c = createCanvas(w, h);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, w, h).data;
    const dark = (px: number, py: number) => {
      const i = (py * w + px) * 4;
      return d[i] + d[i + 1] + d[i + 2] < 60;
    };
    // a rounded black corner of radius R is black along the top row for R pixels
    let r = 0;
    while (r < w / 4 && dark(r, 0)) r++;
    let r2 = 0;
    while (r2 < w / 4 && dark(w - 1 - r2, h - 1)) r2++;
    const cornerRadius = Math.min(r, r2) >= 8 ? Math.min(r, r2) : 0;
    // a camera hole: a dark blob near the top centre, a few percent of the width wide
    let hole: Chrome["hole"];
    const cx = Math.round(w / 2);
    for (let y = Math.round(h * 0.005); y < h * 0.08; y += 2) {
      if (!dark(cx, y)) continue;
      let left = cx;
      let right = cx;
      while (left > 0 && dark(left - 1, y)) left--;
      while (right < w - 1 && dark(right + 1, y)) right++;
      let top = y;
      let bottom = y;
      while (top > 0 && dark(cx, top - 1)) top--;
      while (bottom < h - 1 && dark(cx, bottom + 1)) bottom++;
      const hw = right - left + 1;
      const hh = bottom - top + 1;
      if (hw > w * 0.02 && hw < w * 0.15 && hh > h * 0.005 && hh < h * 0.08) hole = { x: left, y: top, w: hw, h: hh };
      break;
    }
    return { cornerRadius, hole };
  } catch {
    return { cornerRadius: 0 };
  }
}

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

const GROUND = "#F7F6FC";
const ACCENT_2 = "#9B7BFF";
const SPARK = "#FFD166";
const PINK = "#FF6FA5";
const PLATFORM: Record<Side, [string, string]> = { ios: ["#5AA9FF", "#2F7BE8"], android: ["#4DE1B0", "#19B984"] };
const SEVERITY: Record<string, [string, string]> = { high: ["#FDE8EC", "#B3263A"], medium: ["#FFF1D6", "#8A5A00"], low: ["#E6F0FF", "#1F5FC2"], ignore: ["#EEEEF1", "#6B6B75"] };
const TINT = "#EFEBFD";
const LINE = "#E9E5F6";
const MUTED = "#837E9E";

/** A flat, quiet pill. Returns its width. */
function pill(ctx: SKRSContext2D, x: number, y: number, text: string, font: string, bg: string, fg: string, padX = 14, h = 32): number {
  ctx.font = font;
  const w = ctx.measureText(text).width + padX * 2;
  ctx.fillStyle = bg;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.fillText(text, x + padX, y + h * 0.68);
  return w;
}

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
  ctx.fillStyle = brand.accent;
  ctx.fillText("Match", tx + wCross, ty);
}

/** Static frame: background, header with title/severity/logo, panel labels, footer. Transparent where the videos go. */
function drawFrame(L: Layout, brand: Brand, verdict: Verdict, output: RunOutput, index: number, badge: Image, screenRadius: number): Buffer {
  const c = createCanvas(L.W, L.H);
  const ctx = c.getContext("2d");
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, L.W, L.H);
  ctx.fillStyle = MUTED;
  ctx.font = `600 18px ${FONT}`;
  ctx.fillText(`${output.run.flow.title ?? output.run.flow.name}  ·  difference ${index + 1}`, MARGIN, 40);
  const sev = SEVERITY[verdict.severity] ?? SEVERITY.ignore;
  const sw = pill(ctx, MARGIN, 54, verdict.severity.toUpperCase(), `800 14px ${ROUNDED}`, sev[0], sev[1], 12, 28);
  pill(ctx, MARGIN + sw + 8, 54, verdict.category.replace("-", " ").toUpperCase(), `800 14px ${ROUNDED}`, TINT, brand.accent, 12, 28);
  ctx.fillStyle = brand.ink;
  ctx.font = `800 30px ${ROUNDED}`;
  wrapText(ctx, verdict.title, MARGIN, 120, L.W - MARGIN * 2, 36, 2);
  drawLogo(ctx, badge, brand, L.W - MARGIN, 22, 46);
  // panels: a thin, low-key bezel tinted by platform; the label is plain text with a colour dot
  for (const side of ["ios", "android"] as Side[]) {
    const p = L.panels[side];
    const colour = PLATFORM[side][1];
    ctx.save();
    ctx.shadowColor = "rgba(20,18,31,0.10)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = "#fff";
    roundRect(ctx, p.x - 5, p.y - 5, p.w + 10, p.h + 10, screenRadius + 5);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = hex(colour, 0.45);
    ctx.lineWidth = 2;
    roundRect(ctx, p.x - 5, p.y - 5, p.w + 10, p.h + 10, screenRadius + 5);
    ctx.stroke();
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(p.x + 6, p.y - 24, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = brand.ink;
    ctx.font = `800 20px ${ROUNDED}`;
    const name = side === "ios" ? "iOS" : "Android";
    ctx.fillText(name, p.x + 20, p.y - 17);
    ctx.fillStyle = MUTED;
    ctx.font = `600 16px ${FONT}`;
    ctx.fillText(output.run.devices[side].name.replace(/_/g, " "), p.x + 20 + ctx.measureText(name).width + 34, p.y - 17);
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000"; // opaque: destination-out removes by the SOURCE alpha
    roundRect(ctx, p.x, p.y, p.w, p.h, screenRadius);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = MUTED;
  ctx.font = `600 15px ${FONT}`;
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
  ctx.shadowColor = hex(brand.accent, ghost ? 0.15 : 0.35);
  ctx.shadowBlur = 12;
  ctx.strokeStyle = ghost ? hex(brand.accent, 0.6) : brand.accent;
  ctx.lineWidth = 4;
  roundRect(ctx, x, y, w, h, 14);
  ctx.stroke();
  ctx.restore();
  // label pill: above the box when possible, else below; slide away from labels already shown
  ctx.font = `800 21px ${ROUNDED}`;
  const tw = ctx.measureText(label).width;
  const pw = tw + 36;
  const ph = 42;
  const px = Math.min(Math.max(p.x, x + w / 2 - pw / 2), p.x + p.w - pw);
  const candidates: Array<{ py: number; above: boolean }> = [];
  for (let k = 0; k < 4; k++) {
    candidates.push({ py: y - ph - 18 - k * (ph + 10), above: true });
    candidates.push({ py: y + h + 18 + k * (ph + 10), above: false });
  }
  const fits = (cand: { py: number }) => cand.py >= p.y - 4 && cand.py + ph <= p.y + p.h + 4 && !avoid.some((r) => overlaps(r, { x: px, y: cand.py, w: pw, h: ph }));
  const chosen = candidates.find(fits) ?? candidates[0];
  const { py, above } = chosen;
  ctx.save();
  ctx.shadowColor = "rgba(20,18,31,0.18)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = ghost ? "#4B4668" : brand.accent;
  roundRect(ctx, px, py, pw, ph, ph / 2);
  ctx.fill();
  ctx.restore();
  // arrow
  const ax = Math.min(Math.max(x + w / 2, px + 22), px + pw - 22);
  ctx.fillStyle = ghost ? "#4B4668" : brand.accent;
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
  ctx.font = `800 21px ${ROUNDED}`;
  ctx.fillText(label, px + 18, py + 30);
  return { png: c.toBuffer("image/png"), labelRect: { x: px, y: py, w: pw, h: ph } };
}

function drawCaption(L: Layout, brand: Brand, text: string): Buffer {
  const c = createCanvas(L.W, L.H);
  const ctx = c.getContext("2d");
  ctx.font = `700 18px ${ROUNDED}`;
  const tw = ctx.measureText(text).width;
  const pw = tw + 40;
  const px = L.W - MARGIN - pw;
  const py = L.H - FOOTER_H + 22;
  ctx.fillStyle = "#fff";
  roundRect(ctx, px, py, pw, 38, 19);
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  roundRect(ctx, px, py, pw, 38, 19);
  ctx.stroke();
  ctx.fillStyle = "#4B4668";
  ctx.font = `700 18px ${ROUNDED}`;
  ctx.fillText(text, px + 20, py + 26);
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
  const chrome: Record<Side, Chrome> = {
    ios: await detectChrome(path.join(runDir, output.run.video.ios.file), tmp),
    android: await detectChrome(path.join(runDir, output.run.video.android.file), tmp),
  };
  for (const side of ["ios", "android"] as Side[]) if (chrome[side].cornerRadius || chrome[side].hole) log(`  ${side} recording has device chrome (corner radius ${chrome[side].cornerRadius}px${chrome[side].hole ? ", camera hole" : ""}); masking it`);
  verdicts.forEach((v, i) => {
    const file = `diff-${i + 1}.mp4`;
    try {
      composeOne(output, v, i, L, brand, runDir, tmp, file, log, badge, chrome);
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

function composeOne(output: RunOutput, v: Verdict, index: number, L: Layout, brand: Brand, runDir: string, tmp: string, file: string, log: (s: string) => void, badge: Image, chrome: Record<Side, Chrome>) {
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
  // the screen corners: as round as the roundest recorded device, so black corner arcs are hidden
  const P0 = L.panels;
  const screenRadius = Math.max(
    22,
    ...(["ios", "android"] as Side[]).map((side) => (chrome[side].cornerRadius * P0[side].w) / (output.run.video[side].width || 1)),
  );
  const frame = path.join(tmp, `frame-${index}.png`);
  fs.writeFileSync(frame, drawFrame(L, brand, v, output, index, badge, screenRadius));
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
  const clean = (side: Side) => {
    const hole = chrome[side].hole;
    if (!hole) return "";
    // delogo interpolates from the rectangle's border, so the border must lie on clean background
    const pad = Math.round(Math.max(hole.w, hole.h) * 0.45) + 4;
    const x = Math.max(1, hole.x - pad);
    const y = Math.max(1, hole.y - pad);
    return `delogo=x=${x}:y=${y}:w=${hole.w + pad * 2}:h=${hole.h + pad * 2},`;
  };
  const fc: string[] = [
    // everything is composited in RGBA so the full-range (yuvj420p) recordings are not washed out
    `color=c=${GROUND}:s=${L.W}x${L.H}:r=30:d=${len.toFixed(3)},format=rgba[bg]`,
    `[0:v]${clean("ios")}format=rgba,scale=${P.ios.w}:${P.ios.h}:flags=lanczos,tpad=stop_mode=clone:stop_duration=${len.toFixed(3)},setpts=PTS-STARTPTS[ios]`,
    `[1:v]${clean("android")}format=rgba,scale=${P.android.w}:${P.android.h}:flags=lanczos,tpad=stop_mode=clone:stop_duration=${len.toFixed(3)},setpts=PTS-STARTPTS[and]`,
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
