// Writes a file only its owner can read or change (0600), whether or not it existed before: the saved sign-in files
// hold live session cookies. A mode given to writeFile applies only to a new file, so the mode is set again after.
import { chmodSync, writeFileSync } from "node:fs";

export function writePrivateFile(path: string, text: string) {
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
}
