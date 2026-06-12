import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LLMClient } from "../src/llm-client.js";
import type { AppConfig } from "../src/config.js";
import type { ChatCompletionResponse } from "../src/types.js";

const baseConfig: AppConfig = {
  apiKey: "key-123",
  baseURL: "https://ark.example.com/api/v3",
  model: "doubao-test",
  maxTurns: 20,
  workingDirectory: "/tmp",
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
});
