import fs from "node:fs";
import path from "node:path";
import type { LoadedConfig } from "./config.js";
import { outDir, flowsDir } from "./config.js";
import { listFlows } from "./flow.js";

interface Coverage { startedAt: string; screens: Array<{ name: string; note?: string; at: string }>; stepsRun: number; flowsRun: number }

function file(loaded: LoadedConfig) {
  return path.join(outDir(loaded), "coverage.json");
}

export function readCoverage(loaded: LoadedConfig): Coverage {
  const f = file(loaded);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  return { startedAt: new Date().toISOString(), screens: [], stepsRun: 0, flowsRun: 0 };
}

function write(loaded: LoadedConfig, c: Coverage) {
  fs.writeFileSync(file(loaded), JSON.stringify(c, null, 2));
}

export function coverageAdd(loaded: LoadedConfig, name: string, note?: string) {
  const c = readCoverage(loaded);
  if (!c.screens.some((s) => s.name === name)) c.screens.push({ name, note, at: new Date().toISOString() });
  write(loaded, c);
  return coverageStatus(loaded);
}

export function coverageStatus(loaded: LoadedConfig) {
  const c = readCoverage(loaded);
  const { limits } = loaded.config;
  const minutes = Math.round((Date.now() - Date.parse(c.startedAt)) / 60000);
  const flows = listFlows(flowsDir(loaded)).length;
  return {
    screens: { used: c.screens.length, limit: limits.maxScreens, names: c.screens.map((s) => s.name) },
    flows: { authored: flows, run: c.flowsRun, limit: limits.maxFlows },
    steps: { used: c.stepsRun, limit: limits.maxSteps },
    minutes: { used: minutes, limit: limits.maxMinutes },
    exhausted: c.screens.length >= limits.maxScreens || flows >= limits.maxFlows || c.stepsRun >= limits.maxSteps || minutes >= limits.maxMinutes,
  };
}

/** Check whether running `add` more steps/flows fits the budget, and account for them if so. */
export function budgetCheck(loaded: LoadedConfig, add: { steps: number; flows: number }): { ok: boolean; reason?: string } {
  const c = readCoverage(loaded);
  const { limits } = loaded.config;
  const minutes = (Date.now() - Date.parse(c.startedAt)) / 60000;
  if (minutes >= limits.maxMinutes) return { ok: false, reason: `time budget of ${limits.maxMinutes} min used` };
  if (c.stepsRun + add.steps > limits.maxSteps) return { ok: false, reason: `step budget of ${limits.maxSteps} used` };
  if (c.flowsRun + add.flows > limits.maxFlows) return { ok: false, reason: `flow budget of ${limits.maxFlows} used` };
  c.stepsRun += add.steps;
  c.flowsRun += add.flows;
  write(loaded, c);
  return { ok: true };
}
