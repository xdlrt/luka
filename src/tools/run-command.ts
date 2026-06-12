import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition } from "./types.js";

const TOOL_CALL_ID = "run_command";
const DEFAULT_TIMEOUT_MS = 30000;

const execAsync = promisify(exec);

interface ExecError extends Error {
  code?: number;
  killed?: boolean;
  signal?: NodeJS.Signals;
  stdout?: string;
  stderr?: string;
}

function errorResult(message: string, output = "") {
  return { tool_call_id: TOOL_CALL_ID, output, error: message };
}

function appendStderr(stdout: string, stderr: string): string {
  if (stderr.trim() === "") return stdout;
  return stdout === "" ? `[stderr]\n${stderr}` : `${stdout}\n[stderr]\n${stderr}`;
}

export interface RunCommandOptions {
  timeoutMs?: number;
}

export function createRunCommandTool(
  workingDirectory: string,
  options: RunCommandOptions = {}
): ToolDefinition {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    name: "run_command",
    description:
      "Run a shell command in the working directory and return its output",
    category: "command",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute",
        },
      },
      required: ["command"],
    },
    async execute(input: Record<string, unknown>) {
      const command = input.command;
      if (typeof command !== "string" || command.trim() === "") {
        return errorResult("run_command requires a non-empty string command");
      }

      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: workingDirectory,
          timeout: timeoutMs,
          killSignal: "SIGKILL",
        });
        return {
          tool_call_id: TOOL_CALL_ID,
          output: appendStderr(stdout, stderr),
        };
      } catch (error) {
        const execError = error as ExecError;
        const stdout = execError.stdout ?? "";
        const stderr = execError.stderr ?? "";

        if (execError.killed === true) {
          return errorResult(
            `run_command timed out after ${timeoutMs}ms`,
            stdout
          );
        }

        const exitCode = typeof execError.code === "number" ? execError.code : 1;
        const detail = stderr.trim() === "" ? execError.message : stderr;
        return errorResult(`${detail} (exit code: ${exitCode})`, stdout);
      }
    },
  };
}
