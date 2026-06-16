# 第 7 章　多 Agent 编排

> 对应《拆解 Claude Code》第 8 章。

## 前情提要

科普书里说过：子 Agent 不是普通工具，它是一个有独立历史、独立循环、独立工具范围的嵌套会话。主 Agent 不该继承子 Agent 的完整过程，只接收摘要、证据和产物引用。它还给了一条很反直觉的纪律——主 Agent 启动子任务后「不要偷看、不要抢答」，因为它此刻确实不知道子任务发现了什么。

这一章把这套直觉打开到实现层。你会看到：从主 Agent 看，启动子 Agent 仍然是一次 tool use；但从运行时看，这个工具内部会再起一整个 query loop。你还会看到 fork 路径为了命中 prompt cache 做的「逐字节对齐」、`allowedTools` 作为运行时权限作用域而非提示词、`filterIncompleteToolCalls` 如何守住提问-答复配对、同步/异步/中断三种语义如何分叉、Task 多后端的判别联合，以及多 Agent 最难的那个问题——并发写冲突。

## 本章要钻多深

- AgentTool 在主 Agent 眼里是工具、在运行时里是嵌套 query loop——这层「双重身份」在代码里靠什么粘合？
- fork 子 Agent 为什么要费尽心思构造「逐字节相同的 API 请求前缀」？`useExactTools`、`model: 'inherit'`、threaded system prompt 都是为了什么？
- `allowedTools` 怎样进入运行时权限上下文，又为什么「父层批准不泄漏给子层、但 cliArg 必须保留」？
- 子 Agent 的同步 / 异步 / 中断语义如何分叉？为什么异步子 Agent 要拿一个「未链接」的 AbortController？
- Task 为什么是一个多后端判别联合，而 worktree 隔离为什么是并发写的真实手段？

## AgentTool：工具外壳里裹着一整个 query loop

从主 Agent 视角，启动子 Agent 和调用 `read_file` 没有区别——都是一个 `tool_use` 块，带一段 JSON 参数。但 AgentTool 的 `execute` 内部不会去读文件或跑命令，而是构造一份子上下文、再驱动一轮 `query()`：

```typescript
// 阐释性重构——AgentTool 内部启动嵌套 query loop，非逐字源码
async function* runAgent({
  agentDefinition,        // 选中的子 Agent 角色定义（内置或加载自磁盘）
  promptMessages,         // 交给子 Agent 的任务消息
  toolUseContext,         // 父上下文：权限、cwd、appState、abortController...
  canUseTool,             // 权限判定函数，子 Agent 复用，不另起一套
  isAsync,                // 同步等待 vs 后台运行
  forkContextMessages,    // fork 路径：要继承的父对话切片
  allowedTools,           // 运行时权限作用域（不是提示词）
  availableTools,         // 预先组装好的工具池（由调用方算好，避免循环依赖）
  useExactTools,          // 用精确工具池产生 cache-identical 请求前缀
  worktreePath,           // isolation: "worktree" 时的独立工作副本路径
  override,               // 可注入 systemPrompt / abortController / agentId
}): AsyncGenerator<Message, void> {
  // ...构造子上下文...
  for await (const message of query({ /* 子上下文 */ })) {
    yield message         // 子 Agent 的每条消息都流式吐回
  }
}
```

注意 `runAgent` 是个 **async generator**：它不是「跑完返回结果」，而是把子 Agent 的每条消息逐条 yield 出来。这让主流程能实时看到子任务进度（用于 UI、metrics、transcript 落盘），同时仍然保持「主 Agent 不直接介入子循环」的边界——主 Agent 拿到的是一个流，而不是子 Agent 的可变上下文句柄。

这层「工具外壳裹着 query loop」的结构，正是科普书那句「子 Agent 是嵌套会话」在代码里的落点：参数列表的丰富程度（十几个字段）说明，启动一个子 Agent 要决定的远不止「干什么」，还包括「带多少上下文、用哪些工具、有哪些权限、同步还是异步、在哪个目录跑、中断怎么传播」。下面逐个拆开。

## fork：为 prompt cache 而生的「逐字节对齐」

子 Agent 有两种起法。一种是「全新子 Agent」——给一个 `subagent_type`，它从零上下文开始，像「一个刚走进房间的聪明同事」。另一种是 **fork**——省略 `subagent_type`，子 Agent **继承父的完整对话上下文与系统提示词**，更像「父进程的一个分身」。

fork 路径有一组耐人寻味的设计，核心动机只有一个：**让所有 fork 子进程产生逐字节相同的 API 请求前缀，从而共享父的 prompt cache。** 先看那个合成的 fork 角色定义（推断转述其注释意图）：

```typescript
// 阐释性重构——fork 专用的合成 agent 定义，非逐字源码
const FORK_AGENT = {
  agentType: 'fork',
  tools: ['*'],            // 配合 useExactTools：拿到父的精确工具池
  maxTurns: 200,
  model: 'inherit',        // 用父的模型——换模型就无法复用父的 cache
  permissionMode: 'bubble',// 权限提示「冒泡」回父终端展示
  getSystemPrompt: () => '',// 故意留空——见下
}
```

`getSystemPrompt` 返回空字符串不是 bug。fork 路径**不**重新调用 `getSystemPrompt()` 来重建系统提示词，而是把父**已经渲染好的系统提示词字节**通过 `toolUseContext.renderedSystemPrompt` 直接线程进来。源码注释（推断转述）点破了原因：重新调用 `getSystemPrompt()` 可能因为 GrowthBook 实验从冷到热（cold→warm）而产生细微差异，**一旦差一个字节，prompt cache 就失效了**；直接复用渲染好的字节才能保证 byte-exact。`model: 'inherit'` 也是同理——换个模型，父的 cache 根本不在那个模型上。

继承的对话上下文怎么拼，也讲究到字节级：

```typescript
// 阐释性重构——构造 fork 子进程的继承消息，目标是 cache 前缀逐字节相同
function buildForkedMessages(directive, assistantMessage) {
  // 1. 保留父的整条 assistant 消息（所有 tool_use、thinking、text 块）
  // 2. 为每个 tool_use 配一个 tool_result，内容是同一个占位符常量
  const PLACEHOLDER = 'Fork started — processing in background'
  const toolResults = toolUses.map(u => ({
    type: 'tool_result', tool_use_id: u.id,
    content: [{ type: 'text', text: PLACEHOLDER }],  // 所有 fork 共用同一占位符
  }))
  // 3. 末尾追加「每个子进程各不相同」的 directive 文本块
  return [assistantMessage, userMessage([...toolResults, { type: 'text', text: directive }])]
}
```

设计意图直白：前缀（历史 + 父 assistant 消息 + 占位符 tool_result）对所有 fork **完全相同**，只有最后那个 directive 文本块因子进程而异，从而最大化 cache 命中。这也解释了科普书里「同一条消息里并发启动多个 fork」的建议——它们共享同一段 cache 前缀，并发越多，省得越多。

fork 还有一个**递归护栏**。因为 fork 子进程的工具池里仍保留 Agent 工具（为了工具定义 cache 一致），它理论上能再 fork，于是要在调用时拦截：

```typescript
// 阐释性重构——靠扫描历史里的 fork 样板标签来拒绝「fork 套 fork」
function isInForkChild(messages): boolean {
  return messages.some(m =>
    isUserText(m) && m.text.includes(`<${FORK_BOILERPLATE_TAG}>`))
}
```

那段 `FORK_BOILERPLATE_TAG` 样板（推断转述）本身就是一份严厉的「子进程行为契约」：「你是一个被 fork 出来的工作进程，不是主 Agent；不要再 spawn 子 Agent，直接执行；不要在工具调用之间输出文字；改完文件要先 commit 并在报告里带上 commit hash；报告控制在 500 字内，且必须以 `Scope:` 开头」。它把科普书「子 Agent 只回摘要不回过程」的纪律，固化成了一段提示词层面的硬约束。

## allowedTools：运行时权限作用域，不是提示词

这是最容易被误解的一点。`allowedTools` 不是「告诉模型别用某些工具」的提示词文案，而是**直接写进运行时权限上下文的作用域规则**。源码里的处理逻辑非常精确（推断转述其注释）：

```typescript
// 阐释性重构——allowedTools 进入 alwaysAllowRules，替换 session 规则但保留 cliArg
if (allowedTools !== undefined) {
  toolPermissionContext = {
    ...toolPermissionContext,
    alwaysAllowRules: {
      // 保留 SDK 的 --allowedTools：这是消费方的显式授权，对所有 agent 生效
      cliArg: parent.alwaysAllowRules.cliArg,
      // 用传入的 allowedTools 作为 session 级权限——替换掉父的 session 规则
      session: [...allowedTools],
    },
  }
}
```

这里藏着两条相反方向的规则，缺一不可：

- **父层的 session 级批准不能泄漏给子层。** 用户在主会话里点过「总是允许跑这个命令」，不该让一个被派出去的子 Agent 默默继承这份信任。所以提供 `allowedTools` 时，子 Agent 的 session 规则被**完全替换**为显式列出的那一组——它只拥有你明说给它的权限。
- **但 cliArg 规则必须保留。** `cliArg` 来自 SDK / CLI 的 `--allowedTools`，那是部署方在最外层定下的显式授权边界，对会话里所有 Agent（包括子层）都生效，不该被子 Agent 的窄作用域抹掉。

把这两条合起来，得到的语义是：**子 Agent 的权限是「最外层显式授权 ∩（或并上）本次显式列出的窄集合」，而中间那层「用户在主会话里临时点的允许」不向下传递。** 这正是第 4 章权限模型在多 Agent 维度的延伸——权限既不能凭空放大，也不能因为「父批准过」就悄悄继承。

工具池本身也分两条路。普通子 Agent 用 `resolveAgentTools(agentDefinition, availableTools, isAsync)` 按角色定义过滤；fork 路径走 `useExactTools`，直接用父的精确工具池（前面说过，为了 cache 前缀字节一致）。还有一个省 token 的真实优化值得一提：只读子 Agent（Explore / Plan）会被丢掉 `CLAUDE.md` 和最长 40KB 的 `gitStatus`——它们是只读搜索角色，不需要执行 commit/PR/lint 规则，注释（推断转述）算过这笔账：「跨 3400 万次以上 Explore 启动，每周省下约 5-15 Gtok」。多 Agent 的成本，是在这种地方一点点抠出来的。

## filterIncompleteToolCalls：把未闭合的工具调用挡在 fork 之外

第 1 章讲过 LLM 协议的铁律：每个 `tool_use` 必须有配对的 `tool_result`，否则 API 报错。fork 要继承父的对话切片，而父的最后一条 assistant 消息里，可能正好有一个**刚发出、还没拿到结果**的 tool_use（fork 本身往往就是在这条消息里触发的）。如果照搬进子上下文，子 Agent 第一次请求就会带着孤儿 tool_use 撞墙。

`filterIncompleteToolCalls` 就是这道闸门，逻辑朴素但关键（这是真实函数，结构改写转述）：

```typescript
// 阐释性重构——过滤掉「有 tool_use 但无配对 tool_result」的 assistant 消息
function filterIncompleteToolCalls(messages) {
  const idsWithResults = new Set(
    messages.flatMap(m => isUser(m) ? toolResultIds(m) : []))
  return messages.filter(m => {
    if (!isAssistant(m)) return true              // 非 assistant 一律保留
    const hasOrphan = toolUses(m).some(u => !idsWithResults.has(u.id))
    return !hasOrphan                              // assistant 含孤儿 tool_use 则整条剔除
  })
}
```

它先扫一遍收集所有「已有结果」的 tool_use_id，再把任何含未配对 tool_use 的 assistant 消息整条剔除。这呼应第 1 章那条原则：**上下文的任何重组（压缩、fork、resume）都必须维持提问-答复配对的完整性**，否则协议层立刻失败。resume 路径用的是同族的一组过滤器——`filterUnresolvedToolUses` + `filterOrphanedThinkingOnlyMessages` + `filterWhitespaceOnlyAssistantMessages`——把从磁盘 transcript 复活的历史先「洗干净」再续跑，道理完全一样。

## 同步、异步与中断：未链接的 AbortController

子 Agent 可以同步运行（主 Agent 等它）或异步运行（后台跑、靠通知回来）。两者的中断语义在 `AbortController` 的选取上分叉得很干净：

```typescript
// 阐释性重构——中断控制器三选一，决定中断如何传播
const agentAbortController =
  override?.abortController            // 1. 显式注入优先（resume / 后台任务句柄）
    ? override.abortController
    : isAsync
      ? new AbortController()          // 2. 异步：全新「未链接」控制器，独立中断
      : toolUseContext.abortController // 3. 同步：共享父控制器，父中断即子中断
```

三种情况各有道理：

- **同步子 Agent 共享父的 controller。** 用户按 Ctrl-C 中断主 Agent，正在等待的同步子 Agent 应当一并停下——它们本就是一条逻辑链路。
- **异步子 Agent 拿一个全新的、未链接（unlinked）的 controller。** 它在后台独立运行，用户在主会话里的新输入、甚至中断主 Agent，都不应顺着信号链把后台子任务也杀掉。要停它，得通过它自己的任务句柄（`TaskStop`）显式来。
- **resume / 后台任务**通过 `override.abortController` 注入预先建好的句柄，让生命周期管理（注册、进度、kill）能挂到同一个 controller 上。

异步路径还需要一套**生命周期编排**，因为没有调用方在原地等它。源码里 `runAsyncAgentLifecycle`（推断转述）把这件事做得很谨慎：子任务结束时**先**把状态切到 `completed`，**再**做 worktree 清理、handoff 分类这些「通知点缀」——注释明确写了原因（gh-20236）：分类要调用 API、清理要执行 git，都可能挂住，绝不能让它们阻塞状态转移，否则 `TaskOutput` 会一直拿不到结果。这又是一条「自动路径必须有明确的、不被慢操作短路的状态机」的纪律，和第 1 章一脉相承。

无论同步异步，子 Agent 都需要一个**可管理的运行句柄**，而不是 fire-and-forget：

```typescript
// 阐释性重构——子 Agent 的运行句柄
type ChildRunHandle = {
  taskId: string                    // 任务 ID，带类型前缀（见下表）
  agentId: AgentId                  // 子 Agent 身份，用于 transcript / trace 关联
  abortController: AbortController
  status: 'pending' | 'running' | 'completed' | 'failed' | 'killed'
  outputFile: string                // 结果落盘路径——主 Agent 拿到的是引用，不是内容
}
```

注意 `outputFile`：主 Agent 拿到的是一个**文件路径引用**，而不是子任务的完整过程。科普书的「不要偷看」在这里有了代码依据——提示词里专门叮嘱（推断转述）：「`output_file` 不要去 Read 或 tail，除非用户明确要看进度；你会收到完成通知，信它就行。中途读 transcript 会把 fork 的工具噪声拉进你的上下文，那就违背了 fork 的初衷。」以及「不要抢答」：「启动后你对 fork 发现了什么一无所知；绝不要编造或预测 fork 结果。通知会在**后续某一轮**以 user 角色消息到达，它永远不是你自己写出来的。」

## Task：一个多后端的判别联合

「子 Agent」只是 Task 的一种。生产级里 Task 是一个带类型前缀的判别联合，每种后端有不同的执行位置、权限和取消语义：

```typescript
// 阐释性重构——Task 类型联合与状态机，命名为真实粒度
type TaskType =
  | 'local_bash'          // 本地 shell 任务
  | 'local_agent'         // 本进程子 Agent
  | 'remote_agent'        // 远程环境子 Agent
  | 'in_process_teammate' // 同进程「队友」
  | 'local_workflow'      // 工作流脚本（feature gated）
  | 'monitor_mcp'         // MCP 监控（feature gated）
  | 'dream'               // 后台探索

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed'

// 终态判定：守护「别往死掉的队友里注消息、别清理还在跑的任务」
function isTerminalTaskStatus(s: TaskStatus): boolean {
  return s === 'completed' || s === 'failed' || s === 'killed'
}
```

| Task 后端 | 执行位置 | 独有问题 |
| --- | --- | --- |
| `local_agent` | 本进程子 Agent | 与父共享工作区，需防并发写冲突 |
| `remote_agent` | 远程环境 | 认证、传输、远程权限（第 8 章主题） |
| `in_process_teammate` | 同进程队友 | 身份隔离（AsyncLocalStorage）、颜色、进度展示 |
| `local_bash` | 本地 shell | stdout/stderr、退出码、超时、取消 |
| `dream` | 后台探索 | 生命周期与结果回收 |

几个真实细节值得点出。**任务 ID 带类型前缀**（`b`/`a`/`r`/`t`/`w`/`m`/`d`），后接 8 位从「数字+小写」字母表里随机取的字符——注释（推断转述）算过：`36^8 ≈ 2.8 万亿`组合，足以「抵抗暴力枚举的 symlink 攻击」，因为任务输出会落到以 ID 命名的磁盘文件，可预测的 ID 就是一个攻击面。**同进程队友**靠 `AsyncLocalStorage` 提供每个队友隔离的上下文，避免并发队友互相覆盖身份；它还要 `preserveToolUseResults`，因为队友的 transcript 是可被用户查看的。**统一抽象不等于统一风险**——`getTaskByType` 现在只多态分发 `kill`（注释说 spawn/render 从来没被多态调用过，已删除），但每种后端的 `kill` 仍各写各的，因为停一个本地 shell 和停一个远程 Agent 完全是两回事。

## worktree：并发写冲突的真实手段

多 Agent 最难的从来不是「并发启动」，而是「并发写」。两个子 Agent 改同一个文件，或一个子 Agent 改了主 Agent 刚读过的文件，都会制造过期上下文和静默覆盖。生产级给出的真实隔离手段是 **git worktree**：

```typescript
// 阐释性重构——isolation: "worktree" 给子 Agent 一份独立工作副本
isolation?: 'worktree' | 'remote'   // worktree: 独立 git 工作副本；remote: 远程环境
// 与 cwd 互斥：worktree 自己就决定了 cwd
```

当子 Agent 以 `isolation: "worktree"` 启动，系统会为它创建一个临时 git worktree——同一个仓库、同样的相对结构、**独立的工作副本**。子 Agent 的所有改动留在它自己的 worktree 里，不碰父的文件。fork + worktree 组合时，还会注入一段提示（`buildWorktreeNotice`，推断转述）：「你继承的上下文来自父在 `<parentCwd>` 的工作；你现在在隔离 worktree `<worktreeCwd>` 里——同仓库、同相对结构、不同副本。上下文里的路径指向父目录，请翻译到你的 worktree 根；编辑前如果父可能改过这些文件，先重新读一遍。」

worktree 路径会被**持久化到 agent metadata**，这样 resume 时能恢复到正确的 cwd。resume 路径对此还有防御：先 `stat` 一下 worktree 是否还在，外部删了就退回父 cwd 而不是崩在后面的 chdir 上；同时会 bump 一下 worktree 的 mtime（推断转述：gh-22355），防止「过期 worktree 清理」误删一个刚刚 resume 的 worktree。

worktree 解决的是「文件系统级隔离」，但**回合（integration）仍要校验**。一个稳妥的并发策略是先声明写集合、再判定能否并行、最后回收时校验：

```typescript
// 阐释性重构——并发写的判定与回收校验（设计草案层面）
function canRunInParallel(a: SubAgentSpec, b: SubAgentSpec): boolean {
  return disjoint(a.writeScope, b.writeScope)   // 写集合不相交才允许并发写
}
function integrateChildResult(result, currentGitState) {
  assertNoUnexpectedFiles(result.changedFiles, result.declaredWriteScope)
  assertBaseRevisionStillValid(result.baseRevision, currentGitState)
  return applyOrReview(result)
}
```

没有 worktree 或 write scope 的隔离，就不要开放并发写。务实的演进顺序是：先开放并发**探索**（只读，天然无冲突）→ 再开放串行**实现** → 最后才在 worktree 隔离 + 写集合不相交的前提下考虑并发实现。

## summarize：防止子任务过程污染主上下文

fork 和 summarize 是这一章的两个核心动词。fork 负责隔离上下文与权限（前面已经讲透），summarize 负责**回传时只给结论、不给过程**。

异步子 Agent 完成时，运行时从子结果里抽取文本内容，组装成一条**通知**（`enqueueAgentNotification`，推断转述），带上用量统计（token 数、工具调用次数、耗时）和可能的 worktree 结果，在后续某一轮以 user 角色消息送回父会话。父 Agent 看到的是「一份报告 + 一个 output_file 引用」，而不是子 Agent 几十轮的工具往返。对于需要长时运行的子任务，还有**周期性进度摘要**：`onCacheSafeParams` 把子 Agent 的系统提示词、上下文、工具池暴露出来，让后台摘要器 fork 出子对话来生成进度小结——同样靠 prompt cache 共享降低成本。

这条边界呼应科普书的结论，也呼应第 1 章的一个细节：token 预算续跑里「子 Agent（agentId 存在）一律不续跑」。子 Agent 的职责是「干完一件被界定清楚的事、回一份摘要」，而不是无限续命——续命是主 Agent 的特权，子 Agent 越界续跑只会让上下文和成本失控。

## 最小可行实现参照

**本仓库当前没有任何子 Agent 运行时代码。** 这是一条诚实的边界：fork、resume、Task 多后端、worktree 隔离、异步生命周期编排，本仓库**都没有实现**。下面给出的不是「已实现能力」，而是**设计草案**——说明现有的可复用构件未来怎么搭出多 Agent 底座。这里不放任何「假装已实现」的子 Agent 代码。

现有的可复用构件确实是对的起点：

```typescript
// src/agent-loop.ts（真实代码，节选）——单 Agent 循环，未来子 Agent 可复用同一函数
export async function runAgentLoop(
  userInput: string,
  config: AppConfig,
  tools: ToolRegistry,
  client: LLMClient = new LLMClient(config),
  harness: HarnessLike | undefined = undefined,
  logger: Logger = createLogger({ verbose: config.verbose }),
  compressor: HistoryCompressor = new ContextCompressor(client as ContextCompressorClient),
  recorder?: EventRecorderLike
): Promise<AgentResult> { /* ... */ }
```

```typescript
// src/observability/recorder.ts（真实代码，节选）——事件已支持 runId + parentId 关联
export class EventRecorder {
  readonly runId: string;
  emit(type: AgentEventType, payload = {}, options: { parentId?: string } = {}): AgentEvent {
    const event = createAgentEvent(this.runId, type, payload, options);
    // ...
  }
}
```

把这些构件映射到本章讲的生产级能力，缺口一目了然：

| 维度 | 本仓库现状 | 未来若要支持多 Agent（设计草案） |
| --- | --- | --- |
| 子 Agent 循环 | 只有单 Agent `runAgentLoop` | 子 Agent 复用同一函数，传入独立 `MessageHistory` |
| 权限作用域 | `Harness` 统一编排，无 `allowedTools` 传递 | 给 Harness 加「子作用域」：替换 session 规则、保留外层显式授权 |
| 上下文继承 | 无 fork | 需要 `filterIncompleteToolCalls` 同款的配对保护 |
| 父子关联 | `EventRecorder` 已有 `runId` / `parentId` | 直接用 `parentId` 把子 run 挂到父 run 下 |
| 并发写隔离 | 无 | worktree 或 write scope，二者必居其一 |
| Task 后端 | 无 Task 抽象 | 判别联合 + 每后端独立 kill 语义 |

最关键的一点：本仓库的 `parentId` 字段不是为多 Agent 提前埋的彩蛋，但它**恰好**是未来把子 run 挂到父 run 下的天然挂点——这说明「可观测性先于编排」是对的工程顺序。没有 run 关联，多 Agent 就是一堆互不相关的黑盒；有了它，才谈得上调试和成本归因（第 9 章主题）。

## 边界与权衡

- **fork 的字节级对齐是性能优化，也是脆弱点。** byte-exact 的好处是 cache 命中省钱省延迟，代价是任何一处「无意中改了系统提示词字节」（比如 GrowthBook 冷热切换、重算 `getSystemPrompt`）都会静默把 cache 打穿。所以 fork 路径宁可线程渲染好的字节、也不重算——这是「正确性优先于看起来更干净」的取舍。
- **allowedTools 的双向规则容易写反。** 「父 session 批准不下传、外层 cliArg 必须下传」是两条相反方向的规则，少一条都会出安全洞：漏了前者会让子 Agent 偷继承信任，漏了后者会让部署方的显式边界失效。任何动这块的改动都必须补「子层不继承父 session 批准」和「子层仍受 cliArg 约束」两组测试。
- **异步生命周期的状态机比同步复杂一个量级。** 「先转状态再做清理」「慢操作不阻塞状态转移」「未链接 controller」这些都是踩过坑（gh-20236、gh-22355）才长出来的防御。多一种 Task 后端，就多一套 kill / 通知 / 清理要测。
- **worktree 不是免费的。** 它给了真隔离，但创建、清理、过期回收、resume 时的存在性校验都是新的失败点；fork + worktree 还要靠提示词让子 Agent 自己翻译路径——这是「文件系统隔离」和「上下文路径不一致」之间的妥协。

## 本章小结

- AgentTool 从主 Agent 看是一次 tool use，从运行时看是一个 async generator 驱动的嵌套 query loop；丰富的参数列表说明启动子 Agent 要决定的远不止「干什么」。
- fork 路径为命中 prompt cache 做了逐字节对齐：合成 FORK_AGENT、`useExactTools` 用父精确工具池、`model: 'inherit'`、线程渲染好的系统提示词字节、所有子进程共用占位符 tool_result——只有 directive 因子进程而异。
- `allowedTools` 是运行时权限作用域而非提示词：替换子层 session 规则（父批准不下传），但保留 cliArg（外层显式授权必须下传）；`filterIncompleteToolCalls` 守住 fork/resume 时的提问-答复配对。
- 同步子 Agent 共享父 controller、异步子 Agent 拿未链接的新 controller；异步还需要可管理的运行句柄和「先转状态再清理」的生命周期编排。
- Task 是多后端判别联合（local/remote/teammate/shell/dream），worktree 是并发写的真实隔离手段；summarize 只回结论不回过程，子 Agent 一律不续跑。

下一章顺着 `remote_agent` 这条线往外走：当子 Agent 不在本进程、而在远程环境运行时，编排问题就升级成了**桥接与服务端协议**——认证、传输、远程权限同步、断线重连，是多 Agent 在网络维度的延续。
