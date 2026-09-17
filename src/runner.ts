/**
 * Executes flow directives on ONE device through Argent. Selector resolution uses the parsed
 * `describe` tree (the same tree the exploring agent saw), so a flow authored from `crossmatch describe`
 * output resolves identically here.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ArgentClient, ArgentArtifact } from "./argent.js";
import { ScreencastRecorder, clearSiteData, historyBack } from "./cdp.js";
import { centre, parseDescribe, resolveSelector, selectorMatches, describeSelector } from "./describe.js";
import type { Device } from "./devices.js";
import type { Condition, Directive, FlowStep, Selector, Side, StepSideResult, UiNode, UiTree, WebConfig } from "./types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class StepFailure extends Error {}

export interface SideSessionOptions {
  /** The app's bundle id / applicationId; unused on web. */
  bundleId: string;
  /** Required on the web side: the page to open and the browser crossmatch records. */
  web?: WebConfig;
  runDir: string;
  showTouches: boolean;
  timeLimitSeconds: number;
  log: (s: string) => void;
}

export class SideSession {
  readonly side: Side;
  private recordingStart = 0;
  private recording = false;
  private failed = false;
  private screencast?: ScreencastRecorder;
  constructor(readonly client: ArgentClient, readonly device: Device, readonly opts: SideSessionOptions) {
    this.side = device.platform;
  }

  get hasFailed() {
    return this.failed;
  }

  private call<T = any>(tool: string, args: Record<string, unknown>): Promise<T> {
    return this.client.call<T>(tool, { udid: this.device.id, ...args });
  }

  async describe(): Promise<UiTree> {
    const res = await this.call<{ description: string; source: string }>("describe", {});
    return parseDescribe(res.description);
  }

  /**
   * Argent's Android helper (`com.argent.androiddevtools`) sometimes keeps serving a stale
   * accessibility tree after a Compose screen change (the UiAutomation node cache is not
   * invalidated). Stopping the helper makes Argent relaunch it with a fresh cache on the next
   * describe; the app under test is not affected. No-op on iOS.
   */
  async refreshTreeSource(): Promise<boolean> {
    if (this.side !== "android") return false;
    spawnSync("adb", ["-s", this.device.id, "shell", "am", "force-stop", "com.argent.androiddevtools"], { stdio: "ignore" });
    this.opts.log(`[android] restarted Argent's tree helper (stale tree suspected)`);
    await sleep(600);
    return true;
  }

  /** Describe, and if the tree is identical to `previous`, refresh the source once and describe again. */
  async describeFresh(previous?: UiTree): Promise<UiTree> {
    const tree = await this.describe();
    if (this.side !== "android" || !previous || tree.raw !== previous.raw) return tree;
    if (!(await this.refreshTreeSource())) return tree;
    return this.describe();
  }

  async screenshot(file: string, scale = 0.5): Promise<string> {
    // Argent only downscales Chromium screenshots with the optional `sharp` package installed
    const res = await this.call<{ image: ArgentArtifact }>("screenshot", { ...(this.side === "web" ? {} : { scale }), includeImageInContext: false });
    const dest = path.join(this.opts.runDir, file);
    await this.client.saveArtifact(res.image, dest);
    return file;
  }

  private get web(): WebConfig {
    if (!this.opts.web) throw new Error("the web side needs the web config");
    return this.opts.web;
  }

  async startRecording(): Promise<void> {
    if (this.side === "web") {
      // Argent cannot record Chromium: crossmatch records the page itself
      const screencast = new ScreencastRecorder(this.web, path.join(this.opts.runDir, ".web-frames"));
      await screencast.start(); // closes its own connection when it fails
      this.screencast = screencast;
      this.recordingStart = Date.now();
      this.recording = true;
      return;
    }
    await this.call("screen-recording-start", {
      trimStatic: false,
      showTouches: this.opts.showTouches,
      timeLimitSeconds: this.opts.timeLimitSeconds,
    });
    this.recordingStart = Date.now();
    this.recording = true;
  }

  private stopWallClock = 0;

  /**
   * Milliseconds to add to this side's step times so they sit on the video timeline: the video
   * runs from (stop time - duration) whereas step times were measured from when the start call returned.
   */
  /** True when the video is clearly shorter than the time recorded (the time limit cut it). */
  truncated(durationMs: number): boolean {
    if (!this.recordingStart || !this.stopWallClock || !durationMs) return false;
    return this.stopWallClock - this.recordingStart - durationMs > 1500;
  }

  timelineOffset(durationMs: number): number {
    if (!this.recordingStart || !this.stopWallClock || !durationMs || this.truncated(durationMs)) return 0;
    const videoStart = this.stopWallClock - durationMs;
    const delta = this.recordingStart - videoStart;
    // ignore implausible values (a trimmed or truncated video)
    return Math.abs(delta) < 5000 ? Math.round(delta) : 0;
  }

  async stopRecording(): Promise<{ file: string; durationMs: number } | undefined> {
    if (!this.recording) return undefined;
    this.recording = false;
    this.stopWallClock = Date.now();
    const screencast = this.screencast;
    this.screencast = undefined;
    if (screencast) {
      const durationMs = await screencast.stop(path.join(this.opts.runDir, `${this.side}.mp4`));
      return { file: `${this.side}.mp4`, durationMs };
    }
    const res = await this.call<{ video: string | ArgentArtifact; durationMs: number }>("screen-recording-stop", {});
    const dest = path.join(this.opts.runDir, `${this.side}.mp4`);
    if (typeof res.video === "string") fs.copyFileSync(res.video, dest);
    else await this.client.saveArtifact(res.video, dest);
    return { file: `${this.side}.mp4`, durationMs: res.durationMs };
  }

  /** Milliseconds since this side's recording started (0 when not recording). */
  now(): number {
    return this.recordingStart ? Date.now() - this.recordingStart : 0;
  }

  async settle(timeoutMs = 2500): Promise<void> {
    try {
      await this.call("await-screen-idle", { timeoutMs, minStableMs: 300 });
    } catch {
      // an unreadable tree is not fatal here
    }
  }

  /** Start from an empty state: reinstall the app, or on web wipe the site's cookies and storage. */
  async reinstall(appPath: string): Promise<void> {
    if (this.side === "web") return clearSiteData(this.web);
    await this.call("reinstall-app", { bundleId: this.opts.bundleId, appPath });
  }

  private async waitFor(sel: Selector, timeoutMs: number): Promise<{ node?: UiNode; tree: UiTree }> {
    const deadline = Date.now() + timeoutMs;
    const started = Date.now();
    let refreshed = false;
    let tree = await this.describe();
    for (;;) {
      const node = resolveSelector(tree, sel);
      if (node) return { node, tree };
      if (Date.now() >= deadline) return { tree };
      await sleep(350);
      const next = await this.describe();
      if (!refreshed && this.side === "android" && next.raw === tree.raw && Date.now() - started > 1200) {
        refreshed = true;
        await this.refreshTreeSource();
        tree = await this.describe();
        continue;
      }
      tree = next;
    }
  }

  private async tapNode(node: UiNode, times?: number): Promise<void> {
    const c = centre(node.frame);
    // A toggle exposed as a whole row (iOS Toggle in a List) only reacts on the control itself,
    // which sits at the trailing edge; tapping the label does nothing.
    if ((node.role === "switch" || node.role === "checkbox") && node.frame.width > 0.6) c.x = node.frame.x + node.frame.width - Math.min(0.08, node.frame.width / 4);
    await this.call("gesture-tap", { x: c.x, y: c.y, ...(times && times > 1 ? { clickCount: times } : {}) });
  }

  private async swipe(direction: "up" | "down" | "left" | "right", from?: { x: number; y: number }, opts: { momentum?: boolean; durationMs?: number; distance?: number } = {}): Promise<void> {
    const start = from ?? { x: 0.5, y: 0.5 };
    const d = opts.distance ?? 0.35;
    const delta = { up: [0, -d], down: [0, d], left: [-d, 0], right: [d, 0] }[direction];
    const clamp = (v: number) => Math.min(0.95, Math.max(0.05, v));
    if (this.side === "web" && !from) {
      // a page scrolls with the wheel, not a drag; the finger's travel is the opposite of the scroll
      await this.call("gesture-scroll", { x: start.x, y: start.y, deltaX: -delta[0], deltaY: -delta[1], durationMs: opts.durationMs ?? 300 });
      return;
    }
    await this.call(this.side === "web" ? "gesture-drag" : "gesture-swipe", {
      fromX: start.x,
      fromY: start.y,
      toX: clamp(start.x + delta[0]),
      toY: clamp(start.y + delta[1]),
      durationMs: opts.durationMs ?? 300,
      ...(opts.momentum === undefined ? {} : { momentum: opts.momentum }),
    });
  }

  private async checkCondition(c: Condition, timeoutMs: number): Promise<{ ok: boolean; reason?: string; node?: UiNode }> {
    if (c.type === "idle") {
      await this.settle(timeoutMs);
      return { ok: true };
    }
    const deadline = Date.now() + timeoutMs;
    const started = Date.now();
    let last = "";
    let prevRaw: string | undefined;
    let refreshed = false;
    for (;;) {
      let tree = await this.describe();
      if (!refreshed && this.side === "android" && prevRaw === tree.raw && Date.now() - started > 1200) {
        refreshed = true;
        await this.refreshTreeSource();
        tree = await this.describe();
      }
      prevRaw = tree.raw;
      const matches = tree.nodes.filter((n) => selectorMatches(n, c.selector));
      const visible = matches.filter((n) => n.frame.width > 0 && n.frame.height > 0);
      switch (c.type) {
        case "exists":
          if (matches.length) return { ok: true, node: matches[0] };
          last = `no element matches ${describeSelector(c.selector)}`;
          break;
        case "visible":
          if (visible.length) return { ok: true, node: visible[0] };
          last = `no visible element matches ${describeSelector(c.selector)}`;
          break;
        case "hidden":
          if (!visible.length) return { ok: true };
          last = `${describeSelector(c.selector)} is still visible ("${visible[0].text}")`;
          break;
        case "text": {
          const first = resolveSelector(tree, c.selector) ?? visible[0] ?? matches[0];
          const holds = first && (c.match === "equals" ? first.text.toLowerCase() === c.expected.toLowerCase() : c.match === "matches" ? new RegExp(c.expected).test(first.text) : first.text.toLowerCase().includes(c.expected.toLowerCase()));
          if (holds) return { ok: true, node: first };
          last = first ? `${describeSelector(c.selector)} reads "${first.text}", expected "${c.expected}"` : `no element matches ${describeSelector(c.selector)}`;
          break;
        }
      }
      if (Date.now() >= deadline) return { ok: false, reason: last };
      await sleep(350);
    }
  }

  /** Run one directive. Never throws; failures are reported in the result. */
  async execute(step: FlowStep): Promise<StepSideResult> {
    const startMs = this.now();
    if (this.failed) return { status: "skip", reason: "an earlier step failed on this side", startMs, endMs: this.now() };
    try {
      const target = await this.run(step.directive);
      return { status: "pass", startMs, endMs: this.now(), target };
    } catch (e) {
      this.failed = true;
      const reason = e instanceof Error ? e.message : String(e);
      this.opts.log(`[${this.side}] step ${step.index + 1} failed: ${reason}`);
      return { status: e instanceof StepFailure ? "fail" : "error", reason, startMs, endMs: this.now() };
    }
  }

  private async run(d: Directive): Promise<UiNode | undefined> {
    switch (d.kind) {
      case "launch": {
        if (this.side === "web") {
          // a full navigation drops the page's in-memory state, like restarting an app
          const url = d.perPlatform?.web ?? (d.bundleId && /^(https?|file):/.test(d.bundleId) ? d.bundleId : this.web.url);
          // through about:blank, so a URL that differs only after "#" still reloads the page
          await this.call("open-url", { url: "about:blank" });
          await this.call("open-url", { url });
          await this.settle(6000);
          return undefined;
        }
        const id = d.bundleId ?? d.perPlatform?.[this.side] ?? this.opts.bundleId;
        await this.call("restart-app", { bundleId: id });
        await this.settle(6000);
        return undefined;
      }
      case "tap": {
        if (d.selector) {
          const { node } = await this.waitFor(d.selector, 4000);
          if (!node) throw new StepFailure(`tap: no element matches ${describeSelector(d.selector)}`);
          await this.tapNode(node, d.times);
          return node;
        }
        await this.call("gesture-tap", { x: d.x, y: d.y, ...(d.times && d.times > 1 ? { clickCount: d.times } : {}) });
        return undefined;
      }
      case "long-press": {
        const { node } = await this.waitFor(d.selector, 4000);
        if (!node) throw new StepFailure(`long-press: no element matches ${describeSelector(d.selector)}`);
        const c = centre(node.frame);
        if (this.side === "web") {
          await this.call("gesture-drag", { fromX: c.x, fromY: c.y, toX: c.x, toY: c.y, durationMs: d.duration ?? 800 });
          return node;
        }
        await this.call("gesture-custom", {
          events: [
            { type: "Down", x: c.x, y: c.y },
            { type: "Up", x: c.x, y: c.y, delayMs: d.duration ?? 800 },
          ],
        });
        return node;
      }
      case "swipe": {
        let from: { x: number; y: number } | undefined;
        let node: UiNode | undefined;
        if (d.from) {
          node = (await this.waitFor(d.from, 4000)).node;
          if (!node) throw new StepFailure(`swipe: no element matches ${describeSelector(d.from)}`);
          from = centre(node.frame);
        }
        await this.swipe(d.direction, from, { durationMs: d.duration });
        return node;
      }
      case "type": {
        const { node } = await this.waitFor(d.into, 4000);
        if (!node) throw new StepFailure(`type: no element matches ${describeSelector(d.into)}`);
        await this.tapNode(node);
        await sleep(400);
        await this.call("keyboard", { text: d.text });
        if (d.submit !== false) await this.call("keyboard", { key: "enter" });
        return node;
      }
      case "scroll-to": {
        const max = d.maxSwipes ?? 8;
        const dir = d.direction ?? "down";
        const finger = { down: "up", up: "down", left: "right", right: "left" }[dir] as "up" | "down" | "left" | "right";
        for (let i = 0; i <= max; i++) {
          const tree = await this.describe();
          const node = resolveSelector(tree, d.target);
          if (node) return node;
          if (i === max) break;
          await this.swipe(finger, undefined, { momentum: false, durationMs: 400, distance: 0.3 });
          await this.settle(1500);
        }
        throw new StepFailure(`scroll-to: ${describeSelector(d.target)} not found after ${max} swipes`);
      }
      case "await": {
        const res = await this.checkCondition(d.condition, d.timeout ?? 7500);
        if (!res.ok) throw new StepFailure(`await: ${res.reason}`);
        return res.node;
      }
      case "assert": {
        const res = await this.checkCondition(d.condition, 1000);
        if (!res.ok) throw new StepFailure(`assert: ${res.reason}`);
        return res.node;
      }
      case "wait":
        await sleep(d.ms);
        return undefined;
      case "echo":
        return undefined;
      case "button":
        if (this.side === "web") {
          if (d.button !== "back") throw new StepFailure(`button: ${d.button} has no web equivalent (only back, which goes back in the browser history)`);
          await historyBack(this.web);
          return undefined;
        }
        await this.call("button", { button: d.button });
        return undefined;
      case "when": {
        if (d.platform !== this.side) return undefined;
        let last: UiNode | undefined;
        for (const s of d.steps) last = (await this.run(s.directive)) ?? last;
        return last;
      }
      case "tool": {
        const needsBundle = this.side !== "web" && /app$|^launch-app$|^describe$|^await-ui-element$|^settings-permissions$/.test(d.tool);
        await this.call(d.tool, { ...(needsBundle ? { bundleId: this.opts.bundleId } : {}), ...d.args });
        return undefined;
      }
    }
  }
}
