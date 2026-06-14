import { exec } from "node:child_process";
import { promisify } from "node:util";

const DEFAULT_TIMEOUT_MS = 60000;

const execAsync = promisify(exec);

export interface TestResult {
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface TestRunnerOptions {
  timeoutMs?: number;
}

interface ExecFailure extends Error {
  code?: number | string;
  killed?: boolean;
  stdout?: string;
  stderr?: string;
}

export async function runTests(
  command: string,
  cwd: string,
  options: TestRunnerOptions = {}
): Promise<TestResult> {
  validateInput(command, cwd);

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });

    return {
      passed: true,
      exitCode: 0,
      stdout,
      stderr,
      durationMs: elapsedSince(startedAt),
    };
  } catch (error) {
    const failure = toExecFailure(error);
    const stdout = failure.stdout ?? "";
    const stderr = failure.stderr ?? "";

    if (failure.killed === true) {
      return {
        passed: false,
        exitCode: 1,
        stdout,
        stderr: appendLine(
          stderr,
          `Test command timed out after ${timeoutMs}ms`
        ),
        durationMs: elapsedSince(startedAt),
      };
    }

    return {
      passed: false,
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      stdout,
      stderr,
      durationMs: elapsedSince(startedAt),
    };
  }
}

function validateInput(command: string, cwd: string): void {
  if (typeof command !== "string" || command.trim() === "") {
    throw new Error("runTests requires a non-empty string command");
  }

  if (typeof cwd !== "string" || cwd.trim() === "") {
    throw new Error("runTests requires a non-empty string cwd");
  }
}

function toExecFailure(error: unknown): ExecFailure {
  return error instanceof Error ? error : new Error(String(error));
}

function appendLine(base: string, line: string): string {
  return base.trim() === "" ? line : `${base}\n${line}`;
}

function elapsedSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}
