# retcon-form 对 Memory-Continuity 的参考价值

用户提供链接并明确同意尝试吸收。调查时间2026-10-25，来源 [QiDouZu/retcon-form](https://github.com/QiDouZu/retcon-form)，核对提交 `564382e2a1864a12e52d4678ec565e26170d1f42`。

本次只读了README、格式、SHAPE、作者自我修订、Python实现、检查器及测试，没有运行第三方程序、加载它的SKILL或提示词，也没有复制实现代码。仓库声明MIT；若后续实际复用代码，须保留对应版权和许可。

值得吸收：对推断保留当时依据、条件和可修正状态；用可定位原文支持解释；原判断留档，后续修正追加；展示一次上下文选择实际提供了哪些材料。与我们的共同日记、成长审阅、原文定位和旧摘要失效相吻合。

采用边界：

- 普通日记自由写，结构化反思是可选项。不会把每一条身份定义、直接事实或生活感受全部降成待验证猜想。
- 证据使用本项目认证的source/record/revision/hash/span；其他格式可作为人工导入素材，不直接获得可信来源身份。
- “当时的理解”与客观事实分开，追加修正让旧推断过时。不会把模型的自我打分当成真相。
- 系统提供片段的记录不是模型理解证明；未选片段不自动等于语义遗漏或错误。
- 不采用其遇到损坏JSON行后跳过的存储容错方式，继续由本项目存储拒绝不可验证历史；不引入第二数据库、后台回访或自动事实采纳。

证据边界：官方检查器主要按栏目、关键词及文本长度检查完整性；其测试和沙盘不能证明语义正确性或长期人物连续性。作者在自我修订中同样收窄了格式对判断质量的承诺。本项目不会把该仓库宣称的17场景结果写成我们的验收。

主要参考：

- [判断记录格式](https://github.com/QiDouZu/retcon-form/blob/564382e2a1864a12e52d4678ec565e26170d1f42/%E6%A0%BC%E5%BC%8F.md)
- [片段和使用记录](https://github.com/QiDouZu/retcon-form/blob/564382e2a1864a12e52d4678ec565e26170d1f42/SHAPE.md)
- [作者的自我修订](https://github.com/QiDouZu/retcon-form/blob/564382e2a1864a12e52d4678ec565e26170d1f42/%E6%8E%A8%E7%BF%BB_%E5%8E%9F%E6%9C%89%E7%BB%93%E6%9E%9C_v2.md)
- [存储实现](https://github.com/QiDouZu/retcon-form/blob/564382e2a1864a12e52d4678ec565e26170d1f42/retcon.py#L74-L109)
- [格式检查器](https://github.com/QiDouZu/retcon-form/blob/564382e2a1864a12e52d4678ec565e26170d1f42/scripts/check_seal.py)
