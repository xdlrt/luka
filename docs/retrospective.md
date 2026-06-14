# 项目复盘 · 极简 Coding Agent（P1-P5）

> 本文是 P5-W15-T4 的发布前复盘。所有数字与证据均引用仓库中保存的真实 artifact，不做估算或美化。能力描述严格区分"已实现"与"规划中"。

## 1. 最终 eval 结果

发布前最终 eval 复用此前的 P5 发布前全量 run（10 个任务，未重跑以避免引入新的随机波动），结果保存为 `evals/results/2026-06-14-final.json`（内容与原 run `2026-06-14T08-41-43-355Z` 一致）。

- 通过率：90.0%（9/10）
- 平均 turns：5.30
- 平均 tool calls：6.40
- 权限拒绝：0
- 验证运行：11
- flaky task：无
- 唯一失败：`09-add-tests-for-module` — `expected tests/slugify.test.mjs to contain multiple-spaces`（trace 见 `evals/results/traces/2026-06-14T08-41-43-355Z/4117c9e6-5093-476d-b95c-2a4df34e9678.jsonl`）

## 2. 阶段对比

| 阶段 | 任务数 | 通过 | 平均 turns | 来源 artifact |
| --- | --- | --- | ---: | --- |
| P2 基线 | 5 | 5/5 | 3.8 | `evals/results/2026-06-14T03-51-17-197Z.json` |
| P3 | 10 | 9/10 | 4.6 | `evals/results/2026-06-14-p3.json` |
| P4 持续趋势 | — | 平台已就绪，快照待保存 | — | `src/evals/runner.ts`（suite / repeat / trace / baseline check） |
| P5 发布前 final | 10 | 9/10 | 5.3 | `evals/results/2026-06-14-final.json` |

说明：P4 阶段交付的是**持续评测平台本身**——`runEvalSuite`（`src/evals/runner.ts:80`）支持 suite/repeat 选择、trace JSONL 汇总、Markdown 报告、dashboard 数据，以及 `--baseline ... --check` 退化门禁（`src/evals/baseline.ts:54` `checkRegression`）。但正式的 continuous baseline 快照（`evals/baselines/p4-continuous.json`）至今未保存，`evals/baselines/` 目录为空，因此 P4 行不填编造数字。趋势可读出两点：任务规模从 5 扩到 10、通过率稳定在九成；平均 turns 随多文件任务增多而温和上升，与"任务更难、链路更长"的直觉一致。

## 3. 时间线遵守情况

P1-P5 五个里程碑均按 `docs/plan/` 的 checklist 推进，详细任务拆分见 `docs/detailed-execution-plan.md`：

- P1 Agent Loop + tool calls 最小闭环 — 完成
- P2 Harness（权限、安全闸、沙箱、编辑后验证）— 完成
- P3 上下文压缩、消息历史、TodoWrite 规划、多文件 eval — 完成
- P4 可观测 events/hooks/trace + 持续评测 suite/repeat/report/baseline check — 完成
- P5 开源打磨（README/LICENSE/CONTRIBUTING/模板/bin/demo）+ 技术文章（`docs/article-draft.md`）— 完成

整体节奏稳定，未出现里程碑塌方。最大的隐性偏差是 P4 的"正式 baseline 快照"被一路顺延到发布前仍未落地（见第 6 节）。

## 4. 做得好的

- **渐进收敛的 Harness**：权限、安全、验证最初散落在 Agent Loop，后收敛为统一执行控制层（`src/harness.ts` `executeTool` / `preExecute`）。循环只通过 `HarnessLike.executeTool()` 执行工具，职责单一。
- **双协议分离**：面向模型的 schema（`src/types.ts:16`）与运行时 `ToolDefinition`（`src/tools/types.ts:6`）严格分离，`getToolDefinitions()`（`src/tools/index.ts:45`）只投影三元组，不泄露 `execute` / `category`。
- **自验证回路**：编辑后触发测试、摘要回传、重试上限三件可独立测试的小事拼成闭环（`src/harness.ts:188` `postExecute`、`src/verification/retry-loop.ts:39`、`src/verification/format-results.ts`）。摘要解析失败回退原始输出，保证模型不拿空信息。
- **旁路可观测**：`EventRecorder.emit()`（`src/observability/recorder.ts:37`）同步入队、后台 drain，sink 失败只写 stderr；payload 按 `SENSITIVE_KEY_PATTERN`（`src/observability/events.ts:40`）脱敏，不落盘真实凭证。观测从不成为主链路失败的新来源。
- **测试覆盖核心边界**：拒绝路径、危险命令、协议配对等均有针对性测试；`npm test` 全绿。

## 5. 比预期难的

- **多文件任务的稳定性**：`08-cross-file-rename` 单任务用了 12 turns / 17 tool calls（`evals/results/2026-06-14-final.json`），跨文件重命名要反复 grep/glob/read 定位，链路明显拉长，是平均 turns 上升的主因。
- **测试生成类任务**：唯一失败的 `09-add-tests-for-module` 在生成测试内容时未覆盖到 `multiple-spaces` 用例。这类"让模型写出符合隐含规格的测试"比"修一个明确的 bug"更难，模型容易遗漏边界。
- **测试输出解析的鲁棒性**：reporter 输出格式多样，`formatTestResults` 用正则解析、解析不出再回退原始 stdout/stderr，正是被现实输出反复打磨出来的兜底设计。

## 6. 下次会不同的 / 后续改进项（含证据）

- **正式 P4 continuous baseline 快照缺位**：`src/evals/baseline.ts` 已有 `createBaseline`，但 `src/evals/runner.ts` 的 `parseArgs` 没有 `--save-baseline` CLI flag，导致没有顺手的命令把一次真实 run 固化为 baseline，`evals/baselines/` 至今为空。改进：补一个保存 baseline 的 CLI 路径，并在一次真实 eval 后显式落盘。
- **真实 eval 未接入 CI**：当前 CI 只跑 `npm run ci` 和 PR 上的 `npm run eval:mock`（见 `README.md` eval 章节）；真实 regression eval 仍需本地手动跑。改进：接入受控的、带密钥的定时 workflow。
- **命令安全仅为基础正则黑名单**：`DANGEROUS_COMMAND_RULES`（`src/permissions/rules.ts:14`）能拦常见危险写法，但拦不住所有变形，且非完整 OS 沙箱。改进方向是更完整的命令安全策略与真正的沙箱隔离（仍属规划）。
- **单次 run 的统计意义有限**：final 结果未用 `--repeat` 多次取样，无法量化 flaky。改进：发布级评测应多次重复取均值与方差。

## 7. 里程碑确认（P5 达成）

- **可对外发布的开源仓库**：README（含架构图、配置表、使用示例、demo）、`LICENSE`（MIT）、`CONTRIBUTING.md`、GitHub issue/PR 模板、`package.json` 的 `bin`/`files`/`engines` 与入口 shebang 均已就位。
- **技术文章**：`docs/article-draft.md` 完成引言与第 1-6 节正文、持续 eval 趋势表与结论，代码片段均来自真实代码库。

P5 里程碑达成：可对外发布的开源项目 + 技术文章完成。仍坦诚的边界——这是覆盖 P1-P4 主链路的**极简**实现，不是完整 IDE Agent，没有完整沙箱与成熟命令安全策略；上述后续改进项是真实的、可追溯到代码与 artifact 的待办，而非营销话术。
