/**
 * Bounded process runner — the ONLY place the bridge touches a subprocess.
 * Invariants: argument ARRAY (shell: false, always), bounded stdout/stderr,
 * bounded wall-clock, and a structured result that never throws for the
 * expected failure modes (missing binary, timeout, oversized output).
 */

import { spawn } from "node:child_process";

export interface EngineProcessOptions {
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly cwd: string;
  readonly env: Record<string, string>;
}

export interface EngineProcessResult {
  /** False when the process could not start at all (e.g. binary missing). */
  readonly started: boolean;
  readonly startError: string | null;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export interface EngineProcessRunner {
  run(command: string, args: readonly string[], opts: EngineProcessOptions): Promise<EngineProcessResult>;
}

/** Real runner. Tests inject a fake; nothing in the test suite spawns. */
export function createEngineProcessRunner(): EngineProcessRunner {
  return {
    run(command, args, opts) {
      return new Promise((resolve) => {
        const child = spawn(command, [...args], {
          cwd: opts.cwd,
          env: opts.env,
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stdoutBytes = 0;
        let stderrBytes = 0;
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let stdoutTruncated = false;
        let stderrTruncated = false;
        let timedOut = false;
        let startError: string | null = null;
        let settled = false;

        const timer = setTimeout(() => {
          timedOut = true;
          child.kill();
        }, opts.timeoutMs);

        child.stdout.on("data", (chunk: Buffer) => {
          stdoutBytes += chunk.length;
          if (stdoutBytes > opts.maxOutputBytes) {
            stdoutTruncated = true;
            child.kill();
          } else {
            stdoutChunks.push(chunk);
          }
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderrBytes += chunk.length;
          if (stderrBytes > opts.maxOutputBytes) {
            stderrTruncated = true;
            child.kill();
          } else {
            stderrChunks.push(chunk);
          }
        });

        const settle = (started: boolean, exitCode: number | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            started,
            startError,
            exitCode,
            timedOut,
            stdout: Buffer.concat(stdoutChunks).toString("utf8"),
            stderr: Buffer.concat(stderrChunks).toString("utf8"),
            stdoutTruncated,
            stderrTruncated,
          });
        };

        child.on("error", (err: NodeJS.ErrnoException) => {
          startError = err.code === "ENOENT" ? "ENOENT" : (err.message ?? "spawn failed");
          settle(false, null);
        });
        child.on("close", (code) => settle(true, code));
      });
    },
  };
}
