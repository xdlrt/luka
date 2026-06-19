# P6: 会话持久化与恢复

> **里程碑**：Agent 能把一次任务保存为可恢复会话，重启后继续保留消息历史、TODO、工具结果摘要、验证摘要和压缩边界。

## 任务清单

- [x] **P6-W16-T1**: 定义 Session 存储模型

  **说明**：新增会话存储模型，默认写入 `.luka/sessions/{sessionId}.json`。会话文件保存消息历史、TODO 状态、工具调用摘要、验证结果摘要、配置快照和 compact boundary。配置快照只能记录非敏感运行参数。

  **验收标准**：
  - 会话文件包含 `schemaVersion`、`sessionId`、`createdAt`、`updatedAt`、`workingDirectory`、`model`、`messages`、`todos`、`toolSummaries`、`verificationSummaries`、`compactBoundaries`
  - 不保存 `ARK_API_KEY`、完整环境变量、Authorization、token、password、secret 或真实凭证
  - 损坏 JSON、未知 schema version、缺失必填字段时显式报错
  - 单元测试覆盖序列化、反序列化、非法文件和敏感字段脱敏

  **关键文件**：`src/session-store.ts`、`tests/session-store.test.ts`

---

- [x] **P6-W16-T2**: Agent Loop 接入 checkpoint

  **说明**：在 `runAgentLoop` 中支持可选初始消息历史和 checkpoint 回调。每轮 LLM 响应后、每次工具执行后、停止前保存 checkpoint。checkpoint 只能在 tool call / tool message 配对完整后写入，避免恢复后破坏 API 消息协议。

  **验收标准**：
  - 每轮 LLM 响应后保存 assistant message
  - 每个 tool result 回传后保存 tool message
  - `Stop`、`maxTurns`、工具错误路径都保存最终 checkpoint
  - checkpoint 写入失败不直接中断主循环，但用户可见 warning
  - 单元测试覆盖成功、工具错误、权限拒绝和 maxTurns

  **关键文件**：`src/agent-loop.ts`、`src/session.ts`、`tests/agent-loop.test.ts`、`tests/session.test.ts`

---

- [x] **P6-W16-T3**: CLI 增加 session 与 resume 参数

  **说明**：新增 `--session <sessionId>` 和 `--resume <sessionId>`。`--session` 指定本次运行写入的会话 ID；`--resume` 从已有会话恢复上下文并追加新的用户输入。这两个 flag 必须从用户任务中剥离，禁止作为 prompt 传给模型。

  **验收标准**：
  - `parseCliArgs()` 解析 `--session` 和 `--resume`
  - `--resume` 找不到会话时输出明确错误
  - `--resume` 与一次性 prompt 一起使用时，把 prompt 作为恢复后的新用户消息
  - 无 prompt 且无 `--resume` 时仍进入 TUI
  - 单元测试覆盖参数解析、缺值、恢复成功、恢复失败

  **关键文件**：`src/index.ts`、`src/session.ts`、`tests/index.test.ts`

---

- [x] **P6-W16-T4**: 压缩边界与 TODO 恢复兼容

  **说明**：会话恢复必须兼容上下文压缩和 TODO 注入。恢复后的消息历史保留系统提示词和最近消息，compact summary 继续作为摘要消息存在；TODO 状态重新注入系统上下文，但不能替代真实消息历史或工具结果。

  **验收标准**：
  - 压缩后的历史恢复后仍能继续请求模型
  - 恢复后 `todo_write` 状态进入模型上下文和 CLI/TUI 展示
  - 恢复后不会重复注入系统提示词
  - 单元测试覆盖压缩前保存、压缩后恢复、恢复后继续调用工具

  **关键文件**：`src/context/compressor.ts`、`src/planning/todo.ts`、`src/session.ts`、`tests/context/compressor.test.ts`、`tests/session.test.ts`

## 验证要求

- 必跑：`npm test -- tests/session-store.test.ts tests/session.test.ts tests/index.test.ts tests/agent-loop.test.ts`
- 修改上下文压缩或 TODO 恢复时补跑：`npm test -- tests/context/compressor.test.ts tests/planning/todo.test.ts tests/tools/todo-write.test.ts`
- 合并前跑：`npm run build` 和 `npm test`
