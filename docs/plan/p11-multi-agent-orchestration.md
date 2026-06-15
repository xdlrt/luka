# P11: 多 Agent 与子任务编排

> **里程碑**：Agent 具备学习版 sub-agent 编排能力，能把探索、实现和验证拆给受控角色执行，同时避免并发写冲突和消息历史污染。

## 任务清单

- [ ] **P11-W21-T1**: 定义 SubAgent 运行时协议

  **说明**：新增 sub-agent 协议，包含角色、输入、可用工具范围、工作目录、结果摘要和观测 runId。Sub-agent 复用现有 Agent Loop 和 Harness，但必须有独立消息历史。

  **验收标准**：
  - 支持 `explorer`、`worker`、`verifier` 三类角色
  - sub-agent 结果包含 `success`、`summary`、`toolsCalled`、`changedFiles`、`tracePath`
  - sub-agent 不直接写入主 agent 的消息历史，只把摘要作为工具结果或系统上下文回传
  - 单元测试覆盖协议校验和结果摘要

  **关键文件**：`src/agents/types.ts`、`tests/agents/types.test.ts`

---

- [ ] **P11-W21-T2**: 实现只读 explorer 并发

  **说明**：首版允许主 Agent 并发启动多个只读 explorer，用于搜索文件、阅读代码和回答定位问题。Explorer 工具范围限制为 `read_file`、`grep`、`glob`，禁止写入和命令执行。

  **验收标准**：
  - explorer 只能使用只读工具
  - 多个 explorer 可以并发执行
  - explorer 失败返回摘要，不中断主 Agent
  - 主 Agent 收到 explorer 摘要后继续决策
  - 单元测试覆盖并发、工具限制和失败路径

  **关键文件**：`src/agents/explorer.ts`、`src/agent-loop.ts`、`tests/agents/explorer.test.ts`

---

- [ ] **P11-W21-T3**: 实现 worker 串行写入

  **说明**：Worker 可执行写入工具，但同一时间只允许一个 worker 修改文件。主 Agent 为 worker 指定明确任务和允许写入范围；worker 结束后返回 diff 摘要。

  **验收标准**：
  - worker 写入必须经过 Harness 权限、安全和验证
  - worker 并发写入请求被排队或拒绝
  - worker 只能修改声明的路径范围
  - worker 结果包含 changed files 和 diff 摘要
  - 单元测试覆盖串行化、范围拒绝和写入失败

  **关键文件**：`src/agents/worker.ts`、`src/harness.ts`、`tests/agents/worker.test.ts`

---

- [ ] **P11-W21-T4**: 实现 verifier 复查

  **说明**：Verifier 只读取最终 diff、测试摘要和相关文件，给出是否需要继续修复的建议。Verifier 不直接修改代码，避免形成隐藏执行路径。

  **验收标准**：
  - verifier 不能调用写入工具或命令工具
  - verifier 输入包含 diff、验证结果和任务目标
  - verifier 输出结构化建议：`pass`、`needsFix`、`reason`
  - 单元测试覆盖通过、建议修复和工具限制

  **关键文件**：`src/agents/verifier.ts`、`tests/agents/verifier.test.ts`

---

- [ ] **P11-W21-T5**: 子 Agent 观测与 eval

  **说明**：扩展 observability 事件，记录 sub-agent 启动、结束、角色、耗时、工具调用和父子 runId。新增一个多文件 eval，验证 explorer 辅助定位能减少主 Agent 直接搜索负担。

  **验收标准**：
  - trace 中能看到 parent runId 和 child runId
  - report 汇总 sub-agent 次数和失败数
  - 子 agent 事件继续脱敏
  - eval mock 链路可验证 sub-agent summary 被消费

  **关键文件**：`src/observability/events.ts`、`src/evals/trace-reader.ts`、`tests/observability/events.test.ts`、`tests/evals-trace-reader.test.ts`

## 验证要求

- 必跑：`npm test -- tests/agents/*.test.ts tests/agent-loop.test.ts tests/harness.test.ts`
- 修改观测事件时补跑：`npm test -- tests/observability/*.test.ts tests/evals-trace-reader.test.ts`
- 合并前跑：`npm run build`、`npm test` 和 `npm run eval:mock`
