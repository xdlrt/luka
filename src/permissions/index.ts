import { createInterface } from "node:readline/promises";
import { classifyTool, type ToolCategory } from "./categories.js";
import { classifyCommand } from "./command-classifier.js";
import type { ToolDefinition } from "../tools/types.js";

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

export interface PermissionOptions {
  autoApprove?: boolean;
}

export function createDefaultPermissionIO(): PermissionIO {
  let readline: ReturnType<typeof createInterface> | undefined;

  function getReadline(): ReturnType<typeof createInterface> {
    readline ??= createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return readline;
  }

  return {
    write(message: string): void {
      process.stdout.write(message);
    },
    async question(prompt: string): Promise<string> {
      try {
        return await getReadline().question(prompt);
      } finally {
        readline?.close();
        readline = undefined;
      }
    },
  };
}

export async function requestPermission(
  request: PermissionRequest,
  io: PermissionIO = createDefaultPermissionIO(),
  options: PermissionOptions = {}
): Promise<PermissionDecision> {
  if (options.autoApprove === true) {
    return { approved: true };
  }

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

export async function checkToolPermission(
  tool: ToolDefinition,
  input: Record<string, unknown>,
  optionsOrIO: PermissionOptions | PermissionIO = {},
  maybeIO?: PermissionIO
): Promise<PermissionDecision> {
  const io = isPermissionIO(optionsOrIO) ? optionsOrIO : maybeIO;
  const options = isPermissionIO(optionsOrIO) ? {} : optionsOrIO;

  return requestPermission(
    {
      toolName: tool.name,
      category: tool.category ?? classifyTool(tool.name),
      input,
    },
    io,
    options
  );
}

function isPermissionIO(value: PermissionOptions | PermissionIO): value is PermissionIO {
  return "write" in value && "question" in value;
}

function formatPermissionMessage(request: PermissionRequest): string {
  if (request.category === "write" && request.toolName === "write_file") {
    const path = formatValue(request.input.path);
    const preview = formatContentPreview(request.input.content);
    return `[PERMISSION] Write file: ${path}\nContent preview: ${preview}\n`;
  }

  if (request.category === "command" && request.toolName === "run_command") {
    const classification = classifyCommand(request.input.command);
    return `[PERMISSION] Run command: ${formatValue(request.input.command)}\nClassification: ${classification.kind}\nReason: ${classification.reasons.join("; ")}\n`;
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
