/**
 * `crossmatch init`: one command that makes a project ready for an agent to explore.
 *  1. crossmatch.config.json (pre-filled with any .app / .apk it can find and their bundle ids)
 *  2. the exploration skill copied into <project>/.claude/skills/crossmatch
 *  3. Argent installed and wired into the editor (`argent init`), unless --no-argent
 *  4. crossmatch-out/ added to .gitignore
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE, DEFAULT_CONFIG } from "./config.js";
import type { CrossmatchConfig } from "./types.js";

export interface InitOptions { argent: boolean; force: boolean; log: (s: string) => void }

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function projectRoot(start: string): string {
  const git = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: start, encoding: "utf8" });
  return git.status === 0 && git.stdout.trim() ? git.stdout.trim() : start;
}

/** Walk a few levels for built apps, skipping dependency and VCS folders. */
function findFiles(root: string, match: (name: string, full: string) => boolean, maxDepth = 10): string[] {
  const out: string[] = [];
  const skip = new Set(["node_modules", ".git", "Pods", ".gradle", "DerivedData", ".idea", "crossmatch-out"]);
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (match(e.name, full)) {
        out.push(full);
        continue;
      }
      if (e.isDirectory()) walk(full, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

function iosBundleId(app: string): string | undefined {
  const plist = path.join(app, "Info.plist");
  if (!fs.existsSync(plist)) return undefined;
  const res = spawnSync("plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", plist], { encoding: "utf8" });
  return res.status === 0 ? res.stdout.trim() || undefined : undefined;
}

function androidPackage(apk: string): string | undefined {
  // aapt (build-tools) when available; otherwise the applicationId from a nearby build.gradle
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(process.env.HOME ?? "", "Library/Android/sdk");
  const tools = path.join(sdk, "build-tools");
  if (fs.existsSync(tools)) {
    for (const v of fs.readdirSync(tools).sort().reverse()) {
      const aapt = path.join(tools, v, "aapt");
      if (!fs.existsSync(aapt)) continue;
      const res = spawnSync(aapt, ["dump", "badging", apk], { encoding: "utf8" });
      const m = /package: name='([^']+)'/.exec(res.stdout ?? "");
      if (m) return m[1];
      break;
    }
  }
  let dir = path.dirname(apk);
  for (let i = 0; i < 6; i++) {
    for (const f of ["build.gradle.kts", "build.gradle"]) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) {
        const m = /applicationId\s*[=(]?\s*["']([^"']+)["']/.exec(fs.readFileSync(p, "utf8"));
        if (m) return m[1];
      }
    }
    dir = path.dirname(dir);
  }
  return undefined;
}

export function detectApps(root: string): { ios?: { app: string; bundleId?: string }; android?: { app: string; bundleId?: string } } {
  const apps = findFiles(root, (n, f) => n.endsWith(".app") && /iphonesimulator/.test(f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const apks = findFiles(root, (n) => n.endsWith(".apk") && !/unaligned|test/.test(n)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return {
    ios: apps[0] ? { app: path.relative(root, apps[0]), bundleId: iosBundleId(apps[0]) } : undefined,
    android: apks[0] ? { app: path.relative(root, apks[0]), bundleId: androidPackage(apks[0]) } : undefined,
  };
}

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function hasArgent(): boolean {
  return spawnSync(process.platform === "win32" ? "where" : "which", ["argent"], { encoding: "utf8" }).status === 0;
}

export async function runInit(cwd: string, opts: InitOptions): Promise<void> {
  const root = projectRoot(cwd);
  const { log } = opts;
  const done: string[] = [];
  const todo: string[] = [];

  // 1. config
  const configPath = path.join(root, CONFIG_FILE);
  if (fs.existsSync(configPath) && !opts.force) {
    done.push(`${CONFIG_FILE} already exists (kept; --force overwrites)`);
  } else {
    const found = detectApps(root);
    const config: CrossmatchConfig = {
      ...DEFAULT_CONFIG,
      ios: { app: found.ios?.app ?? DEFAULT_CONFIG.ios.app, bundleId: found.ios?.bundleId ?? DEFAULT_CONFIG.ios.bundleId },
      android: { app: found.android?.app ?? DEFAULT_CONFIG.android.app, bundleId: found.android?.bundleId ?? DEFAULT_CONFIG.android.bundleId },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    done.push(`${CONFIG_FILE} written${found.ios ? ` · iOS app: ${found.ios.app}` : ""}${found.android ? ` · Android app: ${found.android.app}` : ""}`);
    if (!found.ios) todo.push(`set ios.app (a simulator .app build) and ios.bundleId in ${CONFIG_FILE}`);
    else if (!found.ios.bundleId) todo.push(`set ios.bundleId in ${CONFIG_FILE}`);
    if (!found.android) todo.push(`set android.app (an .apk) and android.bundleId in ${CONFIG_FILE}`);
    else if (!found.android.bundleId) todo.push(`set android.bundleId in ${CONFIG_FILE}`);
  }

  // 2. skill
  const skillSrc = path.join(PKG_ROOT, "skills", "crossmatch");
  const skillDest = path.join(root, ".claude", "skills", "crossmatch");
  if (fs.existsSync(skillSrc)) {
    copyDir(skillSrc, skillDest);
    done.push(`skill installed at ${path.relative(root, skillDest)}`);
  } else {
    todo.push(`skill not found in the package at ${skillSrc}`);
  }

  // 3. .gitignore
  const gi = path.join(root, ".gitignore");
  const ignoreLine = `${DEFAULT_CONFIG.out}/`;
  const current = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  if (!current.split("\n").some((l) => l.trim() === ignoreLine || l.trim() === DEFAULT_CONFIG.out)) {
    fs.writeFileSync(gi, `${current}${current && !current.endsWith("\n") ? "\n" : ""}${ignoreLine}\n`);
    done.push(`${ignoreLine} added to .gitignore`);
  }

  // 4. argent
  if (opts.argent) {
    if (hasArgent()) {
      const res = spawnSync("argent", ["init", "-y"], { cwd: root, stdio: "inherit" });
      done.push(res.status === 0 ? "argent init ran (MCP server + Argent skills wired into the editor)" : "argent init reported an error (see above)");
    } else {
      log("Argent is not installed; installing it with npx @swmansion/argent@latest init -y …");
      const res = spawnSync("npx", ["-y", "@swmansion/argent@latest", "init", "-y"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
      if (res.status === 0) done.push("Argent installed and wired into the editor");
      else todo.push("install Argent: npm i -g @swmansion/argent@latest && argent init -y");
    }
  }

  log("");
  for (const d of done) log(`✓ ${d}`);
  for (const t of todo) log(`· ${t}`);
  log(`\nNext: \`crossmatch doctor\`, then \`crossmatch setup\`, then ask your agent to explore both apps with the crossmatch skill and run \`crossmatch compare\`.`);
}
