import { describe, expect, it } from "vitest";
import { parseEvalTask } from "../src/evals/types.js";

describe("parseEvalTask", () => {
  it("parses a valid task", () => {
    const task = parseEvalTask({
      id: "01-create-file",
      description: "Create file",
      difficulty: "easy",
      critical: true,
      prompt: "Create notes.txt",
      setup: { files: { "README.md": "hello" } },
      expectations: {
        files: [{ path: "README.md", contains: ["hello"] }],
        outputContains: ["done"],
      },
    });

    expect(task.id).toBe("01-create-file");
    expect(task.critical).toBe(true);
    expect(task.setup.files["README.md"]).toBe("hello");
    expect(task.expectations.files?.[0]?.contains).toEqual(["hello"]);
  });

  it("rejects invalid difficulty", () => {
    expect(() =>
      parseEvalTask({
        id: "bad",
        description: "Bad",
        difficulty: "tiny",
        prompt: "Do it",
        setup: { files: {} },
        expectations: {},
      })
    ).toThrow(/Invalid difficulty/);
  });

  it("rejects non-string setup file content", () => {
    expect(() =>
      parseEvalTask({
        id: "bad",
        description: "Bad",
        difficulty: "easy",
        prompt: "Do it",
        setup: { files: { "a.txt": 123 } },
        expectations: {},
      })
    ).toThrow(/setup.files.a.txt must be a string/);
  });
});
