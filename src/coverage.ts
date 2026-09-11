import fs from "node:fs";
import path from "node:path";
import type { LoadedConfig } from "./config.js";
import { CONFIG_FILE, outDir, flowsDir } from "./config.js";
import { listFlows } from "./flow.js";

interface Coverage { startedAt: string; screens: Array<{ name: string; note?: string; at: string }>; stepsRun: number; flowsRun: number; flowNames?: string[] }

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

export function coverageAdd(loaded: LoadedConfig, name: string, note?: string): { registered: boolean; reason?: string; status: ReturnType<typeof coverageStatus> } {
  const c = readCoverage(loaded);
  const known = c.screens.some((s) => s.name === name);
  if (!known && c.screens.length >= loaded.config.limits.maxScreens) return { registered: false, reason: `screen budget of ${loaded.config.limits.maxScreens} used; raise limits.maxScreens in ${CONFIG_FILE} to register more`, status: coverageStatus(loaded) };
  if (!known) c.screens.push({ name, note, at: new Date().toISOString() });
  write(loaded, c);
  return { registered: true, status: coverageStatus(loaded) };
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
export function budgetCheck(loaded: LoadedConfig, add: { steps: number; flow: string }): { ok: boolean; reason?: string } {
  const c = readCoverage(loaded);
  const { limits } = loaded.config;
  const minutes = (Date.now() - Date.parse(c.startedAt)) / 60000;
  const names = new Set(c.flowNames ?? []);
  const newFlow = !names.has(add.flow);
  if (minutes >= limits.maxMinutes) return { ok: false, reason: `time budget of ${limits.maxMinutes} min used` };
  if (c.stepsRun + add.steps > limits.maxSteps) return { ok: false, reason: `step budget of ${limits.maxSteps} used` };
  if (newFlow && names.size + 1 > limits.maxFlows) return { ok: false, reason: `flow budget of ${limits.maxFlows} distinct flows used` };
  c.stepsRun += add.steps;
  if (newFlow) names.add(add.flow);
  c.flowNames = [...names];
  c.flowsRun = names.size;
  write(loaded, c);
  return { ok: true };
}
