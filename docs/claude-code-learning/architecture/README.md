# Architecture Notes

这里放 Claude Code 的跨模块架构学习笔记。每篇文章应围绕一个架构问题展开：它解决什么场景、如何组织控制流、代价是什么、当前 `coding-agent` 是否需要类似设计。

## 待分析主题

| 主题 | Claude Code 参考 | coding-agent 对照 | 关注点 |
| --- | --- | --- | --- |
| Agentic Loop 与停止条件 | `<claude-code-snapshot>/src/query.ts`、`src/QueryEngine.ts` | `src/agent-loop.ts`、`tests/agent-loop.test.ts` | 多轮请求、tool use 判断、停止条件、错误恢复、max turns |
| Tool Use 协议与执行链路 | `<claude-code-snapshot>/src/Tool.ts`、`src/tools.ts`、`src/services/tools/` | `src/types.ts`、`src/tools/types.ts`、`src/tools/index.ts`、`src/harness.ts` | 模型 schema 和运行时协议分离、工具注册、结果回传 |
| Context / Memory / Compact | `<claude-code-snapshot>/src/context.ts`、`src/services/compact/`、`src/utils/messages.js` | `src/context/*`、`src/session.ts`、`tests/context/*.test.ts` | 系统上下文、用户上下文、消息裁剪、tool call 配对保护 |
| Permission / Sandbox / Safety | `<claude-code-snapshot>/src/hooks/useCanUseTool.js`、`src/types/permissions.js`、`src/utils/permissions/` | `src/harness.ts`、`src/permissions/*`、`tests/permissions/*.test.ts` | 权限模式、用户确认、命令规则、工作目录边界 |
| Skill 系统与能力扩展 | `<claude-code-snapshot>/src/tools/SkillTool/`、`src/skills/`、`src/services/skillSearch/`、`src/utils/hooks/registerSkillHooks.ts` | `docs/plan/p10-mcp-plugin-tools.md`、`docs/plan/p11-multi-agent-orchestration.md` | 技能加载、动态发现、权限交互、工具化执行、与插件/MCP 的边界 |
| MCP / LSP / API 服务层 | `<claude-code-snapshot>/src/services/mcp/`、`src/services/lsp/`、`src/services/api/`、`src/services/oauth/` | `src/llm-client.ts`、`docs/plan/p10-mcp-plugin-tools.md` | 外部协议、认证、连接管理、重试、语言服务、模型 API 边界 |
| 插件系统与扩展治理 | `<claude-code-snapshot>/src/plugins/`、`src/services/plugins/`、`src/commands/plugin/` | `docs/plan/p10-mcp-plugin-tools.md` | 插件加载、市场、信任提示、扩展工具与 Skill/MCP 的边界 |
| IDE / Remote / Server Bridge | `<claude-code-snapshot>/src/bridge/`、`src/remote/`、`src/server/`、`src/cli/transports/`、`src/entrypoints/sdk/` | `src/index.ts`、`src/session.ts` | IDE 连接、远程会话、SDK/Server 模式、消息协议、权限回调 |
| 状态、记忆与配置治理 | `<claude-code-snapshot>/src/state/`、`src/memdir/`、`src/services/SessionMemory/`、`src/services/settingsSync/`、`src/schemas/`、`src/migrations/` | `src/config.ts`、`src/session.ts`、`src/context/*` | AppState、持久记忆、配置 schema、迁移、设置同步、敏感信息边界 |
| CLI / TUI / Commands / Session | `<claude-code-snapshot>/src/main.tsx`、`src/commands.ts`、`src/commands/`、`src/replLauncher.tsx`、`src/components/`、`src/screens/` | `src/index.ts`、`src/session.ts`、`src/tui/*` | 命令入口、slash commands、交互体验、权限提示、会话复用 |
| 输入输出体验 | `<claude-code-snapshot>/src/keybindings/`、`src/vim/`、`src/voice/`、`src/outputStyles/`、`src/cli/structuredIO.ts`、`src/cli/ndjsonSafeStringify.ts` | `src/index.ts`、`src/tui/*` | 快捷键、Vim 模式、语音输入、输出风格、结构化输出 |
| Git / GitHub 工作流 | `<claude-code-snapshot>/src/commands/commit.ts`、`src/commands/diff/`、`src/commands/branch/`、`src/commands/install-github-app/`、`src/utils/git.js` | `docs/commit-notes.md`、`docs/plan/p5-release-writing.md` | commit/review/diff/branch/PR 工作流、自动化边界、发布叙事 |
| Observability / Eval / Trace | `<claude-code-snapshot>/src/cost-tracker.ts`、`src/costHook.ts`、`src/services/analytics/` | `src/observability/*`、`src/evals/*`、`tests/observability/*.test.ts` | 事件脱敏、trace、成本观测、eval 反馈 |
| Sub-agent / Task / Coordinator | `<claude-code-snapshot>/src/tools/AgentTool/`、`src/tasks.ts`、`src/coordinator/` | `docs/plan/p11-multi-agent-orchestration.md` | 子任务隔离、角色拆分、工作区冲突、摘要回传 |

## 建议文件命名

后续新增架构笔记时使用短横线命名：

- `agentic-loop.md`
- `tool-use-protocol.md`
- `context-compact.md`
- `permission-safety.md`
- `skill-system.md`
- `service-integrations.md`
- `plugin-system.md`
- `bridge-remote-server.md`
- `state-memory-config.md`
- `cli-tui-session.md`
- `input-output-experience.md`
- `git-github-workflow.md`
- `observability-evals.md`
- `sub-agent-orchestration.md`

## 分析要求

- 先描述 Claude Code 的设计，再描述当前 `coding-agent` 的实现边界。
- 对比时使用 `当前已实现`、`规划中`、`不适合当前阶段` 三类判断。
- 如果提出后续改进，必须能映射到具体模块或 `docs/plan/` 中的计划主题。
- 不要因为 Claude Code 具备某能力，就默认本项目应立即实现同等复杂度。
