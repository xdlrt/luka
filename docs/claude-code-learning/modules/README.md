# Module Notes

这里放按子模块拆分的 Claude Code 学习笔记。模块笔记比 `architecture/` 更贴近文件和组件职责，但仍以架构级分析为主，不做逐行源码复述。

## 模块索引

| 模块 | Claude Code 参考 | coding-agent 对照 | 建议分析方向 |
| --- | --- | --- | --- |
| Query / Agent Loop | `<claude-code-snapshot>/src/query.ts`、`src/QueryEngine.ts` | `src/agent-loop.ts`、`src/llm-client.ts` | 请求循环、stream 事件、tool use 判断、错误恢复、上下文压缩触发 |
| Tool 类型与注册 | `<claude-code-snapshot>/src/Tool.ts`、`src/tools.ts` | `src/types.ts`、`src/tools/types.ts`、`src/tools/index.ts` | 模型可见 schema、运行时 execute、权限上下文、工具过滤 |
| 文件与命令工具 | `<claude-code-snapshot>/src/tools/FileReadTool/`、`src/tools/FileEditTool/`、`src/tools/BashTool/`、`src/tools/GrepTool/` | `src/tools/read-file.ts`、`src/tools/edit-file.ts`、`src/tools/run-command.ts`、`src/tools/grep.ts` | 文件边界、二进制拒绝、精确替换、命令安全、搜索体验 |
| Context | `<claude-code-snapshot>/src/context.ts`、`src/utils/attachments.js`、`src/utils/messages.js` | `src/context/system-prompt.ts`、`src/context/message-history.ts`、`src/context/compressor.ts` | git 状态、CLAUDE.md、当前日期、消息历史、tool call 配对 |
| Permission / Harness | `<claude-code-snapshot>/src/hooks/useCanUseTool.js`、`src/types/permissions.js`、`src/utils/permissions/` | `src/harness.ts`、`src/permissions/index.ts`、`src/permissions/rules.ts`、`src/permissions/sandbox.ts` | 权限模式、分类、拒绝原因、危险命令、编辑后验证 |
| SkillTool / Skills | `<claude-code-snapshot>/src/tools/SkillTool/`、`src/skills/loadSkillsDir.ts`、`src/skills/bundledSkills.ts`、`src/skills/mcpSkillBuilders.ts`、`src/services/skillSearch/` | `docs/plan/p10-mcp-plugin-tools.md`、`docs/plan/p11-multi-agent-orchestration.md` | 技能目录、技能发现、技能执行、权限请求、与工具/插件/MCP 的关系 |
| MCP / LSP / API / OAuth | `<claude-code-snapshot>/src/services/mcp/`、`src/services/lsp/`、`src/services/api/`、`src/services/oauth/` | `src/llm-client.ts`、`src/config.ts`、`docs/plan/p10-mcp-plugin-tools.md` | 外部服务连接、模型 API、重试、认证、MCP 工具映射、语言服务 |
| Plugin System | `<claude-code-snapshot>/src/plugins/`、`src/services/plugins/`、`src/commands/plugin/` | `docs/plan/p10-mcp-plugin-tools.md` | 插件发现、安装、信任、市场、插件与工具注册关系 |
| Bridge / Remote / Server | `<claude-code-snapshot>/src/bridge/`、`src/remote/`、`src/server/`、`src/cli/transports/`、`src/entrypoints/sdk/` | `src/session.ts`、`src/index.ts` | IDE 桥接、远程控制、SDK schema、server session、权限回调 |
| State / Memory / Config | `<claude-code-snapshot>/src/state/`、`src/memdir/`、`src/services/SessionMemory/`、`src/services/extractMemories/`、`src/services/settingsSync/`、`src/schemas/`、`src/migrations/` | `src/config.ts`、`src/session.ts`、`src/context/*` | AppState、记忆扫描和提取、配置同步、schema、迁移、敏感信息保护 |
| Task / AgentTool | `<claude-code-snapshot>/src/tasks.ts`、`src/Task.ts`、`src/tools/AgentTool/` | `docs/plan/p11-multi-agent-orchestration.md` | 子 Agent 生命周期、独立历史、结果摘要、并发写冲突 |
| CLI / Commands / TUI | `<claude-code-snapshot>/src/main.tsx`、`src/commands.ts`、`src/commands/`、`src/components/`、`src/screens/` | `src/index.ts`、`src/session.ts`、`src/tui/app.tsx` | flag 剥离、slash command、权限确认 UI、会话恢复、诊断命令 |
| Input / Output UX | `<claude-code-snapshot>/src/keybindings/`、`src/vim/`、`src/voice/`、`src/outputStyles/`、`src/cli/structuredIO.ts`、`src/cli/print.ts` | `src/index.ts`、`src/tui/app.tsx` | 快捷键、Vim 操作、语音输入、输出风格、非交互 structured IO |
| Git / GitHub Workflow | `<claude-code-snapshot>/src/commands/commit.ts`、`src/commands/diff/`、`src/commands/branch/`、`src/commands/install-github-app/`、`src/utils/git.js` | `docs/commit-notes.md`、`docs/plan/p5-release-writing.md` | commit、diff、branch、PR、GitHub App、自动化工作流边界 |
| Hooks / Observability | `<claude-code-snapshot>/src/costHook.ts`、`src/services/analytics/`、`src/query/stopHooks.js` | `src/observability/events.ts`、`src/observability/hooks.ts`、`src/observability/recorder.ts`、`src/evals/*` | 事件模型、脱敏、hook 生命周期、eval 报告 |

## 新增模块笔记流程

1. 从 `docs/claude-code-learning/templates/module-analysis.md` 复制模板。
2. 在 `modules/` 下用模块名创建 Markdown 文件。
3. 先列参考文件，再写场景和对比。
4. 明确当前项目是否已经实现相关能力。
5. 如果产生后续任务，只记录为候选行动，不把它写成已完成能力。

## 对比口径

- `coding-agent` 的工具协议必须保持模型 API 协议和运行时协议分离。
- `Agent Loop` 的真实执行路径必须保持 tool call -> Harness -> ToolRegistry -> tool message。
- `run_command` 当前只有工作目录、超时和基础危险命令规则，不能描述成完整命令沙箱。
- `write_file` 当前会覆盖已有文件，不能描述成无风险合并写入。
- 子 Agent、插件市场、完整 RAG、完整 OS 级沙箱仍不属于当前已实现能力。
- Skill 系统目前不属于当前已实现能力；分析时应作为 Claude Code 参考设计或后续候选方向处理。
- IDE bridge、远程会话、server 模式、LSP、OAuth、GitHub App、语音输入、Vim 模式和插件市场均不属于当前已实现能力。
