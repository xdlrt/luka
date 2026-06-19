# Commit Notes

## eval: land baseline gate and command classification

- commit: eval: land baseline gate and command classification
- time: 2026-06-19 21:28
- Why: P5 复盘里留下了四个真实限制：P4 baseline 没有顺手的保存入口、真实 regression eval 没有受控 CI 路径、repeat 结果缺少按任务稳定性统计、命令安全仍停在基础黑名单。继续只在复盘里记录这些限制，会让计划状态和实际能力长期错位；但补齐时也必须守住边界，不能把基础命令分类误写成完整沙箱。
- What: 为 eval runner 增加 `--save-baseline` 与 `eval:regression`，把 P5 final run 固化为 `evals/baselines/p4-continuous.json`；repeat summary 增加按 task 聚合的 pass rate、flaky、持续失败、均值和标准差，并同步到 Markdown report 和 dashboard。GitHub eval workflow 保持 PR 只跑 mock eval，同时支持手动/定时触发，在 secrets 存在时运行真实 regression gate。权限侧新增保守命令分类器，并在 `run_command` 权限提示中展示 read/write/network/git-write/dangerous/unknown；P8 只标记 W18-T1 完成，继续明确当前不是完整 OS 沙箱或成熟命令安全策略。
- How: eval 改动复用已有 `createBaseline`/`checkRegression`，保存 baseline 发生在 run result 和报告落盘之后，gate 失败时不会把退化结果固化为新基线；repeat 统计按 taskId 聚合 attempt，避免只看全局 pass rate 掩盖 flaky 或稳定失败。workflow 用 step-level secrets gate 输出 `run_real=true/false`，无密钥时跳过而不失败。命令分类器仍以现有危险规则为权威拦截层，分类只作为解释和后续 P8 规则扩展的中间层。验证路径为 `npm run build`、定向 eval/permission/workflow 测试、权限全链路测试、`npm run eval:mock`、全量 `npm test` 和 `git diff --check`。

## docs: add deep-dive companion booklet

- commit: docs: add deep-dive companion booklet
- time: 2026-06-16 17:10
- Why: 已出版的《拆解 Claude Code》是面向通用读者的科普书（零代码、不要求懂 TS），但缺一本面向资深工程师、深挖真实控制流/数据结构/协议细节/安全边界的硬核补充本。需要一本既能独立阅读、又能作为科普书对应章节下钻的姊妹篇，且必须诚实处理「真实源码快照来源未经核实、不可逐字复制」的版权与事实边界。
- What: 在 `docs/claude-code-learning/deep-dive/` 新增《Claude Code 内核解剖》：封面（含统一来源免责声明与改写方法论）+ 9 章硬核主题正文（查询状态机、工具框架、上下文/记忆、Bash 安全与权限分层、外部协议、扩展治理、多 Agent、桥接远程、可观测成本）+ 2 个附录（数据结构速查、与科普书章节对照）。每章对应科普书某章但按硬核主题重组，省略协议密度低的 CLI/IO/Git 三章独立成文。深度篇 nav 入口、`/deep-dive/` 独立 sidebar、科普书封面互链已于上一提交（rename）随 rspress.config.ts/index.md 落地，本次提交补齐内容页。
- How: 双素材来源严格区分——讲 Claude Code 机制一律用「阐释性重构」伪代码与类型签名（绝不逐字复制专有源码，推断处标「推断/推断转述」），讲最小可行落地用本仓库 `src/` 真实可运行代码并标注来源路径。第 3-9 章经二轮加深：从一份来源未核实的源码快照挖出真实算法与常量（三种压缩 auto/micro/reactive 与阈值反推、tree-sitter 引用上下文与规则遮蔽检测、退避 jitter 与按 querySource 区分重试、Skill frontmatter 契约与插件按出口分路径、fork 隔离与 worktree 与 filterIncompleteToolCalls、bridge 控制平面与 flush gate、四类 token 计价与子 Agent 成本归属），改写后落地，每章 188-371 行。验证用 `npm run docs:build` 构建通过（深度篇 11 页全生成），并全文检索确认无本机路径、`claude-code-main`、`<claude-code-snapshot>` 等泄露，真实代码块均带 `src/...` 来源标注。

## docs: restructure learning site into a publishable book

- commit: docs: restructure learning site into a publishable book
- time: 2026-06-16 15:35
- Why: 原 `docs/claude-code-learning/` 是面向仓库内部的研究笔记，`architecture/`（14 篇按设计问题）和 `modules/`（15 篇按源码模块）两套主题高度重叠、几乎一一对应，且每篇都深度绑定「coding-agent 当前实现对比 / 可借鉴 / 不照搬 / 参考文件路径」。这种结构服务查漏补缺，却不适合线性阅读，也无法作为一本可出版的书独立成立。目标是用资深编辑视角重组成一本面向通用技术读者的书，与当前实现彻底解耦。
- What: 把 29 篇重叠笔记合并成单一主线的 14 章正文，按 6 个部分组织（核心闭环、权限安全、扩展协作、交互工作流、状态可观测、连接万物）；新增卷首（封面目录、前言、导言）与卷尾（结语、术语表、模块地图、延伸阅读）出版件。全书完全剥离 coding-agent 对比，纯讲 Claude Code，对推断处统一标注「（基于公开行为推断）」。删除旧的 `architecture/`、`modules/`、`templates/`、根 `README.md` 和 `module-coverage.md`（模块地图内容下沉为附录 B）。重排 `rspress.config.ts` 的 nav 与 sidebar 为「卷首→六部分→卷尾」线性结构，站点标题改为《拆解 Claude Code》。
- How: 先一次性读取全部 29 篇素材建立「旧文件→新章节」映射，再按统一科普骨架（场景开场→核心问题→设计原理融合 why/how→关键场景→设计权衡→本章小结）逐章改写，保留原有 Mermaid 流程图与真实场景，删去所有三态口径、对比段落、`<claude-code-snapshot>` 占位和 `docs/plan` 引用。把贯穿各章的设计主线（硬信号判断、代码级安全、事实高于转述、协议配对、克制、诚实）收拢进结语。验证用 `npm run docs:build` 构建通过（21 页全生成、构建产物无残留旧页面），并用关键词全文检索确认无 `claude-code-snapshot`、`docs/plan`、`/architecture/`、`/modules/`、对比段落等残留。

## docs: add Claude Code learning map

- commit: docs: add Claude Code learning map
- time: 2026-06-15 14:02
- Why: 后续要结合 Claude Code 做系统学习，但现有文档只有项目路线图和复盘，缺少一个能长期承载架构主题、源码模块、分析模板和能力边界的学习入口；如果直接零散写分析，容易遗漏 Skill、插件、远程桥接、状态记忆等产品化模块，也容易把 Claude Code 的成熟能力误写成当前项目现状。
- What: 新增 `docs/claude-code-learning/` 学习目录，建立 architecture/modules/templates 三层结构、Claude Code 顶层模块覆盖矩阵，并先落地 Agentic Loop 与停止条件分析。大纲覆盖主循环、工具协议、上下文、权限、Skill、MCP/LSP/API、插件、IDE/Remote/Server、状态记忆配置、命令/TUI、输入输出体验、Git/GitHub 工作流、可观测和子 Agent，同时明确这些主题与当前 `coding-agent` 已实现能力或计划边界的关系。
- How: 以 `<claude-code-snapshot>` 作为 Claude Code 参考路径占位，避免文档绑定个人机器路径；按“architecture 回答为什么这样设计、modules 回答模块做什么”的归档原则组织内容，并用负向边界提醒避免夸大当前能力。验证方式为扫描学习目录确认没有本机绝对路径残留，并检查敏感能力只作为未实现边界出现。

## docs: streamline project docs

- commit: docs: streamline project docs
- time: 2026-06-14 18:36
- Why: P5 发布打磨完成后，README 仍保留较多阶段性说明、baseline 细表和重复能力描述，AGENTS 也还停留在 P1-P4 状态，会让新读者和后续维护者把已完成的本地打包能力与仍未成熟的 npm registry 发布、安全沙箱、长期趋势能力混在一起。
- What: 将 README 收缩为更适合入口阅读的版本，保留快速启动、配置、架构边界、工具安全、开发和 eval 入口；同步 AGENTS 的项目边界到 P1-P5，明确本地 npm bin、demo、License、贡献模板、文章和复盘已经完成，同时继续禁止把未发布到 npm registry、完整 OS 沙箱、成熟命令安全或真正 RAG 描述成现状。
- How: 以“README 给使用者快速入口、AGENTS 给维护者强约束”为分工进行文档瘦身，不改变运行时代码和计划 checklist；验证重点是保留关键能力边界和命令入口，已用 `npm run build` 确认工程仍可编译，并用关键词检查确认 AGENTS 没有残留过时的 P1-P4 或发布状态表述。

## finish P5-W14 release polish

- commit: finish P5-W14 release polish
- time: 2026-06-14 16:40
- Why: P1-P4 主链路已经具备可演示能力，但仓库还缺少开源发布前的入口完整性：npm bin 不能直接链接运行、README 仍偏阶段性说明、License/贡献模板缺失，Demo 和发布边界也没有形成可复现证据。
- What: 将 P5-W14 从路线图推进到本地可打包状态：补 npm bin 和 files 白名单、CLI shebang、README 发布版说明、脚本化 asciinema demo、MIT License、CONTRIBUTING 与 GitHub Issue/PR 模板，并把 P5-W14 checklist 标记为完成。能力描述继续约束在当前真实边界内，不把基础 Harness 宣传成完整 OS 沙箱或成熟命令安全系统。
- How: 先固定发布面而不改变 Agent Loop 和工具协议，再用 package 测试断言 bin/files 字段；README 以 Quick Start、配置、架构、安全边界、eval 证据和设计取舍组织，Demo 采用脚本化 cast 降低模型波动；验证路径为 CLI 输入测试、TypeScript build、全量测试和 npm pack 内容检查。

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

## backfill historical commit notes

- commit: f4cb915
- time: 2026-06-13 23:09
- Why: 历史提交缺少 Why / What / How 复盘，后续写技术文章或回看 P1 最小闭环演进时，只看 commit 标题无法还原关键取舍和验证证据。
- What: 为当前分支历史中的 18 个提交补齐 commit notes，并把旧的不可达哈希 `cf4967a` 替换为当前历史中的 `ebe8beb`，让记录与真实 Git 历史一致。
- How: 先用 `git log` 确认当前短哈希和提交时间，再按提交 diff 提炼每条记录的设计意图、行为变化和验证方式；通过 `git diff`、字段 `rg` 检查和哈希覆盖检查确认补录完整。本条记录在提交后追加，因为短哈希只能在提交创建后确定。

## add baseline CI quality checks

- commit: ci: add baseline quality checks
- time: 2026-06-13 23:14
- Why: 当前仓库只有本地 `build` 和 `test` 脚本，缺少远端合并前的最小质量卡点；首版 CI 需要先固定可重复安装、构建和测试，而不提前引入 lint、Harness 或未实现的安全能力。
- What: 新增 GitHub Actions workflow，在 push 和 pull request 上使用 Node 20 执行 `npm ci` 与 `npm run ci`；新增 `.npmrc` 固定公网 npm registry，并把 lockfile 的 resolved 地址从内部 bnpm 归一到 npmjs，保证 GitHub 托管 runner 可安装依赖。
- How: 将质量组合逻辑收敛到 `package.json` 的 `ci` 脚本，workflow 只调用单一入口；lockfile 只做 registry 主机替换，不改版本和 integrity。验证时本机默认 npm cache 因权限问题失败，改用临时 cache 后 `npm ci` 通过，并执行 `npm run build`、`npm test`、`npm run ci`，确认 11 个测试文件和 66 条测试全部通过。

## add tool category classifier

- commit: aa5a4d8
- time: 2026-06-13 23:27
- Why: P2 Harness 的权限确认、命令规则和沙箱都需要先知道工具的行为类别；如果分类散落在后续权限模块里，Agent Loop 很容易重新耦合具体工具名，破坏 Harness 作为统一控制层的边界。
- What: 新增独立分类模块，将 `read_file`、`write_file`、预留的 `edit_file` 和 `run_command` 映射到 read/write/command，并让未知工具显式返回 `unknown`；已注册工具的运行时 `category` 继续保留在工具协议内，但不允许写成 `unknown`，OpenAI-compatible schema 仍不暴露任何运行时字段。
- How: 用集中表驱动 `classifyTool()`，并用 permissions 单测覆盖已知工具、未知工具和默认注册表一致性；registry 集成测试继续证明模型可见 schema 不包含 `execute` 或 `category`。验证方式为 `npm run build` 与 `npm test`，确认 12 个测试文件和 69 条测试全部通过。

## add permission confirmation module

- commit: 0e8dfd3
- time: 2026-06-13 23:40
- Why: P2-W4-T2 需要先把人工确认做成可测试的独立能力，再由后续任务接入 Agent Loop；这样可以避免权限交互、工具执行和模型消息链路一次性耦合，减少后续 Harness 重构的迁移成本。
- What: 新增 `requestPermission()`，对 read 类工具直接放行，对 `write_file` 打印路径和前三行内容预览后要求 y/n 确认，对 `run_command` 打印命令后要求确认；拒绝或无法识别输入统一返回 `Cancelled by user`，未知工具按保守策略进入确认。
- How: 用可注入的 `PermissionIO` 包装 stdout/stdin，默认实现基于 `node:readline/promises`，测试中用 mock IO 避免阻塞交互；权限模块复用 `permissions/categories` 的 ToolCategory，保持权限层内聚。验证方式为 `npm test -- tests/permissions/index.test.ts`、`npm run build` 和 `npm test`，确认 rebase 到 `origin/main` 后 13 个测试文件和 78 条测试全部通过。

## wire permission checks into agent loop

- commit: wire permission checks into agent loop
- time: 2026-06-13 23:50
- Why: T2 已经把权限确认做成独立模块，但 Agent Loop 仍会直接执行所有工具调用；P2-W4-T3 需要把确认决策放到 tool call -> execution 的关键路径上，同时保持 Agent Loop 不理解具体确认文案和交互细节。
- What: 新增 `checkToolPermission()` 作为工具定义到权限请求的薄适配层，并让 `runAgentLoop` 在执行工具前检查权限；批准时继续执行，拒绝时跳过工具并把 `[permission denied]` tool 消息回传给模型，未知工具仍作为错误 tool 消息进入下一轮。
- How: 通过可注入的 `PermissionChecker` 测试批准、拒绝、未知工具和多工具混合路径，P1 端到端测试显式注入批准决策以避免自动化测试卡在 stdin；验证方式为 `npm run build`、目标权限/Agent Loop 测试和全量 `npm test`，确认 14 个测试文件和 87 条测试全部通过。

## add auto approve cli flag

- commit: add auto approve cli flag
- time: 2026-06-13 23:55
- Why: P2-W4-T4 需要给自动化测试和集成场景一条显式跳过人工确认的路径，否则接入权限确认后，涉及写文件或命令执行的端到端任务会卡在 stdin；同时这个开关必须保持可见、可测试，避免把权限绕过藏进环境变量。
- What: 新增 `AppConfig.autoApprove` 并接入 Agent Loop 的权限检查参数；CLI 支持 `--auto-approve` 和 `-y`，解析时会从用户输入中剥离 flag，确保模型不会把 flag 当成任务内容；权限模块在 auto-approve 模式下直接批准工具请求，但不跳过工具执行、参数解析或错误回传。随同提交补充 AGENTS 的冲突处理约束，明确冲突修复默认服务于 rebase merge。
- How: 用独立 `parseCliArgs()` 固定 flag 解析行为，并用配置、CLI、权限模块、Agent Loop 权限集成和 P1 端到端测试覆盖新增字段与调用形态；验证方式为目标测试 `npm test -- tests/config.test.ts tests/index.test.ts tests/permissions/index.test.ts tests/agent-loop.test.ts tests/agent-loop-permission.test.ts`、`npm run build` 和全量 `npm test`，确认 14 个测试文件和 95 条测试全部通过。

## add dangerous command rules

- commit: add dangerous command rules
- time: 2026-06-14 10:48
- Why: P2-W5 需要在人工确认之前建立可测试的命令拦截能力；如果先把规则写进 Agent Loop 或 `run_command`，后续 Harness 接管执行链路时会重复迁移边界，也容易把安全策略和工具实现耦合在一起。
- What: 新增独立命令安全规则引擎，只根据 `run_command` 的命令文本给出允许或拒绝决策；首批规则覆盖递归删除、外部 URL 请求、强制推送、系统路径写入、`sudo` 提权和 `chmod 777`，但暂不改变现有工具执行行为，避免提前完成 P2-W5-T3 的集成任务。
- How: 用只读规则表和稳定 `ruleId`/`reason` 返回值承载策略，正则匹配保持最小实现并通过反向用例控制误伤；验证方式为 `npm run build`、`npm test -- tests/permissions/rules.test.ts` 和全量 `npm test`，确认 15 个测试文件和 104 条测试全部通过。

## plan observability eval milestone

- commit: plan observability eval milestone
- time: 2026-06-14 10:50
- Why: 原 P4 只把 eval 当作阶段性 runner、报告和门禁，缺少可观测事件、hook 扩展点和数据回流底座；如果没有统一 trace，后续评测结果只能说明通过率，难以复盘 Agent 在 LLM、工具、权限和验证链路上的真实行为。
- What: 将 P4 重构为“可观测与持续评测”里程碑，先建设 lifecycle event、hook runtime、本地 JSONL 和 HTTP feedback，再让 eval runner 消费观测 trace 生成趋势与退化门禁；原发布写作阶段顺延为 P5，并在总计划中补 Observability & Hooks 和 Continuous Eval 模块。
- How: 参考 Codex/TraeX hook 的生命周期思想，但把首版范围收敛到当前项目已经或即将拥有的 session、prompt、LLM、tool、permission、verification、stop 和 eval 事件；选择 JSON 配置避免引入 TOML 依赖，选择本地 JSONL 作为事实来源、HTTP feedback 作为可选回流。验证方式为 `git diff --check`，本次为文档计划调整，未运行代码测试。

## sync plan completion status

- commit: sync plan completion status
- time: 2026-06-14 10:53
- Why: P2 的部分实现已经完成并有对应提交证据，但计划文档仍保持未完成状态，容易让后续执行者重复规划或误判项目进度；同时需要把“完成计划任务必须更新 checklist”沉淀成长期规则，避免路线图和真实进展再次脱节。
- What: 将 P2-W4-T1 到 P2-W5-T1 标记为已完成，并在 AGENTS 的文档更新范式中新增要求：完成 `docs/plan/` 或主执行计划里的明确任务后，必须同次把对应 checklist 从 `[ ]` 改为 `[x]`，且只能标记真实完成的任务。
- How: 只同步计划状态和协作规则，不改变代码行为；完成项对应前序提交中已有分类、权限确认、Agent Loop 接入、auto-approve 和危险命令规则的实现与测试证据。验证方式为 `git diff --check`，本次为文档状态与规则更新，未运行代码测试。

## add working directory sandbox

- commit: add working directory sandbox
- time: 2026-06-14 11:02
- Why: P2-W5-T2 需要把“路径是否仍在 `workingDirectory` 内”做成集中、可测试的判定能力；当前路径校验散落在各工具的 `validatePath` 里，若继续扩散，后续 Harness 接管执行链路时会重复迁移，也难以统一越狱判定口径。
- What: 新增 `src/permissions/sandbox.ts`，导出 `checkPathInSandbox()` 与 `resolvePathInSandbox()`；判定规则为绝对路径直接拒绝、非空字符串校验、解析后用 `path.relative` 判断是否逃出 root，允许 `..` 只要解析后仍在 root 内，符号链接只做路径规范化不追踪真实目标。本次只交付沙箱模块与单测，不改动 `read_file`/`write_file`/`run_command` 或 Agent Loop，真实接入留给 P2-W5-T3。
- How: 用 `path.resolve` 规范化 root 再以 `path.relative` 判断前缀，规避 `/tmp/app` 与 `/tmp/app2` 的 sibling 前缀误判；单测覆盖合法相对路径、`..` 内部归一、`..` 越狱、绝对路径、非法输入、sibling 前缀和 symlink 不追踪，并验证 `resolvePathInSandbox` 抛错原因与 check 决策一致。验证方式为 `npm test -- tests/permissions/sandbox.test.ts`、`npm run build` 和全量 `npm test`，确认 16 个测试文件和 119 条测试全部通过。

## wire safety checks into agent loop

- commit: wire safety checks into agent loop
- time: 2026-06-14 11:04
- Why: P2-W5-T3 需要让沙箱和危险命令规则真正进入工具执行前的关键路径；如果继续只依赖工具内部校验或人工确认，危险命令仍会先进入确认环节，`autoApprove` 场景也无法证明安全规则不可绕过。
- What: 在 Agent Loop 中新增可注入的安全检查层，执行顺序固定为工具存在检查、沙箱/规则检查、权限确认、工具执行；安全拒绝以 `[blocked]` tool 消息回传给模型并使用真实 `tool_call_id`，同时保留当前无 Harness 时由 Agent Loop 编排的边界。
- How: 默认安全检查复用 `checkPathInSandbox()` 和 `checkCommandSafety()`，只对 `read_file`、`write_file`、`edit_file` 做路径沙箱，对 `run_command` 做命令规则，避免按 category 误伤自定义 read/write 工具；测试覆盖沙箱逃逸、危险命令、`autoApprove` 不绕过规则、安全写入仍进入确认、多 tool call 独立处理，以及旧 Agent Loop 单测通过注入 allowSafety 保持协议焦点。验证方式为目标 Agent Loop/permissions 测试、`npm run build` 和全量 `npm test`，确认 17 个测试文件和 136 条测试全部通过。

## add edit file tool

- commit: add edit file tool
- time: 2026-06-14 11:05
- Why: P2-W5-T4 需要在全量覆盖式 `write_file` 之外提供更窄的编辑能力，让模型能基于已读上下文做唯一字符串替换；先实现精确替换而不是 patch 解析，可以把行为边界收敛到可测试的最小闭环，并避免提前引入复杂 diff 语义。
- What: 新增默认 `edit_file` 工具，接受 `path`、`old_string` 和 `new_string`，只在 `old_string` 精确出现一次时写回 UTF-8 文本；未匹配、多处匹配、二进制文件和非法路径都会返回错误且不改文件。默认工具集和 AGENTS 能力描述同步包含 `edit_file`，P2 计划状态标记为完成。
- How: 工具实现复用 `read_file`/`write_file` 的相对路径约束和二进制拒绝思路，用出现次数检查防止误替换；registry 集成测试验证默认工具顺序、write 分类和 OpenAI-compatible schema 不泄露运行时字段，工具单测覆盖成功替换、删除文本、空文件、未匹配、多匹配、非法参数、路径拒绝和二进制拒绝。验证方式为目标工具/registry/categories/Agent Loop 测试、`npm run build` 和全量 `npm test`，确认 17 个测试文件和 136 条测试全部通过。

## add verification test runner

- commit: add verification test runner
- time: 2026-06-14 11:13
- Why: P2-W6 需要开始建立编辑后的自验证能力，但第一步应先交付一个独立、可测试的测试执行器；如果直接接入 Agent Loop，会把命令执行、结果摘要和对话注入耦合在一起，也容易提前声明尚未完成的自修复闭环。
- What: 新增 `runTests()`，用于在指定工作目录执行测试命令，返回 passed、exitCode、stdout、stderr 和 durationMs；普通测试失败被结构化为失败结果而不是异常，超时统一返回失败结果并保留可读错误。P2 计划同步将 W6-T1 标记为完成，但没有新增配置、没有注册 LLM 工具，也没有接入编辑后自动验证。
- How: 实现复用 Node `exec` 的 cwd 与 timeout 能力，并提供可选 `timeoutMs` 让超时单测不依赖 60 秒等待；单测覆盖成功、失败、stdout/stderr 保留、超时和非法输入。验证方式为 `npm run build`、`npm test -- tests/verification/test-runner.test.ts` 和全量 `npm test`，确认 18 个测试文件和 141 条测试全部通过。

## wire post-edit test verification into the loop

- commit: wire post-edit test verification into the loop
- time: 2026-06-14 11:30
- Why: W6-T1 已交付独立的 `runTests`，但结果还无法被模型感知。本次目标是补齐 W6 自验证闭环（T2 摘要 + T3 接入 + T4 端到端），让 Agent 改完代码后自动跑测试并看到结果，为后续 W7 的重试循环打底；难点在于既要复用 T1 的 `TestResult`，又不能把测试执行硬编码进循环导致单测必须真跑测试。
- What: 新增 `formatTestResults()` 把 `TestResult` 压成回喂模型的简洁摘要（成功 `All tests passed (N tests in M files, Xs)`、失败列出 `FAIL ... / Expected / Received`、超 2000 字符截断、解析不到时回退原始输出）。`AppConfig` 新增可选 `testCommand`（覆盖 override/`TEST_COMMAND` 环境变量/空值/默认），CLI 新增 `--test-command <cmd>` 接入执行路径。Agent Loop 在每轮工具执行后，若本轮有成功的 `write_file`/`edit_file` 且配置了 `testCommand`，调用可注入的 `testRunner` 并把摘要以 assistant 消息注入对话；未配置则跳过。边界未变：仍未引入 Harness、未实现重试，验证只读不修复。
- How: `formatTestResults` 用正则解析 vitest 默认 reporter 的 `Test Files` / `Tests` / `Duration` 行与 `FAIL`/`Expected`/`Received`，与输出格式耦合换取实现简单，解析失败时一律回退到截断后的 stdout/stderr 保证模型不会拿到空信息——这是刻意的健壮性兜底。Agent Loop 通过新增的 `testRunner` 默认参数（默认 `runTests`）实现依赖注入，单测注入假 runner 断言①编辑后触发、②结果以 assistant role 注入、③无 testCommand 不触发、④非编辑工具不触发的时序。T4 端到端用临时项目（`add.mjs` 故意写成 `a - b` + 纯 node `check.mjs` 作为 testCommand），避免在临时目录引入 TS 工具链即可真跑测试。验证方式为 `npm run build` 和全量 `npm test`。

## add post-edit self-fix retry loop

- commit: add post-edit self-fix retry loop
- time: 2026-06-14 11:40
- Why: W6 已经能在编辑后运行测试并把结果回喂模型，但失败结果只是一条普通验证消息，模型没有明确的修复语义，也缺少重试上限和过程日志。P2-W7 需要把这条链路升级为有限自修复循环，同时保持 Harness 仍留到 W8，避免过早把权限、安全、验证和执行统一成新抽象。
- What: 新增 `retry-loop` 状态机记录验证失败次数、失败摘要和模型动作，测试失败时注入 `Tests failed. Please fix the issues:`，达到 `maxRetries` 后注入 `Unable to fix after n attempts` 并继续主对话；`AppConfig` 与 CLI 新增 `maxRetries` 和 `verbose`，logger 替换 Agent Loop 中直接 `console.log` 的 turn/tool/verify 输出。P2-W7 checklist 标记为完成，并新增完整自修复 E2E，证明失败测试能驱动下一轮编辑直到通过。
- How: 重试模块只处理状态和消息生成，不直接调用 LLM 或工具，Agent Loop 仍负责 tool call 协议、权限、安全和测试执行；这样既能实现 W7 行为，又不抢 W8 Harness 的边界。验证覆盖配置读取与非法值、CLI 参数、logger 注入、retry 状态机、Agent Loop 失败回喂/上限停止/关闭验证/工具错误不验证，以及临时 `reverseString` 项目的真实编辑和测试执行。验证方式为 `npm run build`、目标 W7/W6 测试和全量 `npm test`，确认 25 个测试文件和 171 条测试全部通过。

## add harness and p2 eval runner

- commit: add harness and p2 eval runner
- time: 2026-06-14 11:50
- Why: W6/W7 已经把编辑后验证和有限重试接进 Agent Loop，但权限、安全、工具执行和验证触发仍散落在循环里；如果继续扩展 eval 或后续可观测事件，Agent Loop 会重新承担控制层职责。P2-W8 需要先把执行控制收敛成 Harness，再建立首版可重复运行的 eval 基准入口。
- What: 新增 `Harness` 作为唯一工具执行控制层，按工具存在检查、沙箱/危险命令规则、权限确认、工具执行、编辑后验证的顺序编排；Agent Loop 只保留 LLM 消息链路、tool call id 回传和停止条件。新增 `src/evals/types.ts`、`src/evals/runner.ts`、5 个 JSON 基准任务和 `npm run eval`，runner 会创建临时项目、运行真实 Agent、检查文件/输出/测试期望并保存 JSON 结果。P1/P2 里程碑和 P2-W8 checklist 标记完成，并在 README 记录 5/5 通过的真实 baseline。
- How: Harness 复用现有 permission/rules/sandbox/test-runner/format-results/retry-loop 模块，不改变安全语义：`autoApprove` 只跳过人工确认，不能绕过拦截规则。eval runner 放入 `src/evals` 以复用现有 TypeScript 编译链路，避免为 `tsx` 引入新依赖；单测通过 fake runner 验证任务读取、临时目录、期望检查和结果落盘。真实 baseline 使用 `.env` 中的 Ark 配置和 `deepseek-v4-flash-260425` 跑通 5 个任务，结果保存为 `evals/results/2026-06-14T03-51-17-197Z.json`；运行时发现 auto-approve 仍会提前创建 readline listener，随后改为 lazy 初始化，避免 eval 多任务场景触发 listener warning。验证方式为 `npm run build`、目标 Harness/Agent Loop/eval 测试、全量 `npm test` 和 `npm run eval -- --all`。

## add npm start cli shortcut

- commit: add npm start cli shortcut
- time: 2026-06-14 11:59
- Why: 当前用户需要先记住构建命令再手动执行 `node dist/index.js`，这对日常试用 CLI 和进入 REPL 都偏繁琐。项目已经有稳定的 TypeScript 构建入口和 CLI 入口，因此最小改动是提供一个 npm 脚本，把构建与启动串成单一命令，而不是新增未实现的全局安装或发布能力。
- What: 新增 `npm start`，执行 `npm run build && node dist/index.js`；README 的快速开始和使用示例改为优先展示 `npm start`，带参数时使用 npm 的 `--` 透传约定。行为边界不变：仍然复用现有 CLI 参数解析、配置必填校验、REPL 和单次任务路径，没有改变工具权限、安全规则或 LLM 协议。
- How: 在 `tests/index.test.ts` 中导入 `package.json`，用脚本断言固定快捷命令指向构建后的真实入口，避免帮助文档与可执行脚本漂移。验证方式为 `npm run test -- tests/index.test.ts`、`npm run build` 和全量 `npm test`，确认 28 个测试文件和 191 条测试全部通过。

## add p3 search tools and message history

- commit: add p3 search tools and message history
- time: 2026-06-14 14:48
- Why: P3-W9 的目标是让 Agent 从单文件最小闭环走向多文件项目处理能力。仅靠 `read_file` 会迫使模型猜文件位置或读取大量无关内容，缺少 `grep`/`glob` 的检索入口；同时 Agent Loop 继续直接维护裸消息数组，会让后续上下文压缩、预算管理和 token 观测难以集中接入。
- What: 新增默认 `grep`、`glob` 只读检索工具，并在系统提示词中明确 glob 定位、grep 搜索、read_file 读完整上下文、edit_file 修改的工作流；Harness 对检索工具执行路径沙箱但不触发编辑后验证。新增 `MessageHistory` 管理 OpenAI-compatible 消息历史，Agent Loop 改为通过它追加 system/user/assistant/tool 消息，并在结果中返回 API usage 累计的 `totalTokens`。P3-W9-T1 到 T5 checklist 同步标记完成。
- How: `glob` 使用 `fast-glob`，默认排除 `node_modules`、`.git`、`dist`，输出排序并限制前 100 条；`grep` 复用 glob 遍历文本文件，跳过二进制内容，按 `path:line: text` 输出并限制前 50 条。`MessageHistory` 保持协议对象原样，只提供浅拷贝数组和约 4 字符/token 的估算，避免把运行时状态混入 `src/types.ts`。验证方式为 `npm run build` 和全量 `npm test`，确认 31 个测试文件和 218 条测试全部通过；期间发现默认 registry 与 Harness 测试需要同步覆盖新检索工具，已补齐顺序、schema、沙箱和只读不验证断言。

## add context compressor

- commit: add context compressor
- time: 2026-06-14 14:58
- Why: P3-W10 需要让长对话在进入模型前可压缩，否则多文件任务积累的 read/grep/glob/tool 结果会不断推高上下文体积，最终要么请求失败，要么迫使后续实现做粗暴截断。首版选择独立压缩器而不是扩展全局配置，是为了先固定最小可测行为，并避免把阈值、CLI flag 和环境变量校验一起拉进本任务。
- What: 新增 `ContextCompressor`，在 token 估算超过阈值时用一次 LLM 摘要早期消息，保留 system 消息和最近 N 条对话消息，并把摘要写成 `Context summary:` assistant 消息。Agent Loop 在每轮 LLM 调用前检查压缩，触发后替换 `MessageHistory` 并记录压缩前后 token；P3-W10-T1/T2 checklist 同步标记完成。
- How: 压缩器只依赖最小 `chat(systemPrompt, userMessage)` 接口，摘要提示词固定要求保留读取/修改文件、关键决定、当前状态、验证失败和下一步，避免把 tool schema 或运行时字段暴露给摘要调用。`MessageHistory.replace()` 提供受控替换能力，Agent Loop 通过可注入 `HistoryCompressor` 做测试隔离。验证方式为目标测试 `npm test -- tests/context/message-history.test.ts tests/context/compressor.test.ts tests/agent-loop.test.ts tests/integration/p1-end-to-end.test.ts`、`npm run build`、全量 `npm test` 和 `git diff --check`，确认 32 个测试文件和 229 条测试全部通过。

## add context-aware read file ranges

- commit: add context-aware read file ranges
- time: 2026-06-14 15:02
- Why: P3-W10-T3 要避免 `read_file` 把超大文件完整塞进上下文，同时工具输出里又不能提示模型使用不存在的能力。只做默认截断会降低上下文压力，但模型无法继续精确读取被省略区段；因此本次把大文件截断和真实可用的 `offset`/`limit` 行范围读取一起交付。
- What: `read_file` 保持 500 行以内原样返回，超过 500 行时默认返回前 100 行、截断提示和后 50 行；工具 schema 新增可选 `offset` 与 `limit`，按 1-based 行号读取指定区段，`limit` 默认 200 且最大 500。P3-W10-T3 checklist 同步标记完成，路径校验和二进制拒绝边界不变。
- How: 实现把文件内容先按行处理，默认路径只在超过阈值时截断，显式范围读取则跳过默认截断并加一行范围元信息，方便模型知道当前片段对应原文件行号。单测覆盖 500 行边界、501 行截断、提示文本、范围读取、默认 offset/limit、越界空片段、非法参数和 limit 上限。验证方式为 `npm test -- tests/tools/read-file.test.ts tests/tools/registry-integration.test.ts`、`npm run build` 和全量 `npm test`，确认 32 个测试文件和 235 条测试全部通过。

## add p3 multifile eval tasks

- commit: add p3 multifile eval tasks
- time: 2026-06-14 15:09
- Why: P2 的 5 个基准任务主要验证单文件读写、简单编辑和自验证闭环，无法覆盖 P3 已新增的 grep/glob 检索、长上下文压缩和多文件导航能力。P3-W10-T4 需要先把任务数据扩展到多文件项目，为后续 W11 的全量 eval 对比提供固定样本。
- What: 新增 `06-grep-fix` 到 `10-implement-from-spec` 五个 eval 任务，分别覆盖错误文本定位 bug、按既有模式添加函数、跨文件重命名、为未测试模块补测试、按 spec 实现功能；每个任务都提供 3 个以上 setup 文件和 Node 内置测试命令。新增真实任务目录测试，固定 01-10 排序、P3 任务多文件约束和 `testsPassing` 期望；P3-W10-T4 checklist 同步标记完成。
- How: 继续复用现有 EvalTask JSON schema，不新增 runner 字段或工具调用断言，避免在没有 trace 事件前把“必须调用 grep/glob/压缩”伪装成可验证事实。任务测试全部使用 `.mjs` 和 `node:assert`，不引入新依赖；验证方式为 `npm test -- tests/evals-types.test.ts tests/evals-runner.test.ts tests/evals-tasks.test.ts`、`npm run build`、全量 `npm test` 和 `git diff --check`，确认 33 个测试文件和 238 条测试全部通过。

## add todo planning tool

- commit: add todo planning tool
- time: 2026-06-14 15:14
- Why: P3-W11 的目标是让 Agent 在多步任务中显式维护规划状态，而不是只把计划写进自然语言回答里。首版选择单次用户请求内的内存 TODO，避免把跨会话持久化、长期任务恢复和清空策略提前引入当前最小闭环。
- What: 新增 `TodoManager`、默认 `todo_write` 工具和任务拆解提示词模块；系统提示词指导复杂或 3 步以上任务先创建计划、执行中更新状态、验证后标记完成。Agent Loop 在每轮模型调用前注入当前 TODO 状态，CLI 在请求结束后展示进度列表；P3-W11-T1 到 T4 checklist 同步标记完成。
- How: `todo_write` 采用完整列表替换语义，并校验非空 id/content、合法 status、最多一个 `in_progress`；工具 category 标为 `read`，因为它只修改进程内规划状态，不写工作区文件。拆解模块只提供可测的 prompt builder 和文本解析器，不额外改变 Agent Loop 的 LLM 请求次数；验证覆盖 planning、工具 schema/registry、权限分类、系统提示词、Agent Loop 上下文注入和 CLI 展示。

## record p3 eval result

- commit: record p3 eval result
- time: 2026-06-14 15:21
- Why: P3 的功能已经覆盖多文件检索、上下文压缩、context-budget 读取和 TodoWrite 规划，但没有真实全量 eval 结果就无法判断这些能力在 10 个任务上的实际表现，也无法和 P2 的 5 任务基线做可复盘对比。
- What: 运行 `npm run eval -- --all` 得到 P3 结果 `9/10`，并保存为 `evals/results/2026-06-14-p3.json`；README 新增 P2/P3 对比表和 P3 任务明细，记录平均轮数从 3.8 到 4.6、平均重试从 0.0 到 0.4，并说明 `09-add-tests-for-module` 失败于期望文本缺失。P3-W11-T5 和总执行计划中的 P3 里程碑标记完成。
- How: 保留 runner 原始输出文件 `2026-06-14T07-17-18-855Z.json`，同时复制一份稳定命名的 P3 结果文件便于 README 引用；对比指标只使用现有 eval JSON 字段手工计算，不新增 runner schema 或持续评测逻辑。验证方式为 `npm run build`、全量 `npm test`、真实 `npm run eval -- --all` 和最终 `git diff --check`。

## add p4 observability hooks

- commit: add p4 observability hooks
- time: 2026-06-14 15:41
- Why: P3 已经有多文件 eval 和规划状态，但运行过程仍只能从最终结果倒推，缺少统一事件流来复盘 LLM、工具、权限、验证和 eval 的真实路径。P4-W12 先建设最小可观测底座，把事件模型、hook 扩展点和 JSONL 事实来源固定下来，为 W13 的 trace 消费、趋势报告和退化门禁打基础。
- What: 新增 `AgentEvent` schema、脱敏摘要、`EventRecorder`、本地 JSONL sink、HTTP feedback sink 和 command/http hook runtime；CLI 支持 `--hooks-config`，配置层支持观测目录与 feedback 环境变量。Agent Loop emit LLM request/response 和 Stop，Harness emit 工具前后、权限和编辑后验证，eval task emit 开始/结束；P4-W12-T1 到 T4 checklist 标记完成。协议边界不变：工具 schema 仍不暴露运行时字段，工具异常仍回传模型，观测和 hook 默认不改变 Agent 成败。
- How: recorder 被设计成唯一观测入口，但对主链路只暴露同步 `emit()`：调用方只创建、脱敏、校验并入队事件，JSONL、HTTP feedback 和 hook 由后台 drain 顺序处理，请求结束只做 500ms 有界 flush。sink/hook 失败只写 stderr 或 HookFailure 事件，避免把观测链路变成执行链路的新故障源；payload 统一经过敏感 key 与凭证样式脱敏，并限制摘要长度，防止把密钥、完整环境变量或大段命令输出写进 trace。测试覆盖事件校验/脱敏、JSONL/HTTP sink、hook 顺序/失败/非递归、配置优先级、CLI 参数、Agent Loop/Harness/eval 生命周期事件和非阻塞 flush 超时。验证方式为新增 observability 测试、配置/CLI/Agent/Harness/eval 定向测试、`npm run build` 和全量 `npm test`。

## add trace based continuous evals

- commit: add trace based continuous evals
- time: 2026-06-14 16:10
- Why: P4-W12 已经把 Agent、Harness 和 eval 的生命周期写成 JSONL trace，但 eval runner 仍主要依赖自身的临时计数，无法复用普通 CLI 和 eval 共享的观测证据，也缺少 repeat、报告和退化门禁。W13 的目标是把 trace 从旁路日志提升为持续评测的事实来源，同时保持真实 LLM eval 与无密钥 PR 校验分离。
- What: 新增 trace reader、baseline gate 和 Markdown/dashboard report；eval runner 支持 suite、repeat、mock eval、稳定 trace 目录、baseline check，并把 result schema 扩展为 runId/tracePath/toolCalls/permissionDeniedCount/verificationRuns/feedbackStatus 等 trace 汇总指标。新增 smoke/regression suite、`npm run eval:mock`、eval workflow artifact 上传，README 更新 hooks/trace 和持续 eval 用法，P4-W13-T1 到 T4 checklist 同步标记完成。
- How: 每个 eval attempt 使用独立 runId，把 trace 写入 `evals/results/traces/{suiteRunId}/`，任务临时目录删除后仍可复盘；runner 仍负责文件/输出/测试期望，行为指标只从 JSONL 汇总，避免重复埋点。mock eval 只验证平台链路并满足文件期望，不伪造成真实模型能力；baseline gate 先用保守阈值检查 pass rate、平均 turns/tool calls、flaky rate 和 feedback health。验证覆盖 trace 解析、runner suite/repeat/mock、baseline 退化、report/dashboard、脚本和 CI 配置。

## align docs with current implementation

- commit: align docs with current implementation
- time: 2026-06-14 16:24
- Why: README 已经基本描述 P4 后的能力，但 AGENTS 仍停在 P1 最小闭环，继续保留“没有 Harness、没有 grep/glob/todo_write、没有写前确认”的约束会误导后续维护者，也会让文档审查时无法判断哪些能力是真实现状、哪些仍是路线图。P5 文档也需要收窄“清理代码”任务，避免把 JSDoc 扫描和当前代码底线混在同一个强制任务里。
- What: AGENTS 的项目边界更新为当前 P1-P4 主链路，明确默认 7 个工具、Harness、上下文压缩、TodoWrite、observability 和持续 eval 平台，同时把未成熟能力限定为完整 OS 沙箱、完整命令安全、检索增强、发布级包分发和长期趋势运营。README 补齐 hook/feedback 配置、架构图中的检索/规划工具和观测链路、默认工具表以及安全边界免责声明；总执行计划把 P4 里程碑与子计划完成状态对齐。P5 发布计划将首个任务聚焦为代码清理，弱化一次性补齐所有 JSDoc 的要求。
- How: 先用源码和测试核对当前真实能力，再只改文档中的能力边界、维护约束和配置说明，不改运行时代码。验证方式为旧描述 `rg` 检查、工具/配置一致性搜索、`npm run build`、全量 `npm test` 和 `git diff --check`；测试结果为 44 个测试文件、304 条测试全部通过。

## add ink tui

- commit: add ink tui
- time: 2026-06-14 18:01
- Why: readline REPL 已经能跑通最小闭环，但多轮交互缺少运行状态、消息流、工具摘要和权限确认的结构化呈现，用户很难像使用 Claude Code 一样持续输入任务并观察 agent 当前状态。首版选择基础 Ink TUI，而不是完整 IDE 或流式渲染，是为了改善交互体验，同时不扩大 Agent Loop、工具协议和 Harness 安全边界。
- What: 无参数启动改为进入基础 Ink TUI，带一次性任务时仍保持原 CLI 路径；新增 TUI 消息流、单行输入、运行态、TODO 展示、工具摘要和内联 `y/n` 权限确认。会话执行和 observability recorder 从 CLI 入口抽到共享 session 层，TUI 和一次性 CLI 复用同一条 tool call -> Harness -> ToolRegistry 主链路。依赖新增 Ink/React 和 TUI 测试库，TS/Vitest 配置支持 TSX，并关闭测试文件并行以稳定终端交互测试。
- How: TUI 自己维护输入缓冲和权限确认 promise，但所有真实工具执行仍由 Harness 编排，`--auto-approve` 仍只跳过人工确认而不绕过路径、命令规则或参数校验。实现过程中尝试过显式终端光标定位，但 Ink/Yoga 坐标在当前布局下会把真实光标放错位置，最终删除显式光标逻辑，只保留普通输入文本，避免错误视觉状态影响可用性。验证方式为 `npm run build`、`npm test -- tests/tui/app.test.tsx tests/tui/permission.test.tsx`、全量 `npm test` 和 `git diff --check`；最终全量测试为 46 个测试文件、323 条测试全部通过。

## align tui input interactions

- commit: align tui input interactions
- time: 2026-06-14 22:36
- Why: 当前 Ink TUI 已经提供基础输入、运行状态和权限确认，但输入框仍停留在尾部追加/删除模型，无法像 Claude Code 的终端输入一样进行基础光标编辑。为避免把 slash command、历史搜索、模型选择等未要求能力带进当前极简 Agent，本次只对齐现有输入和确认流程的键盘交互。
- What: TUI 输入现在维护光标位置，支持在光标处插入字符、Left/Right/Home/End、Backspace/Delete，以及 Ctrl+A/E/B/F/U/K/W 等常见终端编辑键；运行中继续锁定普通输入，权限确认提示改为确认式文案并显式支持 Esc 取消。行为边界不变：权限决策仍只有批准/拒绝，真实工具执行仍走 Harness。
- How: 使用 `inputRef` 与 `cursorOffsetRef` 保持 Ink 输入状态同步，通过局部编辑 helper 统一更新文本和光标，输入行用反色字符渲染 caret，避免引入完整 TextInput 组件或外部状态系统。测试补齐光标插入、删除、Ctrl 编辑、运行中输入忽略和 Esc 拒绝权限；已验证 `npm test -- tests/tui/app.test.tsx tests/tui/permission.test.tsx`、`npm run build`、全量 `npm test` 全部通过。

## add mvp follow-up plans

- commit: add mvp follow-up plans
- time: 2026-06-14 22:40
- Why: 当前实现已经跑通 Claude Code-style coding agent 的核心闭环，但如果要把它从学习型内核推进到可称为产品 MVP，还需要把会话恢复、TUI 工作台、命令权限、工具编排和 diff/验证闭环拆成可执行计划。直接在对话里描述优先级不利于后续接续开发，因此需要把 P6-P10 沉淀到 `docs/plan/` 并纳入总计划索引。
- What: 新增 P6 到 P10 五份后续计划，分别覆盖会话持久化与恢复、REPL/TUI 交互升级、命令安全与权限规则增强、工具执行编排升级、文件 diff 与验证闭环增强；`docs/detailed-execution-plan.md` 同步加入新计划链接、核心模块和未完成里程碑。所有新增 checklist 均保持 `[ ]`，避免把规划误标为已实现能力。
- How: 沿用既有阶段计划的格式，把每个方向拆成任务说明、验收标准、关键文件和验证要求；计划中特别保留现有项目边界，例如继续使用 OpenAI-compatible `chat/completions`、不声称完整 OS 沙箱、不把 SubAgent 放入 MVP 前五。验证方式为文档 diff 和状态检查，本次为纯文档计划更新，未运行代码测试。

## add claude style tui startup screen

- commit: add claude style tui startup screen
- time: 2026-06-14 22:44
- Why: 当前 TUI 空会话首屏只有一行提示，虽然可用，但缺少 Claude Code 风格启动画面的身份感和上下文信息。为了提升进入 TUI 后的第一眼可读性，同时不引入 slash command、历史恢复或模型切换等未实现能力，本次只把空状态改成静态欢迎面板。
- What: 空消息状态下新增 `StartupScreen`，展示 `Welcome to coding-agent`、简洁 ASCII 标识、当前 model、cwd、权限模式以及发送/退出提示；用户提交第一条消息后启动画面消失，继续使用原有消息流。顶部状态栏、输入框、权限确认和工具执行链路不变。
- How: 启动画面作为 `messages.length === 0` 的展示分支实现，不改变 TUI 状态机或 session runner；测试更新首屏断言，并新增提交后隐藏启动画面的覆盖。验证方式为 `npm test -- tests/tui/app.test.tsx tests/tui/permission.test.tsx`、`npm run build` 和全量 `npm test`，确认 46 个测试文件、330 条测试全部通过。

## align hooks with claude code observability

- commit: align hooks with claude code observability
- time: 2026-06-14 22:56
- Why: 现有 hook runtime 是项目自定义的扁平事件转发格式，能把事件发给 command/http，但缺少 Claude Code 风格的 matcher、标准 hook input、hook 执行开始/结束证据和 transcript 路径。为了服务可观测场景，需要把 hook 协议对齐 Claude Code 的配置形态，同时保持当前极简 Agent 的主执行边界不被 hook 改写。
- What: hook 配置改为 `hooks.<EventName>: [{ matcher, hooks }]`，默认读取 `.claude/settings.json`，不再兼容旧的 `agent-hooks.json` 扁平格式；command/http hook 接收 Claude Code 风格 input，包含 session、cwd、transcript、事件名、原始 agent event 和工具摘要。trace 新增 `HookStart` / `HookEnd`，记录 hookId、matcher、target、outcome、耗时、HTTP 状态、exitCode 和脱敏输出；`HookStart` / `HookEnd` / `HookFailure` 不再递归触发 hook。hook 输出只进入观测 trace，不阻断工具执行、不审批权限、不修改工具输入、不向模型注入上下文。
- How: `HookRuntime` 先按事件和 matcher 生成待执行 hook，再围绕每个 hook emit 开始/结束事件；command hook 捕获 stdout/stderr 并尝试解析 JSON 输出用于审计，http hook 复用 JSON POST sink 并把状态码返回给 hook trace。`createEventRecorder()` 先创建本地 JSONL sink，再把 trace 路径注入 hook input，并在 `SessionStart` 记录 hook 配置摘要而不是完整命令。验证方式为 `npm run build`、定向 `npm test -- tests/observability/hooks.test.ts tests/observability/events.test.ts tests/observability/recorder.test.ts tests/observability/sinks.test.ts tests/config.test.ts tests/index.test.ts tests/agent-loop.test.ts tests/agent-loop-permission.test.ts tests/agent-loop-verification.test.ts`、全量 `npm test` 和最终 `git diff --check`；全量结果为 46 个测试文件、335 条测试全部通过。

## add otel trace exporter

- commit: add otel trace exporter
- time: 2026-06-15 11:21
- Why: JSONL trace 已经能服务本地 eval 和复盘，但如果要对齐 Claude Code 的 OpenTelemetry 路径并接入外部观测平台，需要一个标准 OTel trace 出口。首版只导出 traces，不扩展 logs/metrics，避免把持续趋势平台或完整遥测栈误描述成已完成能力。
- What: 新增基于标准 OpenTelemetry SDK 的 `OtelTraceSink`，把现有 session、LLM、tool、verification 和 hook lifecycle events 映射成 spans，同时保留 JSONL trace 作为 eval 的权威事实来源。配置层新增默认关闭的 `observability.otel`，支持项目自有环境变量和标准 OTLP trace endpoint；CLI session 和 eval runner 复用同一套 sink 组装逻辑，OTel 失败仍只作为观测出口失败处理，不改变 Agent 主流程。
- How: 复用 `EventSink` 接口而不是改动 `EventRecorder` 事件协议，确保脱敏和截断仍统一发生在 `createAgentEvent()`；span 配对按 turn、FIFO 或 hookId 完成，无法配对的事件降级为 session event。eval 通过覆盖本地 trace 目录继续写入 `evals/results/traces/{runId}`，避免破坏 trace-reader。验证方式为 `npm run build`、配置/observability/eval 定向测试、全量 `npm test`、`npm run eval:mock` 和 `git diff --check`。

## reorder learning roadmap

- commit: reorder learning roadmap
- time: 2026-06-15 13:03
- Why: P6-P10 后续计划最初按 MVP 产品顺序排列，把 TUI 放在 Diff、MCP、Multi-Agent 和配置治理之前；这对产品体验合理，但不符合当前“优先学习 Claude Code 核心框架”的目标。TUI 会消耗大量交互细节成本，而 runtime 内核更能解释 coding agent 的真实复杂度。
- What: 将 Diff 与验证闭环前置为 P7，把 TUI 后置为 P13；新增 P10 MCP/插件式工具扩展、P11 多 Agent 编排、P12 配置策略治理三份计划。总执行计划同步更新目录、范围、核心模块、里程碑、目标结构和设计决策，明确新增方向是学习版能力，不实现插件市场、完整 MCP 生态、完整远程 swarm 或企业级策略平台。
- How: 采用重命名未完成计划文件的方式保持路线编号和学习优先级一致；所有新增 checklist 均保持 `[ ]`，避免误标实现状态。计划中特别强调外部工具仍走 Harness、子 Agent 不污染主消息历史、配置治理不得保存密钥。验证方式为旧链接和旧编号 `rg` 检查、新计划完成状态检查以及 `git diff --check`；本次为纯文档规划调整，未运行代码测试。

## add claude code learning site

- commit: add claude code learning site
- time: 2026-06-15 15:53
- Why: Claude Code 学习材料已经有入口大纲，但 architecture 和 modules 还缺少成体系的章节内容、可视化表达和可浏览站点；如果继续只用散落 Markdown，读者很难按“跨模块设计问题”和“源码模块职责”两条线建立完整地图，也难以验证 Mermaid 图和路由是否能被文档工具正确渲染。
- What: 补齐 `docs/claude-code-learning/architecture/` 和 `modules/` 的主题笔记，architecture 聚焦跨模块设计取舍，modules 聚焦类型、接口、执行链路、失败路径和测试证据；所有学习页增加 Mermaid 图示，并新增 Rspress 站点配置、入口页、导航、侧边栏、搜索、Mermaid 渲染和 geek 风全局样式。新增 `docs:dev`、`docs:build`、`docs:preview` 脚本和 Rspress 相关 devDependencies，构建产物输出到被忽略的 `doc_build/claude-code-learning`。
- How: 以现有 `docs/claude-code-learning/README.md`、`modules/README.md` 和 `module-coverage.md` 为章节清单，逐项映射到实际 Markdown 文件，并用 `<claude-code-snapshot>` 占位保持参考路径不绑定本机。Rspress 接入采用 `@rspress/core` v2，root 指向现有学习目录；Mermaid 用 `rspress-plugin-mermaid` 渲染；`globalStyles` 在 ESM 配置中用 `fileURLToPath(import.meta.url)` 解析绝对路径，避免 Rspress 临时 runtime 把相对 CSS 当成包名。验证方式为 `npm run docs:build`、`npm run build`、本地 `docs:dev` HTTP 200 检查、Mermaid 覆盖扫描、路径/敏感词扫描和 `git diff --check`。

## deploy learning site with pages

- commit: deploy learning site with pages
- time: 2026-06-15 16:22
- Why: Rspress 已经能把 `docs/claude-code-learning` 构建成静态站点，但如果只停留在本地预览，学习材料仍无法通过 GitHub Pages 稳定访问。部署链路需要和现有 PR CI 分开，避免文档站点发布影响主 Agent build/test/eval 的职责边界。
- What: 新增 GitHub Pages workflow，针对 `docs/claude-code-learning`、Rspress 配置和 package 依赖变化触发；PR 上只执行 `npm run docs:build` 校验，push 到 `main` 或手动触发时上传 `doc_build/claude-code-learning` 并使用官方 Pages action 部署。workflow 使用 Node 22，匹配当前 Rspress 2 的 engine 要求。
- How: 采用 GitHub 官方 `actions/upload-pages-artifact` 和 `actions/deploy-pages`，权限只开放 `contents: read`、`pages: write`、`id-token: write`；构建产物仍保持在 `.gitignore` 的 `doc_build/` 下，不提交静态文件。验证方式为本地 `npm run docs:build`、workflow 路径和权限审查、`git diff --check`。

## fix pages asset base path

- commit: fix pages asset base path
- time: 2026-06-15 16:59
- Why: GitHub Pages 项目站点部署在 `/coding-agent/` 子路径下，Rspress 默认 `base: "/"` 会让 HTML 引用 `/static/...`，导致页面能访问但 CSS/JS 样式资源从域名根路径加载而 404。
- What: 将 Rspress 配置的 `base` 设置为 `/coding-agent/`，让构建产物中的静态资源和站内链接匹配 `https://xdlrt.github.io/coding-agent/` 这个项目站点路径。
- How: 只改 Rspress 站点配置，不改变文档内容和 Agent 运行时代码；验证方式为 `npm run docs:build`，并检查生成的 `index.html` 中资源路径包含 `/coding-agent/static/`。

## docs: rename project to luka in readme

- commit: docs: rename project to luka in readme
- time: 2026-06-16 18:30
- Why: 远端仓库已改名为 `luka`，README 顶部标题仍是旧仓库名 `coding-agent`，造成仓库名与文档展示不一致；同时希望首屏有更醒目的项目标识。需要在更新命名的同时避免误导，因为 npm 包名和 CLI bin 仍是 `coding-agent`（`package.json` 未改名）。
- What: 将 README 主标题从 `coding-agent` 改为 `luka`，并在标题下用 ASCII art 拼出 LUKA 字样；新增一行说明区分“仓库名 = luka”与“npm 包名/CLI 命令仍为 coding-agent”。正文中的 `npm start` / `coding-agent` / `npm link` 等命令保持不变，确保文档与 `package.json` 实际包名和 bin 一致，不制造命令与源码的偏差。
- How: 仅编辑 `README.md` 文档，不触碰运行时代码、配置和测试边界；ASCII art 用 box-drawing 字符放进 `text` 代码块以保证终端和站点渲染对齐。本次为纯文档改动，未运行代码测试；“仓库改名不等于 npm 改名”这一边界在 README 与本复盘中均显式标注，避免后续误以为包名已迁移。

## rename brand from coding-agent to luka

- commit: rename brand from coding-agent to luka
- time: 2026-06-16 16:30
- Why: 上一提交只改了 README 标题，仓库内仍把 `coding-agent` 作为 npm 包名、bin 命令、运行时点目录、OTel service name、TUI 文案和站点 base 散落各处。用户要求把品牌名彻底统一为 `luka`，并显式要求把品牌名抽成全局变量，方便后续再次改名时只改一处而不必全仓搜索替换。
- What: 新增 `src/brand.ts` 作为品牌单一事实来源，导出 `BRAND_NAME` 及其派生标识（`DOT_DIR`、`DEFAULT_OBSERVABILITY_DIR`、`OTEL_SERVICE_NAME`、`OTEL_TRACER_SCOPE`、`TUI_TITLE`、`TUI_WELCOME`、`EVAL_TMP_PREFIX`）。运行时代码（config 默认值、evals/runner、observability/otel tracer scope、tui 文案、context/compressor 提示词）改为从 brand 派生；运行时点目录由 `.coding-agent/observability` 改为 `.luka/observability`，属行为变化。静态文件无法 import TS，直接改字面量：`package.json`/lockfile 的 name 与 bin、`.gitignore`/`.npmignore` 点目录、`rspress.config.ts` 的 `base` → `/luka/`（跟随远端仓库新名）。测试断言改为复用 brand 常量，纯本地 mkdtemp 前缀与文档（README、CONTRIBUTING、issue 模板、demo.cast、detailed-execution-plan、plan/*、learning-site deep-dive 引用）改为 `luka`。
- How: 关键设计是让“可被代码引用的标识”全部收敛到 `brand.ts`，静态配置文件因无法 import 而成为唯一需要手改的边界，并在 brand.ts 注释中点明这一点。范围上区分三类 `coding-agent`：指代本项目→改 `luka`；泛指“coding agent”概念（CONTRIBUTING 的 coding-agent loop、package.json description）→不动；`docs/commit-notes.md` 历史复盘→按 append-only 约定保留不动。踩坑点：旧工具 Grep 命中里大量 `docs/claude-code-learning/` 其实来自已删除但仍被 git 跟踪的旧文件，磁盘真实新书结构无引用，真正命中在未跟踪的 deep-dive WIP 子树。验证：`npm run build`、`npm test`（47 文件 339 测试全过）、`npm run eval:mock`（2/2）。`npm run docs:build` 仍失败，但原因是未跟踪的 deep-dive/index.md 指向尚未创建章节的 dead link，与本次 rename 无关；本提交不含该 WIP 子树与 gitignored 的 `.coding-agent/` 旧 trace。

## docs: editorial pass on claude-code-learning book

- commit: docs: editorial pass on claude-code-learning book
- time: 2026-06-16 19:35
- Why: 以出版社签约级标准对《拆解 Claude Code》科普册与《内核解剖》深度册做全书审稿后，发现一处必改硬伤与多处一致性问题，需要在同一次编辑收口：深度册第 8 章用 `src/bridge/`、`src/remote/`、`src/server/` 这些**本仓库并不存在**的路径来指代 Claude Code 快照内容，既打破全书“`// src/...` = 本仓库可运行真实代码”的证据约定，又与该章结尾“本仓库没有 bridge”自相矛盾，会让读者无法分辨“真实最小实现”与“快照推断”。其余为编辑级一致性问题。
- What: ①第 8 章所有指代快照的文件路径去掉 `src/` 前缀（改为 `bridge/…`、`remote/…`、`server/…`、`entrypoints/…`），开篇新增“路径约定”声明并改写证据标签，明确这些文件本仓库不存在；保留 `src/session.ts`、`src/harness.ts`、`src/tui/app.tsx` 三处经核对存在的真实代码引用。②科普书第 5 章删除“下一章……准确说是第 7 章”的草稿式自我更正。③附录 A 把阐释性 `PermissionDecision`（`behavior/ask` 形态）改名为 `PermissionOutcome` 并加注与最小实现同名类型区分，第 8 章桥接消息引用同步更新。④`ChildRunHandle.status` 的 `'cancelled'` 统一为 `'killed'`，与第 7 章正文及 `TaskStatus` 一致。⑤深度册全卷正文双引号统一为「」，与科普册风格对齐。本次为纯文档改动，不涉及运行时代码、配置或测试边界。
- How: 审稿阶段把深度册所有标注 `// src/...` 的“真实代码”逐一与仓库源码核对（agent-loop、tools/index、tools/types、compressor、harness、permissions/rules、permissions/sandbox、recorder、observability/events、evals/baseline、tui/app 共 11 处），确认全部逐字一致、阈值常量准确，从而把问题精确锁定在第 8 章的路径来源标注而非代码本身。引号统一用脚本化处理：按 fenced code block 与行内 code span 分段保护，只转换正文双引号，避免改动 TS 字符串字面量；改完用括号配对平衡校验 + 代码字面量抽样（`Bearer [redacted]`、`"[redacted]"`、`"SessionStart"` 仍在）确认代码块未被污染。沉淀的可复用范式：跨“真实最小实现 + 闭源快照推断”双源技术书，路径前缀必须成为来源的唯一判别信号，任何混用都会让诚实声明失效。
