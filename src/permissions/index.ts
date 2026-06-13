import { createInterface } from "node:readline/promises";
import type { ToolCategory } from "./categories.js";

const CANCELLED_BY_USER = "Cancelled by user";

export interface PermissionRequest {
  toolName: string;
  category: ToolCategory;
  input: Record<string, unknown>;
}

export type PermissionDecision =
  | { approved: true }
  | { approved: false; reason: string };

export interface PermissionIO {
  write(message: string): void;
  question(prompt: string): Promise<string>;
}

export function createDefaultPermissionIO(): PermissionIO {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    write(message: string): void {
      process.stdout.write(message);
    },
    async question(prompt: string): Promise<string> {
      try {
        return await readline.question(prompt);
      } finally {
        readline.close();
      }
    },
  };
}

export async function requestPermission(
  request: PermissionRequest,
  io: PermissionIO = createDefaultPermissionIO()
): Promise<PermissionDecision> {
  if (request.category === "read") {
    return { approved: true };
  }

  io.write(formatPermissionMessage(request));
  const answer = (await io.question("Proceed? (y/n) ")).trim().toLowerCase();

  if (answer === "y") {
    return { approved: true };
  }

  return { approved: false, reason: CANCELLED_BY_USER };
}

function formatPermissionMessage(request: PermissionRequest): string {
  if (request.category === "write" && request.toolName === "write_file") {
    const path = formatValue(request.input.path);
    const preview = formatContentPreview(request.input.content);
    return `[PERMISSION] Write file: ${path}\nContent preview: ${preview}\n`;
  }

  if (request.category === "command" && request.toolName === "run_command") {
    return `[PERMISSION] Run command: ${formatValue(request.input.command)}\n`;
  }

  return `[PERMISSION] Execute tool: ${request.toolName}\n`;
}

function formatContentPreview(content: unknown): string {
  if (typeof content !== "string") {
    return "<non-string content>...";
  }

  const preview = content.split(/\r?\n/).slice(0, 3).join("\n");
  return `${preview}...`;
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? value : "<missing>";
}
