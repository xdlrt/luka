import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("eval workflow", () => {
  it("runs mock evals on PRs and uploads artifacts", async () => {
    const workflow = await readFile(".github/workflows/evals.yml", "utf8");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("npm run eval:mock");
    expect(workflow).not.toContain("push:");
    expect(workflow).not.toContain("schedule:");
    expect(workflow).not.toContain("npm run eval -- --suite regression --repeat 1");
    expect(workflow).toContain("actions/upload-artifact");
    expect(workflow).toContain("evals/results/**/*.jsonl");
    expect(workflow).toContain("evals/results/latest-summary.md");
  });
});
