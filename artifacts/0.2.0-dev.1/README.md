# Ultra-RP-Memory 0.2.0-dev.1 预览插件包

本目录 TGZ 包含发布复审新增的实体白名单修复，已完成实际原生 SDK **31/31** 和包内公开接口 **1/1** 验收。大小 **826,602 字节**，236 个文件、96 项源码清单校验一致；SHA-256 见同目录 SHA256SUMS.txt。它替代本分支先前的审核包（旧 SHA-256 为 092f7240…），旧文件保留在 Git 历史和本地交付中。包名 `@dsh-external/dsh-ultra-rp-memory`，要求 DSH 0.2.1-rc.2、Cordis 4.0.5、Schemastery 3.18.5、Node 22 或更高；实际验证使用 Node 22.23.3。独立可用，可选精确兼容版 Ultra。

通过宿主插件导入功能选择TGZ；保留默认禁用，按仓库README配置实际profile/workspace/entityIds和可信合作写入者后显式启用。管理页用 `/rp start`、`/rp person manage` 手动打开；存储分段必须另执行明确scope的 `global storage-enable`，不会自动迁移日常库。

源码、测试和构建脚本位于同一提交的仓库根；完整源码 ZIP 与插件下载入口见 [中文发布页](https://github.com/Kayou-31/dsh-ultra-rp-memory/releases/tag/v0.2.0-dev.1)。包内文档为打包时快照，最终验收请看仓库 `docs/rp-memory-dev3/RESULTS.md` 和发行附件中的报告。仅在 GitHub 提供预览版，未发布到 npm；旧版发行附件保留。

已知未验证：一次未复现的对象检查异常根因、最终浏览器复查、真实模型语义、长期使用、断电及生产数据迁移。此包供审核和隔离profile测试。
