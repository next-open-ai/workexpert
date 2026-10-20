# Knowledge Benchmark Suite

覆盖 Embedding 吞吐与兼容性、检索召回、排序质量、索引变更影响和知识问答效果。首批包含 BM-EMB-001。

## KE-P03 v1：重复计算微基准（2026-10-18）

入口 `node scripts/knowledge-performance-benchmark.mjs`（先构建 storage、agent-core）。自生成固定400块/40条命中，无随机性、无外部数据许可或网络费用；真实临时SQLite，单线程，3次预热、20轮交替测量旧逐条读取和新批量读取并断言等价。Embedding为确定性fetch桩，400条输入含100条唯一文本，maxBatch=32；旧13次请求由原顺序分批算法计算，新4次为实测，不比较供应商延迟。没有模型Prompt、Tool或外部判分器。

本次 Apple M2 / macOS arm64 / Node22.22.1，工作区基于51fa72c且有未提交改动。证据读取中位137.29→4.64ms，P95 194.05→6.77ms；保留异常较慢样本，不剔除。fixture摘要、全部原始样本和环境见 [原始结果](../../reports/knowledge-performance-2026-10-18.json)。后台构建可能影响绝对耗时，这只是同批次多命中的阶段级微基准，不是生产SLA、端到端提速、跨文档最坏情况或召回率改善声明。没有重复文本时Embedding请求数不减少；不缓存后续调用。

功能门禁是 KE-P01/P02 及既有知识验收，不能用此微基准替代；真实模型和大库端到端评测尚未执行。
