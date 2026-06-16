# 第 2 章　工具执行框架全貌

> 对应《拆解 Claude Code》第 2 章。

## 前情提要

科普书第 2 章讲过：模型靠「说出想做什么」间接动手；同一个工具存两份描述——给模型的「菜单」（名字、说明、参数）和真正干活的「实现」（还含执行逻辑、权限分类）；模型永远只该看到菜单；工具出错时把错误当成答复送回，而不是让任务崩溃。

这一章把「实现」这一侧彻底打开。你会发现，生产级的工具对象远不止「一个执行函数」——它是一个背负了校验、权限、并发、UI 渲染、可中断性、动态来源的**重型接口**。理解这个接口的字段构成，就理解了一个编程智能体到底要为「让模型安全地动手」付出多少工程代价。

## 本章要钻多深

- 一个生产级工具接口包含哪些方法和元数据？每一个解决什么问题？
- 「给模型的菜单」是如何从「完整实现」里投影出来的——投影这一步为什么是安全关键？
- 工具执行需要的运行时上下文（`ToolUseContext`）里装了什么？为什么工具不能自己去读这些？

## 机制深挖：一个工具接口的全貌

科普书把工具实现简化成「名字 + 说明 + 参数 + 执行逻辑 + 权限分类」五样。真实的工具接口要丰富得多。下面是它的改写形态（推断，保留真实字段以体现职责密度）：

```typescript
// 阐释性重构——表达工具接口的职责广度，非逐字源码
type Tool<Input, Output> = {
  // —— 模型可见的元数据 ——
  inputSchema: ZodSchema<Input>          // 参数 schema（同时用于校验和生成菜单）
  inputJSONSchema?: JSONSchema           // MCP 工具直接给 JSON Schema 而非 Zod
  searchHint?: string                    // 给"工具搜索"用的关键词短语（3-10 词）
  aliases?: string[]                     // 重命名后的向后兼容别名

  // —— 行为分类（决定权限、并发、UI 折叠策略）——
  isReadOnly(input: Input): boolean      // 只读？只读工具可自动放行
  isConcurrencySafe(input: Input): boolean // 并发安全？决定能否并行执行
  isDestructive?(input: Input): boolean  // 不可逆操作（删除/覆盖/发送）？
  isEnabled(): boolean                   // 当前会话是否启用
  interruptBehavior?(): 'cancel' | 'block' // 运行中收到新消息：取消还是阻塞等待

  // —— 执行 ——
  call(args: Input, context: ToolUseContext, canUseTool: CanUseToolFn,
       parentMessage, onProgress?): Promise<ToolResult<Output>>
  inputsEquivalent?(a: Input, b: Input): boolean  // 两次调用是否等价（去重用）

  // —— 给模型的描述（动态生成）——
  description(input: Input, opts: { toolPermissionContext, tools, ... }): Promise<string>
  prompt(opts): Promise<string>          // 工具的详细使用说明
  userFacingName(input): string          // 界面上显示的名字

  // —— UI 渲染（一组可选回调）——
  renderToolUseMessage(...): React.ReactNode
  renderToolUseProgressMessage?(...): React.ReactNode
  renderToolUseRejectedMessage?(...): React.ReactNode
  renderToolUseErrorMessage?(...): React.ReactNode
  // ……还有更多渲染回调
}
```

一个工具对象同时是：**参数契约**（schema）、**行为声明**（只读/并发/破坏性）、**执行器**（call）、**说明书生成器**（description/prompt）、**UI 组件**（一堆 render 回调）。这解释了科普书里那个「全能选手 vs 清爽工具」的权衡——生产级工具之所以「全能」，是因为它要同时服务模型、权限系统、调度器、终端界面四类消费者。

几个值得单独点出的字段：

- **`isReadOnly` / `isConcurrencySafe` / `isDestructive`**：这三个「行为分类」不是装饰，它们直接驱动调度与安全决策。只读工具可以自动放行（无需用户确认）；并发安全的工具可以被并行执行；破坏性工具（删除、覆盖、发送）会触发更严格的确认。科普书第 2 章说「工具属于哪一类关系到要不要确认」，这里就是那个「类」的真身——而且它细分成了三个正交维度。
- **`interruptBehavior`**：当工具正在跑、用户又发来新消息时怎么办？`'cancel'` 是停掉丢弃结果，`'block'` 是让新消息排队等它跑完。默认 `'block'`。这是流式交互体验的关键细节——一个长时间运行的命令不该被用户的随手输入打断。
- **`searchHint`**：当工具数量极多时，不可能把所有工具的菜单都塞给模型（太占上下文）。于是有了「工具搜索」机制——大部分工具默认不出现在菜单里，模型按关键词搜索才把它们「调出来」。`searchHint` 就是给这个搜索用的关键词。这是科普书没提的一层：**菜单本身也可以是动态、按需的。**

## 机制深挖：从「实现」投影出「菜单」

科普书反复强调「模型只该看到菜单」。在代码层面，这是一步**显式的投影**——从重型工具对象里，只摘出模型该看的几个字段，其余一律丢弃。

最小实现把这一步写得清清楚楚（真实代码）：

```typescript
// src/tools/index.ts （真实代码，最小可行实现）
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

注意它**只取** `name` / `description` / `parameters` 三样，运行时字段——`execute`、`category`——根本不在投影范围内。模型拿到的，是一个干净的、不含任何执行能力或内部分类的纯数据结构。

这一步为什么是安全关键？因为投影是「模型能看到什么」的**唯一闸门**。如果有人图省事，直接把整个工具对象序列化发给模型，那么 `category`（权限分类）、内部回调、甚至执行逻辑的线索都可能泄露——模型可能借此推断出绕过权限的方法，或被诱导去构造特定的内部状态。最小实现用类型系统把这两层彻底分开（真实代码）：

```typescript
// src/tools/types.ts —— 运行时工具协议（含 execute / category）
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<ToolResult>;  // 模型看不到
  category?: RegisteredToolCategory;                              // 模型看不到
}
```

而「给模型的菜单」是另一个类型（`ChatToolDefinition`，定义在 `src/types.ts`，只含 `name`/`description`/`parameters`）。**两个类型，物理隔离**——投影函数是它们之间唯一的桥，且这座桥是单向的、只放行三个字段。生产级系统的隔离思路完全一致，只是工具对象那一侧的字段多了一个数量级。

## 机制深挖：运行时上下文 `ToolUseContext`

工具执行时需要很多「环境信息」：当前工作目录、Agent 身份、用于中断的信号、文件状态缓存、权限上下文……一个幼稚的设计会让每个工具自己去读这些（读环境变量、读全局状态）。生产级的做法是把它们打包成一个**显式传入**的上下文对象（推断）：

```typescript
// 阐释性重构——运行时上下文的关键字段
type ToolUseContext = {
  abortController: AbortController        // 中断信号——工具据此响应取消
  readFileState: FileStateCache           // 文件读取状态的 LRU 缓存（去重、追踪）
  agentId?: AgentId                       // 仅子 Agent 设置；钩子据此区分主/子调用
  getToolPermissionContext: () => Promise<ToolPermissionContext>  // 拉取当前权限上下文
  // ……UI 回调、会话信息等
}
```

为什么工具不能自己去读这些，而要靠传入？三个理由，都呼应科普书的安全主张：

1. **可控边界**。`agentId` 由上下文注入，意味着工具无法「假装」自己是别的 Agent。身份是被赋予的，不是自称的——这对第 7 章的多 Agent 权限隔离至关重要。
2. **可测试**。把上下文做成参数，测试就能注入假的 `abortController`、假的权限上下文，而不必去 mock 全局环境。这正是最小实现里 Harness 把工作目录、权限检查器都做成构造参数的同一思路。
3. **可中断**。`abortController` 统一传入，意味着外层（循环、用户）可以一键中断所有正在跑的工具。如果每个工具自己管自己的中断，就没有统一的「停」。

科普书第 2 章说「工具不自己管安全，所有危险动作走统一关卡」。`ToolUseContext` 是这句话的另一面：**工具也不自己找环境，所有环境信息从统一上下文注入。** 拿什么、能拿什么，都由外层说了算。

## 最小可行实现参照

最小实现的工具，把上面这套重型接口砍到只剩骨架——但骨架的**关节位置**和生产级完全一致：

- 行为分类：生产级有 `isReadOnly`/`isConcurrencySafe`/`isDestructive` 三维，最小实现压缩成一个 `category`（read / write / command），够用来驱动「读自动放行、写和命令要确认」。
- 执行：生产级的 `call(args, context, canUseTool, ...)` 带一长串上下文参数，最小实现是 `execute(input)`——工作目录在创建工具时就**闭包捕获**了，所以连 `context` 都省了。
- UI 渲染：最小实现完全没有，界面层（第 9 章会提）单独处理。

而真正一字不差对齐的，是「菜单/实现分离」那条线：两个类型、一个单向投影函数、运行时字段绝不外泄。**接口的繁简可以差一个数量级，但安全边界的位置一毫米都不能挪。**

## 边界与权衡

- **重型接口的代价是「每个工具都要实现一堆回调」**。生产级用了大量「可选方法 + 合理默认」来缓解：没实现 `isReadOnly` 就默认 `false`（保守地当作要确认），没实现 `interruptBehavior` 就默认 `'block'`。默认值的选择本身是安全决策——**拿不准时，默认更安全的那个**。
- **`searchHint` / 工具搜索是把双刃剑**。它让工具数量可以无限扩张（不撑爆上下文），但也意味着模型「看不到」未被搜出的工具——如果搜索关键词没匹配上，一个本该用的工具就被模型「错过」了。这是用「上下文成本」换「召回风险」的权衡。
- **行为分类依赖工具诚实声明**。`isDestructive` 由工具自己返回——如果一个工具谎称自己「不破坏」，权限系统就会少一道确认。所以工具的来源信任（第 6 章插件治理）和这里的行为分类是连在一起的：**只有可信来源的工具，它的自我声明才可信。**

## 本章小结

- 生产级工具是重型接口：它同时是参数契约、行为声明（只读/并发/破坏性三维正交）、执行器、说明书生成器和一组 UI 渲染回调，服务模型/权限/调度/界面四类消费者。
- 「给模型的菜单」由一步显式、单向的投影从完整实现里摘出，只放行 `name`/`description`/`parameters`；这步投影是「模型能看到什么」的唯一闸门，运行时字段绝不外泄。
- 工具执行所需的环境（中断信号、Agent 身份、权限上下文）由 `ToolUseContext` 统一注入，而非工具自取——保证身份可控、行为可测、中断统一。
- 最小实现把接口砍到骨架，但「菜单/实现物理隔离」「环境注入而非自取」这两条安全边界的位置与生产级完全一致。

下一章进入上下文工程——看记忆的压缩、token 预算、配对保护，以及那个科普书一笔带过的「相关记忆检索」在生产级里到底怎么实现。
