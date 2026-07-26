import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "bin.js");

export interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the BUILT CLI exactly as a user would (node dist/bin.js …). */
export function runCli(args: string[]): Promise<CliRun> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { windowsHide: true },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? ((error as { code: number }).code)
            : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}
