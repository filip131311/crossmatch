import { spawnSync } from "node:child_process";
import path from "node:path";
import type { ArgentClient } from "./argent.js";
import { applyViewport, cdpReachable, launchBrowser, registerPortWithArgent } from "./cdp.js";
import { outDir, type LoadedConfig } from "./config.js";
import type { NativeSide, Pair, Side } from "./types.js";

export interface Device { id: string; name: string; platform: Side; state: string }

interface ListedDevice {
  platform: string;
  udid?: string;
  serial?: string;
  id?: string;
  name?: string;
  avdName?: string;
  state?: string;
  runtimeKind?: string;
  port?: number;
  avds?: Array<{ name: string }>;
}

export async function listDevices(client: ArgentClient): Promise<{ devices: ListedDevice[]; avds: string[] }> {
  const res = await client.call<any>("list-devices", {});
  const devices: ListedDevice[] = res.devices ?? [];
  const avds: string[] = [];
  for (const d of devices) if (Array.isArray(d.avds)) for (const a of d.avds) avds.push(a.name);
  if (Array.isArray(res.avds)) for (const a of res.avds) avds.push(typeof a === "string" ? a : a.name);
  return { devices, avds };
}

function isBooted(d: ListedDevice): boolean {
  return d.state === "Booted" || d.state === "device" || d.state === "Running";
}

function idOf(d: ListedDevice): string {
  return (d.udid ?? d.serial ?? d.id) as string;
}

/**
 * The web side: the Chrome on `web.port`, started by crossmatch with a phone-sized viewport when
 * nothing listens there yet, as Argent lists it (`chromium-cdp-<port>`).
 */
export async function ensureBrowser(client: ArgentClient, loaded: LoadedConfig, log: (s: string) => void): Promise<Device> {
  const { web } = loaded.config;
  registerPortWithArgent(web.port);
  if (!(await cdpReachable(web.port))) await launchBrowser(web, path.join(outDir(loaded), "web-profile"), log);
  await applyViewport(web);
  const name = `Chrome ${web.viewport.width}×${web.viewport.height}`;
  for (let attempt = 0; attempt < 30; attempt++) {
    const { devices } = await listDevices(client);
    const found = devices.find((d) => d.platform === "chromium" && (d.port === web.port || d.id === `chromium-cdp-${web.port}`));
    if (found) return { id: idOf(found), name, platform: "web", state: "booted" };
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Argent does not list the browser on port ${web.port}. Use port 9222, or start Argent's tool-server with ARGENT_CHROMIUM_PORTS=${web.port}.`);
}

/**
 * Find (and boot if necessary) the device for one side. `wanted` may be a UDID/serial, a simulator
 * name, or an AVD name. Without `wanted`, the first booted mobile device of that platform is used.
 */
export async function ensureDevice(client: ArgentClient, side: NativeSide, wanted: string | undefined, log: (s: string) => void): Promise<Device> {
  const { devices, avds } = await listDevices(client);
  const mine = devices.filter((d) => d.platform === side && (d.runtimeKind ?? "mobile") === "mobile" && idOf(d));
  const match = (d: ListedDevice) => !wanted || idOf(d) === wanted || d.name === wanted || d.avdName === wanted;
  const booted = mine.find((d) => isBooted(d) && match(d));
  if (booted) return { id: idOf(booted), name: booted.name ?? booted.avdName ?? idOf(booted), platform: side, state: "booted" };
  if (side === "ios") {
    const target = wanted ? mine.find(match) : mine[0];
    if (!target) throw new Error(`No iOS simulator${wanted ? ` matching "${wanted}"` : ""} found (see \`crossmatch devices\`)`);
    log(`Booting iOS simulator ${target.name} (${idOf(target)})…`);
    const res = await client.call<any>("boot-device", { udid: idOf(target) });
    return { id: res.udid ?? idOf(target), name: target.name ?? idOf(target), platform: side, state: "booted" };
  }
  const avd = wanted ? (avds.includes(wanted) ? wanted : undefined) : avds[0];
  if (!avd) throw new Error(`No Android device booted and no AVD${wanted ? ` named "${wanted}"` : ""} found (see \`crossmatch devices\`)`);
  log(`Booting Android emulator ${avd} (this can take minutes)…`);
  const res = await client.call<any>("boot-device", { avdName: avd });
  return { id: res.serial, name: avd, platform: side, state: "booted" };
}

/** Pin clock, battery and signal so the status bar is identical on both sides (and across runs). */
export function pinStatusBar(device: Device): void {
  if (device.platform === "web") return;
  if (device.platform === "ios") {
    spawnSync("xcrun", ["simctl", "status_bar", device.id, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100", "--wifiBars", "3", "--cellularBars", "4", "--operatorName", ""], { stdio: "ignore" });
    return;
  }
  const adb = (...args: string[]) => spawnSync("adb", ["-s", device.id, ...args], { stdio: "ignore" });
  adb("shell", "settings", "put", "global", "sysui_demo_allowed", "1");
  adb("shell", "am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "enter");
  adb("shell", "am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "clock", "-e", "hhmm", "0941");
  adb("shell", "am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "battery", "-e", "level", "100", "-e", "plugged", "false");
  adb("shell", "am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "network", "-e", "wifi", "show", "-e", "level", "4", "-e", "fully", "true");
  adb("shell", "am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "network", "-e", "mobile", "show", "-e", "datatype", "none", "-e", "level", "4");
  adb("shell", "am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "notifications", "-e", "visible", "false");
}

export function unpinStatusBar(device: Device): void {
  if (device.platform === "web") return;
  if (device.platform === "ios") {
    spawnSync("xcrun", ["simctl", "status_bar", device.id, "clear"], { stdio: "ignore" });
    return;
  }
  spawnSync("adb", ["-s", device.id, "shell", "am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command", "exit"], { stdio: "ignore" });
}

export type Devices = Partial<Record<Side, Device>>;

/** The devices of the configured pair, booted (or started) when needed. */
export async function resolveDevices(client: ArgentClient, loaded: LoadedConfig, log: (s: string) => void): Promise<Devices> {
  const pair: Pair = loaded.config.platforms;
  const found = await Promise.all(pair.map((side) => (side === "web" ? ensureBrowser(client, loaded, log) : ensureDevice(client, side, loaded.config[side].device, log))));
  return { [pair[0]]: found[0], [pair[1]]: found[1] };
}

/** One device of a resolved pair. */
export function deviceOf(devices: Devices, side: Side): Device {
  const d = devices[side];
  if (!d) throw new Error(`No ${side} device: ${side} is not one of the configured platforms`);
  return d;
}
