// Headless Chrome driven over CDP, for browser tests. Skips the test when Chrome is not installed.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export type ChromeOpts = { width?: number; height?: number };

export type Page = {
  goto(url: string): Promise<void>;
  eval<T = unknown>(expr: string): Promise<T>;
  /** Polls `expr` in the page until it is truthy. */
  waitFor(expr: string, timeoutMs?: number): Promise<void>;
  screenshot(file: string): Promise<void>;
  setCpuThrottle(rate: number): Promise<void>;
  /** Traces for `ms`, returns total duration in ms per second of wall time, keyed by trace event name. */
  trace(ms: number): Promise<Record<string, number>>;
  /** Waits until the page's fonts have loaded, then returns the families of the loaded font faces. Text is measured
   *  in the bundled Inter (theme.css) only after this. */
  fonts(): Promise<string[]>;
  /** Console messages and uncaught exceptions seen so far. */
  logs: string[];
};

type TestCtx = { skip(msg?: string): void };

export function chromePath(): string | undefined {
  const candidates = [process.env.CHROME_PATH, MAC_CHROME].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(p));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A cold Chrome on a busy CI runner (every test file starting at once, fontconfig building its cache) can take
// several seconds to come up; 10 s was not always enough there.
const START_TIMEOUT_MS = 30_000;

/** Waits for Chrome's first page target. Chrome picks its own debugging port (--remote-debugging-port=0) and writes it
 *  to DevToolsActivePort in the profile dir, so parallel test files never race for a port. */
async function pageTarget(proc: ChildProcess, dir: string, stderr: () => string): Promise<{ webSocketDebuggerUrl: string }> {
  const end = Date.now() + START_TIMEOUT_MS;
  let port: number | undefined;
  while (Date.now() < end) {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      throw new Error(`Chrome exited before exposing a debugging target (${proc.exitCode ?? proc.signalCode}): ${stderr()}`);
    }
    try {
      port ??= Number(readFileSync(path.join(dir, "DevToolsActivePort"), "utf8").split("\n")[0]) || undefined;
    } catch { /* not written yet */ }
    if (port) {
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as any[];
        const target = list.find((x) => x.type === "page");
        if (target) return target;
      } catch { /* not up yet */ }
    }
    await sleep(50);
  }
  throw new Error(`Chrome did not expose a debugging target within ${START_TIMEOUT_MS} ms (port ${port ?? "not written"}): ${stderr()}`);
}

export async function withChrome(t: TestCtx, fn: (page: Page) => Promise<void>, opts: ChromeOpts = {}): Promise<void> {
  const bin = chromePath();
  if (!bin) return void t.skip("Chrome not found (set CHROME_PATH)");
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const dir = mkdtempSync(path.join(tmpdir(), "chrome-test-"));
  const proc: ChildProcess = spawn(bin, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    // The bot's browser plays page audio without a gesture; so does this one.
    "--autoplay-policy=no-user-gesture-required",
    `--user-data-dir=${dir}`, `--window-size=${width},${height}`, "--remote-debugging-port=0", "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  // The last of Chrome's stderr, for the error if it never comes up. Chrome's own logs, not page content.
  let errTail = "";
  proc.stderr?.on("data", (d: Buffer) => { errTail = (errTail + d.toString()).slice(-2000); });
  let ws: WebSocket | undefined;
  try {
    const target = await pageTarget(proc, dir, () => errTail.trim());

    const socket = new WebSocket(target.webSocketDebuggerUrl);
    ws = socket;
    let nextId = 0;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    const listeners = new Set<(method: string, params: any) => void>();
    const logs: string[] = [];
    socket.onmessage = (m) => {
      const d = JSON.parse(String(m.data));
      if (d.id && pending.has(d.id)) {
        const p = pending.get(d.id)!;
        pending.delete(d.id);
        if (d.error) p.reject(new Error(`${d.error.message}`)); else p.resolve(d.result);
        return;
      }
      if (d.method === "Runtime.consoleAPICalled") logs.push(`console.${d.params.type}: ${d.params.args.map((a: any) => a.value ?? a.description).join(" ")}`);
      if (d.method === "Runtime.exceptionThrown") logs.push(`exception: ${d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text}`);
      for (const l of listeners) l(d.method, d.params);
    };
    await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error("CDP socket failed")); });
    const cdp = (method: string, params: object = {}) =>
      new Promise<any>((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });

    await cdp("Runtime.enable");
    await cdp("Page.enable");
    await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });

    const evalIn = async <T,>(expr: string): Promise<T> => {
      const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`page eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value as T;
    };

    const page: Page = {
      logs,
      async goto(url) {
        const loaded = new Promise<void>((resolve) => {
          const l = (method: string) => { if (method === "Page.loadEventFired") { listeners.delete(l); resolve(); } };
          listeners.add(l);
        });
        await cdp("Page.navigate", { url });
        await loaded;
      },
      eval: evalIn,
      fonts: () => evalIn<string[]>(`(async () => {
        document.body?.getBoundingClientRect(); // a layout first, so every font the page uses has been requested
        await document.fonts.ready;
        return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/["']/g, ""));
      })()`),
      async waitFor(expr, timeoutMs = 10_000) {
        const end = Date.now() + timeoutMs;
        while (Date.now() < end) {
          if (await evalIn<boolean>(`!!(${expr})`).catch(() => false)) return;
          await sleep(50);
        }
        throw new Error(`timed out waiting for: ${expr}\n${logs.join("\n")}`);
      },
      async screenshot(file) {
        const r = await cdp("Page.captureScreenshot", { format: "png" });
        writeFileSync(file, Buffer.from(r.data, "base64"));
      },
      async setCpuThrottle(rate) {
        await cdp("Emulation.setCPUThrottlingRate", { rate });
      },
      async trace(ms) {
        const events: any[] = [];
        let done!: () => void;
        const complete = new Promise<void>((r) => (done = r));
        const l = (method: string, params: any) => {
          if (method === "Tracing.dataCollected") events.push(...params.value);
          if (method === "Tracing.tracingComplete") done();
        };
        listeners.add(l);
        await cdp("Tracing.start", { categories: "devtools.timeline,cc,disabled-by-default-devtools.timeline", transferMode: "ReportEvents" });
        await sleep(ms);
        await cdp("Tracing.end");
        await complete;
        listeners.delete(l);
        const out: Record<string, number> = {};
        for (const e of events) {
          if (e.ph === "X" && typeof e.dur === "number") out[e.name] = (out[e.name] ?? 0) + e.dur / 1000;
        }
        for (const k of Object.keys(out)) out[k] = (out[k] * 1000) / ms;
        return out;
      },
    };
    await fn(page);
  } finally {
    try { ws?.close(); } catch { /* already closed */ }
    proc.kill("SIGKILL");
    await new Promise((r) => setTimeout(r, 100));
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}
