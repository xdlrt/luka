import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const ENV_KEYS = ["ARK_API_KEY", "ARK_MODEL", "BASE_URL", "MAX_TURNS"] as const;
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
  });

  it("reads overridable values from environment", () => {
    process.env.ARK_API_KEY = "key-123";
    process.env.ARK_MODEL = "doubao-test";
    process.env.BASE_URL = "https://example.com/v1";
    process.env.MAX_TURNS = "5";

    const config = loadConfig();

    expect(config.baseURL).toBe("https://example.com/v1");
    expect(config.maxTurns).toBe(5);
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
    });

    expect(config.apiKey).toBe("override-key");
    expect(config.model).toBe("override-model");
    expect(config.baseURL).toBe("https://override.example.com");
    expect(config.maxTurns).toBe(99);
    expect(config.workingDirectory).toBe("/tmp/work");
  });
});
