// Headless Chrome driven over CDP, for browser tests. Skips the test when Chrome is not installed.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
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
  /** Console messages and uncaught exceptions seen so far. */
  logs: string[];
};

type TestCtx = { skip(msg?: string): void };

export function chromePath(): string | undefined {
  const candidates = [process.env.CHROME_PATH, MAC_CHROME].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(p));
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withChrome(t: TestCtx, fn: (page: Page) => Promise<void>, opts: ChromeOpts = {}): Promise<void> {
  const bin = chromePath();
  if (!bin) return void t.skip("Chrome not found (set CHROME_PATH)");
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const port = await freePort();
  const dir = mkdtempSync(path.join(tmpdir(), "chrome-test-"));
  const proc: ChildProcess = spawn(bin, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${dir}`, `--window-size=${width},${height}`, `--remote-debugging-port=${port}`, "about:blank",
  ], { stdio: "ignore" });
  let ws: WebSocket | undefined;
  try {
    let target: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 100 && !target; i++) {
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as any[];
        target = list.find((x) => x.type === "page");
      } catch { /* not up yet */ }
      if (!target) await sleep(100);
    }
    if (!target) throw new Error("Chrome did not expose a debugging target");

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
