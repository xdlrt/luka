# P13: REPL/TUI 交互升级

> **里程碑**：无参数启动后的 Ink TUI 成为可持续使用的 coding 工作台，支持本地 slash command、运行状态、恢复入口和清晰的运行总结。

## 任务清单

- [ ] **P13-W23-T1**: 实现 slash command 框架

  **说明**：在 TUI 输入层区分普通用户任务和本地 slash command。首批支持 `/help`、`/clear`、`/status`、`/compact`、`/diff`、`/resume <sessionId>`、`/exit`。Slash command 本地执行，不进入模型 prompt。

  **验收标准**：
  - Slash command 不调用 LLM，也不进入 `runAgentSession`
  - `/help` 展示可用命令
  - `/clear` 清空当前 TUI 展示，不删除 session 文件
  - `/status` 展示 session id、运行状态、最近工具调用和最近验证结果
  - 未知命令输出错误并保持 TUI 可用
  - 单元测试覆盖命令解析、未知命令和不污染 prompt

  **关键文件**：`src/tui/app.tsx`、`src/tui/commands.ts`、`tests/tui/app.test.tsx`

---

- [ ] **P13-W23-T2**: 增强运行状态与工具进度展示

  **说明**：TUI 明确展示当前阶段：`idle`、`thinking`、`tool_running`、`permission_pending`、`verification_running`、`done`。工具调用展示工具名、摘要、耗时、是否被拒绝。摘要必须复用脱敏逻辑，避免展示敏感参数原文。

  **验收标准**：
  - LLM 请求中显示 thinking 状态
  - 工具执行中显示工具名和简短摘要
  - 权限确认期间显示 permission pending
  - 编辑后验证期间显示 verification running
  - 工具结果摘要不包含 API key、Authorization、token、password、secret
  - TUI 测试覆盖状态切换和摘要渲染

  **关键文件**：`src/tui/app.tsx`、`src/session.ts`、`src/observability/events.ts`、`tests/tui/app.test.tsx`

---

- [ ] **P13-W23-T3**: 支持运行中断

  **说明**：Ctrl+C 在运行中优先中断当前 agent run；空闲时退出 TUI。中断应通过 AbortSignal 传递到 LLM 请求、Harness 和长命令执行。被中断的工具返回 cancelled 结果或结束当前 run，不能留下未闭合的 tool call / tool message 配对。

  **验收标准**：
  - 运行中 Ctrl+C 不直接退出进程，而是取消当前任务
  - 空闲时 Ctrl+C 退出 TUI
  - `run_command` 收到中断后杀掉子进程并返回 cancelled 摘要
  - 中断后可以继续输入新任务
  - 单元测试覆盖 LLM 中断、工具中断和空闲退出

  **关键文件**：`src/tui/app.tsx`、`src/agent-loop.ts`、`src/harness.ts`、`src/tools/run-command.ts`、`tests/tui/app.test.tsx`

---

- [ ] **P13-W23-T4**: 统一运行总结

  **说明**：CLI 和 TUI 共用运行总结格式化器。每轮结束展示最终消息、工具调用、TODO、验证结果、session id、是否成功、是否因 `maxTurns` 停止。

  **验收标准**：
  - 一次性 CLI 和 TUI 输出同一套 summary 信息
  - 成功、失败、权限拒绝、验证失败、maxTurns 都有清晰总结
  - 未配置测试命令时明确显示未运行验证
  - 单元测试覆盖主要 summary 分支

  **关键文件**：`src/session-summary.ts`、`src/index.ts`、`src/tui/app.tsx`、`tests/index.test.ts`、`tests/tui/app.test.tsx`

## 验证要求

- 必跑：`npm test -- tests/tui/app.test.tsx tests/tui/permission.test.tsx tests/index.test.ts`
- 如接入中断链路，补跑：`npm test -- tests/agent-loop.test.ts tests/harness.test.ts tests/tools/run-command.test.ts`
- 合并前跑：`npm run build` 和 `npm test`
