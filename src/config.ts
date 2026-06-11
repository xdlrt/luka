import { config as loadDotenv } from "dotenv";

export interface AppConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  maxTurns: number;
  workingDirectory: string;
}

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_MAX_TURNS = 20;

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
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(
          `Invalid MAX_TURNS: expected a positive integer, got "${raw}"`
        );
      }
      maxTurns = parsed;
    }
  }

  const baseURL =
    resolve(overrides.baseURL, process.env.BASE_URL) ?? DEFAULT_BASE_URL;
  const workingDirectory = overrides.workingDirectory ?? process.cwd();

  return { apiKey, baseURL, model, maxTurns, workingDirectory };
}
