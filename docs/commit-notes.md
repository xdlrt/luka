# Commit Notes

## document agent contribution rules

- commit: document agent contribution rules
- Why: 最终技术文章和分享不能只依赖阶段末回忆；Agent 过程中的约束、取舍和踩坑点必须在每次提交后沉淀下来，避免关键设计背景丢失。
- What: 将 AGENTS 从项目说明书收敛为高信噪比执行约束，并新增 commit 后必须在 `docs/commit-notes.md` 记录 Why / What / How 的规则。
- How: 通过 AGENTS 的强约束和正反例范式固定记录位置、字段和质量要求；验证方式为 `npm run build` 与 `npm test`，确认文档改动不影响现有 66 条测试。
