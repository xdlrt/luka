import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVAL_TMP_PREFIX } from "../src/brand.js";
import {
  loadTasks,
  loadSuite,
  runEvalSuite,
  runEvalTask,
  type AgentRunner,
} from "../src/evals/runner.js";
import type { EvalTask } from "../src/evals/types.js";
import type { EventRecorderLike } from "../src/observability/recorder.js";

describe("eval runner", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "luka-evals-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads tasks from JSON files in sorted order", async () => {
    const tasksDir = path.join(tempDir, "tasks");
    await writeTask(tasksDir, "02.json", createTask("02-task"));
    await writeTask(tasksDir, "01.json", createTask("01-task"));

    const tasks = await loadTasks(tasksDir);

    expect(tasks.map((task) => task.id)).toEqual(["01-task", "02-task"]);
  });

  it("runs a task, checks file expectations, and cleans temp dirs", async () => {
    const runner: AgentRunner = vi.fn(async (_input, config, _tools, recorder) => {
      await writeFile(
        path.join(config.workingDirectory, "notes.txt"),
        "done\n",
        "utf8"
      );
      emitSuccessfulTrace(recorder);
      return {
        finalMessage: "done",
        turnsUsed: 2,
        toolsCalled: ["write_file"],
        success: true,
        totalTokens: 4,
      };
    });

    const result = await runEvalTask(createTask("01-create-file"), runner);

    expect(result.passed).toBe(true);
    expect(result.taskId).toBe("01-create-file");
    expect(result.tracePath).toMatch(/\.jsonl$/);
    await expect(readFile(result.tracePath, "utf8")).resolves.toContain(
      "EvalTaskEnd"
    );
    expect(runner).toHaveBeenCalledTimes(1);
    await expectNoEvalTempDir("01-create-file");
  });

  it("reports failed expectations", async () => {
    const runner: AgentRunner = vi.fn(async (_input, _config, _tools, recorder) => {
      emitSuccessfulTrace(recorder);
      return agentResult(true);
    });

    const result = await runEvalTask(createTask("missing-file"), runner);

    expect(result.passed).toBe(false);
    expect(result.failureReason).toMatch(/expected file missing/);
  });

  it("writes suite results for --all", async () => {
    const tasksDir = path.join(tempDir, "tasks");
    const resultsDir = path.join(tempDir, "results");
    await writeTask(tasksDir, "01.json", createTask("01-create-file"));
    const runner: AgentRunner = vi.fn(async (_input, config, _tools, recorder) => {
      await writeFile(
        path.join(config.workingDirectory, "notes.txt"),
        "done\n",
        "utf8"
      );
      emitSuccessfulTrace(recorder);
      return {
        finalMessage: "done",
        turnsUsed: 1,
        toolsCalled: ["write_file"],
        success: true,
        totalTokens: 2,
      };
    });

    const result = await runEvalSuite({
      all: true,
      tasksDir,
      resultsDir,
      runner,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.passed).toBe(true);
    const saved = await readFile(
      path.join(resultsDir, `${result.runId}.json`),
      "utf8"
    );
    expect(saved).toContain("01-create-file");
    expect(result.reportPath).toBe(path.join(resultsDir, "latest-summary.md"));
  });

  it("runs a selected task only", async () => {
    const tasksDir = path.join(tempDir, "tasks");
    const resultsDir = path.join(tempDir, "results");
    await writeTask(tasksDir, "01.json", createTask("01-create-file"));
    await writeTask(tasksDir, "02.json", createTask("02-other"));
    const runner: AgentRunner = vi.fn(async (_input, config, _tools, recorder) => {
      await writeFile(
        path.join(config.workingDirectory, "notes.txt"),
        "done\n",
        "utf8"
      );
      emitSuccessfulTrace(recorder);
      return {
        finalMessage: "done",
        turnsUsed: 1,
        toolsCalled: ["write_file"],
        success: true,
        totalTokens: 2,
      };
    });

    const result = await runEvalSuite({
      taskId: "02-other",
      tasksDir,
      resultsDir,
      runner,
    });

    expect(result.results.map((item) => item.taskId)).toEqual(["02-other"]);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("loads and runs a named suite", async () => {
    const tasksDir = path.join(tempDir, "tasks");
    const suitesDir = path.join(tempDir, "suites");
    const resultsDir = path.join(tempDir, "results");
    await writeTask(tasksDir, "01.json", createTask("01-create-file"));
    await writeTask(tasksDir, "02.json", createTask("02-other"));
    await writeSuite(suitesDir, "smoke", ["02-other"]);

    expect(await loadSuite(suitesDir, "smoke")).toEqual({
      name: "smoke",
      taskIds: ["02-other"],
    });

    const result = await runEvalSuite({
      suite: "smoke",
      tasksDir,
      suitesDir,
      resultsDir,
      mock: true,
    });

    expect(result.selection).toEqual({ mode: "suite", value: "smoke" });
    expect(result.results.map((item) => item.taskId)).toEqual(["02-other"]);
  });

  it("supports repeat and marks flaky tasks", async () => {
    const tasksDir = path.join(tempDir, "tasks");
    const resultsDir = path.join(tempDir, "results");
    await writeTask(tasksDir, "01.json", createTask("01-create-file"));
    const runner = vi
      .fn<AgentRunner>()
      .mockImplementationOnce(async (_input, config, _tools, recorder) => {
        await writeFile(
          path.join(config.workingDirectory, "notes.txt"),
          "done\n",
          "utf8"
        );
        emitSuccessfulTrace(recorder);
        return agentResult(true);
      })
      .mockImplementationOnce(async (_input, _config, _tools, recorder) => {
        emitSuccessfulTrace(recorder);
        return agentResult(true);
      });

    const result = await runEvalSuite({
      all: true,
      repeat: 2,
      tasksDir,
      resultsDir,
      runner,
    });

    expect(result.results).toHaveLength(2);
    expect(result.summary.flakyTasks).toEqual(["01-create-file"]);
  });

  it("records eval task start and end events", async () => {
    const recorder = createRecorder();
    const runner: AgentRunner = vi.fn(async (_input, config, _tools, recorder) => {
      await writeFile(
        path.join(config.workingDirectory, "notes.txt"),
        "done\n",
        "utf8"
      );
      emitSuccessfulTrace(recorder);
      return {
        finalMessage: "done",
        turnsUsed: 1,
        toolsCalled: ["write_file"],
        success: true,
        totalTokens: 2,
      };
    });

    await runEvalTask(createTask("01-create-file"), runner, {
      createRecorder: () => recorder,
    });

    expect(recorder.emit).toHaveBeenCalledWith(
      "SessionStart",
      expect.objectContaining({
        mode: "eval",
        taskId: "01-create-file",
      })
    );
    expect(recorder.emit).toHaveBeenCalledWith(
      "EvalTaskStart",
      expect.objectContaining({
        taskId: "01-create-file",
        difficulty: "easy",
      })
    );
    expect(recorder.emit).toHaveBeenCalledWith(
      "EvalTaskEnd",
      expect.objectContaining({
        taskId: "01-create-file",
        passed: true,
      })
    );
    expect(recorder.emit).toHaveBeenCalledWith(
      "SessionEnd",
      expect.objectContaining({
        mode: "eval",
        taskId: "01-create-file",
        success: true,
      })
    );
  });
});

function createTask(id: string): EvalTask {
  return {
    id,
    description: "Create notes",
    difficulty: "easy",
    prompt: "Create notes.txt",
    setup: { files: {} },
    expectations: {
      files: [{ path: "notes.txt", contains: ["done"] }],
    },
  };
}

async function writeTask(
  tasksDir: string,
  fileName: string,
  task: EvalTask
): Promise<void> {
  await mkdir(tasksDir, { recursive: true });
  await writeFile(
    path.join(tasksDir, fileName),
    `${JSON.stringify(task, null, 2)}\n`,
    "utf8"
  );
}

async function writeSuite(
  suitesDir: string,
  name: string,
  taskIds: string[]
): Promise<void> {
  await mkdir(suitesDir, { recursive: true });
  await writeFile(
    path.join(suitesDir, `${name}.json`),
    `${JSON.stringify({ name, taskIds }, null, 2)}\n`,
    "utf8"
  );
}

async function expectNoEvalTempDir(taskId: string): Promise<void> {
  const entries = await readdir(os.tmpdir());
  expect(
    entries.some((entry) => entry.startsWith(`${EVAL_TMP_PREFIX}${taskId}-`))
  ).toBe(false);
}

function createRecorder(): EventRecorderLike {
  return {
    runId: "run-test",
    emit: vi.fn((type, payload = {}) => ({
      schemaVersion: 1,
      id: `${type}-id`,
      runId: "run-test",
      timestamp: "2026-06-14T01:02:03.000Z",
      type,
      payload,
    })),
    flush: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

function agentResult(success: boolean) {
  return {
    finalMessage: "done",
    turnsUsed: 1,
    toolsCalled: [],
    success,
    totalTokens: 2,
  };
}

function emitSuccessfulTrace(recorder: EventRecorderLike | undefined): void {
  recorder?.emit("LLMResponse", { turn: 1 });
  recorder?.emit("Stop", { success: true, finalState: "done" });
}
