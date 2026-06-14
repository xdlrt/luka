import { describe, expect, it } from "vitest";
import { runTests } from "../../src/verification/test-runner.js";

describe("runTests", () => {
  it("returns a passing result for a successful command", async () => {
    const result = await runTests(
      'node -e "console.log(\'ok\')"',
      process.cwd()
    );

    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/ok/);
    expect(result.stderr).toBe("");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns a failing result with exit code and stderr", async () => {
    const result = await runTests(
      'node -e "console.error(\'fail\'); process.exit(3)"',
      process.cwd()
    );

    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/fail/);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("preserves stdout and stderr from a failing command", async () => {
    const result = await runTests(
      'node -e "console.log(\'out\'); console.error(\'err\'); process.exit(1)"',
      process.cwd()
    );

    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/out/);
    expect(result.stderr).toMatch(/err/);
  });

  it("returns a failing result when the command times out", async () => {
    const result = await runTests(
      'node -e "setTimeout(() => {}, 1000)"',
      process.cwd(),
      { timeoutMs: 50 }
    );

    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Test command timed out after 50ms/);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("throws for invalid inputs", async () => {
    await expect(runTests("", process.cwd())).rejects.toThrow(
      /non-empty string command/
    );
    await expect(runTests("   ", process.cwd())).rejects.toThrow(
      /non-empty string command/
    );
    await expect(runTests("npm test", "")).rejects.toThrow(
      /non-empty string cwd/
    );
  });
});
