# 附录 A　关键数据结构速查

本附录汇总深度册正文里反复出现的结构，按章节归类，便于查阅。除明确标注来源路径的之外，所有结构都是**阐释性重构**，用于表达机制，不是任何专有源码的逐字摘录；凡涉及 Claude Code 的部分均为基于一份来源未经核实的源码快照的推断。带 `// src/...` 路径标注的，来自本仓库可运行的最小实现。

## 第 1 章　Query 状态机（首次出现：第 1 章）

```typescript
// 阐释性重构
type State = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking?: TrackingState
  maxOutputTokensRecoveryCount: number
  hasAttemptedReactiveCompact: boolean
  maxOutputTokensOverride?: number
  pendingToolUseSummary?: Promise<ToolUseSummary | null>
  stopHookActive?: boolean
  turnCount: number
  transition?: Continue          // 记录"上一轮为何继续"，可断言恢复路径
}

type Terminal =
  | { reason: 'completed' }
  | { reason: 'max_turns'; turnCount: number }
  | { reason: 'model_error'; error: unknown }
  | { reason: 'prompt_too_long' }
  | { reason: 'image_error' }
  | { reason: 'aborted_streaming' }
  | { reason: 'aborted_tools' }
  | { reason: 'blocking_limit' }
  | { reason: 'stop_hook_prevented' }
  | { reason: 'hook_stopped' }

type Continue =
  | { reason: 'next_turn' }
  | { reason: 'reactive_compact_retry' }
  | { reason: 'collapse_drain_retry' }
  | { reason: 'max_output_tokens_escalate' }
  | { reason: 'max_output_tokens_recovery' }
  | { reason: 'stop_hook_blocking' }
  | { reason: 'token_budget_continuation' }
```

```typescript
// 阐释性重构——token 预算续跑（COMPLETION_THRESHOLD=0.9, DIMINISHING_THRESHOLD=500）
type BudgetTracker = {
  continuationCount: number
  lastDeltaTokens: number
  lastGlobalTurnTokens: number
  startedAt: number
}

type TokenBudgetDecision =
  | { action: 'continue'; nudgeMessage: string; continuationCount: number; pct: number; turnTokens: number; budget: number }
  | { action: 'stop'; completionEvent: null | {
      continuationCount: number; pct: number; turnTokens: number; budget: number
      diminishingReturns: boolean; durationMs: number } }
```

## 第 2 章　工具框架（首次出现：第 2 章）

```typescript
// 阐释性重构——生产级重型工具接口（摘其要）
type Tool<Input, Output> = {
  aliases?: string[]
  searchHint?: string                                  // 工具搜索关键词
  inputSchema: Schema<Input>
  inputJSONSchema?: JSONSchema                          // MCP 工具直接给 JSON Schema
  outputSchema?: Schema<Output>
  isReadOnly(input: Input): boolean                    // 三维行为分类
  isConcurrencySafe(input: Input): boolean
  isDestructive?(input: Input): boolean
  isEnabled(): boolean
  interruptBehavior?(): 'cancel' | 'block'
  description(input: Input, opts): Promise<string>
  prompt(opts): Promise<string>
  call(input: Input, ctx: ToolUseContext, canUseTool: CanUseToolFn): Promise<ToolResult<Output>>
  renderToolUseMessage?(...): unknown                  // 一组 UI 渲染回调
}

type ToolUseContext = {
  abortController: AbortController                      // 统一中断
  readFileState: FileStateCache
  agentId?: AgentId                                    // 仅子 Agent，身份被注入而非自称
  getToolPermissionContext(): Promise<ToolPermissionContext>
}
```

```typescript
// src/tools/types.ts（真实代码）——运行时协议（含 execute/category，模型看不到）
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<ToolResult>;
  category?: RegisteredToolCategory;
}
// 给模型的菜单 ChatToolDefinition 只含 { type, function: { name, description, parameters } }
```

## 第 3 章　上下文与压缩（首次出现：第 3 章）

```typescript
// 阐释性重构——压缩阈值常量与预警梯度
const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000
const AUTOCOMPACT_BUFFER_TOKENS = 13_000
const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000
const MANUAL_COMPACT_BUFFER_TOKENS = 3_000
// autoCompactThreshold = (contextWindow − 摘要预留) − AUTOCOMPACT_BUFFER
// 连续失败 3 次熔断，停止重试

type AutoCompactTrackingState = {
  compacted: boolean
  turnCounter: number
  turnId: string
  consecutiveFailures?: number   // 熔断计数
}
```

三种压缩对照：

| 名称 | 触发 | 作用对象 | 代价 |
| --- | --- | --- | --- |
| microcompact | 个别工具结果太占地方 | 仅白名单工具的大体积旧结果，清成占位符 | 极小，无额外模型调用 |
| autocompact | 历史整体接近阈值 | 全量摘要重写 | 一次额外模型调用 |
| reactive compact | 请求已被 413 拒绝 | 被动救场后重试 | 救场 + 重试 |

压缩摘要九段式：Primary Request / Key Technical Concepts / Files and Code / Errors and fixes / Problem Solving / All user messages / Pending Tasks / Current Work / Optional Next Step（`<analysis>` 草稿落地前剥离）。

## 第 4 章　Bash 安全与权限（首次出现：第 4 章）

```typescript
// 阐释性重构——tree-sitter 分析产出
type TreeSitterAnalysis = {
  quoteContext: {
    withDoubleQuotes: string         // 去单引号内容（双引号保留）
    fullyUnquoted: string            // 去所有引号内容
    unquotedKeepQuoteChars: string
  }
  compoundStructure: {
    hasCompoundOperators: boolean
    hasPipeline: boolean; hasSubshell: boolean; hasCommandGroup: boolean
    operators: string[]
    segments: string[]               // 按 && || ; 拆出的命令段
  }
  hasActualOperatorNodes: boolean     // 区分真 ; 与转义的 \;
  dangerousPatterns: {
    hasCommandSubstitution: boolean   // $() 或反引号（在会生效的引号外）
    hasProcessSubstitution: boolean
    hasParameterExpansion: boolean
    hasHeredoc: boolean; hasComment: boolean
  }
}

// 规则遮蔽检测：一条宽 allow 让具体 deny 永不命中
type ShadowResult =
  | { shadowed: false }
  | { shadowed: true; shadowedBy: PermissionRule; shadowType: 'ask' | 'deny' }

type PermissionMode =
  | 'default' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk' | 'plan'  // 外部
  | 'auto' | 'bubble'                                                      // 内部

// 阐释性的权限裁决形态——与最小实现的 PermissionDecision（{ approved } 形态）不同名同义
type PermissionOutcome =
  | { behavior: 'allow'; reason: string; metadata?: PermissionMetadata }
  | { behavior: 'deny'; reason: string; metadata?: PermissionMetadata }
  | { behavior: 'ask'; prompt: PermissionPrompt; metadata?: PermissionMetadata }
```

```typescript
// src/permissions/sandbox.ts（真实代码）——路径边界
export function checkPathInSandbox(workingDirectory: string, inputPath: unknown): SandboxDecision {
  // 拒绝：空、绝对路径、解析后逃逸出工作目录（.. 开头）
}
```

## 第 5 章　外部协议（首次出现：第 5 章）

```typescript
// 阐释性重构——退避重试（BASE_DELAY_MS=500，封顶 32s，jitter 0~25%）
function getRetryDelay(attempt: number, retryAfterHeader?: string | null, maxDelayMs = 32_000): number {
  if (retryAfterHeader) { /* 服务端指令优先 */ }
  const baseDelay = Math.min(500 * Math.pow(2, attempt - 1), maxDelayMs)
  return baseDelay + Math.random() * 0.25 * baseDelay   // jitter 防惊群
}

type McpConnection = {
  serverName: string
  transport: 'stdio' | 'sse' | 'http' | 'sdk' | 'in-process'
  authState: 'ready' | 'auth-required' | 'expired' | 'failed'
  capabilities: { tools: McpToolSchema[]; resources?: ResourceSchema[]; prompts?: PromptSchema[] }
}

type ServiceError =
  | { kind: 'network'; retryable: true }
  | { kind: 'auth-required'; retryable: false; authUrl: string }
  | { kind: 'token-expired'; retryable: true }
  | { kind: 'protocol'; retryable: false; message: string }
  | { kind: 'tool-error'; retryable: false; content: ToolResult }
// 重试还取决于 querySource：前台来源重试，后台来源（标题/分类器）立刻认输
```

## 第 6 章　扩展治理（首次出现：第 6 章）

```typescript
// 阐释性重构——Skill frontmatter 契约
type ParsedSkillFields = {
  displayName?: string
  description: string
  whenToUse?: string
  allowedTools: string[]              // 权限作用域，非建议
  version?: string
  model?: ModelSpec                   // 或 'inherit'
  disableModelInvocation: boolean     // 是否禁止模型自动调用
  userInvocable: boolean
  hooks?: HooksSettings               // Skill 可自带钩子
  executionContext?: 'fork'
  agent?: string
}

// 插件：按出口分路径
type LoadedPlugin = {
  name: string; manifest: PluginManifest; path: string; source: string; repository: string
  enabled?: boolean; isBuiltin?: boolean; sha?: string   // git SHA 版本锁定
  commandsPath?: string; commandsPaths?: string[]
  agentsPath?: string; agentsPaths?: string[]
  skillsPath?: string; skillsPaths?: string[]
  outputStylesPath?: string; outputStylesPaths?: string[]
  hooksConfig?: HooksSettings
  mcpServers?: Record<string, McpServerConfig>
  lspServers?: Record<string, LspServerConfig>
}

type PluginComponent = 'commands' | 'agents' | 'skills' | 'hooks' | 'output-styles'
// 加载顺序：路径穿越检查 → schema 校验 → 版本/策略/blocklist → 信任 → 按出口加载
```

## 第 7 章　多 Agent（首次出现：第 7 章）

```typescript
// 阐释性重构——子 Agent 规格与运行句柄
type SubAgentSpec = {
  task: string
  agentType?: string
  allowedTools?: string[]             // 替换所有 session allow 规则，保留 cliArg
  workingDirectory?: string
  isolation?: 'worktree' | 'remote'   // worktree 与 cwd 互斥
  mode?: 'sync' | 'async'
}

type ChildRunHandle = {
  runId: string; agentId: string
  controller: AbortController         // 异步子 Agent 拿独立未链接的 controller
  status: 'running' | 'completed' | 'failed' | 'killed'
  result?: AgentSummary
}

type AgentSummary = {
  success: boolean
  summary: string
  evidence: string[]
  changedFiles: string[]
}
// filterIncompleteToolCalls：剔除有 tool_use 但无 tool_result 的 assistant 消息
```

Task 后端：LocalAgentTask / RemoteAgentTask / InProcessTeammateTask / LocalShellTask / DreamTask，共享抽象但权限、取消、恢复语义各异。

## 第 8 章　桥接协议（首次出现：第 8 章）

```typescript
// 阐释性重构——bridge 入站/出站消息
type BridgeInbound =
  | { type: 'create_session'; cwd: string; metadata: ClientMetadata }
  | { type: 'resume_session'; sessionId: string }
  | { type: 'user_message'; sessionId: string; content: string; attachments?: Attachment[] }
  | { type: 'permission_response'; requestId: string; decision: PermissionOutcome }
  | { type: 'cancel'; sessionId: string; reason?: string }

type BridgeOutbound =
  | { type: 'session_created'; sessionId: string; runId: string }
  | { type: 'assistant_delta'; sessionId: string; text: string }
  | { type: 'tool_event'; sessionId: string; event: ToolEvent }
  | { type: 'permission_request'; requestId: string; summary: PermissionSummary }
  | { type: 'terminal'; sessionId: string; reason: Terminal['reason'] }

// 控制平面（SDK control）：control_request / control_response / control_cancel_request
//   subtype: initialize | set_model | set_permission_mode | interrupt | can_use_tool ...

type BridgeTokenClaims = {
  subject: string
  sessionId?: string; workspaceId?: string
  scopes: ('send_message' | 'respond_permission' | 'read_events')[]   // scope 分级
  expiresAt: number
}

type RemoteSessionState =
  | { status: 'connected'; clientId: string; lastAck: number }
  | { status: 'disconnected'; since: number; bufferedUntil: number }
  | { status: 'resuming'; clientId: string; fromOffset: number }
  | { status: 'closed'; terminal: Terminal['reason'] }
```

## 第 9 章　可观测（首次出现：第 9 章）

```typescript
// src/observability/events.ts（真实代码）——事件 schema 与脱敏
export interface AgentEvent {
  schemaVersion: 1;
  id: string;
  runId: string;
  parentId?: string;
  timestamp: string;
  type: AgentEventType;              // 16 种：SessionStart...HookFailure
  payload: Record<string, unknown>;
}
const SENSITIVE_KEY_PATTERN =
  /(^|_|\b)(ark_api_key|api[-_]?key|authorization|token|password|secret|credential|env)($|_|\b)/i;
// createAgentEvent：先 redactEventPayload，再 validateAgentEvent —— 脱敏在创建中心
```

```typescript
// 阐释性重构——成本归属
type CostEntry = {
  runId: string; parentId?: string; model: string
  inputTokens: number; outputTokens: number
  cacheReadTokens?: number; cacheWriteTokens?: number   // cache write ≈ 12.5× cache read
  costUsd: number
  source: 'llm_response' | 'stream_final' | 'manual_estimate'
}
// 难点：按模型分表（fallback 天然分离）、子 Agent 递归归属、流式 abort 完整性
```

```typescript
// 阐释性重构——trace -> eval
type EvalMetrics = {
  turns: number; toolCalls: number; deniedPermissions: number
  verificationRuns: number; stopReason: Terminal['reason']; feedbackStatus?: string
}
// runner 负责"任务是否完成"，trace-reader 负责"过程指标"，共享同一事实源
```
