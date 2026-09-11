#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { argentVersion, connectArgent } from "./argent.js";
import { ffmpegBin } from "./ffmpeg.js";
import { CONFIG_FILE, flowsDir, loadConfig, outDir, resolveFrom, writeDefaultConfig } from "./config.js";
import { renderTree } from "./describe.js";
import { listDevices, resolveBothDevices, pinStatusBar } from "./devices.js";
import { listFlows, parseFlow } from "./flow.js";
import { runFlowLockstep, runDirFor } from "./lockstep.js";
import { diffRun } from "./diff.js";
import { importVerdicts, judgeRun } from "./judge.js";
import { renderRun } from "./compose.js";
import { writeReport } from "./report.js";
import { SideSession } from "./runner.js";
import { refreshScreenChange } from "./pixels.js";
import { coverageAdd, coverageStatus, budgetCheck } from "./coverage.js";
import type { RunOutput, Side } from "./types.js";

const log = (s: string) => console.error(s);

/** output.json when present, else a run.json that never got judged. */
function loadRunOutput(runDir: string): RunOutput {
  const out = path.join(runDir, "output.json");
  if (fs.existsSync(out)) return JSON.parse(fs.readFileSync(out, "utf8"));
  const run = path.join(runDir, "run.json");
  if (!fs.existsSync(run)) throw new Error(`No run found in ${runDir}: run \`natively compare\` first`);
  return { run: JSON.parse(fs.readFileSync(run, "utf8")), candidates: [] };
}
const program = new Command();
program.name("natively").description("Find and document behavioural differences between an iOS app and its Android twin.").version("0.1.0");
program.option("-c, --config <file>", `path to ${CONFIG_FILE}`);

function cfg() {
  return loadConfig(program.opts().config);
}

program
  .command("init")
  .description(`write a ${CONFIG_FILE} template in the current directory`)
  .action(() => {
    const file = writeDefaultConfig(process.cwd());
    console.log(`Wrote ${file}. Fill in ios.app / ios.bundleId / android.app / android.bundleId.`);
  });

program
  .command("doctor")
  .description("check argent, ffmpeg, devices, apps and the judge")
  .action(async () => {
    let ok = true;
    const fail = (s: string) => { ok = false; console.log(`✗ ${s}`); };
    const pass = (s: string) => console.log(`✓ ${s}`);
    const ver = await argentVersion();
    ver ? pass(`argent ${ver}`) : fail("argent CLI not found (npm i -g @swmansion/argent, or set NATIVELY_ARGENT_BIN)");
    try {
      pass(`ffmpeg with libx264: ${ffmpegBin()}`);
      const onPath = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" });
      if (onPath.status !== 0 || !/libx264/.test(onPath.stdout)) fail("the ffmpeg on PATH has no libx264: Argent's tool-server records with the ffmpeg on ITS PATH, so start it from a shell where `ffmpeg -encoders` lists libx264 (macOS: put /opt/homebrew/bin first)");
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
    spawnSync("adb", ["version"]).status === 0 ? pass("adb") : fail("adb not on PATH (needed to pin the Android status bar and refresh Argent's tree helper)");
    spawnSync("xcrun", ["simctl", "help"]).status === 0 ? pass("xcrun simctl") : fail("xcrun simctl not available (needed to pin the iOS status bar)");
    const cl = spawnSync("claude", ["--version"], { encoding: "utf8" });
    cl.status === 0 ? pass(`claude CLI ${cl.stdout.trim()} (LLM judge available)`) : console.log("· claude CLI not found: `natively judge` will fall back to rule-based verdicts");
    let loaded;
    try {
      loaded = cfg();
      pass(`config ${loaded.file}`);
    } catch (e) {
      fail(String(e instanceof Error ? e.message : e));
      process.exit(1);
    }
    for (const side of ["ios", "android"] as Side[]) {
      const app = resolveFrom(loaded.root, loaded.config[side].app);
      fs.existsSync(app) ? pass(`${side} app ${app}`) : fail(`${side} app not found: ${app}`);
    }
    try {
      const client = await connectArgent();
      pass(`argent transport: ${client.describeTransport()}`);
      const { devices } = await listDevices(client);
      const booted = devices.filter((d: any) => d.state === "Booted" || d.state === "device");
      pass(`${devices.length} devices known, ${booted.length} booted: ${booted.map((d: any) => `${d.platform}:${d.name ?? d.avdName ?? d.udid ?? d.serial}`).join(", ") || "none"}`);
    } catch (e) {
      fail(`argent unreachable: ${e instanceof Error ? e.message : e}`);
    }
    process.exit(ok ? 0 : 1);
  });

program
  .command("devices")
  .description("list devices as argent sees them")
  .action(async () => {
    const client = await connectArgent();
    const { devices, avds } = await listDevices(client);
    for (const d of devices as any[]) console.log(`${d.platform.padEnd(8)} ${(d.state ?? "").padEnd(9)} ${(d.udid ?? d.serial ?? d.id ?? "").padEnd(40)} ${d.name ?? d.avdName ?? ""}`);
    if (avds.length) console.log(`AVDs: ${avds.join(", ")}`);
  });

program
  .command("setup")
  .description("boot both devices, install both apps fresh, pin the status bars")
  .option("--no-install", "do not reinstall the apps")
  .action(async (o) => {
    const loaded = cfg();
    const client = await connectArgent();
    const devices = await resolveBothDevices(client, loaded, log);
    for (const side of ["ios", "android"] as Side[]) {
      log(`${side}: ${devices[side].name} (${devices[side].id})`);
      if (o.install) {
        log(`${side}: installing ${loaded.config[side].app}`);
        await client.call("reinstall-app", { udid: devices[side].id, bundleId: loaded.config[side].bundleId, appPath: resolveFrom(loaded.root, loaded.config[side].app) });
      }
      pinStatusBar(devices[side]);
      await client.call("launch-app", { udid: devices[side].id, bundleId: loaded.config[side].bundleId });
    }
    log("Both apps are installed and running.");
  });

async function sessionFor(side: Side) {
  const loaded = cfg();
  const client = await connectArgent();
  const devices = await resolveBothDevices(client, loaded, log);
  const dir = path.join(outDir(loaded), "scratch");
  fs.mkdirSync(dir, { recursive: true });
  return { loaded, client, devices, session: new SideSession(client, devices[side], { bundleId: loaded.config[side].bundleId, runDir: dir, showTouches: false, timeLimitSeconds: 60, log }) };
}

program
  .command("describe")
  .description("print the normalised UI tree of one or both sides")
  .option("-s, --side <side>", "ios | android | both", "both")
  .option("--json", "print JSON")
  .option("--fresh", "restart Argent's Android tree helper first (use when the tree does not match the screen)")
  .action(async (o) => {
    const sides: Side[] = o.side === "both" ? ["ios", "android"] : [o.side];
    const out: Record<string, unknown> = {};
    for (const side of sides) {
      const { session } = await sessionFor(side);
      if (o.fresh) await session.refreshTreeSource();
      const tree = await session.describe();
      if (o.json) out[side] = tree.nodes;
      else console.log(`### ${side}\n${renderTree(tree)}\n`);
    }
    if (o.json) console.log(JSON.stringify(out, null, 2));
  });

program
  .command("argent <tool>")
  .description("call any argent tool on one side; the device id is injected")
  .requiredOption("-s, --side <side>", "ios | android")
  .option("-a, --args <json>", "tool arguments as JSON", "{}")
  .action(async (tool, o) => {
    const { session, client } = await sessionFor(o.side);
    const { loaded } = await sessionFor(o.side);
    const wantsBundle = /app$|^launch-app$|^describe$|^await-ui-element$/.test(tool);
    const res = await client.call(tool, { udid: session.device.id, ...(wantsBundle ? { bundleId: loaded.config[o.side as Side].bundleId } : {}), ...JSON.parse(o.args) });
    console.log(JSON.stringify(res, null, 2));
  });

program
  .command("screen <name>")
  .description("register a screen the exploration reached on both sides (coverage + budget), saving trees and screenshots")
  .option("--note <text>", "what this screen is")
  .action(async (name, o) => {
    const { loaded, client, devices } = await sessionFor("ios");
    const dir = path.join(outDir(loaded), "screens");
    fs.mkdirSync(dir, { recursive: true });
    const result: Record<string, unknown> = {};
    for (const side of ["ios", "android"] as Side[]) {
      const s = new SideSession(client, devices[side], { bundleId: loaded.config[side].bundleId, runDir: dir, showTouches: false, timeLimitSeconds: 60, log });
      const tree = await s.describe();
      const shot = await s.screenshot(`${name}-${side}.png`, 0.5);
      fs.writeFileSync(path.join(dir, `${name}-${side}.txt`), renderTree(tree));
      result[side] = { screenshot: shot, elements: tree.nodes.length };
    }
    const reg = coverageAdd(loaded, name, o.note);
    console.log(JSON.stringify({ screen: name, registered: reg.registered, ...(reg.reason ? { reason: reg.reason } : {}), ...result, budget: reg.status }, null, 2));
    if (!reg.registered) process.exit(2);
  });

program
  .command("status")
  .description("exploration budget: screens, flows, steps and time used vs limits")
  .action(() => {
    const loaded = cfg();
    console.log(JSON.stringify(coverageStatus(loaded), null, 2));
  });

program
  .command("compare [flows...]")
  .description("run flows on both devices in lockstep with recording, then diff (default: every flow in the flows dir)")
  .option("--fresh", "reinstall both apps before each flow", false)
  .option("--no-judge", "skip the judge")
  .option("--no-render", "skip rendering side-by-side videos")
  .action(async (flows: string[], o) => {
    const loaded = cfg();
    const files = flows.length ? flows.map((f) => (fs.existsSync(f) ? path.resolve(f) : path.join(flowsDir(loaded), f.endsWith(".yaml") ? f : `${f}.yaml`))) : listFlows(flowsDir(loaded));
    if (!files.length) throw new Error(`No flows found in ${flowsDir(loaded)}`);
    const client = await connectArgent();
    const devices = await resolveBothDevices(client, loaded, log);
    const failures: string[] = [];
    for (const file of files) {
      let flowName = path.basename(file);
      try {
        const flow = parseFlow(file);
        flowName = flow.name;
        const budget = budgetCheck(loaded, { steps: flow.steps.length, flow: flow.name });
        if (!budget.ok) {
          log(`Budget exhausted (${budget.reason}); skipping ${flow.name}. Raise limits in ${CONFIG_FILE} to continue.`);
          continue;
        }
        log(`\n=== ${flow.name}${flow.title ? ` — ${flow.title}` : ""}`);
        const run = await runFlowLockstep(client, loaded, devices, flow, { fresh: o.fresh, log });
        const candidates = diffRun(run);
        const output: RunOutput = { run, candidates };
        const runDir = runDirFor(loaded, flow.name);
        const save = () => fs.writeFileSync(path.join(runDir, "output.json"), JSON.stringify(output, null, 2));
        fs.writeFileSync(path.join(runDir, "candidates.json"), JSON.stringify(candidates, null, 2));
        save();
        log(`${candidates.length} candidate difference(s)`);
        for (const c of candidates) log(`  [${c.kind}] step ${c.stepIndex + 1}: ${c.summary}`);
        if (o.judge && candidates.length) {
          output.verdicts = await judgeRun(loaded, output, log);
          fs.writeFileSync(path.join(runDir, "verdicts.json"), JSON.stringify(output.verdicts, null, 2));
          save();
          for (const v of output.verdicts) log(`  ${v.severity.toUpperCase().padEnd(6)} ${v.category.padEnd(15)} ${v.title}`);
          if (o.render) {
            await renderRun(loaded, output, log);
            save();
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failures.push(`${flowName}: ${msg}`);
        log(`!! ${flowName} failed: ${msg}`);
      }
    }
    writeReport(loaded, log);
    if (failures.length) {
      log(`\n${failures.length} flow(s) did not complete:`);
      for (const f of failures) log(`  ${f}`);
      process.exitCode = 1;
    }
  });

program
  .command("judge <run>")
  .description("(re)judge a run's candidates: run name, or a verdicts.json to import human verdicts")
  .option("--rules", "rule-based only, no LLM")
  .option("--from <file>", "import verdicts from a JSON file written by a human/agent")
  .action(async (name, o) => {
    const loaded = cfg();
    const runDir = runDirFor(loaded, name);
    const output = loadRunOutput(runDir);
    await refreshScreenChange(output.run, runDir);
    output.candidates = diffRun(output.run);
    output.verdicts = o.from ? importVerdicts(JSON.parse(fs.readFileSync(o.from, "utf8")), output) : await judgeRun(loaded, output, log, { rulesOnly: !!o.rules });
    fs.writeFileSync(path.join(runDir, "verdicts.json"), JSON.stringify(output.verdicts, null, 2));
    fs.writeFileSync(path.join(runDir, "output.json"), JSON.stringify(output, null, 2));
    for (const v of output.verdicts!) log(`${v.severity.toUpperCase().padEnd(6)} ${v.category.padEnd(15)} ${v.title}`);
  });

program
  .command("render <run>")
  .description("render the side-by-side videos for a judged run")
  .action(async (name) => {
    const loaded = cfg();
    const runDir = runDirFor(loaded, name);
    const output = loadRunOutput(runDir);
    if (!output.verdicts) throw new Error("Run has no verdicts yet: run `natively judge` first");
    await renderRun(loaded, output, log);
    fs.writeFileSync(path.join(runDir, "verdicts.json"), JSON.stringify(output.verdicts, null, 2));
    fs.writeFileSync(path.join(runDir, "output.json"), JSON.stringify(output, null, 2));
    writeReport(loaded, log);
  });

program
  .command("report")
  .description("write the HTML report from every judged run")
  .action(() => {
    const loaded = cfg();
    const file = writeReport(loaded, log);
    console.log(file);
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
