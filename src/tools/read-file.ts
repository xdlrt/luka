import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types.js";

const TOOL_CALL_ID = "read_file";
const MAX_FULL_READ_LINES = 500;
const TRUNCATED_HEAD_LINES = 100;
const TRUNCATED_TAIL_LINES = 50;
const DEFAULT_RANGE_LIMIT = 200;
const MAX_RANGE_LIMIT = 500;
const TRUNCATION_NOTICE =
  "File truncated. Use offset/limit to read specific sections, or grep to find relevant parts.";

function errorResult(message: string) {
  return { tool_call_id: TOOL_CALL_ID, output: "", error: message };
}

function validatePath(inputPath: unknown): string {
  if (typeof inputPath !== "string" || inputPath.trim() === "") {
    throw new Error("read_file requires a non-empty string path");
  }
  if (path.isAbsolute(inputPath)) {
    throw new Error("read_file path must be relative");
  }
  if (inputPath.split(/[\\/]+/).includes("..")) {
    throw new Error("read_file path must not contain ..");
  }
  return inputPath;
}

function validateOptionalPositiveInteger(
  value: unknown,
  name: string
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`read_file ${name} must be a positive integer`);
  }
  return parsed;
}

function isBinary(buffer: Buffer): boolean {
  return buffer.includes(0);
}

function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}

function shouldUseRange(input: Record<string, unknown>): boolean {
  return input.offset !== undefined || input.limit !== undefined;
}

function formatRangeOutput(
  inputPath: string,
  lines: string[],
  offset: number,
  limit: number
): string {
  const totalLines = lines.length;
  const startIndex = Math.min(offset - 1, totalLines);
  const endIndex = Math.min(startIndex + limit, totalLines);
  const selectedLines = lines.slice(startIndex, endIndex);
  const displayEnd = selectedLines.length === 0
    ? offset
    : offset + selectedLines.length - 1;
  const header = `[read_file] Showing lines ${offset}-${displayEnd} of ${totalLines} from ${inputPath}`;
  const content = selectedLines.join("\n");
  return content === "" ? header : `${header}\n${content}`;
}

function formatDefaultOutput(content: string): string {
  const lines = splitLines(content);
  if (lines.length <= MAX_FULL_READ_LINES) {
    return content;
  }

  const head = lines.slice(0, TRUNCATED_HEAD_LINES);
  const tail = lines.slice(-TRUNCATED_TAIL_LINES);
  return [...head, TRUNCATION_NOTICE, ...tail].join("\n");
}

export function createReadFileTool(workingDirectory: string): ToolDefinition {
  return {
    name: "read_file",
    description: "Read a UTF-8 text file from the working directory",
    category: "read",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to the file to read",
        },
        offset: {
          type: "integer",
          description: "Optional 1-based line number to start reading from",
        },
        limit: {
          type: "integer",
          description: `Optional maximum number of lines to read; max ${MAX_RANGE_LIMIT}`,
        },
      },
      required: ["path"],
    },
    async execute(input: Record<string, unknown>) {
      let inputPath: string;
      let offset: number | undefined;
      let limit: number | undefined;
      try {
        inputPath = validatePath(input.path);
        offset = validateOptionalPositiveInteger(input.offset, "offset");
        limit = validateOptionalPositiveInteger(input.limit, "limit");
        if (limit !== undefined && limit > MAX_RANGE_LIMIT) {
          return errorResult(
            `read_file limit must be less than or equal to ${MAX_RANGE_LIMIT}`
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(message);
      }

      const fullPath = path.resolve(workingDirectory, inputPath);
      try {
        const buffer = await readFile(fullPath);
        if (isBinary(buffer)) {
          return errorResult(`read_file cannot read binary file: ${inputPath}`);
        }
        const content = buffer.toString("utf8");
        if (shouldUseRange(input)) {
          return {
            tool_call_id: TOOL_CALL_ID,
            output: formatRangeOutput(
              inputPath,
              splitLines(content),
              offset ?? 1,
              limit ?? DEFAULT_RANGE_LIMIT
            ),
          };
        }
        return {
          tool_call_id: TOOL_CALL_ID,
          output: formatDefaultOutput(content),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`Failed to read file "${inputPath}": ${message}`);
      }
    },
  };
}
