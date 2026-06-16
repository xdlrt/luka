# 第 6 章　扩展治理：Skill 与插件

> 对应《拆解 Claude Code》第 5、7 章。

## 前情提要

科普书把 Skill 解释成"按需取用的本领包"，把插件解释成"安装别人打包好的扩展包"。深度层要问的是：这些扩展如何被发现、加载、信任、映射到运行时出口，并且不绕过工具与权限系统。

这一章把 Skill 与插件放在一起，因为它们本质上都在回答同一个问题：**如何让外部能力进入 Agent，而不让它们接管 Agent。** 我们会看到 Skill 的真实 frontmatter 字段（远比想象的多）、"只加载元数据、按需才读正文"的省 token 策略、插件清单里**按出口分路径**的结构，以及一个常被忽视的安全检查——路径穿越。

## 本章要钻多深

- 一个 Skill 的 frontmatter 里到底声明了多少东西？为什么加载时只读 frontmatter、不读正文？
- 插件清单为什么给每种出口（命令/agent/skill/hook/输出风格）分别记一组路径，而不是一个统一目录？
- 校验顺序为什么是"路径穿越检查 → schema 校验 → 信任 → 加载"，少一步会怎样？
- 为什么说插件市场是供应链治理，而不是产品功能？

## Skill：frontmatter 即契约

科普书说 Skill 是"一组资源"。它的入口是一个 `SKILL.md`，文件头部的 frontmatter（YAML 元数据）才是真正的契约。生产级解析出的字段远超"名字 + 说明"（推断，字段为真实结构）：

```typescript
// 阐释性重构——Skill frontmatter 解析出的字段，非逐字源码
type ParsedSkillFields = {
  displayName?: string
  description: string              // 给模型判断"何时该用"的核心
  whenToUse?: string               // 触发指引
  allowedTools: string[]           // 这个 Skill 运行时能用哪些工具——权限作用域
  argumentHint?: string
  argumentNames: string[]
  version?: string
  model?: ModelSpec                // 可指定用哪个模型，或 'inherit'
  effort?: EffortValue             // 思考强度
  disableModelInvocation: boolean  // 是否禁止模型自动调用（只能用户显式触发）
  userInvocable: boolean           // 是否可被用户直接调用，默认 true
  hooks?: HooksSettings            // Skill 可以携带自己的钩子
  executionContext?: 'fork'        // 是否在 fork 出的子上下文里执行
  agent?: string                   // 绑定到某个子 Agent 角色
  shell?: FrontmatterShell
}
```

几个字段值得单独点出，它们说明 Skill 不只是"一段提示词"：

- **`allowedTools`**：Skill 声明自己运行时能用哪些工具。这是**权限作用域**，不是建议——和第 7 章子 Agent 的 `allowedTools` 是同一个机制。一个文档生成 Skill 可能只需要读文件和写文件，就不该给它跑命令的权限。
- **`disableModelInvocation` / `userInvocable`**：精确区分"谁能触发这个 Skill"。有些 Skill 只允许用户显式调用、禁止模型自动发现使用——这是防止 Skill 触发过宽、污染上下文的闸门。
- **`executionContext: 'fork'` / `agent`**：Skill 可以声明"我要在一个 fork 出来的隔离上下文里跑"，甚至绑定到特定子 Agent 角色。这把 Skill 和第 7 章的多 Agent 直接连了起来。
- **`hooks`**：Skill 甚至能携带自己的生命周期钩子——这意味着 Skill 的治理边界要和第 9 章的钩子治理打通。

**只读 frontmatter、按需读正文，是核心的省 token 策略。** 加载阶段只解析 frontmatter（名字、描述、whenToUse），据此估算每个 Skill 的"目录开销"——因为完整正文只在 Skill 真正被调用时才加载（推断）：

```typescript
// 阐释性重构——加载期只算 frontmatter 的 token，正文延迟到调用时
function estimateSkillFrontmatterTokens(skill): number {
  const frontmatterText = [skill.name, skill.description, skill.whenToUse].join(' ')
  return roughTokenCountEstimation(frontmatterText)
}
```

这解决了科普书第 5 章那个核心矛盾——能力可以无限多，但不能让所有 Skill 的完整说明都常驻上下文。答案是：常驻的只有一句话级别的"索引"（名字 + 描述），模型按这个索引决定要不要"翻开"某个 Skill，翻开时才付出正文的 token。这正是第 2 章 `searchHint` / 工具搜索思想在 Skill 上的体现。

## 插件：按出口分路径的清单

科普书说插件能接入"命令/agent/skill/hook/输出风格"多个出口。深度层最值得看的是：这些出口在数据结构上是**分开记录**的，而不是塞进一个统一目录（推断，结构为真实形态）：

```typescript
// 阐释性重构——一个已加载插件，每种出口各有自己的路径
type LoadedPlugin = {
  name: string
  manifest: PluginManifest
  path: string
  source: string
  repository: string
  enabled?: boolean
  isBuiltin?: boolean
  sha?: string                              // git commit SHA，用于版本锁定

  commandsPath?: string; commandsPaths?: string[]
  agentsPath?: string;   agentsPaths?: string[]
  skillsPath?: string;   skillsPaths?: string[]
  outputStylesPath?: string; outputStylesPaths?: string[]
  hooksConfig?: HooksSettings
  mcpServers?: Record<string, McpServerConfig>
  lspServers?: Record<string, LspServerConfig>
}

type PluginComponent = 'commands' | 'agents' | 'skills' | 'hooks' | 'output-styles'
```

为什么每种出口分开记路径，而不是一个 `pluginDir` 一锅端？因为**出口隔离是治理的前提**。如果所有出口混在一个目录、走一个"加载插件"的入口，就无法给不同风险设不同边界。分开之后，系统可以：单独启用/禁用某一类出口；对 MCP 出口走第 5 章的连接治理，对 hooks 出口走第 9 章的旁路约束，对 commands 出口做命名空间隔离。

注意那个 `sha` 字段——git commit SHA 用于版本锁定。这是供应链治理的痕迹：插件来自哪个仓库的哪个提交，要能精确钉死，否则"自动更新"会让历史行为悄悄改变。

出口隔离的具体边界，可以列成一张治理表：

| 出口 | 风险 | 应有边界 |
| --- | --- | --- |
| commands | 用户以为是本地控制，实际触发外部逻辑 | 命名空间隔离、来源展示、可禁用 |
| hooks | 生命周期钩子改变主流程 | 默认旁路，不改变 Agent 成败（第 9 章）|
| MCP | 外部工具执行 | 归一化成 Tool 再走权限（第 5 章）|
| agents | 子 Agent 获得过宽工具 | allowedTools 与工作目录限制（第 7 章）|
| output styles | 风格影响安全提示文案 | 只能改表达，不改协议与权限 |
| skills | 长说明污染上下文 | 按需加载、来源标注、可禁用模型调用 |

**"信任插件"不等于"允许插件改一切"。** 每个出口单独治理，才能做到信任一个插件、却仍然限制它的某类行为。

## 校验顺序：路径穿越要最先查

插件加载是"把外部代码引入本地"，校验顺序本身就是安全设计。生产级的顺序大致是（推断）：

```typescript
// 阐释性重构——校验必须在赋予执行能力之前，且路径穿越最先查
async function loadPlugin(pkg): Promise<LoadedPlugin | null> {
  const raw = await readManifestJson(pkg)

  // 1. 路径穿越检查——在 schema 校验之前
  //    即使后面的 schema 校验失败，也要先确保没有 ../../ 逃逸
  checkPathTraversal(raw)

  // 2. schema 校验（清单格式、字段类型）
  const manifest = validateManifestSchema(raw)

  // 3. 版本 / 兼容性 / 策略 / blocklist
  checkVersionAndCompatibility(manifest)
  checkPolicyAndBlocklist(manifest)

  // 4. 信任确认——必须在加载任何可执行出口之前
  const trust = await requireTrustIfNeeded(manifest)
  if (!trust.allowed) return null

  // 5. 按出口分别加载
  return {
    commandsPath: resolve(manifest.commands),
    agentsPath: resolve(manifest.agents),
    skillsPath: resolve(manifest.skills),
    hooksConfig: manifest.hooks,
    mcpServers: manifest.mcp,
    outputStylesPath: resolve(manifest.outputStyles),
  }
}
```

源码里有一条很关键的注释（推断转述）：**路径穿越检查要在 schema 校验之前做，这样即使 schema 校验失败也能先抓住安全问题。** 为什么？因为一个恶意清单可能在某个路径字段里写 `../../../../etc/something`，企图让插件的"命令目录"指向插件包外的任意位置。如果先跑 schema 校验、而清单恰好有个不相关的格式错误，流程可能在抓到路径穿越前就以"格式错误"退出——但攻击者要的不是加载成功，有时只是探测。把 `../` 检查提到最前面，保证安全检查不被其它校验的失败"短路"掉。

整个顺序的铁律和第 4 章一脉相承：**校验、信任必须发生在赋予任何执行能力之前。** 顺序错了——比如先加载命令再确认信任——插件系统就从"治理平台"退化成"本地任意代码执行入口"。

## 为什么插件市场是最后一步

科普书说"谨慎，从最小可控的一步开始"。深度层给出具体的演进顺序，每一步都对应一类新打开的风险：

```text
1. 本地、显式、可审计的清单          —— 无下载、无网络
2. 只开一个出口：清单 -> Tool        —— 工具仍走 ToolRegistry + Harness
3. 逐步打开 hooks / commands / agents —— 每个出口单独治理
4. 引入 marketplace + sha 版本锁定   —— 供应链：来源可信、版本可钉
5. 最后才是自动更新 / 依赖解析 / 统计 —— 完整供应链治理
```

市场、自动更新、依赖解析、封禁列表，看起来像产品功能，**实质都是供应链治理**：外部代码会被下载到本地、可能注册工具/命令/钩子、用户可能在不完全理解风险时启用、版本更新可能改变历史行为。`sha` 版本锁定、blocklist、policy 这些机制就是为这些风险准备的。把"市场"排在最后，不是保守，而是**让治理复杂度和实际能力同步推进**——没有 trust、policy、disable、version 机制之前，就不该承诺"市场"。

## 最小可行实现参照

本仓库**没有** Skill 系统，也没有插件系统。这是诚实的边界：这两者都属于"生态扩展"，而最小实现专注于核心闭环。

但它有一个和本章直接相关的设计可以借鉴——工具注册表的 `register` 在重名时直接抛错（真实代码）：

```typescript
// src/tools/index.ts（真实代码，节选）
register(tool: ToolDefinition): void {
  if (this.tools.has(tool.name)) {
    throw new Error(`Tool already registered: ${tool.name}`);
  }
  this.tools.set(tool.name, tool);
}
```

这条小小的重名检查，正是未来插件治理的起点：当插件试图注册一个和现有工具同名的工具时，系统必须有明确反应（拒绝或命名空间隔离），而不是静默覆盖。静默覆盖意味着一个插件可以"劫持"内置工具的名字——模型以为在调用安全的内置 `read_file`，实际调用的是插件的同名实现。从这条 8 行的检查，到完整的出口隔离治理，是同一个原则在不同规模下的展开：**外部能力进入注册表时，必须有明确的冲突与边界处理。**

| 维度 | 最小实现 | 生产级（推断） |
| --- | --- | --- |
| Skill | 无 | frontmatter 契约 + 按需加载正文 |
| 插件 | 无 | 多出口分路径清单 + sha 锁定 |
| 重名处理 | register 抛错 | 命名空间隔离 + 出口治理 |
| 校验 | N/A | 路径穿越优先 + schema + 信任 |
| 市场 | 无 | 供应链治理（排在最后）|

## 边界与权衡

- **Skill 解决 prompt 膨胀，但引入触发准确率问题**。"只读 frontmatter"省了 token，但也意味着模型靠一句话描述来判断要不要翻开 Skill——描述写不好，该用的 Skill 不被发现，不该用的被滥用。
- **出口越多，插件越强，治理矩阵也越大**。六种出口，每种一套边界，组合起来是不小的复杂度。这是"生态能力"的固有成本。
- **路径穿越只是众多注入面之一**。清单可以在很多字段里藏恶意内容；把最危险的检查（路径逃逸）提到最前，是必要但不充分的——它说明安全校验的**顺序**本身就是攻击面。
- **`disableModelInvocation` 这类字段是双刃剑**。它给了细粒度控制，但每多一个控制维度，就多一种配置组合要测试、要向用户解释。

## 本章小结

- Skill 的 frontmatter 是契约，声明了 allowedTools（权限作用域）、触发控制、执行上下文、甚至自带 hooks——远不止"一段提示词"；加载时只读 frontmatter、按需才读正文，是省 token 的核心。
- 插件清单按出口（命令/agent/skill/hook/输出风格/MCP/LSP）分别记路径，因为出口隔离是分级治理的前提；`sha` 字段用于供应链版本锁定。
- 校验顺序是安全设计：路径穿越检查要最先做（不被其它校验短路），信任确认必须在加载任何可执行出口之前。
- 插件市场是供应链治理而非产品功能，应排在"本地可审计清单 → 单出口 → 多出口 → 市场 → 自动更新"演进的最后。

下一章进入多 Agent 编排：fork 隔离、allowedTools 权限作用域、多种 Task 后端，以及并发写冲突这个最难的问题。
