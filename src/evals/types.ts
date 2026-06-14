export type EvalDifficulty = "easy" | "medium" | "hard";

export interface EvalTask {
  id: string;
  description: string;
  difficulty: EvalDifficulty;
  prompt: string;
  setup: {
    files: Record<string, string>;
  };
  testCommand?: string;
  expectations: {
    files?: Array<{
      path: string;
      contains?: string[];
    }>;
    testsPassing?: boolean;
    outputContains?: string[];
  };
}

export interface EvalTaskResult {
  task_id: string;
  passed: boolean;
  turns_used: number;
  retries: number;
  wall_time_ms: number;
  failure_reason?: string;
}

export interface EvalRunResult {
  run_id: string;
  started_at: string;
  results: EvalTaskResult[];
}

export function parseEvalTask(value: unknown): EvalTask {
  const object = asRecord(value, "eval task");
  const id = requireString(object, "id");
  const description = requireString(object, "description");
  const difficulty = parseDifficulty(requireString(object, "difficulty"));
  const prompt = requireString(object, "prompt");
  const setup = parseSetup(object.setup);
  const expectations = parseExpectations(object.expectations);
  const testCommand = optionalString(object.testCommand, "testCommand");

  return {
    id,
    description,
    difficulty,
    prompt,
    setup,
    testCommand,
    expectations,
  };
}

function parseSetup(value: unknown): EvalTask["setup"] {
  const setup = asRecord(value, "setup");
  const files = asStringRecord(setup.files, "setup.files");
  return { files };
}

function parseExpectations(value: unknown): EvalTask["expectations"] {
  const expectations = asRecord(value, "expectations");
  const files = optionalFilesExpectation(expectations.files);
  const testsPassing = optionalBoolean(
    expectations.testsPassing,
    "expectations.testsPassing"
  );
  const outputContains = optionalStringArray(
    expectations.outputContains,
    "expectations.outputContains"
  );

  return {
    files,
    testsPassing,
    outputContains,
  };
}

function optionalFilesExpectation(
  value: unknown
): EvalTask["expectations"]["files"] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error("expectations.files must be an array");
  }

  return value.map((item, index) => {
    const file = asRecord(item, `expectations.files[${index}]`);
    return {
      path: requireString(file, "path"),
      contains: optionalStringArray(file.contains, "contains"),
    };
  });
}

function parseDifficulty(value: string): EvalDifficulty {
  if (value === "easy" || value === "medium" || value === "hard") {
    return value;
  }
  throw new Error(`Invalid difficulty: ${value}`);
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asStringRecord(value: unknown, name: string): Record<string, string> {
  const object = asRecord(value, name);
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(object)) {
    if (typeof item !== "string") {
      throw new Error(`${name}.${key} must be a string`);
    }
    result[key] = item;
  }
  return result;
}

function requireString(
  object: Record<string, unknown>,
  key: string
): string {
  const value = object[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean`);
  }
  return value;
}

function optionalStringArray(
  value: unknown,
  name: string
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new Error(`${name}[${index}] must be a non-empty string`);
    }
    return item;
  });
}
