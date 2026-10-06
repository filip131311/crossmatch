import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { connectArgent as ConnectArgent } from "../argent.js";

/** A fresh copy of the module, so each test loads the client itself instead of reusing the cached one. */
let n = 0;
async function freshConnect(): Promise<typeof ConnectArgent> {
  return (await import(`../argent.js?fresh=${++n}`)).connectArgent;
}

/** A fake Argent install: `<dir>/dist/cli.js`, plus `dist/client.js` unless `client` is false. */
function fakeInstall(version: string, client = true): string {
  const install = fs.mkdtempSync(path.join(os.tmpdir(), "crossmatch-argent-"));
  fs.mkdirSync(path.join(install, "dist"));
  fs.writeFileSync(path.join(install, "package.json"), JSON.stringify({ version, type: "module" }));
  fs.writeFileSync(path.join(install, "dist", "cli.js"), "", { mode: 0o755 });
  if (client) {
    fs.writeFileSync(
      path.join(install, "dist", "client.js"),
      `export function createArgentClient() {
        return {
          async callTool(name, args, options) {
            if (name === "fail") throw new Error("[Tool:fail] boom");
            if (name === "timeout") throw AbortSignal.timeout(0).reason ?? new DOMException("timed out", "TimeoutError");
            return { data: { name, args, signal: options?.signal instanceof AbortSignal }, note: "ignored" };
          },
        };
      }`,
    );
  }
  return install;
}

/** Run `fn` with env vars set (undefined deletes), restoring them afterwards. */
async function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
}

test("connectArgent loads the client of CROSSMATCH_ARGENT_BIN's install and unwraps results and errors", async () => {
  const install = fakeInstall("9.9.9");
  try {
    await withEnv({ CROSSMATCH_ARGENT_BIN: path.join(install, "dist", "cli.js") }, async () => {
      const connectArgent = await freshConnect();
      const client = await connectArgent();
      assert.deepEqual(client.install, { dir: fs.realpathSync(install), version: "9.9.9" });
      assert.deepEqual(await client.call("tap", { udid: "x" }), { name: "tap", args: { udid: "x" }, signal: true });
      await assert.rejects(client.call("fail", {}), { message: "boom" });
      // a timeout's DOMException comes through as is, not as a TypeError from rewriting its message
      await assert.rejects(client.call("timeout", {}), { name: "TimeoutError" });
      assert.equal(await connectArgent(), client, "one client per process");
    });
  } finally {
    fs.rmSync(install, { recursive: true, force: true });
  }
});

test("CROSSMATCH_ARGENT_BIN is used alone: a wrong one fails instead of falling back", async () => {
  const old = fakeInstall("0.26.0", false);
  try {
    for (const bin of [path.join(old, "missing", "cli.js"), path.join(old, "dist", "cli.js")]) {
      await withEnv({ CROSSMATCH_ARGENT_BIN: bin }, async () => {
        await assert.rejects((await freshConnect())(), (e: Error) => e.message.startsWith(`CROSSMATCH_ARGENT_BIN=${bin}`));
      });
    }
    // an install directory works too
    const install = fakeInstall("9.9.9");
    await withEnv({ CROSSMATCH_ARGENT_BIN: install }, async () => {
      assert.equal((await (await freshConnect())()).install.version, "9.9.9");
    });
    fs.rmSync(install, { recursive: true, force: true });
  } finally {
    fs.rmSync(old, { recursive: true, force: true });
  }
});

test("the argent on PATH is used through its bin link; one without a client is reported, not skipped silently", async () => {
  const current = fakeInstall("9.9.9");
  const old = fakeInstall("0.26.0", false);
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "crossmatch-bin-"));
  const errors: string[] = [];
  const consoleError = console.error;
  console.error = (s: string) => void errors.push(s);
  try {
    fs.symlinkSync(path.join(current, "dist", "cli.js"), path.join(bin, "argent"));
    await withEnv({ CROSSMATCH_ARGENT_BIN: undefined, PATH: `${bin}${path.delimiter}${process.env.PATH}` }, async () => {
      assert.equal((await (await freshConnect())()).install.version, "9.9.9");
    });
    assert.deepEqual(errors, []);

    fs.rmSync(path.join(bin, "argent"));
    fs.symlinkSync(path.join(old, "dist", "cli.js"), path.join(bin, "argent"));
    await withEnv({ CROSSMATCH_ARGENT_BIN: undefined, PATH: `${bin}${path.delimiter}${process.env.PATH}` }, async () => {
      // falls back to the @swmansion/argent next to crossmatch (installed as a peer in this checkout)
      const client = await (await freshConnect())();
      assert.notEqual(client.install.dir, fs.realpathSync(old));
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /argent on PATH .* has no Node client/);
  } finally {
    console.error = consoleError;
    for (const d of [current, old, bin]) fs.rmSync(d, { recursive: true, force: true });
  }
});
