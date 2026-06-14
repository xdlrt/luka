import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger.js";

describe("createLogger", () => {
  it("hides debug logs by default", () => {
    const writeLine = vi.fn();
    const logger = createLogger({ verbose: false, writeLine });

    logger.debug("debug line");
    logger.info("[TURN 1] started");

    expect(writeLine).toHaveBeenCalledTimes(1);
    expect(writeLine).toHaveBeenCalledWith("[TURN 1] started");
  });

  it("shows debug logs when verbose is enabled", () => {
    const writeLine = vi.fn();
    const logger = createLogger({ verbose: true, writeLine });

    logger.debug("debug line");

    expect(writeLine).toHaveBeenCalledWith("debug line");
  });

  it("writes warn and error logs without capturing stdout", () => {
    const writeLine = vi.fn();
    const logger = createLogger({ verbose: false, writeLine });

    logger.warn("[VERIFY] Tests failed (attempt 2/3): 1 failure");
    logger.error("boom");

    expect(writeLine).toHaveBeenCalledWith(
      "[VERIFY] Tests failed (attempt 2/3): 1 failure"
    );
    expect(writeLine).toHaveBeenCalledWith("boom");
  });
});
