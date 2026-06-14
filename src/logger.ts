export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface LoggerOptions {
  verbose: boolean;
  writeLine?: (line: string) => void;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(options: LoggerOptions): Logger {
  const writeLine = options.writeLine ?? console.log;
  const minimumLevel: LogLevel = options.verbose ? "debug" : "info";

  function write(level: LogLevel, message: string): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minimumLevel]) return;
    writeLine(message);
  }

  return {
    debug: (message: string) => write("debug", message),
    info: (message: string) => write("info", message),
    warn: (message: string) => write("warn", message),
    error: (message: string) => write("error", message),
  };
}
