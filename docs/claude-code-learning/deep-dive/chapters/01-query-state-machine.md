# 第 1 章　查询循环的真实状态机

> 对应《拆解 Claude Code》第 1 章。

**独立阅读建议**：本章可独立阅读，只要理解「问、做、再问」的循环直觉即可入场。
**联读建议**：与第 3 章（恢复路径触发的压缩）、第 9 章（终止原因如何落成事件）连读，恢复路径的全貌最清晰。

## 前情提要

科普书第 1 章讲过：智能体不是「问一次模型就完事」，而是「问、做、再问」的循环；判断该不该继续，看的是模型有没有真发出工具请求；停止条件的丰富程度是简易实现和成熟产品的分水岭。

这一章把那个「循环」彻底打开。我们会看到：成熟产品里的主循环根本不是一个 `for`，而是一个**携带十余个跨轮状态字段的 `while(true)` 状态机**；「停止」不是一个布尔值，而是一组语义各异的「终止原因」；而最精彩的部分，是那些**看起来该停、实际要悄悄续跑**的恢复路径。

## 本章要钻多深

- 一个生产级查询循环携带哪些跨轮状态？为什么需要这么多？
- 「终止」与「继续」如何被建模成两组判别联合（discriminated union）？真实有多少种原因？
- token 预算续跑（budget continuation）的判定算法长什么样——它如何决定「还能再榨一轮」还是「收益递减、收手」？

## 术语起步

- **判别联合（discriminated union）**：用一个 `reason` 之类的标签字段区分形态各异的同类值，便于逐形态断言。
- **终止原因（Terminal）**：循环各 `return` 点带出的「为何停」，本章归纳为约 10 种。
- **继续原因（transition / Continue）**：循环各 `continue` 点记录的「为何再转一圈」，本章归纳为 7 种。
- **token 预算续跑**：模型没发工具请求时，按预算用量与收益递减判据决定是否再「轻推」一轮。
- **异步生成器（async generator）**：能边推进边 `yield` 流式事件、用返回值带出最终结果的循环形态。

## 机制深挖：状态机的骨架

科普书里的循环可以浓缩成「一个 `for` 转 N 轮」。但当同一个循环要同时服务交互式终端、SDK 调用、子 Agent、流式 UI、上下文压缩、停止钩子时，单靠「第几轮」远远不够。它需要一个**显式的状态结构**，在每一轮迭代间传递。

下面是这个状态结构的改写形态（推断，基于对一份源码快照的归纳；字段名做了保留以体现快照中可见的粒度）：

> 证据标签：本章代码块分三类——`// src/...` 路径标注的是 **[本仓库真实代码]**；讲 Claude Code 快照内部机制的归纳类型与逻辑是 **[快照推断]**；为表达机制而归纳的类型签名是 **[阐释性重构]**。下面这段属于 **[阐释性重构]**。

```typescript
// 阐释性重构——表达跨轮状态的粒度，非逐字源码
type State = {
  messages: Message[]                 // 本轮要提交给模型的消息视图
  toolUseContext: ToolUseContext      // 工具执行上下文（工具集、权限、Agent 身份、UI 回调）
  autoCompactTracking: TrackingState | undefined  // 自动压缩的累计跟踪
  maxOutputTokensRecoveryCount: number             // 输出截断恢复了几次
  hasAttemptedReactiveCompact: boolean             // 是否已尝试过「响应式压缩」
  maxOutputTokensOverride: number | undefined      // 临时抬高的输出上限
  pendingToolUseSummary: Promise<Summary | null>   // 异步生成中的工具使用摘要
  stopHookActive: boolean | undefined              // 停止钩子是否已激活（防重入）
  turnCount: number                                // 当前轮次
  transition: Continue | undefined                 // 上一轮"为何继续"的原因（首轮为 undefined）
}
```

注意最后一个字段 `transition`。它记录的是「上一轮**为什么**没停、而是进入了下一轮」。这个字段本身不影响执行，但它让每一条恢复路径都变得**可观测、可测试**——测试可以断言「这一轮是因为 token 预算续跑才继续的」，而不必去翻消息内容猜测。这是成熟系统的一个共性手法：**把隐式的控制流决策，固化成显式的、可断言的状态。**

整个循环的骨架，是一个异步生成器（async generator）里的 `while (true)`：

```typescript
// 阐释性重构
async function* queryLoop(params): AsyncGenerator<StreamEvent | Message, Terminal> {
  let state: State = { messages: params.messages, turnCount: 1, transition: undefined, /* ... */ }
  const budgetTracker = featureEnabled('TOKEN_BUDGET') ? createBudgetTracker() : null

  while (true) {
    const { messages, turnCount, /* ... */ } = state   // 每轮迭代顶部解构

    // 1. 压缩 / 预算 / 折叠等前置处理
    // 2. 调模型，流式接收 assistant 消息，收集 tool_use
    // 3. 若有可恢复错误 → 改写 state，continue（不停！）
    // 4. 若无 tool_use → 走停止钩子 / 预算续跑判定
    // 5. 若有 tool_use → 执行工具，收集 tool_result
    // 6. 检查 maxTurns
    // 7. 写下一轮 state，进入下一次迭代
  }
}
```

用异步生成器（而非普通循环）是一个关键设计：它能在循环推进的同时，把流式事件（模型吐字、工具进度）`yield` 给外层消费者，而最终的「终止原因」用生成器的**返回值**（`Terminal`）传出。一个数据结构同时承载了「过程流」和「最终结果」两条信息通道。

## 机制深挖：终止与继续，是两组判别联合

科普书说停止条件分「完成」和「撞上限」两种。真实系统远不止。把循环里所有出口的「原因」收集起来，它们构成一个**终止原因的判别联合**（推断）：

```typescript
// 阐释性重构——归纳自循环各 return 点的 reason
type Terminal =
  | { reason: 'completed' }                    // 正常完成：无 tool_use 且无需续跑
  | { reason: 'max_turns'; turnCount: number } // 撞到轮次硬上限
  | { reason: 'model_error'; error: unknown }  // 模型调用出错
  | { reason: 'prompt_too_long' }              // 上下文超长且无法恢复
  | { reason: 'image_error' }                  // 图片/媒体处理失败
  | { reason: 'aborted_streaming' }            // 流式过程中被中断
  | { reason: 'aborted_tools' }                // 工具执行阶段被中断
  | { reason: 'blocking_limit' }               // 阻塞类操作达到上限
  | { reason: 'stop_hook_prevented' }          // 停止钩子主动阻止完成
  | { reason: 'hook_stopped' }                 // 钩子叫停
```

为什么要分这么细？因为**每一种终止原因，上层要做的事不一样**：界面要给用户不同的提示文案；SDK 消费者要收到不同的结束码；可观测系统（第 9 章）要记录不同的事件；自动化脚本要据此决定重试还是放弃。把它们糊成一个布尔 `success`，就丢掉了所有这些区分能力。

与终止对应的，是「继续」的判别联合——记录**这一轮为何决定再转一圈**（推断）：

```typescript
// 阐释性重构——归纳自循环各 continue 点的 transition.reason
type Continue =
  | { reason: 'next_turn' }                  // 常规：执行完工具，进入下一轮
  | { reason: 'reactive_compact_retry' }     // 触发响应式压缩后重试
  | { reason: 'collapse_drain_retry' }       // 上下文折叠后排空重试
  | { reason: 'max_output_tokens_escalate' } // 输出被截断，抬高上限重试
  | { reason: 'max_output_tokens_recovery' } // 输出截断的多阶段恢复
  | { reason: 'stop_hook_blocking' }         // 停止钩子阻塞 → 构造续跑
  | { reason: 'token_budget_continuation' }  // token 预算判定"还能榨一轮"
```

**这正是科普书第 1 章末尾埋下的伏笔的真身**——「有些看起来该停的情况其实不该真停」。看 `max_output_tokens_escalate`：模型这一轮的输出被长度上限截断了。一个幼稚的实现会当成失败退出；而这里把它识别为「可恢复」，临时抬高输出上限（写进 `state.maxOutputTokensOverride`），标记 `transition` 为对应原因，然后 `continue` 回到循环顶部重来。失败被悄悄消化成了下一轮的输入。

`prompt_too_long` 更微妙：它既可能是终止原因（实在无法恢复），也可能先触发一次「响应式压缩」尝试自救——压缩成功就 `reactive_compact_retry` 续跑，压缩也救不回来才真的以 `prompt_too_long` 终止。**同一个症状，先试图恢复，恢复无门才终止**，这是贯穿整个循环的设计姿态。

## 机制深挖：token 预算续跑的判定算法

这是本章最值得细看的一段逻辑（基于快照归纳）：当模型这一轮**没有**发出工具请求（按科普书的规则本该「完成」收手），但任务可能还没真正做完时，系统如何决定「再轻推（nudge）模型一把，让它继续」还是「确实收益递减了，收手」？

这套判定基于一个轻量的预算跟踪器（推断，结构高度还原）：

```typescript
// 阐释性重构——预算跟踪器与判定结果类型
const COMPLETION_THRESHOLD = 0.9    // 用掉预算的 90% 视为接近完成
const DIMINISHING_THRESHOLD = 500   // 单轮增量低于 500 token 视为收益微弱

type BudgetTracker = {
  continuationCount: number      // 已经续跑了几次
  lastDeltaTokens: number        // 上一次检查到现在的 token 增量
  lastGlobalTurnTokens: number   // 上一次记录的累计轮 token
  startedAt: number
}

type TokenBudgetDecision =
  | { action: 'continue'; nudgeMessage: string; pct: number; /* ... */ }
  | { action: 'stop'; completionEvent: CompletionEvent | null }
```

判定函数的核心逻辑（改写，保留真实判定结构）：

```typescript
// 阐释性重构
function checkTokenBudget(tracker, agentId, budget, globalTurnTokens): TokenBudgetDecision {
  // 子 Agent、或没配预算，一律不续跑
  if (agentId || budget === null || budget <= 0) {
    return { action: 'stop', completionEvent: null }
  }

  const turnTokens = globalTurnTokens
  const pct = Math.round((turnTokens / budget) * 100)
  const deltaSinceLastCheck = globalTurnTokens - tracker.lastGlobalTurnTokens

  // 收益递减：续跑过 3 次以上，且最近两次增量都低于阈值
  const isDiminishing =
    tracker.continuationCount >= 3 &&
    deltaSinceLastCheck < DIMINISHING_THRESHOLD &&
    tracker.lastDeltaTokens < DIMINISHING_THRESHOLD

  // 还没到收益递减，且预算用量还不到 90% → 续跑，并给模型一条"轻推"消息
  if (!isDiminishing && turnTokens < budget * COMPLETION_THRESHOLD) {
    tracker.continuationCount++
    tracker.lastDeltaTokens = deltaSinceLastCheck
    tracker.lastGlobalTurnTokens = globalTurnTokens
    return { action: 'continue', nudgeMessage: buildNudge(pct, turnTokens, budget), /* ... */ }
  }

  // 已经续跑过、现在停下 → 发一个带 diminishingReturns 标记的完成事件
  if (isDiminishing || tracker.continuationCount > 0) {
    return { action: 'stop', completionEvent: { diminishingReturns: isDiminishing, /* ... */ } }
  }

  return { action: 'stop', completionEvent: null }
}
```

值得玩味的几个设计：

- **子 Agent 一律不续跑**（`if (agentId) ... stop`）。续跑是给主任务争取「再想想、再做做」的机会；子 Agent 有明确的窄任务边界，不该自作主张地延长（呼应第 7 章「子 Agent 必须受限」）。
- **续跑不是无限的**。`continuationCount >= 3` 加上「连续两次增量都低于 500 token」构成「收益递减」判据——模型已经在原地打转、产出寥寥，就该收手。这道闸门防止了「无意义地反复轻推一个其实已经做完的模型」。
- **续跑时给模型一条 `nudgeMessage`**。不是默默再发一遍历史，而是显式告诉模型「预算还剩多少、请继续推进」。轻推本身成了上下文的一部分。

## 最小可行实现参照

成熟产品的状态机很壮观，但它的**内核**——「问、做、再问，无工具请求就停，撞上限就停」——可以浓缩成几十行。下面是一个最小实现的真实主循环（来自 `luka`，可运行可测试）：

```typescript
// src/agent-loop.ts （真实代码，最小可行实现）
for (let turn = 1; turn <= config.maxTurns; turn++) {
  activeHarness.beginTurn();
  if (await compressor.shouldCompress(history)) {
    const compressed = await compressor.compress(history);
    history.replace(compressed.getMessages());
  }
  const messages = withTodoContext(history.getMessages(), todoManager);
  const response = await client.sendMessage(messages, { tools: toolDefinitions });

  const assistantMessage = response.choices[0]?.message;
  if (assistantMessage !== undefined) history.append(assistantMessage);

  const parsed = parseResponse(response);
  if (parsed.toolCalls.length === 0) {
    recorder?.emit("Stop", { success: true, turns: turn, finalState: "no_tool_calls" });
    return { /* ...success... */ };
  }

  for (const call of parsed.toolCalls) {
    const result = await activeHarness.executeTool(call.name, call.input, tools, lastModelAction);
    history.append({ role: "tool", tool_call_id: call.id, content: result.content });
    if (result.verificationMessage !== undefined) {
      history.append({ role: "assistant", content: result.verificationMessage });
    }
  }
  activeHarness.endTurn();
}
// 循环耗尽
recorder?.emit("Stop", { success: false, turns: config.maxTurns, finalState: "max_turns" });
```

把它和前面的状态机对照，你能精确看到「最小」和「生产级」的差距：

| 维度 | 最小实现（真实代码） | 生产级（推断） |
| --- | --- | --- |
| 循环形态 | `for turn in 1..maxTurns` | `while(true)` + 显式 `State` |
| 终止原因 | 2 种：`no_tool_calls` / `max_turns` | 10+ 种判别联合 |
| 继续原因 | 隐式（只有「下一轮」） | 7 种显式 `transition` |
| 可恢复错误 | 无（异常向外抛） | 多条恢复路径（压缩/抬上限/续跑） |
| 流式 | 无，一次拿完整响应 | 异步生成器流式 `yield` |
| token 预算续跑 | 无 | 有，带收益递减判据 |

注意：最小实现里那句 `if (parsed.toolCalls.length === 0) return success` —— 它就是生产级状态机里「无 tool_use → 走停止钩子/预算续跑判定 → `completed`」这条路径**砍掉所有恢复分支后的残骸**。两者内核同源，差距全在「恢复能力」上。

## 边界与权衡

- **状态多 = 测试矩阵大**。10 种终止 × 7 种继续，加上它们之间的转移，是个不小的组合空间。这正是 `transition` 字段存在的意义：让每条路径都能被单独断言。**复杂状态机的可维护性，依赖于状态本身的可观测性。**
- **恢复路径有上限**。无论是输出截断恢复（`maxOutputTokensRecoveryCount`）还是预算续跑（`continuationCount >= 3`），每条恢复路径都带一个计数器闸门。没有闸门的「自动恢复」会变成「无限重试」——这是比直接失败更糟的失败模式。
- **流式带来重入风险**。异步生成器在 `yield` 处暂停时，外部可能调用 `.return()` 提前关闭它。`stopHookActive` 这类「防重入标记」就是为应对这种并发而生。最小实现没有流式，自然也不需要操心这些。

## 本章小结

- 生产级主循环是携带十余个跨轮状态字段的 `while(true)` 异步生成器，而非简单的 `for`；流式事件靠 `yield` 传出，终止原因靠生成器返回值传出。
- 「终止」是约 10 种原因的判别联合，「继续」是 7 种 `transition` 的判别联合；把控制流决策固化成显式状态，是大状态机可测试的前提。
- 许多「看似该停」的情况（输出截断、上下文超长）会先尝试恢复、恢复无门才真终止；token 预算续跑用「90% 用量 + 收益递减」判据决定要不要再轻推模型一把，且子 Agent 一律不续跑、续跑必有计数闸门。
- 最小实现的 `for` 循环是这台状态机砍掉全部恢复分支后的内核——两者同源，差距全在恢复能力与可观测性。

下一章，我们打开模型那双「手」——看一个生产级工具对象到底背负了多少职责，以及它如何在「给模型看的菜单」和「真正干活的实现」之间划清界限。
