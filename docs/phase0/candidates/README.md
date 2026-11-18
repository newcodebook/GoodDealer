# 冻结候选记录

每个文件记录一个冻结候选：由 `pnpm check:candidate --out docs/phase0/candidates/<commit>.json` 在干净
工作树上生成，分别以 umask `002` 与 `022` 运行根 `pnpm check`，并记录完整提交 SHA、工具链版本、
退出码和输出摘要。

复现方法：检出记录中的 `commit`，使用相同工具链再次运行 `pnpm check:candidate`。输出摘要包含耗时等
非确定内容，只用于核对同一次运行的日志，不要求跨运行相同；可复现的是两个 umask 下的退出码。

候选记录只是该提交的本地实现证据（`claim: local-implementation-evidence`，`closesGate: false`）。
它不是 V1 验收，也不是部署、Provider、原生或发行资格；后续提交不继承它的结论。阶段 4 的 V1 汇合验收
必须在自己的冻结候选上重新取得全部证据。
