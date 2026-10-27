# 本轮算法从哪里来

这轮复用的是仓库所有者授权采用的算法思路，Memory-Continuity 内重新实现 TypeScript 版本；没有引入 Python、RapidFuzz、向量数据库或新的运行时依赖。

## 有界的相似内容复核

参考 [reusable-algorithm-assets 的 candidates.py](https://github.com/Kayou-31/reusable-algorithm-assets/blob/905552ea51c01f0b816c61ad08cad7319fbf6c2b/src/algorithm_assets/candidates.py) 的候选倒排与工作预算，以及同提交的 [dedupe.py](https://github.com/Kayou-31/reusable-algorithm-assets/blob/905552ea51c01f0b816c61ad08cad7319fbf6c2b/src/algorithm_assets/dedupe.py) 的全组两两相容约束。审查版本为 `905552ea51c01f0b816c61ad08cad7319fbf6c2b`。

落地文件是 `src/rp/similarity-review.ts`。它先隔离归属，再按 Unicode 双字片段建立索引；比较次数、文本体积、分区元数据、热门候选桶和结果数量都有限额。归属字符串只存一次，索引使用短编号，避免长来源信息在每个片段键中重复分配。

Memory-Continuity 没有采用自动去重：文字相似、否定词差异和日期差异都是给人看的复核线索。一个组中的任意两项都必须已经比较、达到阈值且没有差异提示，才显示为一组；这仍不证明事实相同。预算耗尽必须在界面披露，不能把未检出解释成没有问题。

此仓库所读快照未发现根目录 LICENSE 或明确的软件包许可声明，因此这里记录所有者授权与设计来源，不把它描述为具有某种已核实开源许可证的外部依赖，也不复制第三方 RapidFuzz 实现。

## 没有替换的部分

也检查了 [kayou-foundation](https://github.com/Kayou-31/kayou-foundation/tree/c4133c5bd9880c6b7244d68c804922587f63420f) 的来源和上下文预算设计。当前项目已经有自己的来源认证与预算边界，没有再叠一套相同能力。

反向依赖队列在 `scripts/benchmarks/dependency-propagation.mjs` 中做影子对照。76 个固定或生成案例结果等价，但常见插入顺序下没有明确速度收益，因此没有替换生产存储的传播实现。它也没有测量文件读写、授权、载荷副本和隐私删除完整闭包，不能把这个小实验推广成整个存储的性能结论。

具体数据、误判和未覆盖部分见 [本轮验证报告](RESULTS.md)。
