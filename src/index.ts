import { loadConfig } from "./config.js";
import { LLMClient } from "./llm-client.js";

const SYSTEM_PROMPT = "You are a helpful assistant. Answer concisely.";

async function main(): Promise<void> {
  const question = process.argv.slice(2).join(" ").trim() || "What is 2+2?";

  const config = loadConfig();
  const client = new LLMClient(config);

  const reply = await client.chat(SYSTEM_PROMPT, question);
  console.log(reply);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
