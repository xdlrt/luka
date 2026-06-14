# AGENTS.md

## 交流语言

必须使用中文与用户交流。所有回复、解释、确认信息均必须使用中文输出。

## 项目边界

这是一个极简 coding agent。当前真实能力已经覆盖 P1-P4 主链路：CLI/REPL 接收用户输入，Agent Loop 调用 OpenAI-compatible `chat/completions`，解析模型返回的 `tool_calls`，通过 `Harness` 统一编排权限、安全、工具执行和编辑后验证，并把工具结果回传给模型继续决策。

- 当前默认工具包括 `read_file`、`write_file`、`edit_file`、`run_command`、`grep`、`glob`、`todo_write`。
- 当前已有消息历史管理、上下文压缩、长文件分段读取、TodoWrite 式规划状态、基础 observability events、hooks、trace、mock/真实 eval runner、suite/repeat/report/baseline check。
- 当前已有基础 Harness：工作目录边界检查、写入和命令权限确认、基础危险命令规则、编辑后测试验证和重试状态。
- 当前仍不是完整 IDE Agent：没有 GUI、插件市场、多模型适配层、检索增强 RAG、完整 OS 级沙箱、成熟命令安全策略、发布级 npm bin 打包或长期趋势运营数据。

禁止在代码、文档、提示词或 CLI 输出中暗示未实现或未成熟能力已经存在。尤其禁止声称当前具备完整沙箱、完整危险命令防护、任意命令安全执行、成熟长期趋势平台、发布级包分发或真正的检索增强。

## 强约束

### 冲突处理

- 如果用户要求解冲突，目标必须是最终能够 `rebase and merge`。
- 禁止直接用 merge commit 解冲突，除非用户明确要求改用 merge commit。
- 解冲突时优先在当前分支上 rebase 目标分支并逐个解决冲突，完成后确认历史仍适合 rebase merge。

### 工具协议

- `src/types.ts` 必须只表达 LLM API 消息协议和 OpenAI-compatible 工具 schema。
- `src/tools/types.ts` 必须表达运行时工具协议，包含 `execute(input)` 和可选 `category`。
- `ToolRegistry.getToolDefinitions()` 必须只导出 `{ type: "function", function: { name, description, parameters } }`。
- `ToolRegistry.getToolDefinitions()` 禁止泄露 `execute`、`category` 或任何运行时字段给模型。
- 工具执行后的 `role: "tool"` 消息必须使用模型返回的真实 `tool_call.id` 作为 `tool_call_id`。
- 禁止使用工具实现里固定的 `tool_call_id` 作为回传消息的 `tool_call_id`。
- 工具参数解析失败必须显式报错，禁止静默改写为 `{}` 或吞掉错误。

### Agent Loop

- 当模型回复没有 tool calls 时，Agent Loop 必须停止并返回成功。
- 当达到 `maxTurns` 时，Agent Loop 必须停止并返回 `success: false`。
- 工具执行异常必须转成 tool 消息回传给模型，禁止让单个工具异常直接中断整个循环，除非是协议级不可恢复错误。
- Agent Loop 必须只通过 `HarnessLike.executeTool()` 执行工具，禁止绕过 Harness 直接调用 `ToolRegistry.execute()`。
- 测试替身可以实现 `HarnessLike`，但不能改变真实执行路径的边界：tool call -> Harness -> ToolRegistry -> tool message。
- 上下文压缩必须保留系统提示词和最近消息，禁止压缩后破坏 tool call / tool message 配对。
- TodoWrite 状态只能作为额外系统上下文注入，禁止替代真实消息历史或工具结果。

### 安全状态

- `read_file` / `write_file` / `edit_file` 当前必须只接受非空相对路径，必须拒绝绝对路径和包含 `..` 的路径片段。
- `grep` / `glob` 的 `path` 可选，但提供时必须是非空相对路径，并拒绝绝对路径和包含 `..` 的路径片段。
- `read_file` 必须拒绝二进制文件。
- `write_file` 当前会覆盖已有文件；即使有权限确认，也禁止把它描述成合并写入或无风险写入。
- `run_command` 当前有工作目录、超时和基础危险命令规则；禁止把它描述成完整命令沙箱或完整安全策略。
- `--auto-approve` 只跳过人工确认，不能绕过路径边界、命令规则、参数校验或工具错误回传。
- observability event 必须做摘要和敏感信息脱敏，禁止记录 `ARK_API_KEY`、完整环境变量、Authorization、token、password、secret 或真实凭证。
- 任何权限、安全、命令执行相关改动，必须补拒绝路径、失败命令或拦截规则测试。

### 配置与 CLI

- `ARK_API_KEY` 和 `ARK_MODEL` 必须保持必填，禁止引入静默默认模型。
- `MAX_TURNS` 必须保持正整数校验。
- 新增配置字段必须同时覆盖：override 优先级、环境变量读取、非法值、默认值。
- 新增 CLI flag 必须接入配置或执行路径，并补 CLI 输入处理测试；禁止只更新帮助文案。
- `--auto-approve`、`--test-command`、`--max-retries`、`--verbose`、`--hooks-config` 必须从用户任务中剥离，禁止把这些 flag 作为 prompt 内容传给模型。

### Commit 复盘

- 每次创建 commit 时，必须在同一个 commit 中同步更新 `docs/commit-notes.md`，记录本次提交的主题、提交时间、Why / What / How。
- 记录必须包含 `commit`、`time`、`Why`、`What`、`How` 五项。
- `commit` 必须使用本次提交的标题或稳定主题；禁止要求记录最终短 hash，因为 commit 内容会参与 hash 计算，同提交内无法提前知道最终 hash。
- `time` 必须使用本地时区的 `YYYY-MM-DD HH:mm` 格式。
- `Why` 必须记录本次改动的问题背景、目标或取舍。
- `What` 必须记录行为变化和架构边界变化，禁止只复述文件 diff。
- `How` 必须记录关键实现路径、测试方式、踩坑点或反直觉点。
- 记录必须服务最终技术文章和分享，必须沉淀可复用的设计理由、错误范式或验证证据。
- 禁止写成流水账；禁止使用“更新代码”“修复问题”“通过测试”这类无信息量描述。
- 禁止为了记录某个 commit 的复盘而再创建单独的 notes-only commit，避免形成递归提交链。

## 开发范式

### 新增工具

正例：

- 新增独立工具文件，返回运行时 `ToolDefinition`。
- 提供 JSON Schema 参数定义、`category`、输入校验和错误结果。
- 在默认注册表中注册，并补工具单测和 registry 集成测试。
- 测试必须覆盖 OpenAI-compatible schema 不包含运行时字段。

反例：

- 只实现函数但不注册到默认工具集。
- 让模型看到 `execute` 或 `category`。
- 只测成功路径，不测缺参、非法参数、运行时失败。
- 在工具里直接读环境变量或绕过 `workingDirectory`。

### 修改 Agent Loop

正例：

- 保持 tool call -> tool execution -> tool message -> next LLM call 的消息链路。
- 覆盖无工具调用、多轮工具调用、多工具调用、工具错误、`maxTurns`。
- 断言回传消息使用模型返回的 tool call id。

反例：

- 把工具结果塞进 assistant 消息。
- 丢弃工具错误，只把 stdout 回传。
- 在循环里硬编码具体工具名。
- 达到 `maxTurns` 后仍继续请求模型。

### 实现 Harness

正例：

- 保持 Agent Loop 依赖 `HarnessLike`，让真实执行路径统一经过 `Harness`。
- 权限确认、危险命令规则、沙箱边界、自验证必须集中在 Harness 内编排。
- 每条拒绝规则必须有测试证明会被拒绝，并证明正常命令不被误伤。
- 编辑后验证只在 `write_file` / `edit_file` 成功后触发，并把测试摘要作为后续上下文回传给模型。

反例：

- 在各个工具里分散实现权限确认。
- 在 Agent Loop 中直接写危险命令黑名单。
- 只在系统提示词里要求模型不要做危险操作，却没有代码级拦截。
- 保留绕过 Harness 的真实工具执行路径。

### 修改上下文、规划或观测

正例：

- 修改上下文压缩时保持 tool call / tool message 配对完整，并补 `tests/context/*.test.ts`。
- 修改 `todo_write` 或规划状态时保证工具消息、模型上下文和 CLI 展示一致，并补 planning/tools/CLI 测试。
- 修改 observability events、hooks、sinks 或 eval trace 时保持 payload 脱敏和 schema 稳定，并补对应 observability/eval 测试。

反例：

- 为了压缩 token 丢弃未闭合的工具调用链路。
- 把 TODO 展示当作真实执行状态，跳过模型工具调用结果。
- 在 trace、hook payload 或 report 中写入密钥、完整环境变量或未脱敏敏感输出。

### 更新文档或提示词

正例：

- 文档必须区分“当前已实现”和“规划中”。
- 修改系统提示词必须补测试，至少证明关键安全边界和工具使用原则仍存在。
- README、AGENTS、docs 中的能力描述必须与源码和测试一致。
- 完成 `docs/plan/` 或 `docs/detailed-execution-plan.md` 中明确列出的计划任务后，必须在同次改动中把对应 checklist 状态从 `[ ]` 更新为 `[x]`，并确保状态只标记真实完成的任务。
- commit 必须同步包含 `docs/commit-notes.md`，记录提交主题、提交时间、Why / What / How。

反例：

- 为了路线图好看，把未实现能力写成已完成。
- 完成了计划任务但不更新对应 checklist，导致路线图状态和真实进展脱节。
- 只更新文档，不更新对应测试或代码边界。
- 只提交代码，不记录决策背景，导致后续无法复盘。
- 在 AGENTS.md 中堆目录树、接口清单、语言常识，稀释项目特有约束。

## 验证要求

- 修改配置加载：必须跑 `tests/config.test.ts`。
- 修改 LLM 请求、响应解析或 tool call 协议：必须跑 `tests/llm-client.test.ts` 和 `tests/agent-loop.test.ts`。
- 修改 Agent Loop：必须跑 `tests/agent-loop.test.ts` 和 `tests/integration/p1-end-to-end.test.ts`。
- 修改工具：必须跑对应 `tests/tools/*.test.ts` 和 `tests/tools/registry-integration.test.ts`。
- 修改 Harness、权限、规则或沙箱：必须跑 `tests/harness.test.ts`、`tests/agent-loop-permission.test.ts` 和对应 `tests/permissions/*.test.ts`。
- 修改编辑后验证或重试：必须跑 `tests/agent-loop-verification.test.ts`、`tests/agent-loop-retry.test.ts`、`tests/verification/*.test.ts` 和相关集成测试。
- 修改上下文压缩、消息历史、系统提示词或规划：必须跑对应 `tests/context/*.test.ts`、`tests/planning/*.test.ts` 和 `tests/tools/todo-write.test.ts`。
- 修改 observability、hooks、trace、eval runner、baseline 或 report：必须跑对应 `tests/observability/*.test.ts`、`tests/evals-*.test.ts` 和 `npm run eval:mock`。
- 修改 CLI 输入处理：必须跑 `tests/index.test.ts`。
- 合并前必须跑 `npm run build` 和 `npm test`。

## 代码底线

- 禁止使用 `any`。
- 禁止未使用导入和死代码。
- 源码导入本项目 TS 模块时必须使用 `.js` 扩展名。
- 禁止提交密钥、`.env` 或任何真实凭证。
