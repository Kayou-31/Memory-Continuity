# M4 与产品化审阅闭环

一个修改执行者，复用一个只读审阅者，未递归委派；构建/测试串行。审阅者未修改文件或运行测试，以下回归由主执行者实际运行。

| 确认问题 | 修复 | 实际证据 |
| --- | --- | --- |
| 管理快照fence别名可被调用者更新 | 保存深拷贝 | management-review-red → management-review-green |
| 确认后、commit前撤权仍可能写事实 | AsyncLocalStorage发布guard，在真正blob/transaction发布前复验 | 同上 |
| 已commit但回执丢失，旧fence挡住同key恢复 | 识别已认证的先前commit，用原key/原内容恢复 | manager-recovery-red → management-review-green |
| 独立写入者插入导致提案使用新fence认证旧预览 | 原始fence传到核心提案/拒绝读视图 | 同上 |
| listener打开中关闭入口，异步返回重新激活 | opening reservation，关闭立即撤销 | manager-opening-red → management-review-green |
| 复制正文未对照发布元数据 | 迁移前hash/长度校验，缺失拒绝 | segments-body-red → segments-related |
| 备份文件readback不能证明落盘 | 每份文件sync，最后manifest原子发布 | 静态修正；故障回归，不是真实断电 |
| backup tree中的子文件ENOENT被当作顶层不存在 | 仅顶层存在性检查可忽略ENOENT | segments-host-backup-red → segments-related |
| 分段8192条仍被通用4096数组上限拒绝 | 分段完整逻辑状态显式8192，默认输入不变 | segments-count-red → segments-count-green |

已运行管理9/9、人物/模块/生命周期37/37、存储相关15/15、容量边界/旧reader/4097各1/1。准确命令和失败日志保留，最终全量单独运行，不拼接。没有确认的未修P1/P2；静态审阅不代表没有其他缺陷。

已发送的文件系统rename、已交付浏览器的文本无法追溯撤回。管理页只在本机原生会话明确打开；同进程恶意代码不属于能力隔离保证。完整历史读取成本、孤儿页清理、长期真实模型质量及真实断电继续列为限制。
