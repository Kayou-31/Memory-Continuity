# 固定标注 fixture 评价

运行 `node scripts/benchmarks/rp-memory.mjs --mode fixture --corpus benchmarks/rp/golden.jsonl --output fixture-report.json`。默认构建不会运行评价或模型。当前只实现 fixture 模式；其他模式拒绝，不接入任何 provider。

golden.jsonl 包含12个中文固定样本，覆盖事实、谎言、误解、道具、承诺、关系方向、秘密、倒叙、retcon、分支、不确定性和同名实体。标注与输出由实现代理编写，人工可复核；没有用户人工裁决或真实模型生成的声明。每项同时包含正确、关键事实遗漏、实际来源ID但语义错误、主体错误等输出；秘密另有错误POV对照。

scorer 按预先标注的 subject/predicate/object/epistemic/speaker/time 元组和真正支持的 sourceIds 评分；引用必须是实际来源中的引文，ID存在不等于支持。关键事实召回、其他事实召回、unsupported、归属各维、POV违规与引用支持分别保留分子/分母，分母为0时rate=null。有限语料中的任一关键事实遗漏或POV违规阻断对应fixture门，不能被平均分抵消。

这是 exact-annotation scorer 的正负例验证。它不理解任意自然语言，也不评价生产模型忠实度；无精确token或压缩比、无p50/p95或实际费用估计。toy 机制证据独立映射A矩阵；offline仅报固定标注fixture；live为not-run、样本0、指标null，不报100%或零事故。P4的蓝钥匙→金钥匙样本保持其独立结构可过、语义失败证据。
