import fg from "fast-glob";
import path from "node:path";
import type { ToolDefinition } from "./types.js";

const TOOL_CALL_ID = "glob";
const DEFAULT_PATH = ".";
const MAX_RESULTS = 100;
const DEFAULT_IGNORES = ["**/node_modules/**", "**/.git/**", "**/dist/**"];

function errorResult(message: string) {
  return { tool_call_id: TOOL_CALL_ID, output: "", error: message };
}

function validatePath(inputPath: unknown): string {
  if (inputPath === undefined) {
    return DEFAULT_PATH;
  }
  if (typeof inputPath !== "string" || inputPath.trim() === "") {
    throw new Error("glob requires a non-empty string path when provided");
  }
  if (path.isAbsolute(inputPath)) {
    throw new Error("glob path must be relative");
  }
  if (inputPath.split(/[\\/]+/).includes("..")) {
    throw new Error("glob path must not contain ..");
  }
  return inputPath;
}

function validatePattern(pattern: unknown): string {
  if (typeof pattern !== "string" || pattern.trim() === "") {
    throw new Error("glob requires a non-empty string pattern");
  }
  if (path.isAbsolute(pattern)) {
    throw new Error("glob pattern must be relative");
  }
  if (pattern.split(/[\\/]+/).includes("..")) {
    throw new Error("glob pattern must not contain ..");
  }
  return pattern;
}

function toPosixPath(inputPath: string): string {
  return inputPath.split(path.sep).join("/");
}

export function createGlobTool(workingDirectory: string): ToolDefinition {
  return {
    name: "glob",
    description: "Find files in the working directory using a glob pattern",
    category: "read",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern for files to find, such as **/*.ts",
        },
        path: {
          type: "string",
          description: "Relative directory to search from; defaults to .",
        },
      },
      required: ["pattern"],
    },
    async execute(input: Record<string, unknown>) {
      let inputPath: string;
      let pattern: string;
      try {
        inputPath = validatePath(input.path);
        pattern = validatePattern(input.pattern);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(message);
      }

      const searchRoot = path.resolve(workingDirectory, inputPath);
      try {
        const entries = await fg(pattern, {
          cwd: searchRoot,
          onlyFiles: true,
          dot: true,
          ignore: DEFAULT_IGNORES,
          unique: true,
        });
        const files = entries
          .map((entry) =>
            toPosixPath(
              path.relative(workingDirectory, path.join(searchRoot, entry))
            )
          )
          .sort((a, b) => a.localeCompare(b));
        const visibleFiles = files.slice(0, MAX_RESULTS);

        if (visibleFiles.length === 0) {
          return { tool_call_id: TOOL_CALL_ID, output: "No files found" };
        }

        const output = [...visibleFiles];
        if (files.length > MAX_RESULTS) {
          output.push(`truncated: showing first ${MAX_RESULTS} files`);
        }
        return { tool_call_id: TOOL_CALL_ID, output: output.join("\n") };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`Failed to glob "${pattern}": ${message}`);
      }
    },
  };
}
