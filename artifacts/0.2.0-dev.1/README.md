# Ultra-RP-Memory 0.2.0-dev.1 审核插件包

本目录TGZ为实际31项原生SDK验收使用的同一文件，SHA256见同目录SHA256SUMS.txt。包名 @dsh-external/dsh-ultra-rp-memory，要求DSH0.2.1-rc.2、Cordis4.0.5、Schemastery3.18.5、Node22或更高；验证使用Node22.23.3。独立可用，可选精确兼容版Ultra。

通过宿主插件导入功能选择TGZ；保留默认禁用，按仓库README配置实际profile/workspace/entityIds和可信合作写入者后显式启用。管理页用 `/rp start`、`/rp person manage` 手动打开；存储分段必须另执行明确scope的 `global storage-enable`，不会自动迁移日常库。

源码、测试和构建脚本位于同一提交的仓库根；可下载该提交源码ZIP。包内文档为打包时快照，完整最终验收报告请看仓库docs/rp-memory-dev3/RESULTS.md。未发布npm或Release，旧稳定包保留。

已知未验证：一次未复现的对象检查异常根因、最终浏览器复查、真实模型语义、长期使用、断电及生产数据迁移。此包供审核和隔离profile测试。
