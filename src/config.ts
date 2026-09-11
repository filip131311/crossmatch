import fs from "node:fs";
import path from "node:path";
import type { CrossmatchConfig } from "./types.js";

export const CONFIG_FILE = "crossmatch.config.json";

export const DEFAULT_CONFIG: CrossmatchConfig = {
  ios: { app: "path/to/App.app", bundleId: "com.example.app" },
  android: { app: "path/to/app-debug.apk", bundleId: "com.example.app" },
  out: "crossmatch-out",
  flows: "flows",
  limits: { maxScreens: 500, maxFlows: 200, maxSteps: 20000, maxMinutes: 720 },
  brand: { name: "crossmatch", accent: "#6C4CF1", ink: "#14121F", paper: "#FFFFFF" },
  recording: { showTouches: true, timeLimitSeconds: 300 },
  judgeRules: [],
};

export interface LoadedConfig {
  config: CrossmatchConfig;
  /** Directory of the config file; every relative path resolves against it. */
  root: string;
  file: string;
}

export function findConfig(start = process.cwd()): string | undefined {
  let dir = path.resolve(start);
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILE);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function loadConfig(explicit?: string): LoadedConfig {
  const file = explicit ? path.resolve(explicit) : findConfig();
  if (!file) throw new Error(`No ${CONFIG_FILE} found. Run \`crossmatch init\` first.`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<CrossmatchConfig>;
  const config: CrossmatchConfig = {
    ...DEFAULT_CONFIG,
    ...raw,
    ios: { ...DEFAULT_CONFIG.ios, ...raw.ios },
    android: { ...DEFAULT_CONFIG.android, ...raw.android },
    limits: { ...DEFAULT_CONFIG.limits, ...raw.limits },
    brand: { ...DEFAULT_CONFIG.brand, ...raw.brand },
    recording: { ...DEFAULT_CONFIG.recording, ...raw.recording },
    judgeRules: raw.judgeRules ?? [],
  };
  for (const k of ["accent", "ink", "paper"] as const) {
    if (!/^#[0-9a-f]{6}$/i.test(config.brand[k])) throw new Error(`${file}: brand.${k} must be a 6-digit hex colour like #6C4CF1 (got "${config.brand[k]}")`);
  }
  return { config, root: path.dirname(file), file };
}

export function resolveFrom(root: string, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(root, p);
}

export function outDir(loaded: LoadedConfig): string {
  const dir = resolveFrom(loaded.root, loaded.config.out);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function flowsDir(loaded: LoadedConfig): string {
  const dir = resolveFrom(loaded.root, loaded.config.flows);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeDefaultConfig(dir: string): string {
  const file = path.join(dir, CONFIG_FILE);
  if (fs.existsSync(file)) throw new Error(`${file} already exists`);
  fs.writeFileSync(file, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
  return file;
}
