import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGrepTool } from "../../src/tools/grep.js";

describe("createGrepTool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "luka-grep-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("defines the grep tool schema", () => {
    const tool = createGrepTool(tempDir);

    expect(tool.name).toBe("grep");
    expect(tool.category).toBe("read");
    expect(tool.parameters).toEqual({
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
    });
  });

  it("searches a single text file and returns line numbers", async () => {
    await writeFile(
      path.join(tempDir, "note.txt"),
      "first\nneedle here\nlast",
      "utf8"
    );
    const tool = createGrepTool(tempDir);

    const result = await tool.execute({
      pattern: "needle",
      include: "note.txt",
    });

    expect(result).toEqual({
      tool_call_id: "grep",
      output: "note.txt:2: needle here",
    });
  });

  it("searches recursively from a relative path", async () => {
    await mkdir(path.join(tempDir, "project/src"), { recursive: true });
    await writeFile(
      path.join(tempDir, "project/src/app.ts"),
      "export const token = 1;",
      "utf8"
    );
    await writeFile(
      path.join(tempDir, "project/readme.md"),
      "token docs",
      "utf8"
    );
    const tool = createGrepTool(tempDir);

    const result = await tool.execute({ pattern: "token", path: "project" });

    expect(result).toEqual({
      tool_call_id: "grep",
      output:
        "project/readme.md:1: token docs\nproject/src/app.ts:1: export const token = 1;",
    });
  });

  it("filters searched files with include", async () => {
    await writeFile(path.join(tempDir, "app.ts"), "target", "utf8");
    await writeFile(path.join(tempDir, "app.md"), "target", "utf8");
    const tool = createGrepTool(tempDir);

    const result = await tool.execute({ pattern: "target", include: "**/*.ts" });

    expect(result).toEqual({
      tool_call_id: "grep",
      output: "app.ts:1: target",
    });
  });

  it("returns a no matches message when nothing matches", async () => {
    await writeFile(path.join(tempDir, "note.txt"), "plain text", "utf8");
    const tool = createGrepTool(tempDir);

    const result = await tool.execute({ pattern: "missing" });

    expect(result).toEqual({
      tool_call_id: "grep",
      output: "No matches found",
    });
  });

  it("limits output to the first 50 matches", async () => {
    const content = Array.from({ length: 55 }, (_, index) => `needle ${index}`)
      .join("\n");
    await writeFile(path.join(tempDir, "many.txt"), content, "utf8");
    const tool = createGrepTool(tempDir);

    const result = await tool.execute({ pattern: "needle" });

    const lines = result.output.split("\n");
    expect(lines).toHaveLength(51);
    expect(lines[0]).toBe("many.txt:1: needle 0");
    expect(lines[49]).toBe("many.txt:50: needle 49");
    expect(lines[50]).toBe("truncated: showing first 50 matches");
  });

  it("ignores node_modules, .git, and dist by default", async () => {
    await mkdir(path.join(tempDir, "node_modules/pkg"), { recursive: true });
    await mkdir(path.join(tempDir, ".git/hooks"), { recursive: true });
    await mkdir(path.join(tempDir, "dist"), { recursive: true });
    await writeFile(path.join(tempDir, "src.ts"), "needle", "utf8");
    await writeFile(
      path.join(tempDir, "node_modules/pkg/index.ts"),
      "needle",
      "utf8"
    );
    await writeFile(
      path.join(tempDir, ".git/hooks/pre-commit.ts"),
      "needle",
      "utf8"
    );
    await writeFile(path.join(tempDir, "dist/bundle.ts"), "needle", "utf8");
    const tool = createGrepTool(tempDir);

    const result = await tool.execute({ pattern: "needle" });

    expect(result).toEqual({
      tool_call_id: "grep",
      output: "src.ts:1: needle",
    });
  });

  it("skips binary files", async () => {
    await writeFile(path.join(tempDir, "binary.bin"), Buffer.from([0, 1, 2]));
    await writeFile(path.join(tempDir, "text.txt"), "needle", "utf8");
    const tool = createGrepTool(tempDir);

    const result = await tool.execute({ pattern: "needle" });

    expect(result).toEqual({
      tool_call_id: "grep",
      output: "text.txt:1: needle",
    });
  });

  it("returns an error when inputs are invalid", async () => {
    const tool = createGrepTool(tempDir);

    await expect(tool.execute({})).resolves.toMatchObject({
      tool_call_id: "grep",
      output: "",
      error: expect.stringMatching(/non-empty string pattern/),
    });
    await expect(
      tool.execute({ pattern: "[", path: "." })
    ).resolves.toMatchObject({
      tool_call_id: "grep",
      output: "",
      error: expect.stringMatching(/Invalid regular expression/),
    });
    await expect(
      tool.execute({ pattern: "x", path: "../outside" })
    ).resolves.toMatchObject({
      tool_call_id: "grep",
      output: "",
      error: expect.stringMatching(/must not contain \.\./),
    });
    await expect(
      tool.execute({ pattern: "x", include: "../*.ts" })
    ).resolves.toMatchObject({
      tool_call_id: "grep",
      output: "",
      error: expect.stringMatching(/include must not contain \.\./),
    });
  });
});
