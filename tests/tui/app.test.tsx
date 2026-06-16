import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render as inkRender } from "ink-testing-library";
import {
  DEFAULT_OBSERVABILITY_DIR,
  OTEL_SERVICE_NAME,
  TUI_TITLE,
  TUI_WELCOME,
} from "../../src/brand.js";
import {
  TuiApp,
  type TuiSessionRunner,
} from "../../src/tui/app.js";
import { ToolRegistry } from "../../src/tools/index.js";
import type { AppConfig } from "../../src/config.js";

const baseConfig: AppConfig = {
  apiKey: "key-123",
  baseURL: "https://ark.example.com/api/v3",
  model: "doubao-test",
  maxTurns: 20,
  workingDirectory: "/tmp/project",
  autoApprove: false,
  maxRetries: 3,
  verbose: false,
  observability: {
    localDir: DEFAULT_OBSERVABILITY_DIR,
    feedback: {
      enabled: false,
      timeoutMs: 3000,
      batchSize: 20,
    },
    otel: {
      enabled: false,
      serviceName: OTEL_SERVICE_NAME,
      timeoutMs: 3000,
    },
  },
};

const instances: Array<ReturnType<typeof inkRender>> = [];

afterEach(() => {
  for (const instance of instances.splice(0)) {
    instance.unmount();
    instance.cleanup();
  }
  vi.restoreAllMocks();
});

describe("TuiApp", () => {
  it("renders the initial shell", () => {
    const instance = render(
      <TuiApp config={baseConfig} registry={new ToolRegistry()} />
    );

    expect(frame(instance)).toContain(TUI_TITLE);
    expect(frame(instance)).toContain("Ready");
    expect(frame(instance)).toContain("model: doubao-test");
    expect(frame(instance)).toContain("cwd: /tmp/project");
    expect(frame(instance)).toContain(TUI_WELCOME);
    expect(frame(instance)).toContain("permissions: manual approval");
    expect(frame(instance)).toContain("Enter to send - .exit or Ctrl+C to exit");
  });

  it("renders typed input at the prompt", async () => {
    const instance = render(
      <TuiApp config={baseConfig} registry={new ToolRegistry()} />
    );

    instance.stdin.write("hello");

    await waitFor(() => expect(frame(instance)).toContain("> hello"));
  });

  it("inserts text at the cursor with arrow-key navigation", async () => {
    const instance = render(
      <TuiApp config={baseConfig} registry={new ToolRegistry()} />
    );

    instance.stdin.write("helo");
    instance.stdin.write("\u001B[D");
    instance.stdin.write("l");

    await waitFor(() => expect(frame(instance)).toContain("> hello"));
  });

  it("supports backspace and delete around the cursor", async () => {
    const instance = render(
      <TuiApp config={baseConfig} registry={new ToolRegistry()} />
    );

    instance.stdin.write("hezllo");
    instance.stdin.write("\u001B[D");
    instance.stdin.write("\u001B[D");
    instance.stdin.write("\u001B[D");
    instance.stdin.write("\u007F");
    await waitFor(() => expect(frame(instance)).toContain("> hello"));

    instance.stdin.write("x");
    await waitFor(() => expect(frame(instance)).toContain("> hexllo"));
    instance.stdin.write("\u001B[D");
    instance.stdin.write("\u001B[3~");

    await waitFor(() => expect(frame(instance)).toContain("> hello"));
  });

  it("supports home, end, and ctrl cursor movement", async () => {
    const instance = render(
      <TuiApp config={baseConfig} registry={new ToolRegistry()} />
    );

    instance.stdin.write("world");
    instance.stdin.write("\u001B[H");
    instance.stdin.write("hello ");
    await waitFor(() => expect(frame(instance)).toContain("> hello world"));

    instance.stdin.write("\u0001");
    instance.stdin.write("say ");
    await waitFor(() =>
      expect(frame(instance)).toContain("> say hello world")
    );

    instance.stdin.write("\u0005");
    instance.stdin.write("!");
    await waitFor(() =>
      expect(frame(instance)).toContain("> say hello world!")
    );

    instance.stdin.write("\u0002");
    instance.stdin.write("?");
    await waitFor(() =>
      expect(frame(instance)).toContain("> say hello world?!")
    );

    instance.stdin.write("\u0006");
    instance.stdin.write(".");
    await waitFor(() =>
      expect(frame(instance)).toContain("> say hello world?!.")
    );
  });

  it("supports ctrl editing shortcuts", async () => {
    const instance = render(
      <TuiApp config={baseConfig} registry={new ToolRegistry()} />
    );

    instance.stdin.write("alpha beta gamma");
    instance.stdin.write("\u001B[D");
    instance.stdin.write("\u001B[D");
    instance.stdin.write("\u001B[D");
    instance.stdin.write("\u001B[D");
    instance.stdin.write("\u001B[D");
    instance.stdin.write("\u001B[D");
    instance.stdin.write("\u000B");
    await waitFor(() => expect(frame(instance)).toContain("> alpha beta"));

    instance.stdin.write("\u0017");
    await waitFor(() => expect(frame(instance)).toContain("> alpha "));

    instance.stdin.write("delta");
    await waitFor(() => expect(frame(instance)).toContain("> alpha delta"));

    instance.stdin.write("\u001B[D");
    instance.stdin.write("\u001B[D");
    instance.stdin.write("\u001B[D");
    instance.stdin.write("\u0015");
    await waitFor(() => expect(frame(instance)).toContain("> lta"));
  });

  it("submits user input and renders the agent result", async () => {
    const sessionRunner: TuiSessionRunner = vi.fn(async () => ({
      finalMessage: "done",
      turnsUsed: 1,
      toolsCalled: [],
      success: true,
      totalTokens: 2,
      todoDisplay: undefined,
    }));
    const instance = render(
      <TuiApp
        config={baseConfig}
        registry={new ToolRegistry()}
        sessionRunner={sessionRunner}
      />
    );
    await waitForInputReady(instance);

    await typeAndSubmit(instance, "hello");
    await waitFor(() => expect(frame(instance)).toContain("done"));

    expect(sessionRunner).toHaveBeenCalledWith(
      "hello",
      baseConfig,
      expect.any(ToolRegistry),
      expect.any(Object)
    );
    expect(frame(instance)).toContain("You");
    expect(frame(instance)).toContain("hello");
    expect(frame(instance)).toContain("Agent");
  });

  it("hides the startup screen after the first submitted message", async () => {
    const sessionRunner: TuiSessionRunner = vi.fn(async () => ({
      finalMessage: "done",
      turnsUsed: 1,
      toolsCalled: [],
      success: true,
      totalTokens: 2,
      todoDisplay: undefined,
    }));
    const instance = render(
      <TuiApp
        config={baseConfig}
        registry={new ToolRegistry()}
        sessionRunner={sessionRunner}
      />
    );
    await waitForInputReady(instance);

    expect(frame(instance)).toContain(TUI_WELCOME);

    await typeAndSubmit(instance, "hello");
    await waitFor(() => expect(frame(instance)).toContain("done"));

    expect(frame(instance)).not.toContain(TUI_WELCOME);
    expect(frame(instance)).toContain("You");
    expect(frame(instance)).toContain("Agent");
  });

  it("does not submit empty input", async () => {
    const sessionRunner = vi.fn();
    const instance = render(
      <TuiApp
        config={baseConfig}
        registry={new ToolRegistry()}
        sessionRunner={sessionRunner}
      />
    );
    await waitForInputReady(instance);

    instance.stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sessionRunner).not.toHaveBeenCalled();
  });

  it("exits on .exit", async () => {
    const onExit = vi.fn();
    const instance = render(
      <TuiApp
        config={baseConfig}
        registry={new ToolRegistry()}
        onExit={onExit}
      />
    );
    await waitForInputReady(instance);

    await typeAndSubmit(instance, ".exit");
    await waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
  });

  it("renders todo display and tool summary", async () => {
    const sessionRunner: TuiSessionRunner = vi.fn(async () => ({
      finalMessage: "updated",
      turnsUsed: 2,
      toolsCalled: ["todo_write", "read_file"],
      success: true,
      totalTokens: 4,
      todoDisplay: "Progress: 1/2 completed\n[x] Inspect",
    }));
    const instance = render(
      <TuiApp
        config={baseConfig}
        registry={new ToolRegistry()}
        sessionRunner={sessionRunner}
      />
    );
    await waitForInputReady(instance);

    await typeAndSubmit(instance, "plan");
    await waitFor(() =>
      expect(frame(instance)).toContain(
        "[TUI] Tools called: todo_write, read_file"
      )
    );

    expect(frame(instance)).toContain("Progress: 1/2 completed");
    expect(frame(instance)).toContain("updated");
  });

  it("renders max-turns status when the agent stops unsuccessfully", async () => {
    const sessionRunner: TuiSessionRunner = vi.fn(async () => ({
      finalMessage: "partial",
      turnsUsed: 3,
      toolsCalled: [],
      success: false,
      totalTokens: 6,
      todoDisplay: undefined,
    }));
    const instance = render(
      <TuiApp
        config={baseConfig}
        registry={new ToolRegistry()}
        sessionRunner={sessionRunner}
      />
    );
    await waitForInputReady(instance);

    await typeAndSubmit(instance, "try");
    await waitFor(() =>
      expect(frame(instance)).toContain("[TUI] Stopped after 3 turns")
    );
  });

  it("renders errors and restores input", async () => {
    const sessionRunner: TuiSessionRunner = vi.fn(async () => {
      throw new Error("boom");
    });
    const instance = render(
      <TuiApp
        config={baseConfig}
        registry={new ToolRegistry()}
        sessionRunner={sessionRunner}
      />
    );
    await waitForInputReady(instance);

    await typeAndSubmit(instance, "fail");
    await waitFor(() => expect(frame(instance)).toContain("Error: boom"));

    expect(frame(instance)).toContain("Ready");
  });

  it("renders running state at the prompt", async () => {
    const sessionRunner: TuiSessionRunner = vi.fn(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                finalMessage: "done",
                turnsUsed: 1,
                toolsCalled: [],
                success: true,
                totalTokens: 2,
                todoDisplay: undefined,
              }),
            50
          );
        })
    );
    const instance = render(
      <TuiApp
        config={baseConfig}
        registry={new ToolRegistry()}
        sessionRunner={sessionRunner}
      />
    );
    await waitForInputReady(instance);

    await typeAndSubmit(instance, "slow");
    await waitFor(() => expect(frame(instance)).toContain("> Running..."));
  });

  it("ignores ordinary input while a session is running", async () => {
    const sessionRunner: TuiSessionRunner = vi.fn(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                finalMessage: "done",
                turnsUsed: 1,
                toolsCalled: [],
                success: true,
                totalTokens: 2,
                todoDisplay: undefined,
              }),
            50
          );
        })
    );
    const instance = render(
      <TuiApp
        config={baseConfig}
        registry={new ToolRegistry()}
        sessionRunner={sessionRunner}
      />
    );
    await waitForInputReady(instance);

    await typeAndSubmit(instance, "slow");
    instance.stdin.write("ignored");
    await waitFor(() => expect(frame(instance)).toContain("> Running..."));
    await waitFor(() => expect(frame(instance)).toContain("done"));

    expect(frame(instance)).not.toContain("> ignored");
  });
});

function render(tree: React.ReactElement): ReturnType<typeof inkRender> {
  const instance = inkRender(tree);
  instances.push(instance);
  return instance;
}

function frame(instance: { lastFrame(): string | undefined }): string {
  return instance.lastFrame() ?? "";
}

async function waitForInputReady(instance: {
  lastFrame(): string | undefined;
}): Promise<void> {
  await waitFor(() => expect(frame(instance)).toContain(">"));
  await new Promise((resolve) => setTimeout(resolve, 25));
}

async function typeAndSubmit(
  instance: {
    stdin: { write(input: string): void };
    lastFrame(): string | undefined;
  },
  input: string
): Promise<void> {
  instance.stdin.write(input);
  await waitFor(() => expect(frame(instance)).toContain(`> ${input}`));
  instance.stdin.write("\r");
}

async function waitFor(assertion: () => void): Promise<void> {
  const timeoutAt = Date.now() + 1000;
  let lastError: unknown;
  while (Date.now() < timeoutAt) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("Timed out waiting for assertion");
}
