/**
 * Thin client for the Argent tool-server. Two transports:
 *  - HTTP to a running tool-server (fast; discovered from ~/.argent/tool-server*.json or env vars)
 *  - the `argent run <tool> --json` CLI (fallback; always works when argent is installed)
 * Every device-touching Argent tool takes the device id in `udid`, on both platforms.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

export interface ArgentArtifact {
  __argentArtifact: true;
  id: string;
  kind: string;
  filename: string;
  mimeType: string;
  size?: number;
  hostPath?: string;
}

export class ArgentError extends Error {
  constructor(message: string, public tool: string, public code?: string) {
    super(message);
  }
}

export interface ArgentClient {
  transport: "http" | "cli";
  call<T = any>(tool: string, args: Record<string, unknown>): Promise<T>;
  /** Save an artifact returned by a tool to `dest` (a file path). */
  saveArtifact(artifact: ArgentArtifact, dest: string): Promise<void>;
  describeTransport(): string;
}

export function resolveArgentBin(): string {
  const env = process.env.NATIVELY_ARGENT_BIN;
  if (env) return env;
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["argent"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim().split("\n")[0];
  try {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve("@swmansion/argent/package.json");
    return path.join(path.dirname(pkg), "dist", "cli.js");
  } catch {
    // fall through
  }
  throw new Error(
    "Cannot find the `argent` CLI. Install it (`npm i -g @swmansion/argent`) or set NATIVELY_ARGENT_BIN to the cli.js path.",
  );
}

function runCli(bin: string, argv: string[], opts: { timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const isJs = bin.endsWith(".js") || bin.endsWith(".cjs") || bin.endsWith(".mjs");
    const child = spawn(isJs ? process.execPath : bin, isJs ? [bin, ...argv] : argv, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      shell: process.platform === "win32" && !isJs, // `argent.cmd` shims need a shell on Windows
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : undefined;
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** `argent run --json` prints notes before the JSON; take the last JSON value in the output. */
export function parseJsonTail(text: string): unknown {
  const trimmed = text.trimEnd();
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const ch = trimmed[i];
    if (ch !== "}" && ch !== "]") continue;
    // walk back to a matching opener at line start
    const opener = ch === "}" ? "{" : "[";
    for (let j = i; j >= 0; j--) {
      if (trimmed[j] !== opener) continue;
      if (j > 0 && trimmed[j - 1] !== "\n") continue;
      try {
        return JSON.parse(trimmed.slice(j, i + 1));
      } catch {
        // keep searching
      }
    }
  }
  throw new Error(`No JSON in argent output:\n${text.slice(-2000)}`);
}

class CliClient implements ArgentClient {
  transport = "cli" as const;
  constructor(private bin: string) {}
  describeTransport() {
    return `argent CLI at ${this.bin}`;
  }
  async call<T>(tool: string, args: Record<string, unknown>): Promise<T> {
    const res = await runCli(this.bin, ["run", tool, "--json", "--args", JSON.stringify(args)], { timeoutMs: 15 * 60_000 });
    if (res.code !== 0) {
      const msg = (res.stderr || res.stdout).trim();
      throw new ArgentError(msg.replace(/^\[Tool:[^\]]+\]\s*/, ""), tool);
    }
    return parseJsonTail(res.stdout) as T;
  }
  async saveArtifact(artifact: ArgentArtifact, dest: string): Promise<void> {
    if (artifact.hostPath && fs.existsSync(artifact.hostPath)) {
      fs.copyFileSync(artifact.hostPath, dest);
      return;
    }
    throw new Error(`Artifact ${artifact.filename} has no readable hostPath`);
  }
}

interface ServerRecord { url: string; token?: string; pid?: number; file: string }

function readServerRecords(): ServerRecord[] {
  const out: ServerRecord[] = [];
  const envUrl = process.env.ARGENT_TOOLS_URL;
  if (envUrl) out.push({ url: envUrl.replace(/\/$/, ""), token: process.env.ARGENT_AUTH_TOKEN, file: "env" });
  const dir = path.join(os.homedir(), ".argent");
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith("tool-server") || !name.endsWith(".json")) continue;
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      if (typeof rec.port !== "number") continue;
      if (typeof rec.pid === "number") {
        try {
          process.kill(rec.pid, 0);
        } catch {
          continue; // dead
        }
      }
      out.push({ url: `http://${rec.host ?? "127.0.0.1"}:${rec.port}`, token: rec.token, pid: rec.pid, file: name });
    } catch {
      // ignore
    }
  }
  // prefer the CLI-managed server on 3001, then most recently started
  out.sort((a, b) => (a.url.endsWith(":3001") ? -1 : 0) - (b.url.endsWith(":3001") ? -1 : 0));
  return out;
}

class HttpClient implements ArgentClient {
  transport = "http" as const;
  constructor(private rec: ServerRecord) {}
  describeTransport() {
    return `tool-server ${this.rec.url} (${this.rec.file})`;
  }
  private headers() {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.rec.token) h.authorization = `Bearer ${this.rec.token}`;
    return h;
  }
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.rec.url}/tools`, { headers: this.headers(), signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }
  async call<T>(tool: string, args: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.rec.url}/tools/${tool}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(15 * 60_000),
    });
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ArgentError(`Non-JSON response from tool-server (${res.status}): ${text.slice(0, 500)}`, tool);
    }
    if (body && typeof body === "object" && "error" in body) {
      const msg = typeof body.error === "string" ? body.error : JSON.stringify(body.error);
      throw new ArgentError(msg.replace(/^\[Tool:[^\]]+\]\s*/, ""), tool, body.error_code);
    }
    if (!res.ok) throw new ArgentError(`HTTP ${res.status}: ${text.slice(0, 500)}`, tool);
    return (body && typeof body === "object" && "data" in body ? body.data : body) as T;
  }
  async saveArtifact(artifact: ArgentArtifact, dest: string): Promise<void> {
    if (artifact.hostPath && fs.existsSync(artifact.hostPath)) {
      fs.copyFileSync(artifact.hostPath, dest);
      return;
    }
    const res = await fetch(`${this.rec.url}/artifacts/${artifact.id}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Cannot download artifact ${artifact.id}: HTTP ${res.status}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
}

let cached: ArgentClient | undefined;

/**
 * Connect to Argent. Tries a running tool-server over HTTP first; if none answers, starts one
 * through the CLI (`argent server start`) and retries; finally falls back to the CLI per call.
 */
export async function connectArgent(opts: { prefer?: "http" | "cli" } = {}): Promise<ArgentClient> {
  if (cached) return cached;
  const prefer = opts.prefer ?? (process.env.NATIVELY_ARGENT_TRANSPORT as "http" | "cli" | undefined) ?? "http";
  const bin = resolveArgentBin();
  if (prefer === "http") {
    for (const rec of readServerRecords()) {
      const c = new HttpClient(rec);
      if (await c.ping()) return (cached = c);
    }
    // no server: ask the CLI to start one (it stays in the foreground, so detach it), then look again
    try {
      const isJs = bin.endsWith(".js") || bin.endsWith(".cjs");
      const child = spawn(isJs ? process.execPath : bin, isJs ? [bin, "server", "start"] : ["server", "start"], { detached: true, stdio: "ignore", env: process.env });
      child.unref();
    } catch {
      // fall through to the CLI transport
    }
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      for (const rec of readServerRecords()) {
        const c = new HttpClient(rec);
        if (await c.ping()) return (cached = c);
      }
    }
  }
  return (cached = new CliClient(bin));
}

export async function argentVersion(): Promise<string | undefined> {
  try {
    const res = await runCli(resolveArgentBin(), ["--version"], { timeoutMs: 20_000 });
    return res.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function argentCli(argv: string[], opts: { cwd?: string } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  const bin = resolveArgentBin();
  const isJs = bin.endsWith(".js") || bin.endsWith(".cjs");
  return new Promise((resolve) => {
    const child = spawn(isJs ? process.execPath : bin, isJs ? [bin, ...argv] : argv, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}
