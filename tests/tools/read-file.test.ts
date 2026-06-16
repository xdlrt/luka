import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReadFileTool } from "../../src/tools/read-file.js";

describe("createReadFileTool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "luka-read-file-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("defines the read_file tool schema", () => {
    const tool = createReadFileTool(tempDir);

    expect(tool.name).toBe("read_file");
    expect(tool.category).toBe("read");
    expect(tool.parameters).toEqual({
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
          description: "Optional maximum number of lines to read; max 500",
        },
      },
      required: ["path"],
    });
  });

  it("reads an existing UTF-8 text file", async () => {
    await writeFile(path.join(tempDir, "hello.txt"), "hello\nworld", "utf8");
    const tool = createReadFileTool(tempDir);

    const result = await tool.execute({ path: "hello.txt" });

    expect(result).toEqual({
      tool_call_id: "read_file",
      output: "hello\nworld",
    });
  });

  it("reads an empty file", async () => {
    await writeFile(path.join(tempDir, "empty.txt"), "", "utf8");
    const tool = createReadFileTool(tempDir);

    const result = await tool.execute({ path: "empty.txt" });

    expect(result).toEqual({ tool_call_id: "read_file", output: "" });
  });

  it("returns full content for files with 500 lines or fewer", async () => {
    const content = numberedLines(500);
    await writeFile(path.join(tempDir, "small.txt"), content, "utf8");
    const tool = createReadFileTool(tempDir);

    const result = await tool.execute({ path: "small.txt" });

    expect(result).toEqual({
      tool_call_id: "read_file",
      output: content,
    });
  });

  it("truncates files larger than 500 lines by default", async () => {
    await writeFile(path.join(tempDir, "large.txt"), numberedLines(501), "utf8");
    const tool = createReadFileTool(tempDir);

    const result = await tool.execute({ path: "large.txt" });

    const lines = result.output.split("\n");
    expect(result.tool_call_id).toBe("read_file");
    expect(lines).toHaveLength(151);
    expect(lines[0]).toBe("line 1");
    expect(lines[99]).toBe("line 100");
    expect(lines[100]).toBe(
      "File truncated. Use offset/limit to read specific sections, or grep to find relevant parts."
    );
    expect(lines[101]).toBe("line 452");
    expect(lines[150]).toBe("line 501");
  });

  it("reads a specific 1-based line range with offset and limit", async () => {
    await writeFile(path.join(tempDir, "range.txt"), numberedLines(20), "utf8");
    const tool = createReadFileTool(tempDir);

    const result = await tool.execute({
      path: "range.txt",
      offset: 5,
      limit: 3,
    });

    expect(result).toEqual({
      tool_call_id: "read_file",
      output:
        "[read_file] Showing lines 5-7 of 20 from range.txt\nline 5\nline 6\nline 7",
    });
  });

  it("uses range defaults when only offset or only limit is provided", async () => {
    await writeFile(path.join(tempDir, "defaults.txt"), numberedLines(250), "utf8");
    const tool = createReadFileTool(tempDir);

    const offsetOnly = await tool.execute({ path: "defaults.txt", offset: 245 });
    const limitOnly = await tool.execute({ path: "defaults.txt", limit: 2 });

    expect(offsetOnly.output).toBe(
      "[read_file] Showing lines 245-250 of 250 from defaults.txt\nline 245\nline 246\nline 247\nline 248\nline 249\nline 250"
    );
    expect(limitOnly.output).toBe(
      "[read_file] Showing lines 1-2 of 250 from defaults.txt\nline 1\nline 2"
    );
  });

  it("returns an empty range when offset is beyond the file", async () => {
    await writeFile(path.join(tempDir, "short.txt"), numberedLines(3), "utf8");
    const tool = createReadFileTool(tempDir);

    const result = await tool.execute({
      path: "short.txt",
      offset: 10,
      limit: 2,
    });

    expect(result).toEqual({
      tool_call_id: "read_file",
      output: "[read_file] Showing lines 10-10 of 3 from short.txt",
    });
  });

  it("returns an error when offset or limit is invalid", async () => {
    const tool = createReadFileTool(tempDir);

    await expect(
      tool.execute({ path: "hello.txt", offset: 0 })
    ).resolves.toMatchObject({
      tool_call_id: "read_file",
      output: "",
      error: expect.stringMatching(/offset must be a positive integer/),
    });
    await expect(
      tool.execute({ path: "hello.txt", limit: "abc" })
    ).resolves.toMatchObject({
      tool_call_id: "read_file",
      output: "",
      error: expect.stringMatching(/limit must be a positive integer/),
    });
    await expect(
      tool.execute({ path: "hello.txt", limit: 501 })
    ).resolves.toMatchObject({
      tool_call_id: "read_file",
      output: "",
      error: expect.stringMatching(/limit must be less than or equal to 500/),
    });
  });

  it("returns an error when the file does not exist", async () => {
    const tool = createReadFileTool(tempDir);

    const result = await tool.execute({ path: "missing.txt" });

    expect(result.tool_call_id).toBe("read_file");
    expect(result.output).toBe("");
    expect(result.error).toMatch(/Failed to read file "missing.txt"/);
  });

  it("returns an error when path is missing or invalid", async () => {
    const tool = createReadFileTool(tempDir);

    await expect(tool.execute({})).resolves.toMatchObject({
      tool_call_id: "read_file",
      output: "",
      error: expect.stringMatching(/non-empty string path/),
    });
    await expect(tool.execute({ path: 123 })).resolves.toMatchObject({
      tool_call_id: "read_file",
      output: "",
      error: expect.stringMatching(/non-empty string path/),
    });
    await expect(tool.execute({ path: "   " })).resolves.toMatchObject({
      tool_call_id: "read_file",
      output: "",
      error: expect.stringMatching(/non-empty string path/),
    });
  });

  it("rejects absolute paths", async () => {
    const tool = createReadFileTool(tempDir);

    const result = await tool.execute({ path: path.join(tempDir, "hello.txt") });

    expect(result).toMatchObject({
      tool_call_id: "read_file",
      output: "",
      error: expect.stringMatching(/must be relative/),
    });
  });

  it("rejects paths containing parent traversal", async () => {
    const tool = createReadFileTool(tempDir);

    const result = await tool.execute({ path: "../secret.txt" });

    expect(result).toMatchObject({
      tool_call_id: "read_file",
      output: "",
      error: expect.stringMatching(/must not contain \.\./),
    });
  });

  it("returns an error for binary files", async () => {
    await writeFile(path.join(tempDir, "binary.bin"), Buffer.from([0, 1, 2]));
    const tool = createReadFileTool(tempDir);

    const result = await tool.execute({ path: "binary.bin" });

    expect(result).toMatchObject({
      tool_call_id: "read_file",
      output: "",
      error: expect.stringMatching(/cannot read binary file/),
    });
  });
});

function numberedLines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join(
    "\n"
  );
}
