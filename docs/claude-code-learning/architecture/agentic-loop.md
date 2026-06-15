# Agentic Loop 与停止条件

## 学习目标

这篇笔记分析 Claude Code 和当前 `coding-agent` 在 Agentic Loop 上的设计差异，重点回答三个问题：

- Agent 为什么需要一个明确的循环，而不是一次模型调用结束任务？
- 什么情况下应该继续请求模型，什么情况下必须停止？
- 当前 `coding-agent` 的简化实现保留了哪些关键边界，哪些复杂恢复能力还不适合照搬？

## Claude Code 设计

Claude Code 的主循环可以理解成一个流式状态机。入口接收消息、系统提示词、用户上下文、工具上下文、权限检查函数和 `maxTurns` 等参数，然后进入 `while (true)` 循环。每轮会构造可发送给模型的上下文，处理 compact、token budget、fallback model、streaming tool execution、stop hooks、附件注入和下一轮状态。

它不是只判断“有没有工具调用”这么简单，而是维护一组跨轮状态：

- `messages`：当前轮要提交给模型的消息视图。
- `toolUseContext`：工具执行上下文，包括工具列表、权限上下文、Agent 身份、UI 回调和状态读写能力。
- `turnCount`：当前循环轮次，用于 `maxTurns` 判断。
- `needsFollowUp`：本轮模型是否产生了 tool use。如果产生，就必须执行工具并把结果回传后再继续。
- `toolUseBlocks` / `assistantMessages` / `toolResults`：保证 assistant 的 tool use 和后续 tool result 成对进入下一轮。
- `transition`：记录上一轮为何继续，例如下一轮、compact retry、stop hook blocking、token budget continuation。

Claude Code 的停止条件是多出口的：

- 没有 tool use，且 stop hooks、token budget continuation、错误恢复都不要求继续时，返回 `completed`。
- 达到 `maxTurns` 时，返回 `max_turns`，并给用户侧产生 max turns 附件提示。
- 模型、图片、上下文、流式中断、工具中断、hook 阻断等情况会返回不同 terminal reason。
- 某些“看似该停止”的情况会被恢复逻辑拦截，例如 prompt too long、max output tokens、stop hook blocking error，会先构造新状态 `continue`，而不是直接结束。

这个设计适合成熟 CLI 产品：同一个循环要同时服务交互式 REPL、SDK、子 Agent、MCP、技能、hook、compact、UI 状态和可观测性。

## 关键场景

- 多轮工具调用：模型先读文件，再搜索，再编辑，再运行测试。只要本轮出现 tool use，循环就不能把 assistant 文本当作最终回答，而必须执行工具并把结果放回上下文。
- 无工具调用自然结束：模型本轮没有产生 tool use，说明它认为可以直接回答。Claude Code 还会先让 stop hooks 和 token budget 逻辑检查是否需要继续；当前 `coding-agent` 则直接成功返回。
- 达到轮次上限：模型持续要求工具调用或陷入修复循环时，必须有硬上限，避免无限调用模型和工具。
- 可恢复错误：上下文过长、输出截断、模型 fallback 或 stop hook blocking 不是普通成功结束，需要把错误转成下一轮上下文或明确 terminal reason。
- 中断与不完整 tool result：流式响应或工具执行中断时，如果已经出现 tool use，必须补齐或合成 tool result，避免下一次 API 请求破坏工具配对协议。

## 数据流 / 控制流

Claude Code 的抽象流程：

```text
进入 query
-> 初始化 State
-> while true
-> 构造 messagesForQuery
-> compact / collapse / token budget 预处理
-> 调用模型并接收流式 assistant message
-> 收集 tool_use blocks，设置 needsFollowUp
-> 如果模型或上下文错误可恢复，改写 State 并 continue
-> 如果没有 tool_use，执行 stop hooks / budget continuation
-> 返回 completed 或其他 terminal reason
-> 如果有 tool_use，执行工具并收集 tool_result
-> 注入附件、memory、skill discovery、刷新工具
-> 检查 maxTurns
-> 更新 State，进入下一轮
```

当前 `coding-agent` 的抽象流程：

```text
进入 runAgentLoop
-> 初始化 MessageHistory(system + user)
-> for turn = 1..maxTurns
-> 可选压缩历史
-> 注入 TODO 状态
-> 调用 OpenAI-compatible chat/completions
-> 追加 assistant message
-> 解析 tool_calls
-> 如果没有 tool_calls，success=true 返回
-> 如果有 tool_calls，逐个通过 Harness 执行
-> 使用模型返回的真实 tool_call.id 追加 tool message
-> 进入下一轮
-> 循环耗尽后 success=false 返回 max_turns
```

## 优点

Claude Code 的优点：

- 停止原因细分，便于 UI、SDK、trace 和恢复逻辑做不同处理。
- 对流式输出、fallback、compact、hook 和中断有恢复路径，长任务稳定性更强。
- 使用 `needsFollowUp` 把“是否继续”绑定到真实 tool use，而不是依赖模型文本或 `stop_reason`。
- 工具结果进入下一轮前集中处理附件、summary、memory、skill discovery 和工具刷新，适合复杂产品形态。

当前 `coding-agent` 的优点：

- 控制流非常清晰，`for` 循环把上限变成结构约束。
- 停止条件少而明确：无 tool calls 成功，达到 `maxTurns` 失败。
- Agent Loop 不直接执行工具，只通过 `HarnessLike.executeTool()`，执行边界容易测试。
- tool message 使用模型返回的真实 `tool_call.id`，保留了 OpenAI-compatible 协议的关键正确性。
- 复杂恢复能力没有提前进入主循环，学习版代码更容易审计和维护。

## 缺点 / 代价

Claude Code 的代价：

- 状态面非常大，`State`、`toolUseContext`、streaming executor、compact、hook、budget 和 attachment 之间存在较多协作点。
- 停止出口多，测试必须覆盖大量 terminal reason 和 continue reason。
- 某些恢复逻辑依赖产品级基础设施，例如流式 UI、hook、MCP、技能、远程会话或 analytics。
- 对学习版 agent 来说，直接照搬会让主循环过早变成复杂状态机。

当前 `coding-agent` 的代价：

- terminal state 只有 `no_tool_calls` 和 `max_turns`，对错误类型和恢复路径表达较少。
- LLM 请求异常、压缩异常目前会向外抛出，不像工具异常那样统一转成模型可消费的上下文。
- 没有流式 tool execution，也没有针对中断时不完整 tool call 链路的复杂恢复。
- 没有 stop hooks 阻断后的自动续跑语义；现有 hooks 主要服务可观测，不阻断工具执行。

## 当前 coding-agent 实现对比

### 当前已实现

- `src/agent-loop.ts` 使用固定 `for` 循环执行多轮模型请求，轮次受 `config.maxTurns` 限制。
- 模型回复没有 `tool_calls` 时，Agent Loop 立即停止并返回 `success: true`。
- 达到 `maxTurns` 时，Agent Loop 停止并返回 `success: false`，同时记录 `finalState: "max_turns"`。
- 每个 tool call 都通过 `HarnessLike.executeTool()` 执行，真实路径保持 tool call -> Harness -> ToolRegistry -> tool message。
- 工具结果回传时使用模型返回的真实 `call.id` 作为 `tool_call_id`。
- 工具执行异常由 Harness 转成工具结果，进入 tool message 后回传给模型。
- 历史压缩发生在每轮模型请求前，并由 `MessageHistory` / compressor 负责保持消息结构。
- TODO 状态作为额外 system context 注入，不替代真实消息历史或工具结果。
- `tests/agent-loop.test.ts` 覆盖无工具调用停止、多轮工具调用、真实 tool call id、`maxTurns`、Harness 边界和 Stop event。

### 当前未实现或规划中

- 没有 Claude Code 那种多 terminal reason 的完整状态机。
- 没有流式模型响应和 streaming tool execution。
- 没有 stop hook blocking 后自动构造下一轮上下文的机制。
- 没有 prompt too long、max output tokens、media error 等多阶段恢复链路。
- sub-agent 编排仍在 `docs/plan/p11-multi-agent-orchestration.md` 中。
- 当前没有完整 OS 级沙箱，也没有成熟的远程会话、技能系统或插件市场。

### 关键差异

Claude Code 的主循环是产品级“会话运行时”：它不仅负责模型和工具，还要协调 UI、子 Agent、MCP、memory、hook、compact、fallback、成本和远程状态。停止条件因此必须表达很多原因，并支持在某些失败场景下继续。

当前 `coding-agent` 的主循环是学习版“协议闭环”：它刻意把核心问题收窄到 OpenAI-compatible `tool_calls`、Harness 执行、tool message 回传和轮次上限。这个取舍更适合当前仓库，因为协议正确性、安全边界和测试可见性比复杂产品恢复能力更重要。

## 可以借鉴的设计

- 保持“是否继续”由 tool call / tool use 决定，禁止依赖模型文本里的自然语言判断。
- 后续如果扩展 terminal state，可以先增加少量结构化原因，例如 `llm_error`、`compression_error`、`interrupted`，不要一次性照搬 Claude Code 的完整 reason 集合。
- 对任何可能产生 assistant tool call 的失败路径，都要保证 tool result 配对完整，避免下一轮 API 请求协议错误。
- 如果未来引入 stop hook 或验证阻断，应把“阻断后继续”的状态显式记录为 transition，避免隐式递归或无限重试。
- `maxTurns` 应继续作为硬上限，并在 observability event 中保留明确 final state。

## 不应该照搬的设计

- 不应为了学习 Claude Code 而把当前 `for` 循环改成大型 `while true` 状态机。
- 不应在没有流式 UI、MCP、技能和远程会话需求时引入 streaming executor 级复杂度。
- 不应把 hook 从可观测能力直接升级为阻断执行能力，除非同步补充权限、安全和失败恢复测试。
- 不应把 Claude Code 的多种恢复路径写成当前项目已实现能力。

## 后续行动

- 候选：为 Agent Loop 增加 LLM 请求异常的结构化 Stop event，但保持是否向外抛出的行为经过单独设计。
- 候选：扩展 `AgentResult` 的 final state 表达，用于区分 `no_tool_calls`、`max_turns` 和未来错误类停止。
- 候选：在上下文压缩测试中继续强化 tool call / tool message 配对保护，确保压缩不会破坏下一轮请求。
- 候选：如果 P11 实现 sub-agent，应复用当前清晰边界：子 Agent 独立历史，主 Agent 只接收摘要和结构化结果。

## 参考文件

Claude Code：

- `<claude-code-snapshot>/src/query.ts`
- `<claude-code-snapshot>/src/Tool.ts`
- `<claude-code-snapshot>/src/tools.ts`

coding-agent：

- `src/agent-loop.ts`
- `src/llm-client.ts`
- `src/harness.ts`
- `src/context/message-history.ts`
- `tests/agent-loop.test.ts`
- `docs/plan/p11-multi-agent-orchestration.md`
