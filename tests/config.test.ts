import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv", () => ({ config: () => ({ parsed: {} }) }));

import { loadConfig } from "../src/config.js";

const ENV_KEYS = [
  "ARK_API_KEY",
  "ARK_MODEL",
  "BASE_URL",
  "MAX_TURNS",
  "TEST_COMMAND",
  "MAX_RETRIES",
  "VERBOSE",
  "HOOKS_CONFIG",
  "OBSERVABILITY_DIR",
  "OBSERVABILITY_FEEDBACK_URL",
  "OBSERVABILITY_FEEDBACK_TIMEOUT_MS",
  "OBSERVABILITY_FEEDBACK_BATCH_SIZE",
] as const;
const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

describe("loadConfig", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("applies defaults when only required vars are set", () => {
    process.env.ARK_API_KEY = "key-123";
    process.env.ARK_MODEL = "doubao-test";

    const config = loadConfig();

    expect(config.apiKey).toBe("key-123");
    expect(config.model).toBe("doubao-test");
    expect(config.baseURL).toBe(DEFAULT_BASE_URL);
    expect(config.maxTurns).toBe(20);
    expect(config.workingDirectory).toBe(process.cwd());
    expect(config.autoApprove).toBe(false);
    expect(config.testCommand).toBeUndefined();
    expect(config.maxRetries).toBe(3);
    expect(config.verbose).toBe(false);
    expect(config.hooksConfigPath).toBeUndefined();
    expect(config.observability).toEqual({
      localDir: ".coding-agent/observability",
      feedback: {
        enabled: false,
        url: undefined,
        timeoutMs: 3000,
        batchSize: 20,
      },
    });
  });

  it("reads TEST_COMMAND from environment and ignores blank values", () => {
    process.env.ARK_API_KEY = "key-123";
    process.env.ARK_MODEL = "doubao-test";
    process.env.TEST_COMMAND = "npm test";

    expect(loadConfig().testCommand).toBe("npm test");

    process.env.TEST_COMMAND = "   ";
    expect(loadConfig().testCommand).toBeUndefined();
  });

  it("reads overridable values from environment", () => {
    process.env.ARK_API_KEY = "key-123";
    process.env.ARK_MODEL = "doubao-test";
    process.env.BASE_URL = "https://example.com/v1";
    process.env.MAX_TURNS = "5";
    process.env.MAX_RETRIES = "2";
    process.env.VERBOSE = "true";
    process.env.HOOKS_CONFIG = "hooks.json";
    process.env.OBSERVABILITY_DIR = ".agent/events";
    process.env.OBSERVABILITY_FEEDBACK_URL = "https://feedback.example/events";
    process.env.OBSERVABILITY_FEEDBACK_TIMEOUT_MS = "1000";
    process.env.OBSERVABILITY_FEEDBACK_BATCH_SIZE = "5";

    const config = loadConfig();

    expect(config.baseURL).toBe("https://example.com/v1");
    expect(config.maxTurns).toBe(5);
    expect(config.maxRetries).toBe(2);
    expect(config.verbose).toBe(true);
    expect(config.hooksConfigPath).toBe("hooks.json");
    expect(config.observability).toEqual({
      localDir: ".agent/events",
      feedback: {
        enabled: true,
        url: "https://feedback.example/events",
        timeoutMs: 1000,
        batchSize: 5,
      },
    });
  });

  it("throws when ARK_API_KEY is missing", () => {
    process.env.ARK_MODEL = "doubao-test";
    expect(() => loadConfig()).toThrow(/ARK_API_KEY/);
  });

  it("throws when ARK_MODEL is missing", () => {
    process.env.ARK_API_KEY = "key-123";
    expect(() => loadConfig()).toThrow(/ARK_MODEL/);
  });

  it("throws when MAX_TURNS is not a positive integer", () => {
    process.env.ARK_API_KEY = "key-123";
    process.env.ARK_MODEL = "doubao-test";
    process.env.MAX_TURNS = "not-a-number";
    expect(() => loadConfig()).toThrow(/MAX_TURNS/);
  });

  it("throws when MAX_RETRIES is not a positive integer", () => {
    process.env.ARK_API_KEY = "key-123";
    process.env.ARK_MODEL = "doubao-test";
    process.env.MAX_RETRIES = "0";
    expect(() => loadConfig()).toThrow(/MAX_RETRIES/);

    process.env.MAX_RETRIES = "1.5";
    expect(() => loadConfig()).toThrow(/MAX_RETRIES/);
  });

  it("throws when observability numeric values are invalid", () => {
    process.env.ARK_API_KEY = "key-123";
    process.env.ARK_MODEL = "doubao-test";
    process.env.OBSERVABILITY_FEEDBACK_TIMEOUT_MS = "0";
    expect(() => loadConfig()).toThrow(/OBSERVABILITY_FEEDBACK_TIMEOUT_MS/);

    process.env.OBSERVABILITY_FEEDBACK_TIMEOUT_MS = "1000";
    process.env.OBSERVABILITY_FEEDBACK_BATCH_SIZE = "1.5";
    expect(() => loadConfig()).toThrow(/OBSERVABILITY_FEEDBACK_BATCH_SIZE/);
  });

  it("validates observability override values", () => {
    process.env.ARK_API_KEY = "key-123";
    process.env.ARK_MODEL = "doubao-test";

    expect(() =>
      loadConfig({
        observability: {
          localDir: "",
          feedback: { enabled: false, timeoutMs: 3000, batchSize: 20 },
        },
      })
    ).toThrow(/observability.localDir/);

    expect(() =>
      loadConfig({
        observability: {
          localDir: ".events",
          feedback: { enabled: false, timeoutMs: 0, batchSize: 20 },
        },
      })
    ).toThrow(/observability.feedback.timeoutMs/);
  });

  it("lets overrides take precedence over environment", () => {
    process.env.ARK_API_KEY = "env-key";
    process.env.ARK_MODEL = "env-model";
    process.env.MAX_TURNS = "5";

    const config = loadConfig({
      apiKey: "override-key",
      model: "override-model",
      baseURL: "https://override.example.com",
      maxTurns: 99,
      workingDirectory: "/tmp/work",
      autoApprove: true,
      testCommand: "vitest run",
      maxRetries: 7,
      verbose: true,
      hooksConfigPath: "override-hooks.json",
      observability: {
        localDir: ".override/events",
        feedback: {
          enabled: true,
          url: "https://override.example/events",
          timeoutMs: 9,
          batchSize: 2,
        },
      },
    });

    expect(config.apiKey).toBe("override-key");
    expect(config.model).toBe("override-model");
    expect(config.baseURL).toBe("https://override.example.com");
    expect(config.maxTurns).toBe(99);
    expect(config.workingDirectory).toBe("/tmp/work");
    expect(config.autoApprove).toBe(true);
    expect(config.testCommand).toBe("vitest run");
    expect(config.maxRetries).toBe(7);
    expect(config.verbose).toBe(true);
    expect(config.hooksConfigPath).toBe("override-hooks.json");
    expect(config.observability).toEqual({
      localDir: ".override/events",
      feedback: {
        enabled: true,
        url: "https://override.example/events",
        timeoutMs: 9,
        batchSize: 2,
      },
    });
  });
});
