# P9: 工具执行编排升级

> **里程碑**：Agent 能并发执行只读工具、串行执行写入和命令工具，支持中断、大输出处理和稳定的工具消息顺序。

## 任务清单

- [ ] **P9-W19-T1**: 为运行时工具协议增加并发安全标记

  **说明**：在 `src/tools/types.ts` 的运行时 `ToolDefinition` 中新增 `isConcurrencySafe?(input): boolean`。默认 false。模型可见的 `ToolRegistry.getToolDefinitions()` 仍只能导出 OpenAI-compatible schema，不能泄露运行时字段。

  **验收标准**：
  - `read_file`、`grep`、`glob` 可标记为并发安全
  - `write_file`、`edit_file`、`run_command` 默认非并发安全
  - `todo_write` 是否并发安全需按状态写入语义保守判断；首版可保持串行
  - 模型可见 schema 不包含 `execute`、`category`、`isConcurrencySafe`
  - 单元测试覆盖 registry schema 边界

  **关键文件**：`src/tools/types.ts`、`src/tools/index.ts`、`tests/tools/registry-integration.test.ts`

---

- [ ] **P9-W19-T2**: 实现 tool call 批处理

  **说明**：同一轮模型返回多个 tool calls 时，将连续并发安全工具组成并发批次执行；非并发安全工具单独串行执行。无论执行顺序如何，追加到消息历史中的 tool message 必须严格按模型返回的 tool_call 顺序。

  **验收标准**：
  - 连续 `read_file` / `grep` / `glob` 并发执行
  - `write_file` / `edit_file` / `run_command` 串行执行
  - 混合调用时按批次执行，消息顺序稳定
  - 单个工具失败转成 tool message，不中断整轮
  - 单元测试覆盖并发、串行、混合和错误路径

  **关键文件**：`src/agent-loop.ts`、`src/harness.ts`、`tests/agent-loop.test.ts`

---

- [ ] **P9-W19-T3**: AbortSignal 贯穿执行链路

  **说明**：`runAgentLoop`、`Harness.executeTool()` 和工具 `execute()` 支持可选 AbortSignal。中断时必须返回明确 cancelled 结果或停止当前 run，不能留下未闭合 tool call。

  **验收标准**：
  - LLM 请求前收到 abort 时不发请求
  - 工具执行中收到 abort 时返回 cancelled
  - `run_command` 收到 abort 后杀掉子进程
  - 验证命令收到 abort 后停止并返回 cancelled 验证摘要
  - 单元测试覆盖各阶段中断

  **关键文件**：`src/agent-loop.ts`、`src/harness.ts`、`src/llm-client.ts`、`src/tools/run-command.ts`、`src/verification/test-runner.ts`

---

- [ ] **P9-W19-T4**: 大工具输出截断与 artifact 落盘

  **说明**：统一处理过长工具输出。超过阈值时，tool message 返回摘要和 artifact 相对路径，完整输出落盘到 `.luka/tool-results/{id}.txt`。写入失败时降级为截断摘要，不影响 Agent Loop。

  **验收标准**：
  - stdout/stderr 过长时被截断
  - artifact 路径在工作目录内
  - artifact 不保存敏感字段或完整环境变量
  - artifact 写入失败有 warning，tool message 仍可回传
  - 单元测试覆盖 run_command 大输出、grep 大结果、写入失败降级

  **关键文件**：`src/tool-results.ts`、`src/harness.ts`、`tests/tool-results.test.ts`、`tests/harness.test.ts`

---

- [ ] **P9-W19-T5**: 编排事件与性能指标

  **说明**：扩展 observability 事件，记录批次大小、并发/串行执行、工具耗时、取消状态和大输出 artifact。事件 payload 必须继续脱敏。

  **验收标准**：
  - `PreToolUse` / `PostToolUse` 能区分 cancelled、blocked、error
  - 批处理事件记录 batch size 和 concurrency mode
  - 大输出事件只记录摘要和 artifact 路径
  - 单元测试覆盖事件 schema 和脱敏

  **关键文件**：`src/observability/events.ts`、`src/observability/recorder.ts`、`tests/observability/events.test.ts`

## 验证要求

- 必跑：`npm test -- tests/agent-loop.test.ts tests/harness.test.ts tests/tools/registry-integration.test.ts tests/tools/*.test.ts`
- 修改观测事件时补跑：`npm test -- tests/observability/*.test.ts tests/evals-trace-reader.test.ts`
- 合并前跑：`npm run build` 和 `npm test`
