# Ultra-RP-Memory：M4、统一管理与长期存储

用户在 2026-10-23 明确授权按 M4 → 管理界面 → 验证 → 长期存储的顺序串行实施，最后更新报告、插件包和 GitHub，正式更名。基线 9eda3d0；保留现有 M0–M3 和稳定 main，不自动合并或发布 npm。

## 裁决与边界

- 继续 TypeScript、DSH 0.2.1-rc.2、Cordis 4.0.5、Schemastery 3.18.5；独立包和 Ultra 可选适配不变。
- 正式产品名 Ultra-RP-Memory，包名 @dsh-external/dsh-ultra-rp-memory；新功能包使用 0.2.0-dev.1，旧 dev.3 产物保留。GitHub 仓库目标名称 dsh-ultra-rp-memory，保留仓库历史和审核 PR。
- 不开启任何自动摘要、自动采纳、自主行动、轮询任务或付费模型请求。新管理服务仅由可信用户命令打开，绑定本机回环地址和一个原生会话，手动刷新，显式提交，关闭或会话失效即撤权。
- M4 区分确定性规则、实际 SDK 请求路径与真实模型语义。固定故事的两个对照只测证据可用性，不能包装为模型回答质量。

## M4

固定四类故事：人物与情境连续性；定向关系和目标；Retcon/隐私与人生分支；模块撤销/冷恢复。以实际 core 写入和读取，逐项检查当前投影、证据和拒绝行为。加入长历史干扰及冷读。对同一证据集合比较有效记忆、最近窗口、原文存档两个对照；对照不进入生产、不绕过删除接口。输出原始观察、准确范围、耗时和内存，断言失败时命令非零。

## 统一管理

复用 person/agentMemory/canonical 原有服务，禁止建立第二套事实库。手动启动 localhost 管理页，使用随机 bearer capability（URL fragment，不写 journal），严格 Host/Origin 和 JSON 检查，无 CORS、外部资源和模型接口。页面提供人物选择/创建、字段修改与策略、关系和目标只读视图及显式更新、经历记录、时间线、成长提案/逐项或批量采纳/拒绝，以及当前用途与规则显示。

所有变更需先取得服务端保存的快照句柄；句柄绑定原始 authority、fence、人物、配置和请求内容，版本变化拒绝，不能把旧页面内容用新 fence 执行。界面使用 textContent 渲染不可信文本。复用实际命令/核心验证，写入仍形成用户控制来源。关闭后 token 和所有预览失效，不把 UI 接口注册成模型工具。

## 长期存储门槛

M4 与管理验收后才修改存储。先记录当前长历史容量与成本，选择有界、显式启用、可备份回退的存储扩展。语义记录和分支/global v1 保持；新物理布局必须使旧 reader 明确拒绝，不能让旧程序读取落后的双份数据。迁移原件和完整事务历史必须保留并校验，恢复不跳过 hash/seal。禁止为了容量截断事务，禁止把有限测试称为无限历史。

### 2026-10-23 存储阶段裁决

原 branch 已按事务追加，首先扩展全局累计 envelope 的物理容量。默认 v1 保持3 MiB发布/4 MiB控制上限；仅可信人工命令 `global storage-enable` 可升级当前明确 scope。升级在同一 writer lock 下校验完整历史、补齐旧seal、复制并逐文件SHA256核验 commits/blobs/seal/identity 到独立 backups 目录，最后写完成manifest；备份失败不发布升级commit。备份含私密历史，不随在线隐私删除自动清除。

新 commit 使用 `rp.global-segments/v1` 描述符：相同语义 State 按 publications 和 keys 分页，每页最多256 KiB，页面按SHA256寻址并重用；descriptor保留 fence/seq/previousHash、页引用、重建State哈希和备份标识。原v1 commit完全保留。每次读取仍验证全部事务链、全部被引用页、State和seal；不信任缓存。旧reader面对descriptor明确拒绝；新reader拒绝升级后降回旧envelope。没有旧副本可供旧reader误读新状态。

新布局完整逻辑envelope限制8 MiB发布/12 MiB控制，最多8192 publications、8192发布keys/12288控制keys，每种页引用最多128；单页和descriptor继续有独立上限。容量预检在写入blob/page前完成，幂等和seal恢复顺序不变。新页只在完整commit发布后可见，孤儿页暂保留、不自动清理。升级后回退只能在停用插件后恢复整个已核验备份，升级后写入需另外保全。

这是有界全局容量与磁盘重复量改进，不是无限存储。完整历史扫描仍随历史增加；分支索引、分页UI更久历史和长期压测留作后续，实际测量不能外推多年运行。
