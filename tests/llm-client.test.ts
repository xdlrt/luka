import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LLMClient, parseResponse } from "../src/llm-client.js";
import { echoTool } from "../src/tools/echo.js";
import type { AppConfig } from "../src/config.js";
import type { ChatCompletionResponse } from "../src/types.js";

const baseConfig: AppConfig = {
  apiKey: "key-123",
  baseURL: "https://ark.example.com/api/v3",
  model: "doubao-test",
  maxTurns: 20,
  workingDirectory: "/tmp",
  autoApprove: false,
  maxRetries: 3,
  verbose: false,
  observability: {
    localDir: ".coding-agent/observability",
    feedback: {
      enabled: false,
      timeoutMs: 3000,
      batchSize: 20,
    },
    otel: {
      enabled: false,
      serviceName: "coding-agent",
      timeoutMs: 3000,
    },
  },
};

function jsonResponse(
  body: unknown,
  init: { status?: number; statusText?: string } = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: { "Content-Type": "application/json" },
  });
}

const sampleResponse: ChatCompletionResponse = {
  id: "resp-1",
  model: "doubao-test",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "4" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
};

describe("LLMClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to chat/completions with auth header and parses content", async () => {
    fetchMock.mockResolvedValue(jsonResponse(sampleResponse));

    const client = new LLMClient(baseConfig);
    const reply = await client.chat("system", "What is 2+2?");

    expect(reply).toBe("4");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ark.example.com/api/v3/chat/completions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer key-123");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("doubao-test");
    expect(body.messages).toEqual([
      { role: "system", content: "system" },
      { role: "user", content: "What is 2+2?" },
    ]);
  });

  it("strips trailing slash from baseURL", async () => {
    fetchMock.mockResolvedValue(jsonResponse(sampleResponse));

    const client = new LLMClient({
      ...baseConfig,
      baseURL: "https://ark.example.com/api/v3/",
    });
    await client.chat("system", "hi");

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ark.example.com/api/v3/chat/completions");
  });

  it("throws a readable error on non-2xx response", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse(
          { error: { message: "invalid api key" } },
          { status: 401, statusText: "Unauthorized" }
        )
      )
    );

    const client = new LLMClient(baseConfig);
    const error = await client.chat("system", "hi").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/401/);
    expect((error as Error).message).toMatch(/invalid api key/);
  });

  it("throws on network failure", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const client = new LLMClient(baseConfig);
    await expect(client.chat("system", "hi")).rejects.toThrow(/network error/);
  });

  it("throws when choices are empty", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ...sampleResponse, choices: [] })
    );

    const client = new LLMClient(baseConfig);
    await expect(client.chat("system", "hi")).rejects.toThrow(
      /missing message content/
    );
  });

  it("includes tools in the request body when provided", async () => {
    fetchMock.mockResolvedValue(jsonResponse(sampleResponse));

    const client = new LLMClient(baseConfig);
    await client.sendMessage(
      [{ role: "user", content: "hi" }],
      { tools: [echoTool] }
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.tools).toEqual([echoTool]);
  });
});

describe("parseResponse", () => {
  function toolCallResponse(args: string): ChatCompletionResponse {
    return {
      id: "resp-tool",
      model: "doubao-test",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "echo", arguments: args },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses a tool call into name and input", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const parsed = parseResponse(
      toolCallResponse(JSON.stringify({ message: "hello" }))
    );

    expect(parsed.finishReason).toBe("tool_calls");
    expect(parsed.text).toBeNull();
    expect(parsed.toolCalls).toEqual([
      { id: "call-1", name: "echo", input: { message: "hello" } },
    ]);
    expect(logSpy).toHaveBeenCalledWith(
      '[LLM] Model requested tool: echo({"message":"hello"})'
    );
  });

  it("returns text with no tool calls for a plain reply", () => {
    const parsed = parseResponse(sampleResponse);

    expect(parsed.text).toBe("4");
    expect(parsed.finishReason).toBe("stop");
    expect(parsed.toolCalls).toEqual([]);
  });

  it("treats empty arguments string as an empty input object", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const parsed = parseResponse(toolCallResponse(""));

    expect(parsed.toolCalls).toEqual([
      { id: "call-1", name: "echo", input: {} },
    ]);
  });

  it("throws a readable error on invalid tool arguments JSON", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(() => parseResponse(toolCallResponse("{not json"))).toThrow(
      /Failed to parse tool arguments for "echo"/
    );
  });
});
