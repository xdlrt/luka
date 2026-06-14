import { describe, expect, it } from "vitest";
import {
  buildDecompositionPrompt,
  parseDecompositionResponse,
} from "../../src/planning/decomposer.js";

describe("buildDecompositionPrompt", () => {
  it("includes task, project context, and decomposition requirements", () => {
    const prompt = buildDecompositionPrompt(
      "Add a REST API endpoint",
      "Express app with vitest tests"
    );

    expect(prompt).toContain("Add a REST API endpoint");
    expect(prompt).toContain("Express app with vitest tests");
    expect(prompt).toContain("3-7 ordered implementation steps");
    expect(prompt).toContain("independently verifiable");
    expect(prompt).toContain("numbered list");
  });

  it("handles empty project context", () => {
    expect(buildDecompositionPrompt("Fix bug", "")).toContain(
      "(none provided)"
    );
  });
});

describe("parseDecompositionResponse", () => {
  it("parses a numbered response into pending todo items", () => {
    expect(
      parseDecompositionResponse(
        [
          "1. Inspect existing routes and tests",
          "2. Add the endpoint handler",
          "3. Cover success and failure cases",
        ].join("\n")
      )
    ).toEqual([
      {
        id: "todo-1",
        content: "Inspect existing routes and tests",
        status: "pending",
      },
      { id: "todo-2", content: "Add the endpoint handler", status: "pending" },
      {
        id: "todo-3",
        content: "Cover success and failure cases",
        status: "pending",
      },
    ]);
  });

  it("parses checkbox and bullet responses", () => {
    expect(
      parseDecompositionResponse(
        [
          "- [ ] Inspect setup",
          "- [~] Implement endpoint",
          "- Add endpoint tests",
        ].join("\n")
      ).map((todo) => todo.content)
    ).toEqual(["Inspect setup", "Implement endpoint", "Add endpoint tests"]);
  });

  it("parses a REST API endpoint decomposition", () => {
    const todos = parseDecompositionResponse(
      [
        "1. Read the API routing and request validation code",
        "2. Define the endpoint contract and handler behavior",
        "3. Implement the handler and register the route",
        "4. Add tests for success, validation failure, and missing resource",
        "5. Run the targeted test suite",
      ].join("\n")
    );

    expect(todos).toHaveLength(5);
    expect(todos[0]?.content).toMatch(/routing/);
    expect(todos[4]?.content).toMatch(/test suite/);
  });

  it("throws when no todo steps can be parsed", () => {
    expect(() =>
      parseDecompositionResponse("No structured steps here")
    ).toThrow(/did not contain any todo steps/);
  });
});
