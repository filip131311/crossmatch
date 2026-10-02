/**
 * Argent through its Node client (`@swmansion/argent/client`). The client talks to the same
 * tool-server as the `argent` CLI and Argent's MCP server, starts it when none runs, and honours
 * `argent link` / ARGENT_TOOLS_URL. Every device-touching Argent tool takes the device id in `udid`,
 * on both platforms.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type * as ArgentSdk from "@swmansion/argent/client";

export interface ArgentClient {
  /** Call a tool and return its result. Artifacts (screenshots, recordings) come back as local file paths. */
  call<T = any>(tool: string, args: Record<string, unknown>): Promise<T>;
  /** The Argent install the client was loaded from. */
  install: { dir: string; version?: string };
}

const CALL_TIMEOUT_MS = 15 * 60_000;

/**
 * The client of the Argent install crossmatch uses, so that crossmatch and the editor's Argent MCP
 * server share one tool-server: CROSSMATCH_ARGENT_BIN (the path of an install's `dist/cli.js`), then
 * the `argent` on PATH, then an `@swmansion/argent` installed next to crossmatch.
 */
function clientCandidates(): string[] {
  const bins: string[] = [];
  if (process.env.CROSSMATCH_ARGENT_BIN) bins.push(process.env.CROSSMATCH_ARGENT_BIN);
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["argent"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) bins.push(which.stdout.trim().split("\n")[0]);
  const out: string[] = [];
  for (const bin of bins) {
    try {
      const client = path.join(path.dirname(fs.realpathSync(bin)), "client.js");
      if (fs.existsSync(client)) out.push(pathToFileURL(client).href);
    } catch {
      // a dangling bin: skip it
    }
  }
  out.push("@swmansion/argent/client");
  return out;
}

async function loadSdk(): Promise<{ sdk: typeof ArgentSdk; dir: string }> {
  for (const specifier of clientCandidates()) {
    try {
      const sdk: typeof ArgentSdk = await import(specifier);
      // <install>/dist/client.js
      const file = fileURLToPath(specifier.startsWith("file:") ? specifier : import.meta.resolve(specifier));
      return { sdk, dir: path.dirname(path.dirname(file)) };
    } catch {
      // try the next one
    }
  }
  throw new Error(
    "Cannot load Argent's Node client (@swmansion/argent/client, Argent 0.26.1 or newer). Install or update Argent (`npm i -g @swmansion/argent@latest`) or set CROSSMATCH_ARGENT_BIN to the cli.js of an install.",
  );
}

function installVersion(dir: string): string | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version;
  } catch {
    return undefined;
  }
}

let cached: Promise<ArgentClient> | undefined;

/** Connect to Argent. The tool-server starts on the first call when none runs. */
export function connectArgent(): Promise<ArgentClient> {
  cached ??= loadSdk().then(({ sdk, dir }) => {
    const client = sdk.createArgentClient();
    return {
      install: { dir, version: installVersion(dir) },
      async call<T>(tool: string, args: Record<string, unknown>): Promise<T> {
        try {
          const res = await client.callTool<T>(tool, args, { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
          return res.data;
        } catch (e) {
          // tool errors read "[Tool:<id>] message"; the tool is known here
          if (e instanceof Error) e.message = e.message.replace(/^\[Tool:[^\]]+\]\s*/, "");
          throw e;
        }
      },
    };
  });
  cached.catch(() => (cached = undefined));
  return cached;
}
