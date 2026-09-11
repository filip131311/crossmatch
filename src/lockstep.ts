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
import { screenChange } from "./pixels.js";
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
  // work in a temp dir; the previous run stays intact until this one has produced run.json
  const finalDir = runDirFor(loaded, flow.name);
  const runDir = `${finalDir}.tmp`;
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
  const started = await Promise.allSettled([sessions.ios.startRecording(), sessions.android.startRecording()]);
  const startFailure = started.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  if (startFailure) {
    // never leave the other side recording
    await Promise.allSettled([sessions.ios.stopRecording(), sessions.android.stopRecording()]);
    throw new Error(`Could not start recording: ${startFailure.reason instanceof Error ? startFailure.reason.message : startFailure.reason}`);
  }
  await new Promise((r) => setTimeout(r, 700));
  const captureErrors: string[] = [];
  let stopped: Array<PromiseSettledResult<{ file: string; durationMs: number } | undefined>> = [];
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
        capture(sessions.ios, step.index, ios, acted ? prev?.ios.tree : undefined, captureErrors),
        capture(sessions.android, step.index, android, acted ? prev?.android.tree : undefined, captureErrors),
      ]);
      for (const side of ["ios", "android"] as Side[]) {
        const cur = (side === "ios" ? ios : android).screenshot;
        const before = prev?.[side].screenshot;
        if (cur && before) (side === "ios" ? ios : android).screenChange = await screenChange(path.join(runDir, before), path.join(runDir, cur));
      }
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
    stopped = await Promise.allSettled([sessions.ios.stopRecording(), sessions.android.stopRecording()]);
  }
  const videoOf = (side: Side, r: PromiseSettledResult<{ file: string; durationMs: number } | undefined>) => {
    if (r.status === "rejected") {
      captureErrors.push(`[${side}] recording could not be retrieved: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
      return { file: "", durationMs: 0, width: 0, height: 0 };
    }
    const file = r.value?.file ?? "";
    const probed = file ? ffprobeSize(path.join(runDir, file)) : { width: 0, height: 0, durationMs: 0 };
    return { file, durationMs: probed.durationMs || r.value?.durationMs || 0, width: probed.width, height: probed.height };
  };
  const video = { ios: videoOf("ios", stopped[0]), android: videoOf("android", stopped[1]) };
  // Rebase step times onto the video timeline: Argent resolves screen-recording-start some time
  // after the first frame is captured, and that latency differs per platform.
  for (const side of ["ios", "android"] as Side[]) {
    const delta = sessions[side].timelineOffset(video[side].durationMs);
    if (!delta) continue;
    for (const st of steps) {
      if (st[side].status === "skip" && st[side].startMs === 0 && st[side].endMs === 0) continue;
      st[side].startMs = Math.max(0, st[side].startMs + delta);
      st[side].endMs = Math.max(0, st[side].endMs + delta);
    }
  }
  if (captureErrors.length) for (const e of captureErrors) opts.log(`Warning: ${e}`);
  const run: RunRecord = {
    flow: { name: flow.name, path: flow.path, title: flow.title, description: flow.description },
    startedAt,
    finishedAt: new Date().toISOString(),
    devices: { ios: { id: devices.ios.id, name: devices.ios.name }, android: { id: devices.android.id, name: devices.android.name } },
    video,
    steps,
    ok: captureErrors.length === 0 && steps.every((s) => s.ios.status === "pass" && s.android.status === "pass"),
    ...(captureErrors.length ? { captureErrors } : {}),
  };
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify(run, null, 2));
  fs.rmSync(finalDir, { recursive: true, force: true });
  fs.renameSync(runDir, finalDir);
  return run;
}

async function capture(s: SideSession, index: number, result: StepSideResult, previous: UiTree | undefined, errors: string[]): Promise<void> {
  if (result.status === "skip") return;
  // tree first (it may restart Argent's Android helper), then the screenshot; each failure is recorded
  try {
    // after an action, an unchanged Android tree is more likely stale than a no-op
    result.tree = await s.describeFresh(previous);
  } catch (e) {
    const msg = `[${s.side}] tree after step ${index + 1} could not be read: ${e instanceof Error ? e.message : e}`;
    result.captureError = msg;
    errors.push(msg);
  }
  try {
    result.screenshot = await s.screenshot(`${s.side}-step-${String(index + 1).padStart(2, "0")}.png`);
  } catch (e) {
    const msg = `[${s.side}] screenshot after step ${index + 1} failed: ${e instanceof Error ? e.message : e}`;
    result.captureError = result.captureError ? `${result.captureError}; ${msg}` : msg;
    errors.push(msg);
  }
}
