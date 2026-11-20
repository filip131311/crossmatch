import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDeviceList } from "../devices.js";

const emulator = { platform: "android", kind: "emulator", serial: "emulator-5554", state: "device", avdName: "Pixel_9_API_36" };
const sim = { platform: "ios", udid: "A6DDC52D-8565-4DCC-8E1F-48321742B1E6", name: "iPhone 17", state: "Booted" };

test("reads AVDs from the top-level avds array (Argent up to 0.34)", () => {
  const { devices, avds } = parseDeviceList({
    devices: [sim, emulator],
    avds: [{ name: "Pixel_9_API_36" }, { name: "Pixel_7_API_34" }],
  });
  assert.deepEqual(devices, [sim, emulator]);
  assert.deepEqual(avds, ["Pixel_9_API_36", "Pixel_7_API_34"]);
});

test("reads AVDs from kind avd entries and keeps them out of devices (later Argent)", () => {
  const avd = { platform: "android", kind: "avd", avdName: "Pixel_7_API_34", state: "stopped" };
  const { devices, avds } = parseDeviceList({ devices: [{ ...sim, kind: "simulator" }, emulator, avd], notes: ["x"] });
  assert.deepEqual(devices, [{ ...sim, kind: "simulator" }, emulator]);
  assert.deepEqual(avds, ["Pixel_7_API_34"]);
});

test("names each AVD once when both shapes are present", () => {
  const avd = { platform: "android", kind: "avd", avdName: "Pixel_7_API_34", state: "stopped" };
  assert.deepEqual(parseDeviceList({ devices: [avd], avds: ["Pixel_7_API_34"] }).avds, ["Pixel_7_API_34"]);
});

test("tolerates an empty or missing result", () => {
  assert.deepEqual(parseDeviceList({}), { devices: [], avds: [] });
  assert.deepEqual(parseDeviceList(undefined), { devices: [], avds: [] });
});
