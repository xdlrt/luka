# Claude Code Learning

这个目录用于系统学习 Claude Code 的架构设计，并把观察到的设计取舍和当前 `coding-agent` 实现做对比。目标不是复刻 Claude Code，也不是把大型产品能力提前写进本项目，而是沉淀可复用的 agent 工程设计判断。

Claude Code 参考资料默认来自本地研究快照。文档中统一使用占位前缀表示快照根目录，避免绑定或暴露个人机器路径：

- `<claude-code-snapshot>`

当前 `coding-agent` 是一个极简 coding agent，已经覆盖 CLI/TUI、OpenAI-compatible `tool_calls`、Harness 工具执行、权限确认、基础命令规则、编辑后验证、上下文压缩、规划状态、observability、hooks、trace 和 eval runner。学习笔记必须严格区分：

- `当前已实现`：源码和测试已经具备的能力。
- `当前规划中`：`docs/plan/` 或其他计划文档中描述但尚未落地的能力。
- `Claude Code 设计`：参考项目中的架构形态，不等价于本项目已经拥有。

## 推荐阅读顺序

1. 总体架构：先理解 Claude Code 的入口、查询循环、工具注册、上下文注入和 UI 关系。
2. Agent Loop：对比 Claude Code `query` 流程和本项目 `runAgentLoop` 的边界。
3. 工具系统：分析工具 schema、运行时执行、权限上下文和结果回传。
4. 上下文管理：分析 git 状态、CLAUDE.md、memory、compact 和消息裁剪。
5. 权限安全：分析工具调用前的权限判断、命令安全、工作目录边界和用户确认。
6. Skill 系统：分析 SkillTool、技能目录加载、动态发现、权限交互和 MCP skill builder。
7. MCP / LSP / API 服务层：分析外部工具协议、语言服务、认证、重试和配额。
8. 插件与扩展：分析插件加载、市场、信任提示、Skill/MCP/工具扩展之间的边界。
9. IDE / Remote / Server Bridge：分析 CLI 与 IDE、远程会话、SDK/Server 模式的连接方式。
10. 任务与子 Agent：分析 AgentTool、Task 系统、coordinator 思路，以及本项目 P11 计划。
11. 状态、记忆与配置治理：分析 AppState、memdir、SessionMemory、settings sync、schema 和 migrations。
12. CLI/TUI 与命令系统：分析命令注册、slash commands、Ink UI、权限交互和会话体验。
13. 输入输出体验：分析 keybindings、vim、voice、output styles、structured IO 和 NDJSON 输出。
14. 可观测与评估：分析 trace、成本、hook、eval 和长期质量反馈。

## 目录说明

- `architecture/`：放跨模块的架构设计笔记，例如主循环、上下文、权限、安全和可观测性。
- `modules/`：放按子模块拆分的学习笔记，例如 Tool、Query、Context、Task、TUI。
- `templates/`：放分析模板。新增笔记时优先复制模板，保持结构一致。
- `module-coverage.md`：记录 Claude Code 顶层模块覆盖情况，帮助后续查漏补缺。

## 归档原则

`architecture/` 按设计问题归档，适合回答“为什么这样设计”。一篇架构笔记通常会横跨多个源码目录，重点是职责边界、控制流、数据流、设计取舍、优缺点，以及当前 `coding-agent` 是否值得借鉴。

`modules/` 按源码模块归档，适合回答“这个模块做什么”。一篇模块笔记应更贴近具体文件、类型、接口和模块职责，用来建立 Claude Code 源码结构和当前 `coding-agent` 实现之间的对照关系。

同一个主题可以同时出现在两个目录，但角度不同。例如 Skill：

- `architecture/skill-system.md`：分析 Skill 作为能力扩展机制，和 Tool、MCP、Plugin、权限系统的关系。
- `modules/skill-tool.md`：分析 `SkillTool`、`skills/loadSkillsDir.ts`、`bundledSkills.ts`、`mcpSkillBuilders.ts` 的职责边界。

新增笔记时先判断问题类型：如果是在解释一个跨模块设计，放 `architecture/`；如果是在拆解某个源码模块，放 `modules/`。

## 写作原则

- 以架构职责、数据流、控制流和工程取舍为主，不逐行复述源码。
- 每篇都要包含具体场景，避免只写抽象概念。
- 每篇都要写优点和缺点，避免把复杂设计默认视为更好设计。
- 每篇都要和当前 `coding-agent` 做对比，明确哪些适合借鉴，哪些不适合照搬。
- 禁止把 Claude Code 的成熟能力描述成本项目已经实现的能力。
- 禁止声称本项目已有完整沙箱、完整危险命令防护、成熟长期趋势平台、npm registry 发布运营或真正的检索增强。
