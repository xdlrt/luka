import type { AppConfig } from "./config.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  Message,
  ParsedResponse,
  ParsedToolCall,
  ToolDefinition,
} from "./types.js";

export interface SendMessageOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
}

function summarizeMessages(messages: Message[]): string {
  return messages
    .map((message, index) => {
      const contentLength = message.content?.length ?? 0;
      const toolCalls = message.tool_calls?.length ?? 0;
      const suffix = toolCalls > 0 ? `, toolCalls=${toolCalls}` : "";
      return `#${index + 1}:${message.role}(contentChars=${contentLength}${suffix})`;
    })
    .join(", ");
}

function summarizeTools(tools: ToolDefinition[] | undefined): string {
  if (tools === undefined || tools.length === 0) return "none";
  return tools.map((tool) => tool.function.name).join(", ");
}

export class LLMClient {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly model: string;

  constructor(config: AppConfig) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL.replace(/\/+$/, "");
    this.model = config.model;
  }

  async sendMessage(
    messages: Message[],
    options: SendMessageOptions = {}
  ): Promise<ChatCompletionResponse> {
    const url = `${this.baseURL}/chat/completions`;
    const body: ChatCompletionRequest = {
      model: this.model,
      messages,
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
    if (options.tools !== undefined) body.tools = options.tools;

    console.log(
      `[LLM] Preparing request: model=${this.model}, url=${url}, messages=${messages.length}, tools=${summarizeTools(options.tools)}`
    );
    console.log(`[LLM] Message summary: ${summarizeMessages(messages)}`);

    let response: Response;
    const startedAt = Date.now();
    try {
      console.log("[LLM] Sending request to chat/completions");
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`LLM request failed: network error: ${reason}`);
    }
    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[LLM] Received HTTP response: status=${response.status} ${response.statusText}, elapsedMs=${elapsedMs}`
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.log(`[LLM] Error response body chars=${detail.length}`);
      throw new Error(
        `LLM request failed: ${response.status} ${response.statusText}` +
          (detail ? ` — ${detail}` : "")
      );
    }

    const rawResponseBody = await response.text();
    console.log(`[LLM] Raw response body:\n${rawResponseBody}`);

    let parsed: ChatCompletionResponse;
    try {
      parsed = JSON.parse(rawResponseBody) as ChatCompletionResponse;
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`LLM response JSON parse failed: ${reason}`);
    }

    const firstChoice = parsed.choices[0];
    console.log(
      `[LLM] Parsed response: id=${parsed.id}, model=${parsed.model}, choices=${parsed.choices.length}, finishReason=${firstChoice?.finish_reason ?? "none"}`
    );
    console.log(
      `[LLM] Usage: prompt=${parsed.usage.prompt_tokens}, completion=${parsed.usage.completion_tokens}, total=${parsed.usage.total_tokens}`
    );
    return parsed;
  }

  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    const result = await this.sendMessage(messages);
    const content = result.choices?.[0]?.message?.content;
    if (content == null) {
      throw new Error("LLM response missing message content");
    }
    return content;
  }
}

export function parseResponse(
  response: ChatCompletionResponse
): ParsedResponse {
  const choice = response.choices?.[0];
  const message = choice?.message;
  const text = message?.content ?? null;
  const finishReason = choice?.finish_reason ?? null;
  const rawToolCalls = message?.tool_calls ?? [];

  console.log(
    `[LLM] Parsing assistant message: finishReason=${finishReason ?? "none"}, textChars=${text?.length ?? 0}, toolCalls=${rawToolCalls.length}`
  );

  const toolCalls: ParsedToolCall[] = [];
  for (const call of rawToolCalls) {
    const raw = call.function.arguments;
    let input: Record<string, unknown>;
    console.log(
      `[LLM] Parsing tool call arguments: id=${call.id}, name=${call.function.name}, rawChars=${raw.length}`
    );
    if (raw === "" || raw == null) {
      input = {};
    } else {
      try {
        input = JSON.parse(raw) as Record<string, unknown>;
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new Error(
          `Failed to parse tool arguments for "${call.function.name}": ${reason}`
        );
      }
    }
    console.log(
      `[LLM] Model requested tool: ${call.function.name}(${JSON.stringify(input)})`
    );
    toolCalls.push({ id: call.id, name: call.function.name, input });
  }

  console.log(
    `[LLM] Parsed assistant result: branch=${toolCalls.length > 0 ? "tool_calls" : "text"}, parsedToolCalls=${toolCalls.length}`
  );

  return { text, toolCalls, finishReason };
}
