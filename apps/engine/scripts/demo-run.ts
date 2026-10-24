// Plays the Maple Café meeting into a local-mode server and records what happened.
//
//   node scripts/demo-run.ts [--runs n] [--out dir] [--speed n] [--clean-text]
//
// Per run: starts `node src/server.ts --local` on a free port (TTS off, its own throwaway database), creates a
// session, opens the stage in headless Chrome at 1280x720, replays test/fixtures/sessions/maple-cafe.json, saves a
// screenshot per beat plus the handoff page, and writes report.json. Lines go in the way Recall's low-latency
// transcript gives them (lowercase, no punctuation), as in a real meeting; --clean-text sends the fixture's own text. The server's own models answer, so with
// OPENROUTER_API_KEY set this costs real money; with it empty the stage stays empty and the cost is 0.
// Prints only counts and paths, never transcript text.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { replay } from "./replay.ts";
import type { Fixture } from "./replay.ts";
import { withChrome } from "../test/helpers/chrome.ts";

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(ENGINE, "test/fixtures/sessions/maple-cafe.json");

/** Whether lines go in as Recall's low-latency transcript gives them: yes, unless --clean-text. */
export function useAsr(args: readonly string[]): boolean {
  return !args.includes("--clean-text");
}

/** Wait for the comparison only when the agent is on (a key is set); without one no comparison can appear. */
export function shouldWait(env: Record<string, string | undefined>): boolean {
  return !!(env.OPENROUTER_API_KEY ?? "").trim();
}

export type Report = {
  cost_usd: number;
  llm_tool_dropped: number;
  build_runs: number;
  ops_unoffered: number;
  spoken_picks: number;
  comparisons_resolved: number;
  replay_error?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Servers still running, so a signal can stop them. */
const active = new Set<() => Promise<void>>();
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    Promise.all([...active].map((stop) => stop())).finally(() => process.exit(1));
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

/** Counts the report fields out of the server's JSON log lines. */
export function countLogs(lines: string[]): Omit<Report, "cost_usd" | "comparisons_resolved"> {
  const out = { llm_tool_dropped: 0, build_runs: 0, ops_unoffered: 0, spoken_picks: 0 };
  for (const line of lines) {
    let e: { msg?: string; ops_unoffered?: unknown };
    try { e = JSON.parse(line); } catch { continue; }
    if (e.msg === "llm_tool_dropped") out.llm_tool_dropped++;
    else if (e.msg === "build.run") { out.build_runs++; out.ops_unoffered += Number(e.ops_unoffered) || 0; }
    else if (e.msg === "conversation.spoken_pick") out.spoken_picks++;
  }
  return out;
}

async function startServer(dir: string, port: number) {
  const lines: string[] = [];
  const logFile = path.join(dir, "server.log");
  const proc: ChildProcess = spawn(process.execPath, ["src/server.ts", "--local"], {
    cwd: ENGINE,
    // TTS_VOICE empty: no voice spend. SURREAL_PATH inside the run's folder: apps/engine/data is never touched.
    env: { ...process.env, PORT: String(port), TTS_VOICE: "", SURREAL_PATH: path.join(dir, "surreal") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buf = "";
  let up!: () => void;
  const listening = new Promise<void>((r) => (up = r));
  proc.stdout!.on("data", (d: Buffer) => {
    buf += d.toString();
    const parts = buf.split("\n");
    buf = parts.pop()!;
    for (const l of parts) {
      lines.push(l);
      if (l.startsWith("Listening on")) up();
    }
  });
  const errLog = createWriteStream(path.join(dir, "stderr.log")); // the server's own warnings and errors
  proc.stderr!.pipe(errLog);
  const exited = new Promise<never>((_, reject) => proc.once("exit", (c) => reject(new Error(`server exited early (${c})`))));
  exited.catch(() => {});
  const stop = async () => {
      writeFileSync(logFile, lines.join("\n") + "\n");
      if (proc.exitCode === null && proc.signalCode === null) {
        proc.kill("SIGTERM");
        await Promise.race([new Promise((r) => proc.once("exit", r)), sleep(5000)]);
        if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
      }
  };
  active.add(stop);
  const handle = { lines, stop: async () => { active.delete(stop); await stop(); } };
  try {
    await Promise.race([listening, exited, sleep(60_000).then(() => { throw new Error("server did not start in 60 s"); })]);
  } catch (err) {
    await handle.stop();
    throw err;
  }
  return handle;
}

async function oneRun(dir: string, speed: number, asr: boolean): Promise<Report> {
  mkdirSync(dir, { recursive: true });
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as Fixture;
  // Without a key the agent is off and no comparison can appear, so there is nothing to wait for.
  if (!shouldWait(process.env)) for (const u of fixture.utterances) delete u.waitFor;
  const port = await freePort();
  const server = await startServer(dir, port);
  try {
    const base = `http://localhost:${port}`;
    const created = await fetch(`${base}/api/local/sessions`, { method: "POST" });
    if (!created.ok) throw new Error(`could not create a session: ${created.status}`);
    const { session } = (await created.json()) as { session: { id: string; stage_url: string; handoff_url: string } };
    const stateUrl = (() => { const u = new URL(session.stage_url); u.pathname += "/state"; return u.toString(); })();
    const stage = async () => (await (await fetch(stateUrl)).json()) as { doc?: { conflicts?: { status: string }[] } };

    let replayError: string | undefined;
    await withChrome({ skip: (msg) => { throw new Error(msg ?? "Chrome not available"); } }, async (page) => {
      await page.goto(session.stage_url);
      // A waitFor that times out is a finding (the comparison never showed), not a reason to lose the run.
      await replay(fixture, {
        baseUrl: base, sessionId: session.id, secret: "", local: true, stateUrl, speed, asr,
        onShot: async (name) => { await page.screenshot(path.join(dir, `${name}.png`)); },
      }).catch((err) => { replayError = (err as Error).message; });
      await page.screenshot(path.join(dir, "final.png"));
      await page.goto(session.handoff_url);
      await sleep(500);
      await page.screenshot(path.join(dir, "handoff.png"));
      // The first screen is only the prototype; the decisions are further down.
      await page.eval(`document.getElementById("decisions")?.scrollIntoView()`);
      await sleep(200);
      await page.screenshot(path.join(dir, "handoff-decisions.png"));
    }, { width: 1280, height: 720 });

    const cost = ((await (await fetch(`${base}/api/sessions/${session.id}/cost`)).json()) as { cost_usd: number }).cost_usd;
    const conflicts = (await stage()).doc?.conflicts ?? [];
    const report: Report = {
      cost_usd: cost,
      ...countLogs(server.lines),
      comparisons_resolved: conflicts.filter((c) => c.status === "resolved").length,
      ...(replayError ? { replay_error: replayError } : {}),
    };
    writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2) + "\n");
    return report;
  } finally {
    await server.stop();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  // Like the server: a variable already set (even empty) wins over .env, so `OPENROUTER_API_KEY= node ...` stays a smoke run.
  const envFile = path.join(ENGINE, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const runs = Number(flag("--runs") ?? 1);
  const speed = Number(flag("--speed") ?? 1);
  if (!(runs >= 1) || !(speed > 0)) throw new Error("--runs and --speed must be positive numbers");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = path.resolve(flag("--out") ?? path.join(ENGINE, "../../.superpowers/demo-runs", stamp));
  mkdirSync(out, { recursive: true });
  if (!shouldWait(process.env)) {
    console.log("no OPENROUTER_API_KEY: the agent is off, so the stage stays empty");
  }
  const asr = useAsr(args);
  console.log(asr ? "lines: as the low-latency transcript gives them (lowercase, no punctuation)" : "lines: the fixture's own text (--clean-text)");
  const failed: number[] = [];
  for (let i = 1; i <= runs; i++) {
    const dir = runs > 1 ? path.join(out, `run-${i}`) : out;
    let r: Report;
    try { r = await oneRun(dir, speed, asr); } catch (err) {
      failed.push(i);
      console.log(`run ${i}/${runs}: failed: ${(err as Error).message}\n  ${dir}`);
      continue;
    }
    if (r.replay_error) failed.push(i);
    console.log(`run ${i}/${runs}: cost $${r.cost_usd.toFixed(4)}, ${r.build_runs} builds, ${r.llm_tool_dropped} dropped, ${r.ops_unoffered} unoffered, ${r.spoken_picks} spoken picks, ${r.comparisons_resolved} comparisons resolved${r.replay_error ? `, replay stopped: ${r.replay_error}` : ""}`);
    console.log(`  ${dir}`);
  }
  if (failed.length) throw new Error(`${failed.length} of ${runs} runs failed: run ${failed.join(", ")}`);
}

if (import.meta.main) {
  main().then(() => process.exit(0), (err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
}
