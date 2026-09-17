/**
 * Renders one side-by-side mp4 per confirmed difference: the first platform on the left, the second on the right,
 * both cut from the lockstep recordings at the same step, with branded callouts pointing at the
 * elements the judge named. The agent only says *where*; the look is uniform across artifacts.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import type { LoadedConfig } from "./config.js";
import { ffmpegBin } from "./ffmpeg.js";
import { resolveSelector } from "./describe.js";
import { ffprobeSize, runDirFor } from "./lockstep.js";
import { SIDE_NAME, otherSide, runPair, sideOf, type Brand, type Frame, type RunOutput, type Side, type VideoInfo, type Verdict } from "./types.js";

const FONT = "-apple-system, 'Helvetica Neue', Helvetica, Arial, Roboto, sans-serif";
const ROUNDED = "'Arial Rounded MT Bold', 'Nunito', 'Varela Round', 'Helvetica Neue', Arial, sans-serif";
const PANEL_H = 1100;
const MARGIN = 40;
const GAP = 48;
const HEADER_H = 24;
const LABEL_H = 56;
const FOOTER_H = 84;
const LEAD_MS = 700;
const TAIL_MS = 2600;

interface Layout { W: number; H: number; panels: Partial<Record<Side, { x: number; y: number; w: number; h: number }>> }

const videoOf = (output: RunOutput, side: Side): VideoInfo => output.run.video[side] ?? { file: "", durationMs: 0, width: 0, height: 0 };
const panelOf = (L: Layout, side: Side) => L.panels[side]!;

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
  const [sa, sb] = runPair(output.run);
  const w = (s: Side) => Math.round(((videoOf(output, s).width || 1080) / (videoOf(output, s).height || 2400)) * PANEL_H);
  const wa = w(sa);
  const wb = w(sb);
  const W = MARGIN * 2 + wa + GAP + wb;
  const y = HEADER_H + LABEL_H;
  return {
    W: W % 2 ? W + 1 : W,
    H: (y + PANEL_H + FOOTER_H) % 2 ? y + PANEL_H + FOOTER_H + 1 : y + PANEL_H + FOOTER_H,
    panels: { [sa]: { x: MARGIN, y, w: wa, h: PANEL_H }, [sb]: { x: MARGIN + wa + GAP, y, w: wb, h: PANEL_H } },
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

const GROUND = "#FAFAFD"; // identical to the report page ground so the clip melts into the page
const ACCENT_2 = "#9B7BFF";
const SPARK = "#FFD166";
const PINK = "#FF6FA5";
const PLATFORM: Record<Side, [string, string]> = { ios: ["#5AA9FF", "#2F7BE8"], android: ["#4DE1B0", "#19B984"], web: ["#FFB36B", "#E8792F"] };
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

/** Static frame: background, header with title/severity/logo, panel labels, footer. Transparent where the videos go. */
function drawFrame(L: Layout, brand: Brand, output: RunOutput, screenRadius: number): Buffer {
  const c = createCanvas(L.W, L.H);
  const ctx = c.getContext("2d");
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, L.W, L.H);
  // the report card carries the title, severity, category and the mark: the clip is just the two screens
  // panels: a thin, low-key bezel tinted by platform; the label is plain text with a colour dot
  for (const side of runPair(output.run)) {
    const p = panelOf(L, side);
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
    const name = SIDE_NAME[side];
    ctx.fillText(name, p.x + 20, p.y - 17);
    ctx.fillStyle = MUTED;
    ctx.font = `600 16px ${FONT}`;
    ctx.fillText((output.run.devices[side]?.name ?? "").replace(/_/g, " "), p.x + 20 + ctx.measureText(name).width + 34, p.y - 17);
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000"; // opaque: destination-out removes by the SOURCE alpha
    roundRect(ctx, p.x, p.y, p.w, p.h, screenRadius);
    ctx.fill();
    ctx.restore();
  }
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
  const p = panelOf(L, side);
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
    const tree = step[p.side]?.tree;
    let frame = p.frame;
    if (p.element && tree) {
      const node = resolveSelector(tree, p.element);
      if (node) frame = node.frame;
      else if (!frame) {
        // the element may be in a neighbouring step's tree (the judge names the step loosely)
        for (const d of [-1, 1, -2, 2]) {
          const alt = output.run.steps[p.stepIndex + d]?.[p.side]?.tree;
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
    out.push({ side: p.side, frame, label: p.label, fromMs: step[p.side]?.startMs ?? 0, ghost: false, stepIndex: p.stepIndex });
  }
  // A missing control gets a ghost marker at the same place on the other side.
  if (v.category === "missing-feature" && out.length && out.every((p) => p.side === out[0].side)) {
    const src = out[0];
    const other = otherSide(runPair(output.run), src.side);
    const step = output.run.steps[src.stepIndex];
    out.push({ side: other, frame: src.frame, label: `Not on ${SIDE_NAME[other]}`, fromMs: step?.[other]?.startMs ?? src.fromMs, ghost: true, stepIndex: src.stepIndex });
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
  const pair = runPair(output.run);
  if (pair.some((side) => !videoOf(output, side).file)) {
    log("  no side-by-side videos: a recording is missing on one side");
    return files;
  }
  const chrome = {} as Record<Side, Chrome>;
  for (const side of pair) chrome[side] = await detectChrome(path.join(runDir, videoOf(output, side).file), tmp);
  for (const side of pair) if (chrome[side].cornerRadius) log(`  ${side} recording has black rounded corners (radius ${chrome[side].cornerRadius}px); masking them`);
  verdicts.forEach((v, i) => {
    const file = `diff-${i + 1}.mp4`;
    try {
      composeOne(output, v, i, L, brand, runDir, tmp, file, log, chrome);
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

function composeOne(output: RunOutput, v: Verdict, index: number, L: Layout, brand: Brand, runDir: string, tmp: string, file: string, log: (s: string) => void, chrome: Record<Side, Chrome>) {
  const steps = output.run.steps;
  const [a, b] = v.stepRange;
  const pair = runPair(output.run);
  const [sa, sb] = pair;
  for (const side of pair) {
    const video = videoOf(output, side);
    if (video.durationMs) continue;
    const probed = ffprobeSize(path.join(runDir, video.file));
    if (!probed.durationMs) throw new Error(`cannot determine the length of ${video.file}`);
    output.run.video[side] = { ...video, ...probed };
  }
  const duration = (side: Side) => videoOf(output, side).durationMs;
  // clamp to the recording: a flow can outlive the recording's time limit
  const clipStart = (side: Side) => Math.max(0, Math.min(sideOf(steps[a], side).startMs - LEAD_MS, duration(side) - 1500));
  const clipEnd = (side: Side) => Math.min(duration(side), Math.max(sideOf(steps[b], side).endMs, sideOf(steps[a], side).startMs) + TAIL_MS);
  for (const side of pair) if (sideOf(steps[b], side).endMs > duration(side)) log(`  warning: step ${b + 1} on ${side} lies beyond the end of the recording (raise recording.timeLimitSeconds)`);
  const lenMs = Math.max(clipEnd(sa) - clipStart(sa), clipEnd(sb) - clipStart(sb), 1500);
  const len = lenMs / 1000;
  // the screen corners: as round as the roundest recorded device, so black corner arcs are hidden
  const screenRadius = Math.max(
    22,
    ...pair.map((side) => (chrome[side].cornerRadius * panelOf(L, side).w) / (videoOf(output, side).width || 1)),
  );
  const frame = path.join(tmp, `frame-${index}.png`);
  fs.writeFileSync(frame, drawFrame(L, brand, output, screenRadius));
  const inputs: string[] = ["-ss", (clipStart(sa) / 1000).toFixed(3), "-t", len.toFixed(3), "-i", path.join(runDir, videoOf(output, sa).file), "-ss", (clipStart(sb) / 1000).toFixed(3), "-t", len.toFixed(3), "-i", path.join(runDir, videoOf(output, sb).file), "-loop", "1", "-framerate", "30", "-t", len.toFixed(3), "-i", frame];
  const overlays: Array<{ file: string; from: number; to: number }> = [];
  // captions: one per step in range, timed by the left side (both sides are within a few hundred ms)
  for (let s = a; s <= b; s++) {
    const st = steps[s];
    const from = Math.max(0, sideOf(st, sa).startMs - clipStart(sa)) / 1000;
    const next = steps[s + 1];
    const to = next && s < b ? Math.max(0, sideOf(next, sa).startMs - clipStart(sa)) / 1000 : len;
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
      const r = sideOf(st, side);
      if (r.startMs > 0 && r.status !== "skip") return r.startMs;
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
  // the camera hole is real device chrome and stays; only the black corner arcs are masked
  const clean = (_side: Side) => "";
  const fc: string[] = [
    // everything is composited in RGBA so the full-range (yuvj420p) recordings are not washed out
    `color=c=${GROUND}:s=${L.W}x${L.H}:r=30:d=${len.toFixed(3)},format=rgba[bg]`,
    `[0:v]${clean(sa)}format=rgba,scale=${panelOf(L, sa).w}:${panelOf(L, sa).h}:flags=lanczos,tpad=stop_mode=clone:stop_duration=${len.toFixed(3)},setpts=PTS-STARTPTS[left]`,
    `[1:v]${clean(sb)}format=rgba,scale=${panelOf(L, sb).w}:${panelOf(L, sb).h}:flags=lanczos,tpad=stop_mode=clone:stop_duration=${len.toFixed(3)},setpts=PTS-STARTPTS[right]`,
    `[bg][left]overlay=${panelOf(L, sa).x}:${panelOf(L, sa).y}:shortest=1[t0]`,
    `[t0][right]overlay=${panelOf(L, sb).x}:${panelOf(L, sb).y}[t1]`,
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
