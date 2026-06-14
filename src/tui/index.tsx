import React from "react";
import { render } from "ink";
import type { AppConfig } from "../config.js";
import { createDefaultToolRegistry, type ToolRegistry } from "../tools/index.js";
import { TuiApp } from "./app.js";

export async function runTui(
  config: AppConfig,
  registry: ToolRegistry = createDefaultToolRegistry(config.workingDirectory)
): Promise<void> {
  const instance = render(<TuiApp config={config} registry={registry} />);
  await instance.waitUntilExit();
}

export { TuiApp };
