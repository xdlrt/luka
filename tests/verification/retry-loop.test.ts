import { describe, expect, it } from "vitest";
import {
  createRetryState,
  recordVerificationAttempt,
} from "../../src/verification/retry-loop.js";
import type { TestResult } from "../../src/verification/test-runner.js";

const config = {
  maxRetries: 3,
  testCommand: "npm test",
};

function result(passed: boolean): TestResult {
  return {
    passed,
    exitCode: passed ? 0 : 1,
    stdout: passed ? "ok" : "fail",
    stderr: "",
    durationMs: 10,
  };
}

describe("retry loop state", () => {
  it("asks the model to fix failing tests before the retry limit", () => {
    const attempt = recordVerificationAttempt(
      createRetryState(),
      config,
      result(false),
      "Tests failed: 1 of 2",
      "tools: edit_file"
    );

    expect(attempt.shouldRetry).toBe(true);
    expect(attempt.nextMessage).toBe(
      "Tests failed. Please fix the issues:\nTests failed: 1 of 2"
    );
    expect(attempt.result.success).toBe(false);
    expect(attempt.result.attempts).toBe(1);
    expect(attempt.result.history).toHaveLength(1);
    expect(attempt.result.history[0]).toMatchObject({
      attempt: 1,
      formattedResult: "Tests failed: 1 of 2",
      modelAction: "tools: edit_file",
    });
  });

  it("resets state after tests pass", () => {
    const first = recordVerificationAttempt(
      createRetryState(),
      config,
      result(false),
      "Tests failed",
      "edit"
    );

    const second = recordVerificationAttempt(
      first.state,
      config,
      result(true),
      "All tests passed",
      "edit"
    );

    expect(second.shouldRetry).toBe(false);
    expect(second.result.success).toBe(true);
    expect(second.result.message).toBe("[verification] All tests passed");
    expect(second.state.attempts).toBe(0);
    expect(second.state.history).toEqual([]);
  });

  it("stops retrying when maxRetries is reached", () => {
    let state = createRetryState();
    state = recordVerificationAttempt(
      state,
      { ...config, maxRetries: 2 },
      result(false),
      "first failure",
      "edit"
    ).state;

    const final = recordVerificationAttempt(
      state,
      { ...config, maxRetries: 2 },
      result(false),
      "second failure",
      "edit"
    );

    expect(final.shouldRetry).toBe(false);
    expect(final.nextMessage).toBe("Unable to fix after 2 attempts");
    expect(final.result.success).toBe(false);
    expect(final.result.attempts).toBe(2);
    expect(final.result.history).toHaveLength(2);
    expect(final.state.attempts).toBe(0);
  });

  it("treats maxRetries=1 as one failed attempt before stopping", () => {
    const final = recordVerificationAttempt(
      createRetryState(),
      { ...config, maxRetries: 1 },
      result(false),
      "failure",
      "edit"
    );

    expect(final.shouldRetry).toBe(false);
    expect(final.nextMessage).toBe("Unable to fix after 1 attempts");
  });
});
