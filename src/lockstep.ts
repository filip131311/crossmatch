/**
 * Runs one flow on both devices in lockstep: every step starts on both sides at the same moment and
 * the next step waits for both to finish. Both screens are recorded for the whole run, and after each
 * step both trees and screenshots are captured for diffing.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ArgentClient } from "./argent.js";
import { ffprobeBin } from "./ffmpeg.js";
import type { LoadedConfig } from "./config.js";
import { outDir, resolveFrom } from "./config.js";
import { pinStatusBar, type Device } from "./devices.js";
import { stepLabel } from "./flow.js";
import { SideSession } from "./runner.js";
import type { Flow, RunRecord, Side, StepResult, StepSideResult, UiTree } from "./types.js";

export interface LockstepOptions {
  /** Reinstall both apps before the run so both start from an empty state. */
  fresh: boolean;
  log: (s: string) => void;
}

export function runDirFor(loaded: LoadedConfig, flowName: string): string {
  return path.join(outDir(loaded), "runs", flowName);
}

export function ffprobeSize(file: string): { width: number; height: number; durationMs: number } {
  const res = spawnSync(ffprobeBin(), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], { encoding: "utf8" });
  try {
    const j = JSON.parse(res.stdout);
    return { width: j.streams[0].width, height: j.streams[0].height, durationMs: Math.round(parseFloat(j.format.duration) * 1000) };
  } catch {
    return { width: 0, height: 0, durationMs: 0 };
  }
}

export async function runFlowLockstep(client: ArgentClient, loaded: LoadedConfig, devices: Record<Side, Device>, flow: Flow, opts: LockstepOptions): Promise<RunRecord> {
  const runDir = runDirFor(loaded, flow.name);
  fs.rmSync(runDir, { recursive: true, force: true });
  fs.mkdirSync(runDir, { recursive: true });
  const { config } = loaded;
  const sessions: Record<Side, SideSession> = {
    ios: new SideSession(client, devices.ios, { bundleId: config.ios.bundleId, runDir, showTouches: config.recording.showTouches, timeLimitSeconds: config.recording.timeLimitSeconds, log: opts.log }),
    android: new SideSession(client, devices.android, { bundleId: config.android.bundleId, runDir, showTouches: config.recording.showTouches, timeLimitSeconds: config.recording.timeLimitSeconds, log: opts.log }),
  };
  const both = <T>(fn: (s: SideSession) => Promise<T>): Promise<[T, T]> => Promise.all([fn(sessions.ios), fn(sessions.android)]);

  if (opts.fresh) {
    opts.log("Reinstalling both apps for a clean state…");
    await Promise.all([
      sessions.ios.reinstall(resolveFrom(loaded.root, config.ios.app)),
      sessions.android.reinstall(resolveFrom(loaded.root, config.android.app)),
    ]);
  }
  pinStatusBar(devices.ios);
  pinStatusBar(devices.android);
  if (flow.steps[0]?.directive.kind !== "launch") opts.log(`Warning: flow "${flow.name}" does not start with launch:, so both sides start from whatever state the apps are in.`);

  const startedAt = new Date().toISOString();
  const steps: StepResult[] = [];
  opts.log(`Recording both screens…`);
  await both((s) => s.startRecording());
  await new Promise((r) => setTimeout(r, 700));
  try {
    for (const step of flow.steps) {
      const label = stepLabel(step.directive);
      opts.log(`Step ${step.index + 1}/${flow.steps.length}: ${label}`);
      const [ios, android] = await both((s) => s.execute(step));
      // give the UI a beat to react, then let animations finish on both sides before capturing
      await new Promise((r) => setTimeout(r, 400));
      await both((s) => s.settle(2500));
      const prev = steps[steps.length - 1];
      const acted = !["await", "assert", "wait", "echo"].includes(step.directive.kind);
      await Promise.all([
        capture(sessions.ios, step.index, ios, acted ? prev?.ios.tree : undefined),
        capture(sessions.android, step.index, android, acted ? prev?.android.tree : undefined),
      ]);
      steps.push({ index: step.index, directive: step.directive, label, ios, android });
      if (ios.status !== android.status) opts.log(`  ↳ outcome differs: ios=${ios.status} android=${android.status}`);
      if (sessions.ios.hasFailed && sessions.android.hasFailed) {
        for (const rest of flow.steps.slice(step.index + 1)) {
          const skip = (): StepSideResult => ({ status: "skip", reason: "both sides failed earlier", startMs: 0, endMs: 0 });
          steps.push({ index: rest.index, directive: rest.directive, label: stepLabel(rest.directive), ios: skip(), android: skip() });
        }
        break;
      }
    }
  } finally {
    // hold the last frame for a moment so the video does not cut on the final action
    await new Promise((r) => setTimeout(r, 1200));
  }
  const [iosVideo, androidVideo] = await both((s) => s.stopRecording());
  const video = {
    ios: { file: iosVideo?.file ?? "", ...ffprobeSize(path.join(runDir, iosVideo?.file ?? "")) },
    android: { file: androidVideo?.file ?? "", ...ffprobeSize(path.join(runDir, androidVideo?.file ?? "")) },
  };
  const run: RunRecord = {
    flow: { name: flow.name, path: flow.path, title: flow.title, description: flow.description },
    startedAt,
    finishedAt: new Date().toISOString(),
    devices: { ios: { id: devices.ios.id, name: devices.ios.name }, android: { id: devices.android.id, name: devices.android.name } },
    video,
    steps,
    ok: steps.every((s) => s.ios.status === "pass" && s.android.status === "pass"),
  };
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify(run, null, 2));
  return run;
}

async function capture(s: SideSession, index: number, result: StepSideResult, previous?: UiTree): Promise<void> {
  if (result.status === "skip") return;
  try {
    // after an action, an unchanged Android tree is more likely stale than a no-op
    const [tree, shot] = await Promise.all([s.describeFresh(previous), s.screenshot(`${s.side}-step-${String(index + 1).padStart(2, "0")}.png`)]);
    result.tree = tree;
    result.screenshot = shot;
  } catch (e) {
    s.opts.log(`[${s.side}] capture after step ${index + 1} failed: ${e instanceof Error ? e.message : e}`);
  }
}
