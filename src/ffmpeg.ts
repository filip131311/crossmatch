import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CANDIDATE_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
let ffmpegPath: string | undefined;

function hasX264(bin: string): boolean {
  const res = spawnSync(bin, ["-hide_banner", "-encoders"], { encoding: "utf8" });
  return res.status === 0 && /libx264/.test(res.stdout);
}

/** ffmpeg with libx264: NATIVELY_FFMPEG, then PATH, then the usual install dirs. */
export function ffmpegBin(): string {
  if (ffmpegPath) return ffmpegPath;
  const candidates = [process.env.NATIVELY_FFMPEG, "ffmpeg", ...CANDIDATE_DIRS.map((d) => path.join(d, "ffmpeg"))].filter((c): c is string => !!c);
  for (const c of candidates) {
    if (c !== "ffmpeg" && !fs.existsSync(c)) continue;
    if (hasX264(c)) return (ffmpegPath = c);
  }
  throw new Error("No ffmpeg with libx264 found. Install it (macOS: `brew install ffmpeg`) or set NATIVELY_FFMPEG.");
}

export function ffprobeBin(): string {
  const ff = ffmpegBin();
  const probe = ff === "ffmpeg" ? "ffprobe" : path.join(path.dirname(ff), "ffprobe");
  return probe;
}
