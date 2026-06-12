import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWriteFileTool } from "../../src/tools/write-file.js";

describe("createWriteFileTool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "coding-agent-write-file-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("defines the write_file tool schema", () => {
    const tool = createWriteFileTool(tempDir);

    expect(tool.name).toBe("write_file");
    expect(tool.category).toBe("write");
    expect(tool.parameters).toEqual({
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to the file to write",
        },
        content: {
          type: "string",
          description: "UTF-8 text content to write",
        },
      },
      required: ["path", "content"],
    });
  });

  it("writes a new UTF-8 text file", async () => {
    const tool = createWriteFileTool(tempDir);

    const result = await tool.execute({
      path: "hello.txt",
      content: "hello\nworld",
    });

    await expect(readFile(path.join(tempDir, "hello.txt"), "utf8")).resolves.toBe(
      "hello\nworld"
    );
    expect(result).toEqual({
      tool_call_id: "write_file",
      output: "Wrote 11 characters to hello.txt",
    });
  });

  it("overwrites an existing file", async () => {
    await writeFile(path.join(tempDir, "note.txt"), "old", "utf8");
    const tool = createWriteFileTool(tempDir);

    const result = await tool.execute({ path: "note.txt", content: "new" });

    await expect(readFile(path.join(tempDir, "note.txt"), "utf8")).resolves.toBe(
      "new"
    );
    expect(result).toEqual({
      tool_call_id: "write_file",
      output: "Wrote 3 characters to note.txt",
    });
  });

  it("creates parent directories automatically", async () => {
    const tool = createWriteFileTool(tempDir);

    const result = await tool.execute({
      path: "nested/path/file.txt",
      content: "nested",
    });

    await expect(
      readFile(path.join(tempDir, "nested/path/file.txt"), "utf8")
    ).resolves.toBe("nested");
    expect(result).toEqual({
      tool_call_id: "write_file",
      output: "Wrote 6 characters to nested/path/file.txt",
    });
  });

  it("writes an empty content string", async () => {
    const tool = createWriteFileTool(tempDir);

    const result = await tool.execute({ path: "empty.txt", content: "" });

    await expect(readFile(path.join(tempDir, "empty.txt"), "utf8")).resolves.toBe(
      ""
    );
    expect(result).toEqual({
      tool_call_id: "write_file",
      output: "Wrote 0 characters to empty.txt",
    });
  });

  it("writes a file at the working directory root", async () => {
    const tool = createWriteFileTool(tempDir);

    const result = await tool.execute({ path: "root.txt", content: "root" });

    await expect(readFile(path.join(tempDir, "root.txt"), "utf8")).resolves.toBe(
      "root"
    );
    expect(result).toEqual({
      tool_call_id: "write_file",
      output: "Wrote 4 characters to root.txt",
    });
  });

  it("returns an error when path is missing or invalid", async () => {
    const tool = createWriteFileTool(tempDir);

    await expect(tool.execute({ content: "x" })).resolves.toMatchObject({
      tool_call_id: "write_file",
      output: "",
      error: expect.stringMatching(/non-empty string path/),
    });
    await expect(
      tool.execute({ path: 123, content: "x" })
    ).resolves.toMatchObject({
      tool_call_id: "write_file",
      output: "",
      error: expect.stringMatching(/non-empty string path/),
    });
    await expect(
      tool.execute({ path: "   ", content: "x" })
    ).resolves.toMatchObject({
      tool_call_id: "write_file",
      output: "",
      error: expect.stringMatching(/non-empty string path/),
    });
  });

  it("returns an error when content is missing or invalid", async () => {
    const tool = createWriteFileTool(tempDir);

    await expect(tool.execute({ path: "file.txt" })).resolves.toMatchObject({
      tool_call_id: "write_file",
      output: "",
      error: expect.stringMatching(/requires string content/),
    });
    await expect(
      tool.execute({ path: "file.txt", content: 123 })
    ).resolves.toMatchObject({
      tool_call_id: "write_file",
      output: "",
      error: expect.stringMatching(/requires string content/),
    });
  });

  it("rejects absolute paths", async () => {
    const tool = createWriteFileTool(tempDir);

    const result = await tool.execute({
      path: path.join(tempDir, "file.txt"),
      content: "x",
    });

    expect(result).toMatchObject({
      tool_call_id: "write_file",
      output: "",
      error: expect.stringMatching(/must be relative/),
    });
  });

  it("rejects paths containing parent traversal", async () => {
    const tool = createWriteFileTool(tempDir);

    const result = await tool.execute({ path: "../file.txt", content: "x" });

    expect(result).toMatchObject({
      tool_call_id: "write_file",
      output: "",
      error: expect.stringMatching(/must not contain \.\./),
    });
  });
});
