import type { AppConfig } from "./config.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  Message,
} from "./types.js";

export interface SendMessageOptions {
  temperature?: number;
  maxTokens?: number;
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

    let response: Response;
    try {
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

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `LLM request failed: ${response.status} ${response.statusText}` +
          (detail ? ` — ${detail}` : "")
      );
    }

    return (await response.json()) as ChatCompletionResponse;
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
