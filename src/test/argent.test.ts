import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connectArgent } from "../argent.js";

test("connectArgent loads the client of CROSSMATCH_ARGENT_BIN's install and unwraps results and errors", async () => {
  const install = fs.mkdtempSync(path.join(os.tmpdir(), "crossmatch-argent-"));
  fs.mkdirSync(path.join(install, "dist"));
  fs.writeFileSync(path.join(install, "package.json"), JSON.stringify({ version: "9.9.9" }));
  fs.writeFileSync(path.join(install, "dist", "cli.js"), "");
  fs.writeFileSync(
    path.join(install, "dist", "client.js"),
    `export function createArgentClient() {
      return {
        async callTool(name, args, options) {
          if (name === "fail") throw new Error("[Tool:fail] boom");
          return { data: { name, args, signal: options?.signal instanceof AbortSignal }, note: "ignored" };
        },
      };
    }`,
  );
  process.env.CROSSMATCH_ARGENT_BIN = path.join(install, "dist", "cli.js");
  try {
    const client = await connectArgent();
    assert.deepEqual(client.install, { dir: fs.realpathSync(install), version: "9.9.9" });
    assert.deepEqual(await client.call("tap", { udid: "x" }), { name: "tap", args: { udid: "x" }, signal: true });
    await assert.rejects(client.call("fail", {}), { message: "boom" });
    assert.equal(await connectArgent(), client, "one client per process");
  } finally {
    delete process.env.CROSSMATCH_ARGENT_BIN;
    fs.rmSync(install, { recursive: true, force: true });
  }
});
