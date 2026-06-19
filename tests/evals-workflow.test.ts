import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("eval workflow", () => {
  it("runs mock evals on PRs and gated real regression evals on scheduled/manual runs", async () => {
    const workflow = await readFile(".github/workflows/evals.yml", "utf8");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("npm run eval:mock");
    expect(workflow).toContain("ARK_API_KEY: ${{ secrets.ARK_API_KEY }}");
    expect(workflow).toContain("ARK_MODEL: ${{ secrets.ARK_MODEL }}");
    expect(workflow).toContain("run_real=true");
    expect(workflow).toContain("github.event_name != 'pull_request'");
    expect(workflow).toContain("npm run eval:regression");
    expect(workflow).toContain("actions/upload-artifact");
    expect(workflow).toContain("evals/results/**/*.jsonl");
    expect(workflow).toContain("evals/results/latest-summary.md");
  });
});
