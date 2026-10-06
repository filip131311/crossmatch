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

export interface ArgentClient {
  /** Call a tool and return its result. Artifacts (screenshots, recordings) come back as local file paths. */
  call<T = any>(tool: string, args: Record<string, unknown>): Promise<T>;
  /** The Argent install the client was loaded from. */
  install: { dir: string; version?: string };
}

/**
 * The part of `@swmansion/argent/client` crossmatch uses. Typed here rather than imported, because the
 * client is loaded at runtime from whichever Argent install the user has, of any version.
 */
interface ArgentSdk {
  createArgentClient(): {
    callTool(name: string, args?: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<{ data: unknown }>;
  };
}

const CALL_TIMEOUT_MS = 15 * 60_000;
const MIN_VERSION = "0.27.0";

/** `<install>/dist/client.js` for an install's `dist/cli.js` (or a link to it), or the install directory. */
function clientNextTo(bin: string): string | undefined {
  const real = fs.realpathSync(bin);
  const client = fs.statSync(real).isDirectory()
    ? path.join(real, "dist", "client.js")
    : path.join(path.dirname(real), "client.js");
  return fs.existsSync(client) ? client : undefined;
}

async function importSdk(specifier: string): Promise<{ sdk: ArgentSdk; dir: string }> {
  const sdk: ArgentSdk = await import(specifier);
  if (typeof sdk.createArgentClient !== "function") throw new Error(`${specifier} is not Argent's Node client`);
  // <install>/dist/client.js
  const file = fileURLToPath(specifier.startsWith("file:") ? specifier : import.meta.resolve(specifier));
  return { sdk, dir: path.dirname(path.dirname(file)) };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The client of the Argent install crossmatch uses, so that crossmatch and the editor's Argent MCP
 * server share one tool-server: CROSSMATCH_ARGENT_BIN (an install's `dist/cli.js` or directory) when
 * set, and nothing else; otherwise the `argent` on PATH, then an `@swmansion/argent` installed next to
 * crossmatch.
 */
async function loadSdk(): Promise<{ sdk: ArgentSdk; dir: string; warning?: string }> {
  const pinned = process.env.CROSSMATCH_ARGENT_BIN;
  if (pinned) {
    let client: string | undefined;
    try {
      client = clientNextTo(pinned);
    } catch (e) {
      throw new Error(`CROSSMATCH_ARGENT_BIN=${pinned}: ${message(e)}`);
    }
    if (!client) throw new Error(`CROSSMATCH_ARGENT_BIN=${pinned} is not an Argent ${MIN_VERSION}+ install (no dist/client.js next to it).`);
    try {
      return await importSdk(pathToFileURL(client).href);
    } catch (e) {
      throw new Error(`CROSSMATCH_ARGENT_BIN=${pinned}: cannot load ${client}: ${message(e)}`);
    }
  }

  const tried: string[] = [];
  let warning: string | undefined;
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["argent"], { encoding: "utf8" });
  const onPath = which.status === 0 ? which.stdout.split(/\r?\n/)[0].trim() : "";
  if (onPath) {
    try {
      const client = clientNextTo(onPath);
      if (client) return await importSdk(pathToFileURL(client).href);
      warning = `the argent on PATH (${onPath}) has no Node client: it is older than Argent ${MIN_VERSION}, or a wrapper script. crossmatch uses another install, with its own tool-server. Update it (\`npm i -g @swmansion/argent@latest\`) or set CROSSMATCH_ARGENT_BIN to its dist/cli.js.`;
      tried.push(`${onPath}: no dist/client.js next to it`);
    } catch (e) {
      warning = `cannot load the Node client of the argent on PATH (${onPath}): ${message(e)}. crossmatch uses another install, with its own tool-server.`;
      tried.push(`${onPath}: ${message(e)}`);
    }
  }
  try {
    return { ...(await importSdk("@swmansion/argent/client")), warning };
  } catch (e) {
    tried.push(`@swmansion/argent/client: ${message(e)}`);
  }
  throw new Error(
    `Cannot load Argent's Node client (@swmansion/argent/client, Argent ${MIN_VERSION} or newer). Install or update Argent (\`npm i -g @swmansion/argent@latest\`) or set CROSSMATCH_ARGENT_BIN to the dist/cli.js of an install.\n  tried: ${tried.join("\n  tried: ") || "nothing (no argent on PATH)"}`,
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
  cached ??= loadSdk().then(({ sdk, dir, warning }) => {
    if (warning) console.error(`! ${warning}`);
    const client = sdk.createArgentClient();
    return {
      install: { dir, version: installVersion(dir) },
      async call<T>(tool: string, args: Record<string, unknown>): Promise<T> {
        try {
          const res = await client.callTool(tool, args, { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
          return res.data as T;
        } catch (e) {
          // tool errors read "[Tool:<id>] message"; the tool is known here. Other errors, such as the
          // DOMException of a timeout, keep their message (a DOMException's cannot be set).
          if (e instanceof Error && e.message.startsWith("[Tool:")) e.message = e.message.replace(/^\[Tool:[^\]]+\]\s*/, "");
          throw e;
        }
      },
    };
  });
  cached.catch(() => (cached = undefined));
  return cached;
}
