import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writePrivateFile } from "../scripts/private-file.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("writePrivateFile (saved sign-in files)", () => {
  it.skipIf(process.platform === "win32")("writes 0600, also over a file that was readable by others", () => {
    const dir = mkdtempSync(join(tmpdir(), "private-file-"));
    dirs.push(dir);
    const fresh = join(dir, "signed-in.json");
    writePrivateFile(fresh, "{}");
    expect(statSync(fresh).mode & 0o777).toBe(0o600);
    const old = join(dir, "pending.json");
    writeFileSync(old, "old", { mode: 0o644 });
    writePrivateFile(old, "{}");
    expect(statSync(old).mode & 0o777).toBe(0o600);
  });
});
