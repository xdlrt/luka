import { config as loadDotenv } from "dotenv";

export interface AppConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  maxTurns: number;
  workingDirectory: string;
  autoApprove: boolean;
  testCommand?: string;
  maxRetries: number;
  verbose: boolean;
}

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_MAX_TURNS = 20;
const DEFAULT_MAX_RETRIES = 3;

function resolve(
  overrideValue: string | undefined,
  envValue: string | undefined
): string | undefined {
  if (overrideValue !== undefined) return overrideValue;
  const trimmed = envValue?.trim();
  return trimmed ? trimmed : undefined;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  loadDotenv();

  const apiKey = resolve(overrides.apiKey, process.env.ARK_API_KEY);
  if (!apiKey) {
    throw new Error(
      "Missing API key: set ARK_API_KEY in environment or .env"
    );
  }

  const model = resolve(overrides.model, process.env.ARK_MODEL);
  if (!model) {
    throw new Error(
      "Missing model: set ARK_MODEL in environment or .env"
    );
  }

  let maxTurns = DEFAULT_MAX_TURNS;
  if (overrides.maxTurns !== undefined) {
    maxTurns = overrides.maxTurns;
  } else {
    const raw = process.env.MAX_TURNS?.trim();
    if (raw) {
      maxTurns = parsePositiveInteger(raw, "MAX_TURNS");
    }
  }

  const maxRetries =
    overrides.maxRetries !== undefined
      ? parsePositiveInteger(overrides.maxRetries, "maxRetries")
      : parseOptionalPositiveInteger(process.env.MAX_RETRIES, "MAX_RETRIES") ??
        DEFAULT_MAX_RETRIES;
  const baseURL =
    resolve(overrides.baseURL, process.env.BASE_URL) ?? DEFAULT_BASE_URL;
  const workingDirectory = overrides.workingDirectory ?? process.cwd();
  const autoApprove = overrides.autoApprove ?? false;
  const testCommand = resolve(overrides.testCommand, process.env.TEST_COMMAND);
  const verbose = overrides.verbose ?? parseBoolean(process.env.VERBOSE);

  return {
    apiKey,
    baseURL,
    model,
    maxTurns,
    workingDirectory,
    autoApprove,
    testCommand,
    maxRetries,
    verbose,
  };
}

function parseOptionalPositiveInteger(
  raw: string | undefined,
  name: string
): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return parsePositiveInteger(trimmed, name);
}

function parsePositiveInteger(raw: string | number, name: string): number {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${name}: expected a positive integer, got "${raw}"`
    );
  }
  return parsed;
}

function parseBoolean(raw: string | undefined): boolean {
  const trimmed = raw?.trim().toLowerCase();
  return trimmed === "1" || trimmed === "true";
}
