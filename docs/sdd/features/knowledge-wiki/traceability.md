# Wiki 追踪矩阵

WK-M19 → WK-T19 → WK-M19-T：[已有主题合并预览](incremental-merge.md)。保守章节追加、双方版本校验、仅保存更新草稿；实际状态见 status。

2026-10-21 WK-R18 → WK-T18 → WK-R18-T：[显式断点续跑](resumable-generation.md)替代下文“候选仅内存/不能续跑”的历史限制。旧任务仍只能重新生成，新任务按私有检查点恢复；不自动调用模型，实际验证见 status。

WK-D17 → WK-T17 → WK-D17-T：[生成阶段与显式重新生成](generation-diagnostics.md)。阶段由服务端持久化；重新生成需二次确认，不是断点续算。状态见 status。

0.12：WK-15 → contracts/ui → WK-T11 → WK-U08（原搜索协议与真实Wiki浏览器回归）。

0.11：WK-14 → ADR-0009 / contracts → WK-T10 → WK-R04 / WK-U07。

0.10：WK-04/08/12 → WK-T06d → WK-U06；批量交互与兼容边界见 ui/contracts。

0.9：WK-06/08/12 → WK-T06c → WK-U05；直接打开与页面章节树契约见 ui。

0.8：WK-03/08/09/12 → WK-T04c → WK-G01c/G02c/A07/U04；失败反馈与兼容契约见 contracts。

0.7：WK-02/03/08/09/12 → WK-T04b → WK-G01b/G02b/A06；设计与兼容性见 [有界分批](batching.md)。

状态：实施中；规格版本：0.2；更新日期：2026-10-16。关联：[需求](requirements.md)、[任务](tasks.md)、[测试](test-spec.md)。

| 需求 | 设计事实源 | 任务 | 验证 |
| --- | --- | --- | --- |
| WK-01 | ADR/architecture | T02/T05/T06 | R03/E01 |
| WK-02 | architecture/state-machine | T04 | C01/G01/G02 |
| WK-03 | architecture/contracts | T04 | G01/E01 |
| WK-04 | contracts/state-machine | T02/T05/T06 | S02/G02/U01 |
| WK-05 | architecture/contracts | T02/T05 | R01/R03/B01 |
| WK-06 | architecture/ui | T05/T06 | R02/U01 |
| WK-07 | ADR-0007/architecture/state-machine | T03/T05/T05a | S03/A01/A02/E01 |
| WK-08 | ui | T06 | U01/U02/E01 |
| WK-09 | contracts/state-machine | T04 | G02/E02 |
| WK-10 | ADR/plan | T02/T03/T07 | S01/S02/R03/E02 |
| WK-11 | ADR/contracts | T01/T02 | C01/评审边界 |
| WK-12 | manual-plan | T08 | D01 |
| WK-13 | ADR-0008/ownership | T09a/T09b | A03/后续库内继承验收 |

表内任务省略 WK- 前缀，测试省略 WK- 前缀；统一按完整 ID 引用测试报告。T01 覆盖全部文档评审，T07 汇总全部工程验收，但不得替代各实现任务自身测试。

0.5 小批量子集：WK-02/03/09 → WK-T04a → WK-G01a/G02a/A04/S01a；WK-04/05/06/08 → WK-T06a → WK-A04/U01a；WK-12 → WK-T08a 手册小批量入口说明与生成产物。任务完成证据只在 status 维护。

0.6 编辑子集：WK-04/07/08/12 → WK-T06b → WK-U03/A05、手册 8.6 与应用内产物。无数据迁移、无新增模型调用或权限控制。
