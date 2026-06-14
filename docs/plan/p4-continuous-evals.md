# P4: 可观测与持续评测 — Hooks + Telemetry + Eval

> **里程碑**：Agent 具备可观测事件流、可扩展 hook 机制、数据回流能力，以及基于观测数据的持续 eval 平台。

## 任务清单

- [x] **P4-W12-T1**: 定义可观测事件模型

  **说明**：先建立统一的 lifecycle event schema，让 Agent Loop、工具、权限、自验证和 eval 都围绕同一条事件流沉淀证据。持续 eval 后续只消费这些事件，不再各自拼接临时指标。

  ```typescript
  export type AgentEventType =
    | 'SessionStart'
    | 'UserPromptSubmit'
    | 'LLMRequest'
    | 'LLMResponse'
    | 'PreToolUse'
    | 'PostToolUse'
    | 'PermissionRequest'
    | 'VerificationStart'
    | 'VerificationEnd'
    | 'Stop'
    | 'SessionEnd'
    | 'EvalTaskStart'
    | 'EvalTaskEnd';

  export interface AgentEvent {
    schemaVersion: 1;
    id: string;
    runId: string;
    parentId?: string;
    timestamp: string;
    type: AgentEventType;
    payload: Record<string, unknown>;
  }
  ```

  **验收标准**：
  - 事件 schema 有版本号，非法版本和未知事件类型显式报错
  - 每个事件包含 `id`、`runId`、`timestamp`、`type`、`payload`
  - payload 禁止记录 `ARK_API_KEY`、完整环境变量、真实凭证或未脱敏的敏感命令输出
  - 单元测试覆盖合法事件、未知事件、非法 payload 和脱敏边界

  **关键文件**：`src/observability/events.ts`、`tests/observability/events.test.ts`

---

- [x] **P4-W12-T2**: 实现 hook runtime

  **说明**：参考 Codex/TraeX lifecycle hooks，但只实现当前项目需要的最小核心链路。Hook 是扩展点，不是 Agent 主流程的一部分；失败、超时和回流异常必须被记录，但默认不能中断用户任务。

  ```typescript
  export interface HookDefinition {
    type: 'command' | 'http';
    command?: string;
    url?: string;
    timeoutMs: number;
  }

  export interface HookConfig {
    hooks: Partial<Record<AgentEventType, HookDefinition[]>>;
  }
  ```

  **验收标准**：
  - 默认配置文件为 `agent-hooks.json`
  - CLI 支持 `--hooks-config <path>`，配置解析失败时启动失败
  - command hook 通过 stdin 接收事件 JSON
  - http hook 通过 `fetch` POST 事件 JSON
  - 同一事件类型可配置多个 hook，按配置顺序执行
  - hook 超时或失败时记录 hook failure 事件，不让单个 hook 阻塞主流程

  **关键文件**：`src/observability/hooks.ts`、`src/config.ts`、`src/index.ts`、`tests/observability/hooks.test.ts`、`tests/config.test.ts`、`tests/index.test.ts`

---

- [x] **P4-W12-T3**: 实现事件 recorder 与数据 sink

  **说明**：新增 `EventRecorder` 作为 Agent 内部唯一观测入口。默认写本地 JSONL，额外支持 HTTP feedback sink。HTTP 回流用于后续接入分析平台；本地 JSONL 是首版事实来源。

  ```json
  {
    "observability": {
      "localDir": ".coding-agent/observability",
      "feedback": {
        "enabled": false,
        "url": "https://example.com/events",
        "timeoutMs": 3000,
        "batchSize": 20
      }
    }
  }
  ```

  **验收标准**：
  - 每次 Agent run 生成稳定 `runId`
  - 默认写入 `.coding-agent/observability/{runId}.jsonl`
  - JSONL 每行一个 `AgentEvent`
  - HTTP feedback 支持单条或批量 POST
  - HTTP 失败默认不影响 Agent 成功状态，但计入 feedback health
  - recorder 写入失败有 stderr 提示，并在可恢复场景下继续主流程

  **关键文件**：`src/observability/recorder.ts`、`src/observability/sinks.ts`、`tests/observability/recorder.test.ts`、`tests/observability/sinks.test.ts`

---

- [x] **P4-W12-T4**: 接入 Agent 核心生命周期

  **说明**：把 recorder 接入真实执行链路。观测只记录“发生了什么”和必要摘要，不改变工具协议、LLM 消息协议或权限决策结果。

  **验收标准**：
  - `SessionStart` / `SessionEnd` 覆盖每次 CLI 请求和 eval task
  - `UserPromptSubmit` 记录用户输入摘要，不记录超长原文
  - `LLMRequest` / `LLMResponse` 记录模型、消息数量、tool call 数、耗时和 token 估算
  - `PreToolUse` / `PostToolUse` 记录工具名、参数摘要、结果摘要、耗时
  - `PermissionRequest` 记录工具类别、批准/拒绝结果
  - `Stop` 记录 success、turns、最终状态和错误摘要
  - 工具执行异常仍按 Agent Loop 规则转成 tool 消息回传给模型

  **关键文件**：`src/agent-loop.ts`、`src/llm-client.ts`、`src/permissions/index.ts`、`tests/agent-loop.test.ts`、`tests/agent-loop-permission.test.ts`

---

- [x] **P4-W13-T1**: 让 eval runner 消费观测 trace

  **说明**：重构 eval runner：任务执行仍走真实 Agent Loop，但结果指标从 trace JSONL 汇总，而不是在 runner 里重复埋点。这样普通 CLI 使用和 eval 使用共享同一套观测证据。

  **验收标准**：
  - 单任务运行：`npx tsx evals/runner.ts --task 01-create-file`
  - suite 运行：`npx tsx evals/runner.ts --suite smoke`
  - 全量运行：`npx tsx evals/runner.ts --all`
  - 重复运行：`npx tsx evals/runner.ts --suite regression --repeat 3`
  - 每个 eval result 包含 `runId`、`tracePath`、`taskId`、`passed`、`turnsUsed`、`toolCalls`、`permissionDeniedCount`、`verificationRuns`、`failureReason`、`feedbackStatus`
  - 真实 eval 仍要求 `ARK_API_KEY` 和 `ARK_MODEL`，禁止静默默认模型

  **关键文件**：`evals/runner.ts`、`evals/trace-reader.ts`、`tests/evals/runner.test.ts`、`tests/evals/trace-reader.test.ts`

---

- [x] **P4-W13-T2**: 实现 baseline、趋势报告和退化门禁

  **说明**：持续评测的核心是判断能力是否退化。门禁同时看 outcome 指标和行为指标，失败报告必须能指回具体 trace，便于复盘。

  **验收标准**：
  - `npx tsx evals/runner.ts --all --baseline evals/baselines/p4-continuous.json --check`
  - 门禁覆盖 pass rate、平均 turns、平均 tool calls、permission denied 数、verification runs、flaky rate、feedback success rate
  - `critical: true` 任务失败时直接失败
  - Markdown 报告包含通过率趋势、平均轮数、平均工具调用、反馈健康度、失败 Top N、flaky task、模型版本对比
  - dashboard 数据输出到 `evals/dashboard/data.json`
  - 每个失败项提供 `tracePath`

  **关键文件**：`evals/baseline.ts`、`evals/report.ts`、`evals/dashboard/data.json`、`tests/evals/baseline.test.ts`、`tests/evals/report.test.ts`

---

- [x] **P4-W13-T3**: 接入 CI、artifact 和可选回流

  **说明**：PR 上不依赖真实密钥，主要校验 schema、hook runtime、mock eval 和报告生成；main 分支或定时任务在 secrets 存在时运行真实 eval。CI 默认关闭 HTTP feedback，只上传 trace 和 eval 结果 artifact。

  **验收标准**：
  - PR：运行 `npm run eval:mock`，不要求 `ARK_API_KEY`
  - push/main 或 schedule：存在 `ARK_API_KEY` 和 `ARK_MODEL` secrets 时运行真实 eval
  - 无 secrets 时明确输出 skip 原因，并且不把真实 eval 标记为失败
  - 上传 observability JSONL、eval result 和 summary report 为 artifact
  - CI 不提交或改写 repo 文件
  - HTTP feedback 只有显式配置时才启用

  **关键文件**：`.github/workflows/evals.yml`、`package.json`

---

- [x] **P4-W13-T4**: 文档化 hooks、观测和持续 eval

  **说明**：README 和计划文档必须清楚区分“当前已实现”和“规划中”。P4 完成后，文档要说明 hooks、事件、数据回流、eval runner、baseline 和 CI 的使用方式。

  **验收标准**：
  - README 包含本地 trace 位置、hook 配置示例、HTTP feedback 配置、CI 行为、更新 baseline、解读失败
  - 文档说明真实 LLM eval 会受模型波动影响，需要 repeat/flaky 机制辅助判断
  - 文档说明无密钥 CI 只运行 mock eval、hook runtime 和报告校验
  - `docs/commit-notes.md` 在相关提交中记录可观测与评测系统的设计取舍和验证证据
  - 全量 eval 运行完成并生成首个持续评测基线
  - 基线保存为 `evals/baselines/p4-continuous.json`
  - 生成 `evals/results/latest-summary.md`
  - `npm run build`、`npm test`、`npm run eval:mock` 通过
  - **P4 里程碑达成**：项目具备可观测事件流、可扩展 hook 机制、数据回流能力和基于观测数据的持续 eval 平台

  **关键文件**：`README.md`、`docs/commit-notes.md`、`evals/baselines/p4-continuous.json`、`evals/results/latest-summary.md`

---
