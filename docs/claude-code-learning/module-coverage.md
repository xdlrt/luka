# Claude Code Module Coverage

这份清单用于检查学习大纲是否覆盖 Claude Code 快照中的主要模块。覆盖不是指逐文件分析，而是确保每类设计都有明确归档位置，后续写笔记时不会遗漏重要系统。

## 已纳入核心学习主题

| Claude Code 模块 | 归档主题 | 说明 |
| --- | --- | --- |
| `query.ts`、`QueryEngine.ts`、`query/` | Agentic Loop 与停止条件 | 主循环、流式响应、tool use、停止原因、错误恢复 |
| `Tool.ts`、`tools.ts`、`tools/` | Tool Use 协议与执行链路 | 工具 schema、运行时执行、权限上下文、工具注册 |
| `context.ts`、`context/`、`services/compact/` | Context / Memory / Compact | 系统上下文、用户上下文、compact、消息保护 |
| `hooks/`、`types/permissions`、`utils/permissions/` | Permission / Sandbox / Safety | 权限模式、用户确认、安全规则、工具调用前检查 |
| `tools/SkillTool/`、`skills/`、`services/skillSearch/` | Skill 系统与能力扩展 | 技能目录、动态发现、SkillTool、MCP skill builder |
| `services/mcp/`、`services/lsp/`、`services/api/`、`services/oauth/` | MCP / LSP / API 服务层 | 外部协议、认证、模型 API、语言服务 |
| `plugins/`、`services/plugins/`、`commands/plugin/` | 插件系统与扩展治理 | 插件加载、市场、信任、扩展治理 |
| `bridge/`、`remote/`、`server/`、`cli/transports/`、`entrypoints/sdk/` | IDE / Remote / Server Bridge | IDE 桥接、远程会话、SDK/Server、传输协议 |
| `state/`、`memdir/`、`services/SessionMemory/`、`services/extractMemories/`、`services/settingsSync/`、`schemas/`、`migrations/` | 状态、记忆与配置治理 | AppState、持久记忆、设置同步、schema、迁移 |
| `commands.ts`、`commands/`、`main.tsx`、`replLauncher.tsx`、`components/`、`screens/` | CLI / TUI / Commands / Session | slash commands、Ink UI、权限提示、会话体验 |
| `keybindings/`、`vim/`、`voice/`、`outputStyles/`、`cli/structuredIO.ts` | 输入输出体验 | 快捷键、Vim、语音、输出风格、结构化输出 |
| `tasks.ts`、`Task.ts`、`tasks/`、`tools/AgentTool/`、`coordinator/` | Sub-agent / Task / Coordinator | 子 Agent、任务系统、协调器、结果摘要 |
| `cost-tracker.ts`、`costHook.ts`、`services/analytics/`、`services/toolUseSummary/`、`services/AgentSummary/` | Observability / Eval / Trace | 成本、事件、摘要、评估反馈 |
| `commands/commit.ts`、`commands/diff/`、`commands/branch/`、`commands/install-github-app/`、`utils/git.js` | Git / GitHub 工作流 | commit、diff、branch、PR、GitHub App |

## 低优先级产品化外围

这些模块可以在对应主题里顺带分析，但不需要优先单独成文。

| Claude Code 模块 | 建议归档 | 原因 |
| --- | --- | --- |
| `buddy/` | CLI / TUI / Commands / Session | 偏产品体验，不影响 coding agent 核心闭环 |
| `outputStyles/` | 输入输出体验 | 和输出风格、响应格式有关 |
| `moreright/` | Observability / Eval / Trace | 需要进一步确认职责后再决定是否单独分析 |
| `native-ts/` | CLI / TUI 或服务层 | 更偏运行时工程支撑 |
| `upstreamproxy/` | MCP / LSP / API 服务层 | 更偏网络或代理接入 |
| `assistant/` | Agentic Loop 或 CLI/TUI | 需要按具体文件确认职责 |
| `bootstrap/`、`setup.ts`、`projectOnboardingState.ts` | 状态、记忆与配置治理 | 启动和 onboarding 支撑 |

## 当前项目边界提醒

- 当前 `coding-agent` 没有 IDE bridge、远程会话、server 模式、插件市场、Skill 系统、MCP/LSP 集成、OAuth、GitHub App、语音输入或 Vim 模式。
- 当前 `coding-agent` 已有基础 hooks、observability、eval runner、上下文压缩和 TUI，但规模和 Claude Code 产品化系统不同。
- 学习这些模块时，重点沉淀设计取舍和可借鉴边界，不要把 Claude Code 的成熟能力写成当前项目已实现能力。
