/**
 * The web side's own Chrome DevTools Protocol plumbing. Argent drives the page (describe, tap, type,
 * screenshot) but cannot start a phone-sized browser, record a Chromium screen, or wipe site data, so
 * crossmatch does those three things itself over CDP:
 *  - starts Chrome on the configured debugging port (and tells Argent about the port) and emulates a
 *    phone-sized viewport (a Chrome window cannot be narrower than 500 px, so `--window-size` alone is not enough)
 *  - records the page with `Page.startScreencast` and encodes the frames into an mp4 with ffmpeg
 *  - clears cookies and storage for `--fresh`, the web equivalent of reinstalling an app
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ffmpegBin } from "./ffmpeg.js";
import type { WebConfig } from "./types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A CDP call that takes longer than this means a hung page; fail instead of blocking the run. */
const CDP_TIMEOUT_MS = 15_000;

interface CdpTarget { id: string; type: string; url: string; webSocketDebuggerUrl?: string }

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function cdpReachable(port: number): Promise<boolean> {
  try {
    await getJson(`http://127.0.0.1:${port}/json/version`);
    return true;
  } catch {
    return false;
  }
}

const BROWSER_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ],
  linux: ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
};

/** The Chrome executable: web.browser, then CROSSMATCH_CHROME, then the usual install locations. */
export function findBrowser(web: WebConfig): string | undefined {
  const explicit = web.browser ?? process.env.CROSSMATCH_CHROME;
  if (explicit) return !path.isAbsolute(explicit) || fs.existsSync(explicit) ? explicit : undefined;
  for (const c of BROWSER_PATHS[process.platform] ?? []) {
    if (path.isAbsolute(c)) {
      if (fs.existsSync(c)) return c;
    } else if (spawnSync("which", [c], { encoding: "utf8" }).status === 0) return c;
  }
  return undefined;
}

/**
 * Start Chrome with a phone-sized viewport and the debugging port open, detached so it outlives this
 * command (Argent and later crossmatch commands keep talking to it). The profile lives in `profileDir`
 * so the user's own browser profile is never touched.
 */
export async function launchBrowser(web: WebConfig, profileDir: string, log: (s: string) => void): Promise<void> {
  const bin = findBrowser(web);
  if (!bin) throw new Error(`No Chrome found for the web side${web.browser ?? process.env.CROSSMATCH_CHROME ? ` at ${web.browser ?? process.env.CROSSMATCH_CHROME}` : ""}. Install Google Chrome, or set web.browser in the config (or CROSSMATCH_CHROME) to a Chromium-based browser.`);
  fs.mkdirSync(profileDir, { recursive: true });
  const { width, height, deviceScaleFactor } = web.viewport;
  const args = [
    `--remote-debugging-port=${web.port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate",
    `--window-size=${width},${height}`,
    `--force-device-scale-factor=${deviceScaleFactor}`,
    ...(web.headless ? ["--headless=new", "--hide-scrollbars"] : [`--app=${web.url}`]),
    ...(web.userAgent ? [`--user-agent=${web.userAgent}`] : []),
    ...(web.headless ? [web.url] : []),
  ];
  log(`Starting ${path.basename(bin)} (${width}×${height}${web.headless ? ", headless" : ""}) on port ${web.port}…`);
  let spawnError: Error | undefined;
  const child = spawn(bin, args, { detached: true, stdio: "ignore" });
  child.on("error", (e) => (spawnError = e));
  child.unref();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (spawnError) throw new Error(`Could not start ${bin}: ${spawnError.message}`);
    if (await cdpReachable(web.port)) return;
    await sleep(250);
  }
  throw new Error(`Chrome did not open its debugging port ${web.port} within 20 s (is another Chrome still using ${profileDir}?)`);
}

/**
 * Argent always probes port 9222; other ports must be in the port file its tool-server reads on
 * every discovery (the one Argent itself writes when it boots an Electron app).
 */
export function registerPortWithArgent(port: number): void {
  if (port === 9222) return;
  const file = process.env.ARGENT_CHROMIUM_PORTS_FILE ?? path.join(os.homedir(), ".argent", "chromium-cdp-ports.json");
  try {
    let ports: number[] = [];
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(raw)) ports = raw.filter((p) => typeof p === "number");
    } catch {
      // no file yet
    }
    if (ports.includes(port)) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify([...ports, port]));
  } catch {
    // best effort: ARGENT_CHROMIUM_PORTS on the tool-server works too
  }
}

/** The page tab Argent drives: the first `page` target, opened on `url` when the browser has none. */
async function pageTarget(port: number, url: string): Promise<CdpTarget> {
  const pages = (await getJson<CdpTarget[]>(`http://127.0.0.1:${port}/json/list`)).filter((t) => t.type === "page" && !t.url.startsWith("devtools://"));
  if (pages[0]?.webSocketDebuggerUrl) return pages[0];
  const created = await getJson<CdpTarget>(`http://127.0.0.1:${port}/json/new?${encodeURI(url)}`, { method: "PUT" });
  if (!created.webSocketDebuggerUrl) throw new Error(`Chrome on port ${port} has no page to drive`);
  return created;
}

/** A single CDP connection to one page. */
export class CdpPage {
  private nextId = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private listeners = new Map<string, Array<(params: any) => void>>();

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`CDP ${msg.error.message}`));
        else p.resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
      }
    });
    ws.addEventListener("close", () => {
      for (const p of this.pending.values()) p.reject(new Error("CDP connection closed"));
      this.pending.clear();
    });
  }

  static async connect(web: WebConfig): Promise<CdpPage> {
    if (typeof WebSocket === "undefined") throw new Error(`The web side needs Node 22 or newer (found ${process.version}).`);
    const target = await pageTarget(web.port, web.url);
    const ws = new WebSocket(target.webSocketDebuggerUrl!);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out connecting to Chrome on port ${web.port}`)), CDP_TIMEOUT_MS);
        ws.addEventListener("open", () => (clearTimeout(timer), resolve()), { once: true });
        ws.addEventListener("error", () => (clearTimeout(timer), reject(new Error(`Could not connect to Chrome on port ${web.port}`))), { once: true });
      });
    } catch (e) {
      ws.close();
      throw e;
    }
    return new CdpPage(ws);
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${CDP_TIMEOUT_MS / 1000} s`));
      }, CDP_TIMEOUT_MS);
      const settle = <A>(fn: (a: A) => void) => (a: A) => (clearTimeout(timer), fn(a));
      this.pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method: string, fn: (params: any) => void): void {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), fn]);
  }

  close(): void {
    this.ws.close();
  }
}

/** Emulate the configured phone viewport on the page. Every client of the page, Argent included, sees it. */
export async function applyViewport(web: WebConfig, page?: CdpPage): Promise<void> {
  const own = page ?? (await CdpPage.connect(web));
  try {
    const { width, height, deviceScaleFactor } = web.viewport;
    await own.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor, mobile: true });
  } finally {
    if (!page) own.close();
  }
}

/**
 * Wipe cookies, storage, caches and service workers for the web app's origin only: a fresh install.
 * The page is unloaded first, so an app that saves its state on unload cannot write it back.
 */
export async function clearSiteData(web: WebConfig, url = web.url): Promise<void> {
  const page = await CdpPage.connect(web);
  try {
    await page.send("Page.navigate", { url: "about:blank" });
    // Page.navigate returns before the old page has unloaded: wait for the blank page, then let the
    // old page's last storage writes (pagehide handlers) land before they are cleared
    for (let i = 0; i < 40; i++) {
      const { result } = await page.send<{ result: { value?: string } }>("Runtime.evaluate", { expression: "location.href", returnByValue: true });
      if (result.value === "about:blank") break;
      await sleep(50);
    }
    await sleep(300);
    const origin = new URL(url).origin;
    if (origin !== "null") await page.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
    else {
      // an opaque origin: only the page itself can reach its storage
      await page.send("Page.navigate", { url });
      await page.send("Runtime.evaluate", { expression: "try { localStorage.clear(); sessionStorage.clear(); } catch {}" });
      await page.send("Page.navigate", { url: "about:blank" });
    }
  } finally {
    page.close();
  }
}

/** Browser back, the web counterpart of the system back button. */
export async function historyBack(web: WebConfig): Promise<void> {
  const page = await CdpPage.connect(web);
  try {
    const { currentIndex, entries } = await page.send<{ currentIndex: number; entries: Array<{ id: number }> }>("Page.getNavigationHistory");
    if (currentIndex > 0) await page.send("Page.navigateToHistoryEntry", { entryId: entries[currentIndex - 1].id });
  } finally {
    page.close();
  }
}

/**
 * Records the page from CDP screencast frames. Chrome only sends a frame when the page repaints, so
 * every frame is held until the next one arrives; the video runs from `start()` to `stop()`.
 */
export class ScreencastRecorder {
  private page?: CdpPage;
  private frames: Array<{ file: string; at: number }> = [];
  private startedAt = 0;
  private seq = 0;

  constructor(private readonly web: WebConfig, private readonly framesDir: string) {}

  async start(): Promise<void> {
    fs.rmSync(this.framesDir, { recursive: true, force: true });
    fs.mkdirSync(this.framesDir, { recursive: true });
    const page = await CdpPage.connect(this.web);
    try {
      await page.send("Page.enable");
      // a still page sends no screencast frame, so the first frame is a screenshot taken at the start
      this.startedAt = Date.now();
      const first = await page.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 85 });
      this.save(first.data, this.startedAt);
      page.on("Page.screencastFrame", (p: { data: string; sessionId: number }) => {
        if (this.page !== page) return; // arrived after stop()
        this.save(p.data, Date.now());
        page.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
      });
      const { width, height } = this.size();
      this.page = page;
      await page.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: width, maxHeight: height, everyNthFrame: 2 });
    } catch (e) {
      // never leave the connection open: it would keep the process alive
      this.page = undefined;
      page.close();
      throw e;
    }
  }

  /** The video size in pixels: the configured viewport at its scale factor, rounded to even numbers. */
  private size(): { width: number; height: number } {
    const { width, height, deviceScaleFactor } = this.web.viewport;
    const even = (n: number) => Math.round((n * deviceScaleFactor) / 2) * 2;
    return { width: even(width), height: even(height) };
  }

  /** Stop without producing a video (a failed run). */
  abort(): void {
    const page = this.page;
    this.page = undefined;
    page?.close();
    if (!process.env.CROSSMATCH_KEEP_TMP) fs.rmSync(this.framesDir, { recursive: true, force: true });
  }

  private save(base64: string, at: number): void {
    const file = path.join(this.framesDir, `frame-${String(++this.seq).padStart(6, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(base64, "base64"));
    this.frames.push({ file, at });
  }

  /** Stop and encode the mp4. Returns the video length in milliseconds. */
  async stop(dest: string): Promise<number> {
    const page = this.page;
    if (!page) throw new Error("screencast was not started");
    this.page = undefined;
    const stoppedAt = Date.now();
    try {
      await page.send("Page.stopScreencast");
    } catch {
      // the page may be gone; encode what arrived
    }
    page.close();
    const frames = this.frames.filter((f) => f.at <= stoppedAt);
    const lines: string[] = [];
    frames.forEach((f, i) => {
      const from = f.at;
      const to = i + 1 < frames.length ? frames[i + 1].at : stoppedAt;
      lines.push(`file '${f.file.replace(/'/g, "'\\''")}'`, `duration ${(Math.max(1, to - from) / 1000).toFixed(3)}`);
    });
    const list = path.join(this.framesDir, "frames.txt");
    fs.writeFileSync(list, lines.join("\n") + "\n");
    // the concat demuxer drops the last entry's duration: hold the last frame, then cut at the stop time
    const total = ((stoppedAt - this.startedAt) / 1000).toFixed(3);
    // every frame is scaled to one size: a browser whose real viewport differs yields mixed frame sizes
    const { width, height } = this.size();
    const vf = `fps=30,scale=${width}:${height},tpad=stop_mode=clone:stop_duration=${total},format=yuv420p`;
    const res = spawnSync(ffmpegBin(), ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", vf, "-t", total, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", dest], { encoding: "utf8" });
    if (!process.env.CROSSMATCH_KEEP_TMP) fs.rmSync(this.framesDir, { recursive: true, force: true });
    if (res.status !== 0) throw new Error(`ffmpeg could not encode the web recording: ${res.stderr.slice(-500)}`);
    return stoppedAt - this.startedAt;
  }
}
