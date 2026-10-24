# Memory-Continuity 指令更名验证

日期：2026-10-24。版本：0.2.0-dev.4；基线 `e0ae02a80e8508c97ec38011c2e066da0464bf9f`，分支 `feat/m5-layered-continuity`。

主命令改为 **`/memcont`**，取 Memory + Continuity。`/rp` 保留为兼容别名，两个入口使用同一个 handler、owner、权限和会话状态；不注册容易歧义的 `/mc`。其余子命令与参数不变。

```text
/memcont help
/memcont start
/memcont status
/memcont person manage
/memcont injection preview 我想回忆上次的约定
/memcont continue-clean
```

## 改动范围

- `src/rp/rp-plugin.ts`：使用真实 SDK 的两次命令注册提供主入口及旧别名，统一释放；错误与候选提示推荐新命令。
- `src/rp/command-help.ts`：主帮助和六类专题的命令示例统一使用 `/memcont`。
- `src/rp/person/editor.ts`、`management.ts`、`manager-ui.ts`、`ui/person-editor`：导入命令生成器及管理提示同步；浏览器 bundle 由构建生成。
- `README.md`、`docs/COMMANDS.zh.md`、M5 说明和人物/成长/存储/摘要/叙述者使用文档：更新当前使用方式，保留历史验证报告原文。
- `test/fixtures/rp/native-host.mjs`：普通真实 SDK 测试默认走 `/memcont`。
- `test/rp-command-help.test.mjs`：新增命令发现、没有 `/mc`、新旧命令共用分支、两种入口各发送一次、关闭同时释放两个入口的回归。
- 包版本与锁文件改为 dev.4；构建重新生成 `SOURCE-MANIFEST.json`。

## 回归证据

先运行新增用例，再修改注册和帮助。`node --test test/rp-command-help.test.mjs` 初次退出 1，2/4 通过、2/4 失败，分别为主命令尚未注册和帮助仍使用旧命令。实现后同一命令退出 0，4/4 通过。原始日志保存在 `work/memcont-command-2026-10-24/rename-red.log` 与 `rename-green.log`。

## 兼容性与边界

这是命令入口更名，没有数据迁移。`rp-memory` 配置节点、`.dsh-rp` 数据目录、branch/global v1、host journal v2、`sessionMemoryPolicy/v1` 和 `rp_memory_*` 模型工具名保持原格式。更换插件包时只启用一个版本。M5 已有备份与新版读取规则继续适用，详见 [M5 迁移说明](README.md)。

Node v22.23.3、npm 11.16.0、DSH 0.2.1-rc.2（session format 4）、Cordis 4.0.5、Schemastery 3.18.5、TypeScript 5.9.3、esbuild 0.25.12。Windows/PowerShell，串行构建与测试。

宿主回归使用真实 SDK 与离线 terminal；不能据此评价真实模型的语义质量。外包前端尚未收到，本轮不新增浏览器交互验收。没有后台自动功能或付费 API。上一轮独立依赖安装与 37 项包验收是 dev.3 的历史证据，不算本轮重新通过；本轮实际命令和包验收在下面单独记录。其余未完成/未验证项继续见 [后端报告](BACKEND-RESULTS.md#保留的未完成未验证项)。

## 本轮命令与交付

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `npm run typecheck` | 0 | 完整类型检查 |
| `npm run build` | 0 | ESM、类型、编辑器 bundle 和 manifest 生成 |
| `npm test` | 0 | **单次完整 249/249**，0 失败/跳过/取消，133.419 秒 |
| `npm run evaluate:fixture` | 0 | 固定语料协议校验，无模型调用 |
| `npm pack --dry-run` | 0 | 272 个文件，打包清单通过 |

以上没有拼接定向重跑；最终日志在 `work/memcont-command-2026-10-24`。实际插件包、完整源码与校验记录放入 `outputs/memory-continuity-0.2.0-dev.4-command-2026-10-24`（本聊天工作目录下）。包内报告记录打包时点，旁置 `RESULTS.md` 补充实际包和归档验收。没有 Git push、远程仓库更名或 Release/npm 发布。

### 实际插件包与独立重建

`npm pack --json --pack-destination <交付目录>` 退出 0。包为 `dsh-external-dsh-memory-continuity-0.2.0-dev.4.tgz`，2,590,027 字节、272 个条目；SHA-256：`c3a8f89944e1020328a670caa74ab57a0edfba6743b2e84d298889623f991439`。解包检查路径、类型和唯一性，manifest 中 102 个文件的长度与哈希均匹配。

`RP_PERSON_BUNDLE` 指向实际解包入口，`RP_NATIVE_SDK` 指向上一轮独立安装的真实 SDK，执行 `node --test --test-concurrency=1 test/rp-command-help.test.mjs test/rp-injection-host.test.mjs`：退出 0，**12/12**，0 失败/跳过/取消，5.361 秒。测试包括新旧命令、权限、注入、检索工具回执、干净续接和备份故障；与全量 249 项分开记录。

包验收后，在解包源码目录串行执行 `npm run typecheck`、`npm run build`，均退出 0。构建复用上一轮独立安装的锁定依赖，本轮未重新安装。重新生成的 SOURCE-MANIFEST 与主工作树完全一致，SHA-256：`6967665311cfb90925701d9bab1f35ec3fdf33463d18856a05953dac664e59d4`。

打包后只补充报告，没有改动运行代码。完整源码归档的 Git 提交、CRC 和逐文件 Git blob 验证记录见旁置 RESULTS 与 evidence。
