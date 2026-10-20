// Writes a file only its owner can read or change (0600), whether or not it existed before: the saved sign-in files
// hold live session cookies. The text goes into a new 0600 file first, which then replaces the old one, so it is never
// readable by others, not even for a moment.
import { chmodSync, renameSync, rmSync, writeFileSync } from "node:fs";

export function writePrivateFile(path: string, text: string) {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, text, { mode: 0o600, flag: "wx" });
    chmodSync(temp, 0o600);
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}
