# WorkExpert 平台 Benchmark 中心

Benchmark 用于评测平台特征、比较版本和验证技术取舍，不替代功能测试。常规回归和发布验收进入 [`docs/quality/`](../quality/README.md)。

知识库内的[离线召回评测报告](../sdd/features/knowledge-evaluation/README.md)可导入人工标注的冻结快照，输出HTML报告；不在线采样、不调用检索、不自动调参。导入的耗时不是受控性能基准。

| 入口 | 内容 |
| --- | --- |
| [methodology.md](methodology.md) | 环境控制、统计方法和可比性规则 |
| [catalog.md](catalog.md) | Benchmark ID、领域和状态 |
| [suites/](suites/README.md) | Agent、运行时、模型、知识和集成评测 |
| [baselines/](baselines/README.md) | 平台和版本基线 |
| [reports/](reports/README.md) | 实际评测结果 |
| [datasets/](datasets/README.md) | 数据集来源、版本和许可 |
