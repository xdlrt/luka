# Commit Notes

## initial repository baseline

- commit: ba268fb
- time: 2026-06-11 20:13
- Why: 项目需要一个可追踪的 Git 起点，后续所有脚手架、架构约束和实现决策都应能回溯到明确历史。
- What: 建立空仓库的初始提交边界，为后续逐步提交 P1 最小闭环提供干净基线。
- How: 以初始提交固定仓库根历史；该提交不承载业务实现，验证重点是后续提交能在此基础上小步演进。

## initialize TypeScript scaffold

- commit: 5f97333
- time: 2026-06-11 21:56
- Why: coding agent 需要先具备可编译、可测试、可约束的工程骨架，否则后续 Agent Loop、工具协议和安全边界会缺少稳定落点。
- What: 初始化 TypeScript ES Modules 项目，加入 `build`、`dev`、`test` 脚本、Vitest 配置、占位入口、`.gitignore`、AGENTS 约束和详细执行计划。
- How: 使用 NodeNext/strict TypeScript 作为底座，并把路线图写入 `docs/detailed-execution-plan.md`；通过构建和测试脚本确认脚手架可运行。

## add Ark config loader

- commit: 8d12817
- time: 2026-06-11 23:39
- Why: LLM 调用必须从一开始就把凭证、模型、base URL 和循环次数做成显式配置，避免在业务代码里散落环境变量读取或隐式默认模型。
- What: 新增 `loadConfig`，读取 `ARK_API_KEY`、`ARK_MODEL`、`BASE_URL`、`MAX_TURNS`，保持 API key 和 model 必填，校验 `MAX_TURNS` 为正整数，并提供 `.env.example`。
- How: 采用 `overrides > env > default` 的优先级，给缺少必填项、非法 `MAX_TURNS`、环境变量覆盖和 overrides 覆盖补单测；同时把 AGENTS 和执行计划从 Anthropic 初稿调整到 Ark 配置现实。

## define OpenAI-compatible wire types

- commit: 8facc25
- time: 2026-06-12 00:09
- Why: 实际接入的是火山引擎方舟 OpenAI-compatible `chat/completions`，继续保留 Anthropic SDK 类型会让消息协议和工具协议在项目早期就分叉。
- What: 新增 `src/types.ts`，定义 `Message`、`ToolCall`、`ParsedToolCall`、`ToolResult`、OpenAI-compatible 工具 schema、请求响应、usage 和 finish reason，并移除 Anthropic SDK 依赖。
- How: 把 LLM API 线格式集中到 `src/types.ts`，让工具参数中的 `function.arguments` 保持 JSON 字符串形态；同步 `package.json` 和执行计划，验证方式为 TypeScript 编译。

## align plan with Ark implementation

- commit: 0ab8d1e
- time: 2026-06-12 00:23
- Why: 计划文档仍混有 Anthropic SDK 表述，会误导后续实现者按错误 API 和工具协议继续开发。
- What: 将详细执行计划中的 LLM 提供商、客户端实现、工具调用命名和验收口径调整为 Ark/OpenAI-compatible 路线。
- How: 只改文档，不改运行时代码；通过逐项对齐 `src/types.ts` 和 `loadConfig` 已建立的事实，避免路线图把未采用 SDK 的实现描述成 Anthropic 方案。

## implement first LLM call

- commit: feba875
- time: 2026-06-12 10:44
- Why: P1 最小闭环的第一块能力是能真实向 OpenAI-compatible 模型发起非流式请求，并把失败信息暴露为可诊断错误。
- What: 新增基于原生 `fetch` 的 `LLMClient`，调用 `{baseURL}/chat/completions`，处理鉴权、非 2xx、网络错误和空 choices，并把 CLI 从 Hello World 接到单轮问答。
- How: 通过 mock `fetch` 测试请求 URL、header、body、baseURL 斜杠归一、HTTP 错误、网络错误和空响应；AGENTS 同步说明当前只有配置、类型、客户端和基础 CLI，避免夸大能力。

## parse tool calls from responses

- commit: 3c216c8
- time: 2026-06-12 22:18
- Why: Agent Loop 后续要靠模型返回的 `tool_calls` 决定是否执行工具，必须先把响应解析、日志和参数错误处理做成独立可测能力。
- What: 扩展 `LLMClient.sendMessage` 支持传入工具定义，新增 `parseResponse` 将 assistant 文本和 `tool_calls` 分支分开，并加入临时 `echo` 工具 schema 作为解析样例。
- How: 在解析阶段对每个 `function.arguments` 做 JSON.parse，成功时记录模型请求的工具，非法 JSON 时显式抛错；测试覆盖纯文本、工具调用、空参数、非法参数和请求体包含 tools。

## implement tool registry

- commit: d085f9d
- time: 2026-06-12 22:28
- Why: 工具执行需要一个运行时协议，但模型只能看到 OpenAI-compatible schema；二者如果混在同一类型里，会把 `execute` 或 `category` 泄露给模型。
- What: 新增 `src/tools/types.ts` 表达运行时工具协议，新增 `ToolRegistry` 支持注册、查找、列出、执行和导出 OpenAI-compatible tool definitions。
- How: `getToolDefinitions()` 只映射 `{ type: "function", function: { name, description, parameters } }`；测试覆盖重复注册、未知工具、执行结果和不暴露运行时字段。

## implement read_file tool

- commit: 87551ed
- time: 2026-06-12 22:40
- Why: P1 闭环需要模型能读取工作目录内文本文件，同时在没有 Harness 的阶段先建立最小路径边界，不能让工具接受绝对路径或父目录逃逸。
- What: 新增 `read_file` 运行时工具，读取 UTF-8 文本，拒绝空路径、非字符串路径、绝对路径、包含 `..` 的路径和二进制文件。
- How: 工具返回 `ToolResult` 而不是抛出普通读文件错误，失败时把错误放入 `error`；单测覆盖 schema、成功读取、空文件、缺失文件、非法路径和二进制拒绝。

## implement write_file tool

- commit: 532610d
- time: 2026-06-12 22:44
- Why: 最小 coding agent 必须能写入文件，但当前尚未实现写前确认，所以实现要诚实表达覆盖写入能力，并用路径校验限制工作目录边界。
- What: 新增 `write_file` 工具，接受相对路径和字符串内容，自动创建父目录，写入或覆盖 UTF-8 文本文件。
- How: 复用与 `read_file` 一致的非空相对路径和 `..` 拒绝规则，并单测覆盖新建、覆盖、嵌套目录、空内容、根目录文件、缺参、非法内容和路径拒绝。

## implement run_command tool

- commit: 239a07a
- time: 2026-06-12 22:49
- Why: P1 需要能执行基本命令来验证结果，但当前没有危险命令规则引擎，因此命令工具只能承诺 cwd 和超时保护，不能宣传成安全 Harness。
- What: 新增 `run_command` 工具，在工作目录执行 shell command，返回 stdout/stderr，失败时返回 exit code，超时后杀进程。
- How: 用 `child_process.exec` 加超时和 `SIGKILL`，把命令失败转成 tool error 而非抛出；测试覆盖成功命令、失败退出、stderr 捕获、超时和非法 command 参数。

## register default tools

- commit: 5e6f0cf
- time: 2026-06-12 22:53
- Why: 单个工具实现完成后，还需要形成默认工具集，保证 CLI/Agent Loop 使用的 registry 与测试中验证的工具能力一致。
- What: 新增默认工具注册入口，将 `read_file`、`write_file`、`run_command` 注册到 `ToolRegistry`，并把 CLI demo 从临时 `echo` 迁到默认工具定义。
- How: 通过 registry 集成测试验证默认工具数量、工具名、执行链路和导出的 OpenAI-compatible schema；重点断言 schema 不包含 `execute`、`category` 等运行时字段。

## implement agent loop

- commit: 69f7baa
- time: 2026-06-12 22:58
- Why: P1 的核心是 tool call -> tool execution -> tool message -> next LLM call 的循环，而不是一次性解析工具调用日志。
- What: 新增 `runAgentLoop`，构建消息历史、调用 LLM、解析工具调用、通过 `ToolRegistry` 执行工具、把工具结果作为 `role: "tool"` 消息回传，并在无工具调用或达到 `maxTurns` 时停止。
- How: 保持使用模型返回的真实 `tool_call.id` 作为回传 `tool_call_id`；工具执行异常转成 tool 消息继续喂给模型；测试覆盖无工具调用、多轮调用、多工具调用、工具错误和 `maxTurns` 失败。

## add baseline system prompt

- commit: ed7d8fd
- time: 2026-06-12 23:02
- Why: 系统提示词不应散落在 CLI 或 Agent Loop 中，否则后续调整工具规则和安全边界时缺少单一维护点。
- What: 新增基线系统提示词模块，并让 CLI/Agent Loop 使用该常量，同时用测试固定提示词非空、包含关键工具使用原则和当前能力边界。
- How: 提示词只描述当前真实能力与基本行为准则，不声称已有 Harness、写前确认、危险命令拦截或 TodoWrite；验证方式为 `tests/context/system-prompt.test.ts`。

## implement readline REPL

- commit: e364214
- time: 2026-06-12 23:09
- Why: CLI 需要从单次参数调用升级为可交互 REPL，才能让用户连续输入任务并复用同一入口体验 P1 Agent Loop。
- What: 重构 `src/index.ts`，支持非交互参数输入和 readline REPL，处理空输入、`.exit`、Ctrl+C、配置加载失败和每轮 Agent Loop 结果输出。
- How: 将 CLI 输入处理拆成可测试函数，用 mock agent runner 覆盖参数输入、REPL 多轮、退出路径和错误输出；保持新增 CLI 行为接入真实配置和执行路径，而不只更新帮助文案。

## add P1 end-to-end demo test

- commit: b294596
- time: 2026-06-12 23:15
- Why: 单测已经覆盖组件行为，但 P1 最小闭环需要一条端到端证据证明模型工具调用、文件写入、命令执行和最终回答能串起来。
- What: 新增集成测试模拟 LLM 先调用 `write_file` 再调用 `run_command`，最后返回成功消息，验证 Agent Loop 与默认工具 registry 的组合可完成最小任务。
- How: 使用临时工作目录和 mock LLM 响应，不依赖真实网络；断言工具调用顺序、文件内容、最终结果、turn 数和 success 状态，作为 P1 demo 的回归保护。

## document agent contribution rules

- commit: ebe8beb
- time: 2026-06-12 23:38
- Why: 最终技术文章和分享不能只依赖阶段末回忆；Agent 过程中的约束、取舍和踩坑点必须在每次提交后沉淀下来，避免关键设计背景丢失。
- What: 将 AGENTS 从项目说明书收敛为高信噪比执行约束，并新增 commit 后必须在 `docs/commit-notes.md` 记录 Why / What / How 的规则。
- How: 通过 AGENTS 的强约束和正反例范式固定记录位置、字段和质量要求；验证方式为 `npm run build` 与 `npm test`，确认文档改动不影响现有 66 条测试。

## split execution plan by milestone

- commit: e5798ae
- time: 2026-06-12 23:41
- Why: 单个超长执行计划已经难以维护和复盘，P1 到 P4 的不同阶段需要独立文档承载更清晰的里程碑、边界和后续写作素材。
- What: 将 `docs/detailed-execution-plan.md` 拆分为 `docs/plan/p1-agent-loop.md`、`p2-harness.md`、`p3-context-planning.md`、`p4-release-writing.md`，并把主计划收敛为索引式总览。
- How: 保留原有阶段内容但按里程碑分文件，减少主文档噪声；同步 AGENTS/commit notes 中的引用和提交哈希，验证方式为 `npm run build` 与 `npm test`，确认文档拆分不影响代码行为。
