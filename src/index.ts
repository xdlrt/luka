import { loadConfig } from "./config.js";
import { LLMClient, parseResponse } from "./llm-client.js";
import { echoTool } from "./tools/echo.js";
import type { Message } from "./types.js";

const SYSTEM_PROMPT = "You are a helpful assistant. Answer concisely.";

async function main(): Promise<void> {
  console.log("[CLI] Starting coding-agent demo");
  const question = process.argv.slice(2).join(" ").trim() || "What is 2+2?";
  console.log(`[CLI] User input: ${question}`);

  const config = loadConfig();
  console.log(
    `[CLI] Loaded config: model=${config.model}, baseURL=${config.baseURL}, maxTurns=${config.maxTurns}, workingDirectory=${config.workingDirectory}`
  );
  const client = new LLMClient(config);

  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: question },
  ];
  console.log(`[CLI] Built messages: count=${messages.length}`);
  console.log(`[CLI] Registered tools: ${echoTool.function.name}`);

  console.log("[CLI] Calling LLM");
  const response = await client.sendMessage(messages, { tools: [echoTool] });
  const parsed = parseResponse(response);
  console.log("[CLI] LLM call completed; parsing response");

  if (parsed.toolCalls.length > 0) {
    console.log(`[CLI] Branch: tool_calls (${parsed.toolCalls.length})`);
    for (const call of parsed.toolCalls) {
      console.log(`Tool call: ${call.name}`, call.input);
    }
  } else {
    console.log("[CLI] Branch: text");
    console.log(parsed.text ?? "");
  }
  console.log("[CLI] Done");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
