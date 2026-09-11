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

export interface InitOptions { argent: boolean; force: boolean; scan: boolean; log: (s: string) => void }

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function projectRoot(start: string): { root: string; git: boolean } {
  const git = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: start, encoding: "utf8" });
  return git.status === 0 && git.stdout.trim() ? { root: git.stdout.trim(), git: true } : { root: start, git: false };
}

/**
 * Walk a few levels for built apps, skipping dependency and VCS folders. Bounded: at most `maxDepth`
 * levels, `maxDirs` directories and `budgetMs` milliseconds, so a scan of a huge tree stops quickly
 * instead of hanging.
 */
function findFiles(root: string, match: (name: string, full: string) => boolean, maxDepth = 8, maxDirs = 20000, budgetMs = 5000): string[] {
  const out: string[] = [];
  const skip = new Set(["node_modules", ".git", "Pods", ".gradle", "DerivedData", ".idea", "crossmatch-out", "Library", "Applications", ".Trash", ".cache", ".npm", ".nvm", ".pnpm-store", "vendor", "target", "__pycache__", ".venv", "venv"]);
  const started = Date.now();
  let dirs = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth || ++dirs > maxDirs || Date.now() - started > budgetMs) return;
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
  const { root, git } = projectRoot(cwd);
  const { log } = opts;
  const home = process.env.HOME ?? "";
  const done: string[] = [];
  const todo: string[] = [];
  const step = (n: number, what: string) => log(`\n[${n}/4] ${what}`);
  const ok = (what: string) => {
    done.push(what);
    log(`  ✓ ${what}`);
  };
  const later = (what: string) => {
    todo.push(what);
    log(`  · ${what}`);
  };

  log(`crossmatch init in ${root}`);
  if (root === home) log("  (this is your home directory; run init inside the project you want to compare, or keep going to set up here)");
  else if (!git) log("  (not a git repository: using the current directory as the project root)");

  // 1. config
  step(1, `config file ${CONFIG_FILE}`);
  const configPath = path.join(root, CONFIG_FILE);
  if (fs.existsSync(configPath) && !opts.force) {
    ok(`${CONFIG_FILE} already exists (kept; --force overwrites)`);
  } else {
    let found: ReturnType<typeof detectApps> = {};
    if (!opts.scan) log("  app scan skipped (--no-scan); fill in the app paths later");
    else if (root === home) log("  app scan skipped in the home directory; fill in the app paths later");
    else {
      log("  looking for built apps (.app bundles and .apk files) under the project (a few seconds at most)…");
      found = detectApps(root);
      log(`  iOS app: ${found.ios ? found.ios.app : "none found"}${found.ios?.bundleId ? ` (${found.ios.bundleId})` : ""}`);
      log(`  Android app: ${found.android ? found.android.app : "none found"}${found.android?.bundleId ? ` (${found.android.bundleId})` : ""}`);
    }
    const config: CrossmatchConfig = {
      ...DEFAULT_CONFIG,
      ios: { app: found.ios?.app ?? DEFAULT_CONFIG.ios.app, bundleId: found.ios?.bundleId ?? DEFAULT_CONFIG.ios.bundleId },
      android: { app: found.android?.app ?? DEFAULT_CONFIG.android.app, bundleId: found.android?.bundleId ?? DEFAULT_CONFIG.android.bundleId },
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    ok(`${CONFIG_FILE} written`);
    if (!found.ios) later(`when you have a simulator build, set ios.app (the .app) and ios.bundleId in ${CONFIG_FILE}`);
    else if (!found.ios.bundleId) later(`set ios.bundleId in ${CONFIG_FILE}`);
    if (!found.android) later(`when you have an Android build, set android.app (the .apk) and android.bundleId in ${CONFIG_FILE}`);
    else if (!found.android.bundleId) later(`set android.bundleId in ${CONFIG_FILE}`);
  }

  // 2. skill
  step(2, "agent skill");
  const skillSrc = path.join(PKG_ROOT, "skills", "crossmatch");
  const skillDest = path.join(root, ".claude", "skills", "crossmatch");
  if (fs.existsSync(skillSrc)) {
    copyDir(skillSrc, skillDest);
    ok(`skill installed at ${path.relative(root, skillDest)}`);
  } else {
    later(`skill not found in the package at ${skillSrc}`);
  }

  // 3. .gitignore
  step(3, ".gitignore");
  const gi = path.join(root, ".gitignore");
  const ignoreLine = `${DEFAULT_CONFIG.out}/`;
  const current = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  if (!current.split("\n").some((l) => l.trim() === ignoreLine || l.trim() === DEFAULT_CONFIG.out)) {
    fs.writeFileSync(gi, `${current}${current && !current.endsWith("\n") ? "\n" : ""}${ignoreLine}\n`);
    ok(`${ignoreLine} added to .gitignore`);
  } else {
    ok(`${ignoreLine} already in .gitignore`);
  }

  // 4. argent
  step(4, "Argent");
  if (!opts.argent) {
    log("  skipped (--no-argent)");
  } else if (hasArgent()) {
    log("  argent is installed; running `argent init -y` to wire its MCP server and skills into the editor…");
    const res = spawnSync("argent", ["init", "-y"], { cwd: root, stdio: "inherit" });
    if (res.status === 0) ok("argent init ran (MCP server + Argent skills wired into the editor)");
    else later("argent init reported an error (see above); run `argent init -y` again after fixing it");
  } else {
    log("  argent is not installed; running `npx -y @swmansion/argent@latest init -y` (downloads Argent, can take a minute)…");
    const res = spawnSync("npx", ["-y", "@swmansion/argent@latest", "init", "-y"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
    if (res.status === 0) ok("Argent installed and wired into the editor");
    else later("install Argent: npm i -g @swmansion/argent@latest && argent init -y");
  }

  log("\nSummary");
  for (const d of done) log(`  ✓ ${d}`);
  for (const t of todo) log(`  · ${t}`);
  log(`\nNext: \`crossmatch doctor\` (checks the toolchain; the apps can come later), then \`crossmatch setup\` once both builds are in ${CONFIG_FILE}, then ask your agent to explore both apps with the crossmatch skill and run \`crossmatch compare\`.`);
}
