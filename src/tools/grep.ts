import fg from "fast-glob";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types.js";

const TOOL_CALL_ID = "grep";
const DEFAULT_PATH = ".";
const MAX_MATCHES = 50;
const DEFAULT_IGNORES = ["**/node_modules/**", "**/.git/**", "**/dist/**"];

interface Match {
  filePath: string;
  lineNumber: number;
  line: string;
}

function errorResult(message: string) {
  return { tool_call_id: TOOL_CALL_ID, output: "", error: message };
}

function validatePath(inputPath: unknown): string {
  if (inputPath === undefined) {
    return DEFAULT_PATH;
  }
  if (typeof inputPath !== "string" || inputPath.trim() === "") {
    throw new Error("grep requires a non-empty string path when provided");
  }
  if (path.isAbsolute(inputPath)) {
    throw new Error("grep path must be relative");
  }
  if (inputPath.split(/[\\/]+/).includes("..")) {
    throw new Error("grep path must not contain ..");
  }
  return inputPath;
}

function validatePattern(pattern: unknown): string {
  if (typeof pattern !== "string" || pattern.trim() === "") {
    throw new Error("grep requires a non-empty string pattern");
  }
  return pattern;
}

function validateInclude(include: unknown): string | undefined {
  if (include === undefined) {
    return undefined;
  }
  if (typeof include !== "string" || include.trim() === "") {
    throw new Error("grep requires a non-empty string include when provided");
  }
  if (path.isAbsolute(include)) {
    throw new Error("grep include must be relative");
  }
  if (include.split(/[\\/]+/).includes("..")) {
    throw new Error("grep include must not contain ..");
  }
  return include;
}

function isBinary(buffer: Buffer): boolean {
  return buffer.includes(0);
}

function toPosixPath(inputPath: string): string {
  return inputPath.split(path.sep).join("/");
}

function findMatches(
  content: string,
  filePath: string,
  pattern: RegExp
): Match[] {
  return content.split(/\r?\n/).flatMap((line, index) => {
    pattern.lastIndex = 0;
    return pattern.test(line)
      ? [{ filePath, lineNumber: index + 1, line }]
      : [];
  });
}

export function createGrepTool(workingDirectory: string): ToolDefinition {
  return {
    name: "grep",
    description: "Search UTF-8 text files in the working directory with a regex",
    category: "read",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "JavaScript regular expression pattern to search for",
        },
        path: {
          type: "string",
          description: "Relative directory to search from; defaults to .",
        },
        include: {
          type: "string",
          description: "Optional glob filter for files, such as **/*.ts",
        },
      },
      required: ["pattern"],
    },
    async execute(input: Record<string, unknown>) {
      let inputPath: string;
      let patternText: string;
      let include: string | undefined;
      let pattern: RegExp;
      try {
        inputPath = validatePath(input.path);
        patternText = validatePattern(input.pattern);
        include = validateInclude(input.include);
        pattern = new RegExp(patternText);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(message);
      }

      const searchRoot = path.resolve(workingDirectory, inputPath);
      try {
        const entries = await fg(include ?? "**/*", {
          cwd: searchRoot,
          onlyFiles: true,
          dot: true,
          ignore: DEFAULT_IGNORES,
          unique: true,
        });
        const files = entries
          .map((entry) => ({
            absolutePath: path.join(searchRoot, entry),
            relativePath: toPosixPath(
              path.relative(workingDirectory, path.join(searchRoot, entry))
            ),
          }))
          .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

        const matches: Match[] = [];
        for (const file of files) {
          if (matches.length > MAX_MATCHES) {
            break;
          }

          let buffer: Buffer;
          try {
            buffer = await readFile(file.absolutePath);
          } catch {
            continue;
          }

          if (isBinary(buffer)) {
            continue;
          }
          matches.push(
            ...findMatches(buffer.toString("utf8"), file.relativePath, pattern)
          );
        }

        if (matches.length === 0) {
          return { tool_call_id: TOOL_CALL_ID, output: "No matches found" };
        }

        const visibleMatches = matches.slice(0, MAX_MATCHES);
        const output = visibleMatches.map(
          (match) => `${match.filePath}:${match.lineNumber}: ${match.line}`
        );
        if (matches.length > MAX_MATCHES) {
          output.push(`truncated: showing first ${MAX_MATCHES} matches`);
        }
        return { tool_call_id: TOOL_CALL_ID, output: output.join("\n") };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`Failed to grep "${patternText}": ${message}`);
      }
    },
  };
}
