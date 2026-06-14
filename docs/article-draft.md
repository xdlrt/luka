# 从零手写一个极简 Coding Agent：让 AI 改代码这件事如何变得可控

> 状态：草稿（P5-W15）。本文随项目同步演进，能力描述严格对齐当前真实实现，不预支未完成功能。
>
> 写作进度：T1 完成整体大纲与引言；T2 完成第 2-4 节正文（Agent Loop / 工具调用协议 / Harness）；本次（T3）完成第 5-6 节、持续 eval 趋势表与结论，全文连贯收尾。

---

## 引言

把"让大模型自己读代码、改代码、跑测试"做成一个能跑起来的东西，第一版往往只要一个下午：拼一段提示词，让模型输出 shell 命令，再用 `eval` 执行。它甚至能改对几个简单 bug。但只要你真的把它放到自己的仓库里跑第二次，问题就会接踵而至——模型把 `tool_call_id` 对错了导致对话错乱，一条 `rm -rf` 直接把工作区清空，写文件越过了项目目录，或者改完代码根本没人验证就宣布"已修复"。

这些问题没有一个能靠"换个更强的模型"解决，因为它们不是智能问题，而是**工程约束问题**。一个能放心使用的 Coding Agent，本质不是"更聪明的提示词"，而是一套让模型的每一个动作都落在可控边界内的执行框架。

这正是本文要做的事：从零手写一个极简但**结构完整**的 Coding Agent，把"AI 改代码"这件事拆成几个互相咬合的机制，逐个讲清楚它们为什么必须存在。我们会看到，整个系统其实围绕一条朴素的主线运转——

```
用户输入 -> LLM 决策 -> 模型发起 tool call -> Harness 编排执行 -> 工具结果回传 -> 下一轮 LLM 决策 -> ...（直到模型不再调用工具）
```

这条循环里每一个箭头都藏着一个工程决策：循环什么时候停？工具协议怎么定义才不会泄露内部实现给模型？谁来拦住危险命令？改完的代码由谁验证？本文用六节回答这些问题，每节都配上项目里的**真实代码片段**——不是伪代码，而是仓库中实际运行、被测试覆盖的代码。更重要的是，文章会还原这些机制**真实的演进顺序**：很多控制逻辑（权限、安全、验证）最初是散落着接进循环的，直到积累到一定程度才被收敛成统一的 Harness——这条"先散落、后收敛"的路径，比一开始就给出"正确架构"更有参考价值。

需要先说清楚边界：这是一个**极简**实现。它没有 GUI、没有插件市场、没有多模型适配层、没有 RAG，也**没有完整的 OS 级沙箱**。它的 Harness 是一组**基础的**分层闸门（路径边界、权限确认、基础危险命令规则、编辑后验证），而不是成熟的命令安全系统。明确这一点，恰恰是为了讲清楚一个更有价值的问题：在最小的工程量下，哪些机制是"让 AI 可控"绝对不能省的？读完你会发现，答案比"加一个沙箱"要细腻得多。

下面从最核心的 Agent Loop 开始。

---

## 第 1 节 · 为什么要从零手写 Coding Agent

**核心要点**

- 现成 Agent 框架是黑盒：当模型行为出错时，你无法定位是循环逻辑、工具协议还是权限层的问题。
- "AI 改代码"的难点不在模型智能，而在**可控性**：消息协议正确性、动作边界、改动可验证性。
- 从零手写的价值：把每个设计决策显式化，理解一个 Coding Agent **最小可行的骨架**由哪些部件构成。
- 明确边界：本项目是极简实现，覆盖 P1-P4 主链路（Agent Loop / 工具协议 / Harness / 自验证 / 可观测+持续评测），但**不是**完整 IDE Agent，**没有**完整沙箱与成熟命令安全策略。

**📌 计划展示代码片段**

- `src/index.ts`：CLI/REPL 入口，如何把用户输入接入循环（展示输入到 `runAgentLoop` 的转接，强调 `--auto-approve` 等 flag 从用户任务中剥离）。
- `docs/detailed-execution-plan.md` / `AGENTS.md` 摘录：项目边界声明，作为"诚实描述能力"的范例。

**目标篇幅**：约 400 字。

---

## 第 2 节 · Agent Loop 模式解析

整个 Agent 的"心脏"出乎意料地朴素：一个带上界的 `for` 循环。每一轮（turn）做四件事——把消息历史发给 LLM、解析返回、执行模型要的工具、把工具结果追加回历史，然后进入下一轮。`src/agent-loop.ts` 里的 `runAgentLoop` 就是这条主线：

```ts
// src/agent-loop.ts:52
for (let turn = 1; turn <= config.maxTurns; turn++) {
  // ... 可选的上下文压缩 ...
  const messages = withTodoContext(history.getMessages(), todoManager);
  const response = await client.sendMessage(messages, {
    tools: toolDefinitions,
  });
  const assistantMessage = response.choices[0]?.message;
  if (assistantMessage !== undefined) {
    history.append(assistantMessage);
  }
  const parsed = parseResponse(response);
  // ... 停止判断与工具执行 ...
}
```

这里第一个值得说的设计，是**循环为什么必须有上界**。把 `turn` 限制在 `config.maxTurns` 以内，不是为了"优雅"，而是一道硬性的烧钱护栏：模型完全可能陷入"调用工具 → 看到结果 → 再调用同一个工具"的死循环，每一轮都是一次真金白银的 API 调用。上界把最坏情况钉死在可预期的范围内。

由此引出**两个停止条件，缺一不可**。第一个是"任务完成"信号：当模型这一轮的回复里**不再包含任何 tool call**，就意味着它认为话已说完、活已干完，此时直接返回成功。

```ts
// src/agent-loop.ts:105
if (parsed.toolCalls.length === 0) {
  logger.info(`[TURN ${turn}] no tool calls; finishing`);
  recorder?.emit("Stop", {
    success: true,
    turns: turn,
    finalState: "no_tool_calls",
    totalTokens,
  });
  return {
    finalMessage: lastText,
    turnsUsed: turn,
    toolsCalled,
    success: true,
    totalTokens,
    todoDisplay: getTodoDisplay(todoManager),
  };
}
```

第二个是"被迫中止"信号。注意它在循环体之外——只有当 `for` 把 `maxTurns` 轮全部用尽、模型仍在不停调用工具时，控制流才会落到这里，返回 `success: false`：

```ts
// src/agent-loop.ts:146
logger.warn(`[Agent] Reached maxTurns=${config.maxTurns}; stopping`);
recorder?.emit("Stop", {
  success: false,
  turns: config.maxTurns,
  finalState: "max_turns",
  totalTokens,
});
```

两个出口用不同的 `finalState`（`no_tool_calls` / `max_turns`）和 `success` 值区分开，下游既能据此判断任务成败，也能在可观测数据里清楚看到 Agent 是"自然收尾"还是"撞墙退出"。

最后一个、也是最容易被忽视的纪律，是**消息格式的成对追加**。OpenAI-compatible 协议要求：assistant 发起的每一个 tool call，都必须有一条对应的 `role: "tool"` 结果消息跟在后面，且二者通过 `tool_call_id` 配对。循环里逐个执行工具、逐个把结果追加回历史时，`tool_call_id` 用的是**模型返回的真实 `call.id`**，而不是任何工具内部自造的 id：

```ts
// src/agent-loop.ts:123
for (const call of parsed.toolCalls) {
  toolsCalled.push(call.name);
  const result = await activeHarness.executeTool(
    call.name,
    call.input,
    tools,
    lastModelAction
  );
  history.append({
    role: "tool",
    tool_call_id: call.id,
    content: result.content,
  });
  // ...
}
```

为什么这条纪律如此关键？因为模型一轮里可能并发发起多个 tool call，如果回传时 id 对错、或漏了某个 call 的结果消息，下一轮请求就会因为"tool call 与 tool result 不配对"而直接被 API 拒绝，或者更隐蔽地——让模型把 A 工具的结果当成 B 工具的结果，对话就此错乱。把"用真实 id、成对追加"写进循环本身，等于把协议正确性变成不可绕过的结构约束。

还要留意一处细节：真正执行工具的不是循环自己，而是 `activeHarness.executeTool(...)`。Agent Loop 只负责"编排消息流转"，至于权限、安全、验证这些"可控性"职责，全部下沉到了 Harness——这正是第 4 节要展开的故事。


---

## 第 3 节 · 工具调用协议深挖

如果说 Agent Loop 是骨架，工具协议就是骨架与外部世界之间的接口。这里藏着一个最容易踩坑、也最能体现工程克制的设计：**面向模型的协议和面向运行时的协议，必须是两套东西。**

运行时这一套，是工具真正"长什么样"。`src/tools/types.ts` 里的 `ToolDefinition` 不仅有名字、描述、参数 schema，还带着真正能跑的 `execute` 函数和一个可选的 `category`（用于权限分类）：

```ts
// src/tools/types.ts:6
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<ToolResult>;
  category?: RegisteredToolCategory;
}
```

而模型这一套，是工具"对外宣称的样子"。`src/types.ts` 里另有一个**同名但完全不同**的 `ToolDefinition`，它只描述 OpenAI-compatible 的函数调用 schema——一个 `{ type: "function", function: { name, description, parameters } }` 三元组，仅此而已：

```ts
// src/types.ts:16
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}
```

把两者缝合起来的，是 `ToolRegistry.getToolDefinitions()`。它做的事很简单，但每一行都在"做减法"——只从运行时对象里**投影**出模型需要的三个字段，`execute` 和 `category` 一个字都不外泄：

```ts
// src/tools/index.ts:45
getToolDefinitions(): ChatToolDefinition[] {
  return this.getAll().map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
```

**为什么要如此严格地分离？** 因为模型只需要知道"有哪些工具、怎么调用它们"，它既不需要、也不应该看到"这些工具是怎么实现的"。一旦把 `execute` 或 `category` 这类运行时字段塞进发给模型的 payload，轻则用无关信息干扰它的决策，重则诱导它去"调用"一个本不该由它感知的内部能力。协议分离不是洁癖，而是一道把"实现细节"和"模型视野"隔开的边界。

接下来是另一条贯穿全局的纪律——`tool_call_id` 的回传。模型发起 tool call 时，每个 call 都带一个由模型生成的 `id`：

```ts
// src/types.ts:3
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
```

当工具执行完、要把结果作为 `role: "tool"` 消息追加回历史时，这条消息的 `tool_call_id` **必须**是上面那个模型给的真实 `id`（参见第 2 节的 `history.append`），而绝不能是工具实现里自造的固定 id。道理和第 2 节一脉相承：模型一轮里可能并发调用多个工具，唯有用真实 id 配对，模型才能把每条结果对应回它发出的那次调用；id 一旦错位，多工具场景下的对话就会张冠李戴。

最后还有一条防御性约束：**工具参数解析失败必须显式报错，禁止静默改写为 `{}`**。模型给的 `arguments` 是一段字符串，解析成参数对象时如果出错（比如 JSON 不合法），正确做法是把错误如实暴露出来，而不是悄悄塞一个空对象让工具"带病执行"——后者会把一个清晰的协议错误，掩盖成一个面目模糊的运行时故障。

把这三条放在一起看，工具协议的设计哲学其实很统一：**对模型暴露的信息要尽量少且精确，对错误的处理要尽量显式且诚实。**


---

## 第 4 节 · Harness：让 AI 可控

前两节反复出现一个名字：`executeTool`。它属于 Harness——这个项目里负责"让 AI 可控"的执行控制层。但 Harness 的价值，恰恰要从它**一开始并不存在**讲起。

**先散落，后收敛。** 权限确认、危险命令规则、路径沙箱、编辑后验证，这些控制逻辑最初都是**逐个散落**地接进 Agent Loop 的：加了人工确认就在循环里插一段确认、要拦危险命令就在循环里塞一个黑名单判断。这种做法的好处是每个能力都能独立落地、独立测试；但代价也很快显现——Agent Loop 本该只管"消息流转"，却被迫一点点承担起"这条命令安不安全""这次写文件要不要确认"这类它不该管的职责，循环体越来越臃肿、越来越难讲清楚边界在哪。直到把这些逻辑**收敛**成统一的 `Harness`，循环才重新变回那个干净的、只编排消息的骨架。这条"先散落、后收敛"的路径本身就是一条设计教训：控制逻辑分散，会让核心循环重新耦合上它不该知道的细节。

收敛后的结构很清晰：Agent Loop 与工具之间，`Harness` 是**唯一的编排层**。循环只通过 `HarnessLike.executeTool()` 执行工具，绝不绕过它去直接调 `ToolRegistry.execute()`。所有"可控性"都集中在 `executeTool` 一处编排：

```ts
// src/harness.ts:101
async executeTool(/* ... */): Promise<HarnessExecutionResult> {
  try {
    const tool = tools.get(toolName);
    if (tool === undefined) {
      throw new Error(`Tool not found: ${toolName}`);
    }
    this.recorder?.emit("PreToolUse", { /* ... */ });
    const decision = await this.preExecute(tool, input);
    if (!decision.proceed) {
      // 被拦截：直接把拒绝原因作为工具结果回传，不执行
      return { content: decision.reason };
    }
    const result = await tools.execute(toolName, input);
    const content = formatToolResult(result);
    const action = await this.postExecute(toolName, result, modelAction);
    this.recorder?.emit("PostToolUse", { /* ... */ });
    return { content, verificationMessage: action.verificationMessage };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: `[error] ${message}` };
  }
}
```

执行前的闸门顺序在 `preExecute` 里，而且**顺序本身就是设计**：

```ts
// src/harness.ts:158
async preExecute(/* ... */): Promise<HarnessDecision> {
  const safety = checkToolSafety(tool, input, {
    workingDirectory: this.config.workingDirectory,
  });
  if (!safety.proceed) {
    return safety;          // 1. 安全闸：先于一切
  }
  const permission = await this.permissionCheck(tool, input, {
    autoApprove: this.config.autoApprove,
  });
  // ...
  if (!permission.approved) {
    return { proceed: false, reason: `[permission denied] ${permission.reason}` };
  }
  return { proceed: true };  // 2. 权限确认：在安全闸之后
}
```

注意 `checkToolSafety` 排在权限确认**之前**。这是一个刻意的取舍：安全闸是硬边界，连人工确认都不该有机会放行一条越界操作；而权限确认是"要不要打扰用户"的软策略。换句话说，`--auto-approve` 只能跳过第二步的人工确认，**绝不能**绕过第一步的安全边界。

安全闸自己按工具名分派两类检查：

```ts
// src/harness.ts:247
function checkToolSafety(tool, input, options): HarnessDecision {
  if (REQUIRED_PATH_TOOL_NAMES.has(tool.name)) {
    const sandbox = checkPathInSandbox(options.workingDirectory, input.path);
    if (!sandbox.allowed) {
      return { proceed: false, reason: `[blocked] ${sandbox.reason}` };
    }
  }
  // grep/glob 的 path 可选，缺省按 "." 处理
  if (tool.name === "run_command") {
    const commandSafety = checkCommandSafety(input.command);
    if (!commandSafety.allowed) {
      return { proceed: false, reason: `[blocked] ${commandSafety.reason}` };
    }
  }
  return { proceed: true };
}
```

对 `read/write/edit` 这类带路径的工具，走路径沙箱 `checkPathInSandbox`——拒绝绝对路径、拒绝逃出工作目录的 `..` 片段：

```ts
// src/permissions/sandbox.ts:7
export function checkPathInSandbox(workingDirectory, inputPath): SandboxDecision {
  if (typeof inputPath !== "string" || inputPath.trim() === "") {
    return { allowed: false, reason: "path must be a non-empty string" };
  }
  if (path.isAbsolute(inputPath)) {
    return { allowed: false, reason: "absolute paths are not allowed; ..." };
  }
  const root = path.resolve(workingDirectory);
  const resolvedPath = path.resolve(root, inputPath);
  const relativePath = path.relative(root, resolvedPath);
  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) {
    return { allowed: false, reason: "path escapes the working directory" };
  }
  return { allowed: true, resolvedPath, relativePath };
}
```

对 `run_command`，走一组**基础的**危险命令规则——一张用正则匹配的规则表，命中即拦：

```ts
// src/permissions/rules.ts:14
export const DANGEROUS_COMMAND_RULES: readonly CommandSafetyRule[] = [
  { id: "recursive-delete", reason: "Blocked: destructive file deletion (rm -rf)", pattern: /.../ },
  { id: "external-network-request", reason: "Blocked: external network request (curl/wget)", pattern: /.../ },
  { id: "force-push", reason: "Blocked: force push (git push --force)", pattern: /.../ },
  { id: "privilege-escalation", reason: "Blocked: privilege escalation (sudo)", pattern: /.../ },
  // ... 还有写保护路径、chmod 777 等
];
```

这里必须**诚实地划清边界**：这是一组基础的分层闸门，不是完整的 OS 级沙箱，也不是成熟的命令安全策略。一张正则黑名单永远拦不住所有变形写法。但它兑现了一个比"看起来很安全"更重要的承诺——**安全靠代码级拦截，而不是仅在系统提示词里恳求模型"请不要乱来"**。提示词约束是概率性的，模型可以无视；而 `preExecute` 里的闸门是确定性的，命中就是命中。把这道闸门放在主链路的必经之处，才是"让 AI 可控"真正的落脚点。


---

## 第 5 节 · 自验证回路

前几节解决了"模型怎么安全地动手"，但还剩一个更尖锐的问题：**改完代码，凭什么说它改对了？** 人类工程师改完一处 bug 会顺手跑一遍测试；自验证回路要做的，就是把这个习惯固化成机制——让 Agent 改完文件后自己跑测试、自己看结果、必要时自己重试。

入口在 Harness 的 `postExecute`。它只在**编辑类工具成功之后**才触发验证：`result.error` 非空，或工具不是 `write_file` / `edit_file`，都直接跳过——读文件、跑 grep 这类操作没有"需要被验证的改动"：

```ts
// src/harness.ts:188
async postExecute(toolName, result, modelAction): Promise<PostExecuteAction> {
  if (result.error !== undefined || !EDIT_TOOL_NAMES.has(toolName)) {
    return {};
  }
  this.editedThisTurn = true;
  if (this.config.testCommand === undefined) {
    return {};
  }
  const testResult = await this.testRunner(
    this.config.testCommand,
    this.config.workingDirectory
  );
  const summary = formatTestResults(testResult);
  const verification = recordVerificationAttempt(
    this.retryState,
    { maxRetries: this.config.maxRetries, testCommand: this.config.testCommand },
    testResult, summary, modelAction
  );
  this.retryState = verification.state;
  return { verificationMessage: verification.nextMessage };
}
```

这套能力是**分三步渐进交付**的，每一步只推进一层边界——这也是整个项目反复使用的手法。

第一步，做一个独立可测的测试执行器 `runTests`。它就是对 `child_process.exec` 的一层封装，但加了两个不可省的护栏：60 秒超时和 `SIGKILL`，确保一个挂死的测试不会把整个 Agent 拖死：

```ts
// src/verification/test-runner.ts:27
export async function runTests(command, cwd, options = {}): Promise<TestResult> {
  validateInput(command, cwd);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS; // 60000
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd, timeout: timeoutMs, killSignal: "SIGKILL",
    });
    return { passed: true, exitCode: 0, stdout, stderr, /* ... */ };
  } catch (error) {
    // 超时 / 非零退出码都收敛成结构化的 TestResult
  }
}
```

第二步，做结果摘要 `formatTestResults`，把它注入对话——此时只读不修复。这里藏着一个**刻意的健壮性设计**：它用正则去解析 reporter 输出（`Tests x failed | y passed` 之类），但一旦解析不出失败明细，就**回退到截断后的原始 stdout/stderr**，绝不让模型拿到一条空信息：

```ts
// src/verification/format-results.ts:41
function formatFailed(result: TestResult, counts: TestCounts | null): string {
  const lines: string[] = [];
  // ... 推入 "Tests failed: x of y" ...
  const failures = parseFailures(result.stdout);
  if (failures.length > 0) {
    lines.push(...failures);
  } else {
    const raw = rawOutput(result);      // 兜底：原始 stdout + stderr
    if (raw !== "") lines.push(raw);
  }
  return lines.join("\n");
}
```

第三步，才加上重试状态机 `recordVerificationAttempt`，把"测试失败"升级为明确的"请修复"语义。它有两个出口：还没到上限就注入 `Tests failed. Please fix the issues:` 连同摘要，促使模型下一轮去改；一旦尝试次数到达 `maxRetries`，就注入 `Unable to fix after n attempts` 并重置状态、放弃修复——这道上限是防死循环的硬护栏：

```ts
// src/verification/retry-loop.ts:68
if (attempts >= config.maxRetries) {
  const message = `Unable to fix after ${config.maxRetries} attempts`;
  return { state: createRetryState(), /* ... */ nextMessage: message };
}
const message = `Tests failed. Please fix the issues:\n${formattedResult}`;
return { state: nextState, /* ... */ shouldRetry: true, nextMessage: message };
```

注意 `verification.nextMessage` 最终会作为一条 assistant 消息回到对话历史（见第 2 节循环里的 `verificationMessage` 追加）。于是"改文件 → 跑测试 → 把结果讲给模型听 → 模型再改"形成了一个闭环。把人类"改完跑测试"的直觉拆成"独立执行器 + 摘要兜底 + 重试上限"三件可单独测试的小事，正是这个回路既好用又可靠的原因。


---

## 第 6 节 · 经验教训

把六节走下来，最值得沉淀的不是某个具体实现，而是一组反复奏效的工程取舍。下面七条，每一条都能在代码里找到落点。

**1. 渐进式收敛优于一步到位。** 权限、安全、验证最初都散落在 Agent Loop 里，直到积累够了才收敛成 `Harness`。先散落让每个能力独立可测，再收敛让控制层职责单一。但要警惕散落期拖太长——循环会重新耦合上具体工具名和它本不该管的判断。

**2. 协议分离不是洁癖。** 把 `execute` / `category` 这类运行时字段泄露给模型，轻则干扰决策，重则诱导它去"调用"不存在的内部能力。`getToolDefinitions()`（`src/tools/index.ts:45`）只投影 `{ type, function: { name, description, parameters } }` 三元组，是一道必须守住的边界。

**3. 可控性必须代码级落地。** 只在系统提示词里写"请勿执行危险命令"是概率性的，模型可以无视。真正的闸门写在 `preExecute` 里，且 `checkToolSafety` 排在权限确认**之前**、`--auto-approve` 也绕不过（`src/harness.ts:158`）。确定性的拦截才算数。

**4. 观测必须是旁路，而非主链路。** `EventRecorder.emit()`（`src/observability/recorder.ts:37`）对主链路只做一件事——把事件同步推进队列就立即返回；真正的写盘 / HTTP / hook 派发都在后台 `drainLoop` 里完成，sink 出错也只写 stderr（`recorder.ts:142`）。绝不能让"看 Agent 在做什么"变成 Agent 失败的新来源。payload 还要对 `ARK_API_KEY`、Authorization、token、secret 做脱敏（`src/observability/events.ts:40` 的 `SENSITIVE_KEY_PATTERN`），绝不落盘真实凭证。

**5. 上下文压缩不能破坏对话结构。** 压缩时保留系统消息、把中段历史交给模型总结、再接回最近 N 条对话（`src/context/compressor.ts:42`）。系统提示词和近期上下文是模型继续任务的命脉，压缩的是"远处的历史"，不是"刚刚发生的事"。

**6. mock 与真实 eval 必须分离。** `runEvalSuite`（`src/evals/runner.ts:80`）里，`options.mock` 走 `createMockRunner`，只验证 runner / trace / report 链路，无需密钥、可进 CI；真实 LLM eval 另跑。两者绝不能混为一谈——mock 通过率不代表模型能力。配套的 `--baseline ... --check` 会在 pass rate、平均 turns 等指标退化时直接抛错（`runner.ts:124`），让退化在合并前就被拦下。

**7. 诚实描述边界本身是工程纪律。** 把"基础 Harness"说成"完整沙箱"，会让使用者承担超出实际防护的风险。本文通篇坚持"基础 / 分层闸门"的措辞，正是这条纪律的体现。

### 持续 eval 趋势

这套机制到底跑得怎么样？下表汇总了项目各阶段的真实 eval 产物（数字均来自仓库中保存的 run artifact，非估算）：

| 阶段 | 任务数 | 通过 | 平均 turns | 来源 artifact |
| --- | --- | --- | ---: | --- |
| P2 基线 | 5 | 5/5 | 3.8 | `evals/results/2026-06-14T03-51-17-197Z.json` |
| P3 | 10 | 9/10 | 4.6 | `evals/results/2026-06-14-p3.json` |
| P4 持续趋势 | — | 平台已就绪，快照待 T4 | — | `src/evals/runner.ts`（suite / repeat / trace / baseline check） |
| P5 发布前 | 10 | 9/10 | 5.3 | `evals/results/2026-06-14T08-41-43-355Z.json` |

> 说明：P4 阶段交付的是**持续评测平台本身**——suite/repeat 选择、trace JSONL 汇总、Markdown 报告、dashboard 数据与退化门禁均已就绪；但正式的 continuous baseline 快照（`evals/baselines/p4-continuous.json`）需要一次真实 LLM eval 才能显式保存，这一步留给 P5-W15-T4，故 P4 行不填编造数字。趋势可读出两点：任务规模从 5 扩到 10、通过率稳定在九成，平均 turns 随多文件任务增多（如 `08-cross-file-rename` 单任务 12 轮）而温和上升——这与"任务更难、链路更长"的直觉一致。

### 结论

回到引言的那条主线：一个能放心使用的 Coding Agent，靠的不是更聪明的提示词，而是一套让模型每个动作都落在可控边界内的**结构**。本文拆出的六个机制——带上界的 Agent Loop、双协议分离、收敛的 Harness、确定性的安全闸、闭环的自验证、旁路的可观测——没有一个依赖"模型足够聪明"这个假设；它们的价值恰恰在于：即便模型出错，错误也被框在可预期、可观测、可回退的范围内。

需要再次坦诚边界：这仍是一个极简实现。它的安全闸是基础的分层闸门而非完整 OS 沙箱，它的命令规则是一张拦得住常见危险写法、但拦不住所有变形的正则表，它的持续趋势数据也才刚刚起步。往前看，更完整的命令安全策略、多模型适配层、检索增强，都是自然的演进方向——但在写下它们之前，必须先承认它们还是规划，而非现状。把"诚实描述能力"也当成一条工程纪律，或许才是从零手写这件事，留给作者最深的一课。


---

## 附录 · 全文篇幅规划

| 章节 | 目标字数 | 负责任务 |
| --- | --- | --- |
| 引言 | ~500 | T1 |
| 第 1 节 为什么从零手写 | ~400 | T2 |
| 第 2 节 Agent Loop | ~700 | T2 |
| 第 3 节 工具调用协议 | ~700 | T2 |
| 第 4 节 Harness | ~700 | T2 |
| 第 5 节 自验证回路 | ~600 | T3 |
| 第 6 节 经验教训 + 趋势表 + 结论 | ~600 + 表 + 结论 | T3 |
| **合计** | **约 3000-4000 字** | — |

> 写作约束：所有代码片段必须来自真实代码库并标注路径；涉及 Harness / 命令安全 / 沙箱的描述一律使用"基础 / 分层闸门"措辞，禁止暗示完整 OS 沙箱、完整危险命令防护或成熟安全策略。
